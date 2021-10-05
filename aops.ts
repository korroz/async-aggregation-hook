import { Observable, OperatorFunction } from 'rxjs';
import { bufferTime } from 'rxjs/operators';

interface BufferControl<T> {
  buffer: () => OperatorFunction<T, T[]>;
}

class ModeBufferControl<T> implements BufferControl<T> {
  buffer() {
    return bufferTime<T>(200);
  }
}

interface Aggregator {
  aggregate: <T extends string[] | Record<string, string>>(
    queries: T
  ) => Observable<T extends string[] ? number[] : Record<string, number>>;
}

class SurveyOpsAggregator implements Aggregator {
  aggregate<T extends string[] | Record<string, string>>(
    q: T
  ): Observable<T extends string[] ? number[] : Record<string, number>> {
    throw 'not implement';
  }
}
