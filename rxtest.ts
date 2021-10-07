import { useEffect, useState } from 'react';
import { __, zip } from 'ramda';
import { produce } from 'immer';
import {
  aggReq,
  executeAggregations,
  getCurrentControl,
  toggleControl,
  calculate as calcApi,
} from './sopsapi';
import { BufferControlMode } from './aops';

export const calculate = () => executeAggregations();
const getManualCalc = () => getCurrentControl() === BufferControlMode.Manual;
let manualCalc: boolean = getManualCalc();
export function useCalculationControl() {
  const [enabled, setEnabled] = useState(manualCalc);
  return [
    manualCalc,
    () => {
      toggleControl();
      manualCalc = getManualCalc();
      setEnabled(manualCalc);
    },
  ];
}

const defaultRedo = Symbol('useAgg() default redo value');
export function useAgg(queries: string[], redo: any = defaultRedo): number[] {
  const init = () => queries.map(() => Number.NaN);
  const [result, setResult] = useState<number[]>(init());
  useEffect(() => {
    // Reset result
    setResult(init());
    // Sub to result
    const sub = aggReq(queries).subscribe(setResult);
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
  setter: (produceFn: (self: CalcUnit) => CalcUnit | void) => void;
}
interface CalcIndex<T> {
  aggs: string[];
  evalFn: (values: number[]) => T;
}
interface CalcMap<T> {
  aggs: Dict<string>;
  evalFn: (values: Dict<number>) => T;
}
export function useCalcByIndex<T>(
  icalcs: CalcIndex<T>[],
  defaultValue: T
): T[] {
  const aggs = useAgg(icalcs.flatMap((b) => b.aggs));
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
    const queries = keys.map((k) => aggs[k]);
    const mesaEval = (values: number[]) =>
      evalFn(values.reduce((acc, v, i) => ({ ...acc, [keys[i]]: v }), {}));
    return { aggs: queries, evalFn: mesaEval };
  });
  return useCalcByIndex<T>(proj, defaultValue);
}
function setUnitSetter(units: CalcUnit[]) {
  units.forEach((u, i) => {
    u.setter = (pfn) => {
      units[i] = produce(u, pfn);
    };
  });
  return units;
}
export function useCalcUnits2(units: CalcUnit[]) {
  const [state, setState] = useState<CalcUnit[]>([]);
  const set = (u: CalcUnit[]) => setState(setUnitSetter(u));
  useEffect(
    function init() {
      set(units);
    },
    [...units]
  );
  useEffect(
    function calculateApi() {
      // Sub to result
      const sub = calcApi(
        units.map((u) => ({ queries: u.aggs, evals: u.evals }))
      ).subscribe((x) =>
        set(zip(units, x).map(([u, r]) => ({ ...u, result: r })))
      );
      // Clean up
      return () => sub.unsubscribe();
    },
    [...units, manualCalc]
  );
  return state;
}
