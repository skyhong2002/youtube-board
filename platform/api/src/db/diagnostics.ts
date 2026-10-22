import { DataQueryFailed, DataSourceUnavailable } from './client.js';
import { safeOperation, safeFailureObservation, type ReaderFailureObservation, type ReaderOperation } from './observation.js';

/** A fixed diagnostic vocabulary, coalesced per failure category for 30 seconds. */
export function dataSourceReporter(write: (line: string) => void = line => { if (!process.stderr.writableNeedDrain) process.stderr.write(line); }, now = () => Date.now()) {
  const recent = new Map<string, { at: number; suppressed: number; operations: Partial<Record<ReaderOperation, number>> }>();
  return (error: unknown, context: 'readiness' | 'request' | 'reader', detail?: ReaderFailureObservation) => {
    const category = error instanceof DataSourceUnavailable ? error.category : error instanceof DataQueryFailed ? 'query' : 'unknown';
    const code = error instanceof DataSourceUnavailable ? error.driverCode : 'UNKNOWN';
    const key = `${context}:${category}`, at = now(), previous = recent.get(key);
    if (previous && at - previous.at < 30000) { previous.suppressed = Math.min(2147483647, previous.suppressed + 1); if (detail) { const operation = safeOperation(detail.operation); previous.operations[operation] = Math.min(2147483647, (previous.operations[operation] ?? 0) + 1); } return; }
    recent.set(key, { at, suppressed: 0, operations: {} });
    try { write(JSON.stringify({ event: 'data-source-failure', context, category, code, suppressed: previous?.suppressed ?? 0, ...(detail ? {...safeFailureObservation(detail), suppressedOperations: previous?.operations ?? {}} : {}) }) + '\n'); }
    catch { /* A failed diagnostic sink cannot change the source result. */ }
  };
}
