import React, { useState } from 'react';
import { render } from 'react-dom';
import './style.css';
import {
  useAgg,
  calculate,
  useCalculationControl,
  useCalcUnits2,
  useCalcByIndex,
  useCalcByMap,
} from './rxtest';

const q1 = ['doom', 'cat', 'thousand', 'doom', 'brother']; // AGG sum(weight) PRED doom:1 PRED global:1
const q2 = ['doom', 'dog', 'thousand', 'doom', 'sister'];
function App() {
  const [containerKey, setKey] = useState('wat');
  const [queries, setQueries] = useState(q1);
  const [manualModeOn, toggleManual] = useCalculationControl();
  return (
    <div>
      <button onClick={() => setQueries(queries === q1 ? q2 : q1)}>
        Switch
      </button>
      <button onClick={() => setKey(containerKey === 'wat' ? 'wot' : 'wat')}>
        Refresh
      </button>
      <button onClick={calculate} disabled={!manualModeOn}>
        Calculate
      </button>
      <label>
        Manual
        <input
          type="checkbox"
          name="manual"
          checked={manualModeOn}
          onChange={toggleManual}
        />
      </label>
      <div className="agg-wrapper" key={containerKey}>
        {queries.map((q, i) => (
          <AggDisplay query={q} key={i} />
        ))}
        <DoubleAggDisplay queries={['cat', 'sister']} />
        <CalcDisplay />
        <IndexDisplay />
        <MapDisplay />
      </div>
    </div>
  );
}

function AggDisplay({ query }: { query: string }) {
  const [count, setCount] = useState(0);
  const [result] = useAgg([query], count);
  return (
    <div className="agg-div">
      <div className="counter" onClick={() => setCount(count + 1)}>
        Count: {count}
      </div>
      <div className="title">AGG DISPLAY</div>
      <div className="query">{query}</div>
      <div className="result">
        <meter min="0" max="100" low="40" value={result.toString()}></meter>
        <br />
        {result.toString()}
      </div>
    </div>
  );
}
function DoubleAggDisplay({ queries }: { queries: [string, string] }) {
  const [first, second] = useAgg(queries);
  const [count, setCount] = useState(0);
  return (
    <div className="agg-div">
      <div className="counter" onClick={() => setCount(count + 1)}>
        Count: {count}
      </div>
      <div className="title">DOUBLE AGG DISPLAY</div>
      <div className="query">{queries[0]}</div>
      <div className="result">{first.toString()}</div>
      <div className="query">{queries[1]}</div>
      <div className="result">{second.toString()}</div>
    </div>
  );
}
const calcUnits: Parameters<typeof useCalcUnits2>[0] = [
  {
    aggs: { cat: 'cat', sister: 'sister' },
    evals: [
      ['product', (x) => x.cat * x.sister],
      ['r', (x) => x.product / x.sister],
    ],
  },
  {
    aggs: { count: 'sister', base1: 'doom', base2: 'brother' },
    evals: [
      ['base', (x) => x.base1 + x.base2],
      ['r', (x) => (x.count / x.base) * 100],
    ],
  },
];
function CalcDisplay() {
  const [count, setCount] = useState(0);
  const [calc1, calc2] = useCalcUnits2(calcUnits);
  return (
    <div className="agg-div">
      <div
        className="counter"
        onClick={() => {
          setCount(count + 1);
          calc1.setter((unit) => {
            unit.tags = { myTag: 'My fine tag' };
          });
        }}
      >
        Count: {count}
      </div>
      <div className="title">CALC DISPLAY</div>
      <div className="query">cat * sister / sister</div>
      <div className="result">{calc1?.result?.r?.toString()}</div>
      <div className="query">doom / (doom + brother) * 100</div>
      <div className="result">{calc2?.result?.r?.toFixed(2)} %</div>
    </div>
  );
}
const indexUnits = [
  { aggs: ['doom', 'cat'], evalFn: ([doom, cat]) => doom + cat },
  {
    aggs: ['sister', 'brother'],
    evalFn: ([sister, brother]) => sister / (sister + brother),
  },
];
function IndexDisplay() {
  const [count, setCount] = useState(0);
  const [woot, doom] = useCalcByIndex<number | string>(indexUnits, '-');
  return (
    <div className="agg-div">
      <div className="counter" onClick={() => setCount(count + 1)}>
        Count: {count}
      </div>
      <div className="title">INDEX DISPLAY</div>
      <div className="query">doom + cat</div>
      <div className="result">{woot}</div>
      <div className="query">sister / (bro + sis)</div>
      <div className="result">
        {typeof doom === 'number' ? (doom * 100).toFixed(2) : doom} %
      </div>
    </div>
  );
}
function MapDisplay() {
  const [count, setCount] = useState(0);
  const [woot, doom] = useCalcByMap<number | string>(
    [
      {
        aggs: { count: 'thousand', animal: 'dog' },
        evalFn: ({ count, animal }) => count + animal,
      },
      {
        aggs: { a: 'doom', b: 'cat', c: 'thousand' },
        evalFn: ({ a, b, c }) => (a + b + c) / 3,
      },
    ],
    '...'
  );
  return (
    <div className="agg-div">
      <div className="counter" onClick={() => setCount(count + 1)}>
        Count: {count}
      </div>
      <div className="title">MAP DISPLAY</div>
      <div className="query">thousand + dog</div>
      <div className="result">{woot}</div>
      <div className="query">avg of (doom, cat, thousand)</div>
      <div className="result">
        {typeof doom === 'number' ? doom.toFixed(2) : doom} AVG
      </div>
    </div>
  );
}
function MyFrequencyComponent() {
  const [count, base] = useAgg([
    'AGGREGATION SUM(weight) PREDICATE gender:1',
    'AGGREGATION SUM(weight)',
  ]);
  return <div>{(count / base) * 100} %</div>;
}
function aggHelper(agg: string, preds: string[]): string {
  return ['AGGREGATION ', agg, ...preds.flatMap((p) => ['PREDICATE ', p])].join('');
}
function freqCalc({ count, base }: { count: string; base: string }) {
  return {
    aggs: {
      count: aggHelper('SUM(weight)', [count, base]),
      base: aggHelper('SUM(weight)', [base]),
    },
    evals: [['result', (ctx) => (ctx.count / ctx.base) * 100]],
  };
}
function MyFreqCalcComponent() {
  const [male, female] = useCalcUnits([
    freqCalc({ count: 'gender:1', base: 'country:1' }),
    freqCalc({ count: 'gender:2', base: 'country:1' }),
  ]);
  return (
    <div>
      <div>Male: {male.result} %</div>
      <div>Female: {female.result} %</div>
    </div>
  );
}

render(<App />, document.getElementById('root'));
