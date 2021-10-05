import { useEffect, useState } from 'react';
import { of, Subject, iif } from 'rxjs';
import {
  buffer,
  debounceTime,
  map,
  share,
  tap,
  first,
  delay,
  mergeMap,
  scan,
  skipWhile,
  groupBy
} from 'rxjs/operators';
import {
  addIndex,
  all,
  any,
  complement,
  compose,
  equals,
  find,
  has,
  isNil,
  none,
  pair,
  map as rmap,
  props,
  uniq,
  zipObj,
  zipWith,
  __,
  chain,
  findLast,
  reverse,
  values, zip
} from 'ramda';
import { produce } from 'immer';
import {
  AggregationControl,
  aggReq,
  executeAggregations,
  getCurrentControl,
  toggleControl,
  calculate as calcApi
} from './sopsapi';

// const clicks$ = fromEvent(document, 'click').pipe(share());
// const bufferedAndDebounced$ = clicks$.pipe(
//   map(() => 'pretend agg request'),
//   tap(x => console.log(x)),
//   buffer(clicks$.pipe(debounceTime(1000)))
// );

// bufferedAndDebounced$.subscribe(console.log);
const debounceWait = 500,
  backendLatency = 500;
const log = (...data: any[]) =>
  tap((value: unknown) => console.log(...data, value));

const rng = () => Math.ceil(Math.random() * 100);
function stubAggAjax(queries: string[]) {
  return of(queries.map(q => rng())).pipe(delay(backendLatency));
}

const calc$ = new Subject(); // deprecated
export const calculate = () => executeAggregations();
const getManualCalc = () => getCurrentControl() === AggregationControl.Manual;
let manualCalc: boolean = getManualCalc();
const toggleManualCalc = () => (manualCalc = !manualCalc);
export function useCalculationControl() {
  const [enabled, setEnabled] = useState(manualCalc);
  return [
    manualCalc,
    () => {
      toggleControl();
      manualCalc = getManualCalc();
      setEnabled(manualCalc);
    }
  ];
}

const req = new Subject<string>();
const res = req.pipe(
  buffer(iif(() => manualCalc, calc$, req.pipe(debounceTime(debounceWait)))),
  log('Debounced'),
  map(uniq),
  log('Deduped'),
  mergeMap(queries =>
    stubAggAjax(queries).pipe(map(results => zipObj(queries, results)))
  ),
  log('Backend result'),
  share()
);
const defaultRedo = Symbol('useAgg() default redo value');
export function useAgg(queries: string[], redo: any = defaultRedo): number[] {
  const init = () => queries.map(() => Number.NaN);
  const [result, setResult] = useState<number[]>(init());
  useEffect(() => {
    // Reset result
    setResult(init());
    // Sub to result
    const sub = aggReq(queries).subscribe(setResult);
    /*const sub = res
      .pipe(
        map(props(queries)),
        //log(queries, 'props'),
        //scan(zipWith((a, r) => (a === undefined ? r : a)), props(queries, {})),
        scan(
          zipWith(
            compose(
              find(complement(equals(undefined))),
              // reverse, // if looking for further results down the line
              pair
            )
          ),
          props(queries, {})
        ),
        skipWhile(any(isNil)),
        first() // don't short out if looking for further results down the line
      )
      .subscribe(setResult);
    // Send request
    queries.forEach(q => req.next(q));*/
    // Clean up
    return () => sub.unsubscribe();
  }, [...queries, redo, manualCalc]);
  return result;
}

type Dict<T> = { [key: string]: T };
interface CalcUnit {
  aggs: Dict<string>;
  evals: [string, (values: Dict<number>) => number][];
  result: Dict<number>;
  tags: Dict<string>;
  setter: (produceFn :(self: CalcUnit) => CalcUnit | void) => void;
}
interface CalcIndex<T> {
  aggs: string[];
  evalFn: (values: number[]) => T;
}
interface CalcMap<T> {
  aggs: Dict<string>;
  evalFn: (values: Dict<number>) => T;
}
const indexMap = addIndex(rmap);
export function useCalcByIndex<T>(
  icalcs: CalcIndex<T>[],
  defaultValue: T
): T[] {
  const aggs = useAgg(icalcs.flatMap(b => b.aggs));
  const reduced = icalcs.reduce(
    (acc, b) => {
      const stop = acc.offset + b.aggs.length;
      const slice = aggs.slice(acc.offset, stop);
      const result = slice.some(Number.isNaN) ? defaultValue : b.evalFn(slice);
      return { offset: stop, results: [...acc.results, result] };
    },
    { offset: 0, results: [] }
  );
  return reduced.results;
}
export function useCalcByMap<T>(mcalcs: CalcMap<T>[], defaultValue: T): T[] {
  const proj = mcalcs.map(({ aggs, evalFn }) => {
    const keys = Object.keys(aggs).sort(); // sort not needed for ES2020 and above, ES2015+ is tricky
    const queries = keys.map(k => aggs[k]);
    const mesaEval = (values: number[]) =>
      evalFn(values.reduce((acc, v, i) => ({ ...acc, [keys[i]]: v }), {}));
    return { aggs: queries, evalFn: mesaEval };
  });
  return useCalcByIndex<T>(proj, defaultValue);
}
export function useCalcUnits(units: CalcUnit[]) {
  // const aggs = units.flatMap((u, i) =>
  //   Object.entries(u.aggs)
  //     .sort((a, b) => a[0].localeCompare(b[0]))
  //     .map(a => [i, ...a])
  // );
  // const queries = aggs.map(a => a[2]);
  // // console.log(aggs);
  // // console.log(queries);
  // const results = useAgg(queries);
  // // console.log(results);
  // const valle = units.map<Dict<number>>(_ => ({}));
  // aggs.forEach(([i, key], r) => (valle[i][key] = results[r]));
  // units.forEach((u, i) =>
  //   u.evals.forEach(([k, e]) => (valle[i][k] = e(valle[i])))
  // );
  // // console.log('valle', valle);
  // return valle;
  return useCalcByMap<Dict<number>>(
    units.map(u => ({
      aggs: u.aggs,
      evalFn: results =>
        u.evals.reduce((acc, e) => ({ ...acc, [e[0]]: e[1](acc) }), results)
    })),
    {}
  );
}
function setUnitSetter(units: CalcUnit[]) {
  units.forEach((u, i) => {
      u.setter = pfn => {
        units[i] = produce(u, pfn);
      };
  });
  return units;
}
export function useCalcUnits2(units: CalcUnit[]) {
  const [state, setState] = useState<CalcUnit[]>([]);
  const set = (u: CalcUnit[]) => setState(setUnitSetter(u));
  useEffect(function init() {
      set(units);
  }, [...units]);
  useEffect(function calculateApi() {
    // Sub to result
    const sub = calcApi(
      units.map(u => ({ queries: u.aggs, evals: u.evals }))
    ).subscribe(x => set(zip(units, x).map(([u, r]) => ({ ...u, result: r }))));
    // Clean up
    return () => sub.unsubscribe();
  }, [...units, manualCalc]);
  return state;
}
