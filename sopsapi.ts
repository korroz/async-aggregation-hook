import { Observable, combineLatest } from 'rxjs';
import { map } from 'rxjs/operators';
import { Agg, agg, aggregatorService } from './aops';
import { map as rmap } from 'ramda';

//+req: -a-a-a-b-c---------
//-req: --a-----b----------
// exe: ----------e--------
// qry:           ac|
//back:             --r|
// res: ----------------ac-
type Dict<T> = { [key: string]: T };

export function aggReq(queries: string[]): Observable<number[]> {
  return aggregatorService.aggregate(rmap(agg, queries));
}
function aggMapReq(queryMap: Dict<string>): Observable<Dict<number>> {
  return aggregatorService.aggregate(
    rmap<Dict<string>, Dict<Agg>>(agg, queryMap)
  );
}

interface AggregationsRequest<T> {
  queries: string[];
  results: (results: number[]) => T;
}
export function aggReqByIndex<T>(
  aggs: AggregationsRequest<T>[]
): Observable<T[]> {
  return combineLatest(
    aggs.map((agg) => aggReq(agg.queries).pipe(map((r) => agg.results(r))))
  );
}
interface AggregationsRequestMap<T> {
  queries: Dict<string>;
  results: (results: Dict<number>) => T;
}
export function aggReqByMap<T>(
  aggMaps: AggregationsRequestMap<T>[]
): Observable<T[]> {
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
