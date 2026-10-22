import { DataQueryFailed, DataSourceUnavailable } from './client.js';

/** A fixed diagnostic vocabulary, coalesced per failure category for 30 seconds. */
export function dataSourceReporter(write: (line: string) => void = line => { process.stderr.write(line); }, now = () => Date.now()) {
  const recent = new Map<string, { at: number; suppressed: number }>();
  return (error: unknown, context: 'readiness' | 'request' | 'reader') => {
    const category = error instanceof DataSourceUnavailable ? error.category : error instanceof DataQueryFailed ? 'query' : 'unknown';
    const code = error instanceof DataSourceUnavailable ? error.driverCode : 'UNKNOWN';
    const key = `${context}:${category}`, at = now(), previous = recent.get(key);
    if (previous && at - previous.at < 30000) { previous.suppressed++; return; }
    recent.set(key, { at, suppressed: 0 });
    try { write(JSON.stringify({ event: 'data-source-failure', context, category, code, suppressed: previous?.suppressed ?? 0 }) + '\n'); }
    catch { /* A failed diagnostic sink cannot change the source result. */ }
  };
}
