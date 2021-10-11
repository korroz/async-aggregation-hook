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

interface Aggregator {
  aggregate: (queries: string[]) => Observable<number[]>;
  aggregateObj: (
    queries: Record<string, string>
  ) => Observable<Record<string, number>>;
}

type AggregatorBackend = (
  queries: string[]
) => Observable<Record<string, number>>;
class AggregatorService<T extends BufferControl<Observable<string>>>
  implements Aggregator
{
  private response$: Observable<Record<string, number>>;
  private readonly request$ = new Subject<Observable<string>>();
  constructor(public readonly control: T, backend: AggregatorBackend) {
    this.response$ = this.request$.pipe(
      control.buffer(),
      mergeMap((rs) =>
        from(rs).pipe(
          concatAll(),
          //log('Request'),
          distinct(),
          toArray(),
          log('Deduped'),
          mergeMap(backend)
        )
      ),
      log('Backend result'),
      share()
    );
  }

  private result = (query: string) => {
    return this.response$.pipe(
      map((r) => r[query]),
      filter((r) => r !== undefined)
    );
  };
  private request(queries: string[], subscription: Subscription) {
    this.request$.next(iif(() => subscription.closed, EMPTY, from(queries)));
  }

  // Aggregator interface signature
  aggregate(queries: string[]) {
    return new Observable<number[]>((subscriber) => {
      const sub = combineLatest(rmap(this.result, queries)).subscribe(
        subscriber
      );
      this.request(queries, sub);
    });
  }
  aggregateObj(queries: Record<string, string>) {
    return new Observable<Record<string, number>>((subscriber) => {
      const doom = rmap<
        Record<string, string>,
        Record<string, Observable<number>>
      >(this.result, queries);
      const sub = combineLatest(doom).subscribe(subscriber);
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
    map((r) => zipObj(qs, r)),
    delay(backendLatency)
  );

const aggregatorBufferControl = new ModeBufferControl<Observable<string>>(
  debounceWait
);
export const aggregatorService = new AggregatorService(
  aggregatorBufferControl,
  backend
);
