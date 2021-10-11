import {
  BehaviorSubject,
  combineLatest,
  EMPTY,
  from,
  iif,
  Observable,
  of,
  OperatorFunction,
  Subject,
  Subscription,
} from 'rxjs';
import {
  buffer,
  concatAll,
  debounceTime,
  delay,
  distinct,
  filter,
  map,
  mergeMap,
  share,
  switchAll,
  tap,
  toArray,
} from 'rxjs/operators';
import { map as rmap, values, zipObj } from 'ramda';

interface BufferControl<T> {
  buffer: () => OperatorFunction<T, T[]>;
}
export enum BufferControlMode {
  Auto = 'auto',
  Manual = 'manual',
}
class ModeBufferControl<T> implements BufferControl<T> {
  private _mode = new BehaviorSubject<BufferControlMode>(
    BufferControlMode.Auto
  );
  private manualControl = new Subject<void>();

  constructor(private time: number) {}
  // BufferControl<T> signature
  buffer(): OperatorFunction<T, T[]> {
    return (source: Observable<T>) => {
      const deb = source.pipe(debounceTime(this.time));
      const ctrl = this._mode.pipe(
        map((mode) =>
          mode === BufferControlMode.Auto ? deb : this.manualControl
        ),
        switchAll()
      );
      return source.pipe(buffer<T>(ctrl));
    };
  }
  flush(): void {
    this.manualControl.next();
  }
  get mode(): BufferControlMode {
    return this._mode.value;
  }
  set mode(mode: BufferControlMode) {
    this._mode.next(mode);
  }
  cycleMode(): BufferControlMode {
    return (this.mode =
      this.mode === BufferControlMode.Auto
        ? BufferControlMode.Manual
        : BufferControlMode.Auto);
  }
}

interface Agg {
  query: string;
  hint: string;
}
export function agg(query: string, hint?: string): Agg {
  hint = hint || 'a';
  return { query, hint };
}
function fullAgg(agg: Agg): string {
  return `QUERY ${agg.query} HINT ${agg.hint}`;
}
type FullAggQuery = string;
interface CompiledAgg extends Agg {
  full: FullAggQuery;
}
function compileAgg(agg: Agg): CompiledAgg {
  return { ...agg, full: fullAgg(agg) };
}

interface Aggregator {
  aggregate: (queries: Agg[]) => Observable<number[]>;
  aggregateObj: (
    queries: Record<string, Agg>
  ) => Observable<Record<string, number>>;
}

type AggregatorBackend = (
  queries: CompiledAgg[]
) => Observable<Record<FullAggQuery, number>>;
class AggregatorService<T extends BufferControl<Observable<CompiledAgg>>>
  implements Aggregator
{
  private response$: Observable<Record<FullAggQuery, number>>;
  private readonly request$ = new Subject<Observable<CompiledAgg>>();
  constructor(public readonly control: T, backend: AggregatorBackend) {
    this.response$ = this.request$.pipe(
      control.buffer(),
      mergeMap((rs) =>
        from(rs).pipe(
          concatAll(),
          //log('Request'),
          distinct((a) => a.full),
          toArray(),
          log('Deduped'),
          mergeMap(backend)
        )
      ),
      log('Backend result'),
      share()
    );
  }

  private result = (query: CompiledAgg) => {
    return this.response$.pipe(
      map((r) => r[query.full]),
      filter((r) => r !== undefined)
    );
  };
  private request(queries: CompiledAgg[], subscription: Subscription) {
    this.request$.next(iif(() => subscription.closed, EMPTY, from(queries)));
  }

  // Aggregator interface signature
  aggregate(queries: Agg[]) {
    const caggs = rmap(compileAgg, queries);
    return new Observable<number[]>((subscriber) => {
      const sub = combineLatest(rmap(this.result, caggs)).subscribe(subscriber);
      this.request(caggs, sub);
    });
  }
  aggregateObj(queries: Record<string, Agg>) {
    const caggs = rmap<Record<string, Agg>, Record<string, CompiledAgg>>(
      compileAgg,
      queries
    );
    const oaggs = rmap<
      Record<string, CompiledAgg>,
      Record<string, Observable<number>>
    >(this.result, caggs);
    return new Observable<Record<string, number>>((subscriber) => {
      const sub = combineLatest(oaggs).subscribe(subscriber);
      this.request(values(queries).map(compileAgg), sub);
    });
  }
}

function log<T>(...data: any[]) {
  return tap<T>((value: T) => console.log(...data, value));
}

const debounceWait = 500,
  backendLatency = 500;

const rng = () => Math.ceil(Math.random() * 100);
const backend: AggregatorBackend = (qs) =>
  of(qs.map(rng)).pipe(
    map((r) =>
      zipObj(
        qs.map((q) => q.full),
        r
      )
    ),
    delay(backendLatency)
  );

const aggregatorBufferControl = new ModeBufferControl<Observable<CompiledAgg>>(
  debounceWait
);
export const aggregatorService = new AggregatorService(
  aggregatorBufferControl,
  backend
);
