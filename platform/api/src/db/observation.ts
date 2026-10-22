/** Fixed diagnostic names only. Never retain SQL, parameters, URLs or row values. */
export const READER_OPERATIONS = [
  'other', 'video-read', 'channel-read', 'count-read', 'live-read', 'ai-read',
  'vocabulary-read', 'evidence-read', 'report-cache-read', 'lineage-read',
  'readiness', 'api-status', 'home-summary', 'home-category-counts', 'home-category-names',
  'home-vocabulary', 'home-video-source', 'home-term-labels', 'home-ranking',
  'home-daily-history', 'home-representatives', 'home-version-check', 'ranking-exclusions',
  'derived-vocabulary', 'derived-channels', 'derived-source-size', 'derived-source',
  'derived-evidence-size', 'derived-evidence',
] as const;
export type ReaderOperation = typeof READER_OPERATIONS[number];
const operations = new Set<string>(READER_OPERATIONS);
export const safeOperation = (value: unknown): ReaderOperation => typeof value === 'string' && operations.has(value) ? value as ReaderOperation : 'other';
/** Coarse fallback for unlabeled callers. Structural table identifiers choose a fixed
 * name; neither query text nor an arbitrary/hash-based dimension leaves this function. */
export function readerOperation(query: string, explicit?: ReaderOperation): ReaderOperation {
  if (explicit !== undefined) return safeOperation(explicit);
  for (const [pattern, operation] of [
    [/\bts_\w*lineage\b/, 'lineage-read'], [/\burt_show_\w+\b/, 'report-cache-read'],
    [/\burt_ai_\w+\b/, 'ai-read'], [/\burt_video_live\b|\burt_live_\w+\b/, 'live-read'],
    [/\burt_video\b/, 'video-read'], [/\burt_channel\b/, 'channel-read'],
    [/\burt_count\b/, 'count-read'], [/\bts_video_tag_\w+\b/, 'evidence-read'],
    [/\bts_vocabulary_\w+\b/, 'vocabulary-read'],
  ] as const) if (pattern.test(query)) return operation;
  return 'other';
}
const elapsed = (from: number, now: number) => Math.max(0, Math.min(2147483647, Math.floor(now - from)));
interface Lease { operation: ReaderOperation; queuedAt: number; activeAt: number | null; expired: boolean }
export interface PoolObservation {
  active: number; queued: number; expiredQueued: number;
  connectionLimit: number; queueLimit: number;
  activeOperations: {operation: ReaderOperation; count: number; oldestMs: number}[];
  queuedOperations: {operation: ReaderOperation; count: number; oldestMs: number}[];
}
export interface ReaderFailureObservation {
  operation: ReaderOperation; phase: 'compile' | 'admission' | 'acquire' | 'statement';
  durationMs: number; acquireMs: number; statementMs: number; pool: PoolObservation;
}
/** Tracks the existing lifecycle; never authorizes admission or cancels work.
 * queued = unresolved driver getConnection calls, including connection establishment
 * and calls whose caller timed out. It is NOT mysql2's internal FIFO length.
 * active = leases handed to rows(), until release/destroy. At most 24 + 6 entries. */
export function readerPoolObservation(now = () => performance.now()) {
  const queued = new Set<Lease>(), active = new Set<Lease>();
  const groups = (leases: Set<Lease>, at: number, phase: 'queued' | 'active') => {
    const rows = new Map<ReaderOperation, {operation: ReaderOperation; count: number; oldestMs: number}>();
    for (const lease of leases) {
      const row = rows.get(lease.operation) ?? {operation: lease.operation, count: 0, oldestMs: 0};
      row.count++; row.oldestMs = Math.max(row.oldestMs, elapsed(phase === 'active' ? lease.activeAt! : lease.queuedAt, at));
      rows.set(lease.operation, row);
    }
    return [...rows.values()];
  };
  return {
    queue(operation: ReaderOperation) { const lease: Lease = {operation: safeOperation(operation), queuedAt: now(), activeAt: null, expired: false}; queued.add(lease); return lease; },
    expire(lease: Lease) { lease.expired = true; },
    acquired(lease: Lease) { queued.delete(lease); lease.activeAt = now(); active.add(lease); },
    abandon(lease: Lease) { queued.delete(lease); },
    release(lease: Lease) { active.delete(lease); },
    snapshot(): PoolObservation { const at = now(); return {active: active.size, queued: queued.size, expiredQueued: [...queued].filter(x => x.expired).length, connectionLimit: 6, queueLimit: 24, activeOperations: groups(active, at, 'active'), queuedOperations: groups(queued, at, 'queued')}; },
  };
}
export const observationElapsed = elapsed;

/** Reconstruct the log payload, including nested fields; callers cannot smuggle
 * arbitrary metadata through the diagnostic callback's typed argument. */
export function safeFailureObservation(detail: ReaderFailureObservation): ReaderFailureObservation {
  const number = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.min(2147483647, Math.floor(value))) : 0;
  const groups = (value: PoolObservation['activeOperations']) => Array.isArray(value) ? value.slice(0, READER_OPERATIONS.length).map(row => ({operation: safeOperation(row?.operation), count: number(row?.count), oldestMs: number(row?.oldestMs)})) : [];
  return {operation: safeOperation(detail.operation), phase: ['compile','admission','acquire','statement'].includes(detail.phase) ? detail.phase : 'compile', durationMs: number(detail.durationMs), acquireMs: number(detail.acquireMs), statementMs: number(detail.statementMs), pool: {
    active: number(detail.pool?.active), queued: number(detail.pool?.queued), expiredQueued: number(detail.pool?.expiredQueued), connectionLimit: 6, queueLimit: 24,
    activeOperations: groups(detail.pool?.activeOperations), queuedOperations: groups(detail.pool?.queuedOperations),
  }};
}
