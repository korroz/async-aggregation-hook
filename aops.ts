import { Observable, OperatorFunction } from 'rxjs';
import { bufferTime } from 'rxjs/operators';

interface BufferControl<T> {
  buffer: () => OperatorFunction<T, T[]>;
}
enum BufferControlMode {
  Auto = 'auto',
  Manual = 'manual',
}
class ModeBufferControl<T> implements BufferControl<T> {
  // BufferControl<T> signature
  buffer() {
    return bufferTime<T>(200);
  }
  flush(): void {
    throw 'not implemented';
  }
  _mode = BufferControlMode.Auto;
  get mode(): BufferControlMode {
    return this._mode;
  }
  set mode(mode: BufferControlMode) {
    this._mode = mode;
    // TODO: actually switch buffer control stream.
  }
  cycleMode(): BufferControlMode {
    throw 'not implemented';
  }
}

interface Aggregator {
  aggregate: <T extends string[] | Record<string, string>>(
    queries: T
  ) => Observable<T extends string[] ? number[] : Record<string, number>>;
}

type AggregatorBackend = (queries: string[]) => Observable<number[]>;
class SurveyOpsAggregator implements Aggregator {
  constructor(
    private readonly _request$: Observable<Observable<string>>,
    private readonly _bufferControl: BufferControl<Observable<string>>,
    private readonly _backend: AggregatorBackend
  ) {}

  // Aggregator interface signature
  aggregate<T extends string[] | Record<string, string>>(
    q: T
  ): Observable<T extends string[] ? number[] : Record<string, number>> {
    throw 'not implement';
  }
}
