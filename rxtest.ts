import { useEffect, useState } from 'react';
import { __, zip, values } from 'ramda';
import { produce } from 'immer';
import {
  aggReq,
  executeAggregations,
  getCurrentControl,
  toggleControl,
  calculate as calcApi,
  aggReqByIndex,
  aggReqByMap,
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
  const [results, setResults] = useState<T[]>(() =>
    icalcs.map(() => defaultValue)
  );
  const aggs = icalcs.flatMap((c) => c.aggs);
  useEffect(() => {
    const sub = aggReqByIndex<T>(
      icalcs.map((c) => ({ queries: c.aggs, results: c.evalFn }))
    ).subscribe(setResults);
    return () => sub.unsubscribe();
  }, aggs);
  return results;
}
export function useCalcByMap<T>(mcalcs: CalcMap<T>[], defaultValue: T): T[] {
  const [results, setResults] = useState<T[]>(() =>
    mcalcs.map(() => defaultValue)
  );
  const aggs = mcalcs.flatMap((c) => values(c.aggs));
  useEffect(() => {
    const sub = aggReqByMap(
      mcalcs.map((c) => ({ queries: c.aggs, results: c.evalFn }))
    ).subscribe(setResults);
    return () => sub.unsubscribe();
  }, aggs);
  return results;
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
