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

export interface Agg {
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
interface AggQuery extends Partial<Agg> {
  full: AggQueryString;
}
function compileAgg(q: AggOrQuery): AggQuery {
  if (isAggQuery(q))
    return q;
  else if (typeof q === 'string')
    return <AggQuery>{ full: q };
  else
    return <AggQuery>{ ...q, full: fullAgg(q) };
}
function isAggQuery(query: AggOrQuery) : query is AggQuery {
  return (query as AggQuery).full !== undefined;
}
type AggQueryString = string;
type AggOrQuery = Agg | AggQuery | AggQueryString;
type ArrayOrRecord<T> = T[] | Record<string, T>;
type NumberResult<T extends ArrayOrRecord<AggOrQuery>> = T extends any[] ? number[] : Record<AggQueryString, number>;

interface Aggregator {
  aggregate: <T extends ArrayOrRecord<AggOrQuery>>(queries: T) => Observable<NumberResult<T>>;
}

type AggregatorBackend = (
  queries: AggQuery[]
) => Observable<Record<AggQueryString, number>>;
class AggregatorService<T extends BufferControl<Observable<AggQuery>>>
  implements Aggregator
{
  private response$: Observable<Record<AggQueryString, number>>;
  private readonly request$ = new Subject<Observable<AggQuery>>();
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

  private result = (query: AggQuery) => {
    return this.response$.pipe(
      map((r) => r[query.full]),
      filter((r) => r !== undefined)
    );
  };
  private request(queries: AggQuery[], subscription: Subscription) {
    this.request$.next(iif(() => subscription.closed, EMPTY, from(queries)));
  }

  // Aggregator interface signature
  aggregate(queries: AggQueryString[]) : Observable<number[]>;
  aggregate(queries: Agg[]) : Observable<number[]>;
  aggregate(queries: Record<string, AggQueryString>) : Observable<Record<string, number>>;
  aggregate(queries: Record<string, Agg>) : Observable<Record<string, number>>;
  aggregate<Q extends ArrayOrRecord<AggOrQuery>>(queries: Q) : Observable<NumberResult<Q>>;
  aggregate<Q extends ArrayOrRecord<AggOrQuery>>(queries: Q) : Observable<NumberResult<Q>> {
    if (Array.isArray(queries)) {
      const doom = queries.map(compileAgg);
      return this.aggregateArr(doom) as Observable<NumberResult<Q>>;
    }
    else {
      const doom = rmap<Record<string, AggOrQuery>, Record<string, AggQuery>>(compileAgg, queries);
      return this.aggregateObj(doom) as Observable<NumberResult<Q>>;
    }
  }
  private aggregateArr(queries: AggQuery[]) : Observable<number[]> {
    return new Observable<number[]>((subscriber) => {
      const sub = combineLatest(rmap(this.result, queries)).subscribe(subscriber);
      this.request(queries, sub);
    });
  }
  private aggregateObj(queries: Record<string, AggQuery>) {
    const oaggs = rmap<
      Record<string, AggQuery>,
      Record<string, Observable<number>>
    >(this.result, queries);
    return new Observable<Record<string, number>>((subscriber) => {
      const sub = combineLatest(oaggs).subscribe(subscriber);
      this.request(values(queries), sub);
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

const aggregatorBufferControl = new ModeBufferControl<Observable<AggQuery>>(
  debounceWait
);
export const aggregatorService = new AggregatorService(
  aggregatorBufferControl,
  backend
);
