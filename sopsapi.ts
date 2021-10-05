import { current } from 'immer/dist/core/current';
import {
  any,
  complement,
  compose,
  equals,
  find,
  isNil,
  keys,
  pair,
  props,
  reverse,
  values,
  zipObj,
  zipWith,
  map as rmap,
} from 'ramda';
import {
  Observable,
  Subject,
  BehaviorSubject,
  EMPTY,
  of,
  using,
  iif,
  from,
  combineLatest,
  Subscription,
  OperatorFunction,
} from 'rxjs';
import {
  scan,
  skipWhile,
  first,
  startWith,
  switchMap,
  debounce,
  mergeMap,
  map,
  tap,
  delay,
  share,
  buffer,
  switchAll,
  concatAll,
  distinct,
  toArray,
  debounceTime,
  filter,
} from 'rxjs/operators';

//+req: -a-a-a-b-c---------
//-req: --a-----b----------
// exe: ----------e--------
// qry:           ac|
//back:             --r|
// res: ----------------ac-
const debounceWait = 500,
  backendLatency = 500;
const log = (...data: any[]) =>
  tap((value: unknown) => console.log(...data, value));

const rng = () => Math.ceil(Math.random() * 100);
function stubAggAjax(queries: string[]) {
  return of(queries.map((q) => rng())).pipe(delay(backendLatency));
}

type Dict<T> = { [key: string]: T };

const req = new Subject<Observable<string>>();

export enum AggregationControl {
  Auto = 'auto',
  Manual = 'manual',
}

interface BufferControl<T> {
  buffer: () => OperatorFunction<T, T[]>;
}

function createBufferControl(hotReq: Observable<Observable<string>>) {
  let currentControl: AggregationControl = AggregationControl.Auto;
  const manualControl = new Subject<void>();
  const debounceControl = hotReq.pipe(debounceTime(debounceWait));
  const control = new BehaviorSubject<Observable<unknown>>(pickControl());
  return {
    buffer: () => buffer(control.pipe(switchAll())),
    getCurrentControl: () => currentControl,
    flushBuffer: () => manualControl.next(),
    toggleControl,
  };

  function pickControl(): Observable<unknown> {
    return currentControl === AggregationControl.Auto
      ? debounceControl
      : manualControl;
  }
  function toggleControl() {
    currentControl =
      currentControl === AggregationControl.Auto
        ? AggregationControl.Manual
        : AggregationControl.Auto;
    control.next(pickControl());
  }
}
const bufferControl = createBufferControl(req);

export const executeAggregations = bufferControl.flushBuffer;
export const getCurrentControl = bufferControl.getCurrentControl;
export const toggleControl = bufferControl.toggleControl;

const res = req.pipe(
  bufferControl.buffer(),
  mergeMap((rs) =>
    from(rs).pipe(
      concatAll(),
      // log('Query'),
      distinct(),
      toArray(),
      log('Deduped'),
      mergeMap((queries) =>
        stubAggAjax(queries).pipe(map((results) => zipObj(queries, results)))
      )
    )
  ),
  log('Backend result'),
  share()
);
function queryResult(query: string) {
  return res.pipe(
    map((r) => r[query]),
    filter((r) => r !== undefined)
  );
}
function requestQueries(queries: string[], subscription: Subscription) {
  req.next(iif(() => subscription.closed, EMPTY, from(queries)));
}

function requestAggregations<T extends string[] | Dict<string>>(
  aggs: T
): Observable<T extends string[] ? number[] : Dict<number>> {
  return new Observable<T extends string[] ? number[] : Dict<number>>(
    (subscriber) => {
      const sub = combineLatest(rmap(queryResult, aggs)).subscribe(subscriber);
      requestQueries(Array.isArray(aggs) ? aggs : values(aggs), sub);
    }
  );
}

interface Aggregator {
  aggregate: <T extends string[] | Dict<string>>(
    queries: T
  ) => Observable<T extends string[] ? number[] : Dict<number>>;
}

export function aggReq(queries: string[]): Observable<number[]> {
  return requestAggregations(queries);
  return new Observable<number[]>((subscriber) => {
    const sub = res
      .pipe(
        map(props(queries)),
        scan(
          zipWith(compose(find(complement(equals(undefined))), reverse, pair)),
          props(queries, {})
        ),
        skipWhile(any(isNil))
      )
      .subscribe(subscriber);

    // req.next(iif(() => sub.closed, EMPTY, from(queries)));
    requestQueries(queries, sub);

    return sub;
  });
}
function aggMapReq(queryMap: Dict<string>): Observable<Dict<number>> {
  return requestAggregations(queryMap);
  return new Observable<Dict<number>>((subscriber) => {
    const queryKeys = keys(queryMap);
    const queries = values(queryMap);
    const sub = res
      .pipe(
        scan((acc, results) => {
          const out = { ...acc };
          for (let k of queryKeys) {
            const value = results[queryMap[k]];
            if (value !== undefined) out[k] = value;
          }
          return out;
        }, {} as Dict<number>),
        skipWhile(compose(any(isNil), props(queryKeys)))
      )
      .subscribe(subscriber);

    req.next(iif(() => sub.closed, EMPTY, from(queries)));

    return sub;
  });
}

interface AggregationsRequest<T> {
  queries: string[];
  results: (results: number[]) => T;
}
function aggReqByIndex<T>(aggs: AggregationsRequest<T>[]): Observable<T[]> {
  return combineLatest(
    aggs.map((agg) => aggReq(agg.queries).pipe(map((r) => agg.results(r))))
  );
}
interface AggregationsRequestMap<T> {
  queries: Dict<string>;
  results: (results: Dict<number>) => T;
}
function aggReqByMap<T>(aggMaps: AggregationsRequestMap<T>[]): Observable<T[]> {
  return combineLatest(
    aggMaps.map((aggMap) =>
      aggMapReq(aggMap.queries).pipe(map((r) => aggMap.results(r)))
    )
  );
}

export interface CalculationRequest {
  queries: Dict<string>;
  evals: [string, (results: Dict<number>) => number][];
}
export function calculate(
  calcs: CalculationRequest[]
): Observable<Dict<number>[]> {
  return combineLatest(
    calcs.map((calc) =>
      aggMapReq(calc.queries).pipe(
        map((r) =>
          calc.evals.reduce((acc, v) => ({ ...acc, [v[0]]: v[1](acc) }), r)
        )
      )
    )
  );
}
