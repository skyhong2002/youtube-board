import { createHash } from 'node:crypto';
import type { Connection, RowDataPacket } from 'mysql2/promise';
import { taipeiSql } from '@youtube-board/ingestion';
import { connectDatabase, withWriterLock } from './database.js';
import { assertExecute, executionPolicy } from './policy.js';
import { loadVocabularySnapshot } from './load-vocabulary.js';
import { SOURCE } from './vocabulary.js';
import { evidenceForVideo, storeVideoEvidence, VIDEO_EVIDENCE_JOB, type VideoInput } from './video-evidence.js';

export const RECENT_VIDEO_EVIDENCE_JOB = 'tags.videos.match.recent';
export const RECENT_VIDEO_EVIDENCE_COMMAND = 'videos:match:recent';
export const RECENT_CHECKPOINT = 'recent-window-v1';
const DAY = 86_400_000, REFRESH_MS = 6 * 3_600_000;
interface Cursor { publishedAt: string; pk: number }
export interface RecentCheckpoint {
  schemaVersion: 1; generation: string; vocabularyVersion: string;
  windowFrom: string; windowUntil: string; startedAt: string;
  cursor: Cursor | null; processed: number; written: number; unchanged: number; invalid: number;
  completedAt: string | null;
}
interface Budget { schemaVersion: 1; date: string; limit: number; reserved: number }
export interface RecentMatchInput { limit: number; dailyLimit: number; execute: boolean }
const integer = (value: unknown, min: number, max: number): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max;
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const iso = (value: unknown): value is string => typeof value === 'string' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
function sqlTime(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d(?:\.\d{1,6})?$/.test(value)) return false;
  const date = new Date(value.replace(' ', 'T') + 'Z');
  return Number.isFinite(+date) && date.toISOString().slice(0, 19).replace('T', ' ') === value.slice(0, 19);
}
const generation = (version: string, from: string, until: string) => createHash('sha256').update(JSON.stringify([version, from, until])).digest('hex');
export function validateRecentInput(input: RecentMatchInput): RecentMatchInput {
  if (!integer(input.limit, 1, 500) || !integer(input.dailyLimit, 1, 50_000) || typeof input.execute !== 'boolean') throw new Error('Recent matching requires limit1–500 and daily-limit1–50000');
  return input;
}
export function validateRecentArguments(args: string[]): RecentMatchInput {
  if (args[0] !== RECENT_VIDEO_EVIDENCE_COMMAND) throw new Error('Invalid recent matching command');
  const options = new Map<string, number>(); let mode: string | undefined;
  for (const arg of args.slice(1)) {
    if (arg === '--execute' || arg === '--dry-run') { if (mode) throw new Error('Choose one recent matching mode'); mode = arg; continue; }
    const match = /^--(limit|daily-limit)=(\d+)$/.exec(arg);
    if (!match || options.has(match[1]!)) throw new Error('Invalid recent matching option');
    options.set(match[1]!, Number(match[2]));
  }
  return validateRecentInput({ limit: options.get('limit') ?? 100, dailyLimit: options.get('daily-limit') ?? 5000, execute: mode === '--execute' });
}
export function parseRecentCheckpoint(raw: string): RecentCheckpoint {
  let value: unknown; try { value = JSON.parse(raw); } catch { throw new Error('Invalid recent matching checkpoint'); }
  if (!record(value) || value.schemaVersion !== 1 || typeof value.vocabularyVersion !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(value.vocabularyVersion)
    || !sqlTime(value.windowFrom) || !sqlTime(value.windowUntil) || !iso(value.startedAt)
    || value.windowFrom !== taipeiSql(new Date(Date.parse(value.startedAt) - 7 * DAY)) || value.windowUntil !== taipeiSql(new Date(value.startedAt))
    || value.generation !== generation(value.vocabularyVersion, value.windowFrom, value.windowUntil)
    || !['processed', 'written', 'unchanged', 'invalid'].every(key => integer(value[key], 0, Number.MAX_SAFE_INTEGER))
    || Number(value.processed) !== Number(value.written) + Number(value.unchanged) + Number(value.invalid)
    || !(value.completedAt === null || iso(value.completedAt) && Date.parse(value.completedAt) >= Date.parse(value.startedAt))) throw new Error('Invalid recent matching checkpoint');
  if (value.cursor !== null && (!record(value.cursor) || !sqlTime(value.cursor.publishedAt) || !integer(value.cursor.pk, 1, Number.MAX_SAFE_INTEGER)
    || value.cursor.publishedAt < value.windowFrom || value.cursor.publishedAt >= value.windowUntil)) throw new Error('Invalid recent matching cursor');
  if ((value.processed === 0) !== (value.cursor === null)) throw new Error('Recent matching cursor/count mismatch');
  return value as unknown as RecentCheckpoint;
}
function parseBudget(raw: string, date: string): Budget {
  let value: unknown; try { value = JSON.parse(raw); } catch { throw new Error('Invalid recent matching budget'); }
  if (!record(value) || value.schemaVersion !== 1 || value.date !== date || !integer(value.limit, 1, 50_000) || !integer(value.reserved, 0, value.limit)) throw new Error('Invalid recent matching budget');
  return value as unknown as Budget;
}
export function planRecentWindow(previous: RecentCheckpoint | null, version: string, now: Date) {
  if (!Number.isFinite(+now) || !/^[A-Za-z0-9_-]{1,100}$/.test(version)) throw new Error('Invalid recent matching anchor');
  if (previous && +now < Date.parse(previous.completedAt ?? previous.startedAt)) throw new Error('Recent matching clock moved backwards');
  const sameVersion = previous?.vocabularyVersion === version;
  if (sameVersion && previous.completedAt === null) return { checkpoint: previous, action: 'resume' as const };
  if (sameVersion && previous.completedAt && +now - Date.parse(previous.completedAt) < REFRESH_MS && taipeiSql(now).slice(0, 10) === taipeiSql(new Date(previous.completedAt)).slice(0, 10)) return { checkpoint: previous, action: 'up-to-date' as const };
  const from = taipeiSql(new Date(+now - 7 * DAY)), until = taipeiSql(now);
  const checkpoint: RecentCheckpoint = { schemaVersion: 1, generation: generation(version, from, until), vocabularyVersion: version, windowFrom: from, windowUntil: until, startedAt: now.toISOString(), cursor: null, processed: 0, written: 0, unchanged: 0, invalid: 0, completedAt: null };
  return { checkpoint, action: previous && !sameVersion ? 'new-vocabulary' as const : 'new-window' as const };
}
async function journal(db: Connection, key: string) {
  const [rows] = await db.query<RowDataPacket[]>('SELECT status,result FROM ts_job_runs WHERE job_key=? AND execution_key=?', [RECENT_VIDEO_EVIDENCE_JOB, key]);
  if (rows.length > 1 || rows[0] && typeof rows[0].result !== 'string') throw new Error('Invalid recent matching journal');
  return rows[0] ?? null;
}
async function save(db: Connection, key: string, status: string, value: unknown) {
  await db.execute('INSERT INTO ts_job_runs(job_key,execution_key,status,result) VALUES(?,?,?,?) ON DUPLICATE KEY UPDATE status=VALUES(status),result=VALUES(result)', [RECENT_VIDEO_EVIDENCE_JOB, key, status, JSON.stringify(value)]);
}
async function checkpoint(db: Connection, value: RecentCheckpoint) {
  await save(db, RECENT_CHECKPOINT, value.completedAt ? 'completed' : 'running', value);
}
/** Durable continuation lives in the existing TS journal, separate from source
 * ingestion. The first reservation fixes a day's upper budget; lowering a later
 * invocation can restrict it further but raising options cannot bypass that cap.
 * Reservations precede work and survive crashes, intentionally charging failed
 * attempts. Evidence commits before cursor advancement, so an uncertain outcome
 * retries idempotently and is charged again instead of skipping source rows.
 */
export async function continueRecentMatching(db: Connection, input: RecentMatchInput, now: Date, ownership: () => Promise<void>, clock: () => Date = () => now) {
  validateRecentInput(input);
  if (!Number.isFinite(+now)) throw new Error('Invalid recent matching clock');
  const day = taipeiSql(now).slice(0, 10), budgetKey = `recent-budget-${day}`;
  const [current] = await db.query<RowDataPacket[]>('SELECT c.run_id FROM ts_vocabulary_current c JOIN ts_vocabulary_runs r ON r.id=c.run_id WHERE c.source=? AND r.status=?', [SOURCE, 'published']);
  if (!current.length) return { mode: input.execute ? 'execute' : 'dry-run', status: 'awaiting-vocabulary', action: 'awaiting-vocabulary', processed: 0, results: [] as Array<{pk:number;status:string;count:number}>, checkpoint: null, budget: null, vocabularyVersion: null, window: null, generation: null, refreshHours: 6, externalCalls: 0, sourceWrites: 0 };
  if (current.length !== 1 || typeof current[0]!.run_id !== 'string') throw new Error('Invalid current vocabulary identity');
  const saved = await journal(db, RECENT_CHECKPOINT), prior = saved ? parseRecentCheckpoint(saved.result) : null;
  if (saved && saved.status !== (prior!.completedAt ? 'completed' : 'running')) throw new Error('Recent matching checkpoint status mismatch');
  const plan = planRecentWindow(prior, current[0]!.run_id, now), state = structuredClone(plan.checkpoint);
  const savedBudget = await journal(db, budgetKey), budget = savedBudget ? parseBudget(savedBudget.result, day) : { schemaVersion: 1 as const, date: day, limit: input.dailyLimit, reserved: 0 };
  if (savedBudget && savedBudget.status !== 'reserved') throw new Error('Recent matching budget status mismatch');
  const cap = Math.min(input.dailyLimit, budget.limit), available = Math.max(0, cap - budget.reserved);
  const summary = (status: string, processed = 0, results: Array<{ pk: number; status: string; count: number }> = []) => ({
    mode: input.execute ? 'execute' : 'dry-run', status, action: plan.action, vocabularyVersion: state.vocabularyVersion,
    window: { from: state.windowFrom, until: state.windowUntil, timezone: 'Asia/Taipei', days: 7 }, generation: state.generation,
    processed, results, checkpoint: state, budget: { date: day, limit: cap, reserved: budget.reserved, remaining: Math.max(0, cap - budget.reserved) },
    externalCalls: 0, sourceWrites: 0, refreshHours: 6,
  });
  if (plan.action === 'up-to-date') return summary('up-to-date');
  if (!available) {
    if (input.execute && plan.action !== 'resume') { await ownership(); await checkpoint(db, state); }
    return summary('daily-budget-exhausted');
  }
  const snapshot = await loadVocabularySnapshot(db, state.vocabularyVersion);
  if (snapshot.id !== state.vocabularyVersion) throw new Error('Vocabulary identity mismatch');
  const take = Math.min(input.limit, available), cursor = state.cursor;
  // Use the publication index and exact source identity. Duplicate older source
  // rows must not overwrite evidence for a newer copy of the same video ID.
  const [rows] = await db.query<RowDataPacket[]>(`SET STATEMENT max_statement_time=5 FOR SELECT v.pk,v.videoId,v.title,v.description,v.mtime,v.publishedAt FROM urt_video v
    WHERE v.publishedAt>=? AND v.publishedAt<? ${cursor ? 'AND (v.publishedAt<? OR (v.publishedAt=? AND v.pk<?))' : ''}
    AND NOT EXISTS (SELECT 1 FROM urt_video newer WHERE newer.videoId=v.videoId AND BINARY newer.videoId=BINARY v.videoId AND newer.pk>v.pk)
    ORDER BY v.publishedAt DESC,v.pk DESC LIMIT ?`, [state.windowFrom, state.windowUntil, ...(cursor ? [cursor.publishedAt, cursor.publishedAt, cursor.pk] : []), take + 1]);
  const selected = rows.slice(0, take), more = rows.length > take;
  if (input.execute) {
    await ownership();
    await db.beginTransaction();
    try { budget.reserved += selected.length; await save(db, budgetKey, 'reserved', budget); await checkpoint(db, state); await db.commit(); }
    catch (error) { await db.rollback().catch(() => {}); throw error; }
  }
  const results: Array<{ pk: number; status: string; count: number }> = [];
  for (const row of selected) {
    await ownership();
    if (taipeiSql(clock()).slice(0, 10) !== day) return { ...summary('day-boundary', results.length, results), coverage: snapshot.coverage, wouldReserve: input.execute ? 0 : selected.length };
    const pk = Number(row.pk);
    if (!integer(pk, 1, Number.MAX_SAFE_INTEGER) || !sqlTime(row.publishedAt) || row.publishedAt < state.windowFrom || row.publishedAt >= state.windowUntil
      || state.cursor && (row.publishedAt > state.cursor.publishedAt || row.publishedAt === state.cursor.publishedAt && pk >= state.cursor.pk)) throw new Error('Invalid recent matching source order');
    const video: VideoInput = { pk, videoId: row.videoId, title: row.title ?? '', description: row.description ?? '', observedAt: row.mtime ?? null };
    let result: { status: string; count: number };
    try { result = { status: 'preview', count: evidenceForVideo(video, snapshot).evidence.length }; }
    catch { result = { status: 'invalid', count: 0 }; }
    if (result.status === 'invalid') state.invalid++;
    else if (input.execute) { result = await storeVideoEvidence(db, video, snapshot); if (result.status === 'written') state.written++; else state.unchanged++; }
    else state.unchanged++; // Preview progress is returned only; no durable accounting changes.
    state.processed++; state.cursor = { publishedAt: row.publishedAt, pk };
    if (input.execute) { await ownership(); await checkpoint(db, state); }
    results.push({ pk, ...result });
  }
  if (!more) {
    state.completedAt = clock().toISOString();
    if (Date.parse(state.completedAt) < +now) throw new Error('Recent matching clock moved backwards');
    if (input.execute) { await ownership(); await checkpoint(db, state); }
  }
  return { ...summary(more ? input.execute && budget.reserved >= cap ? 'daily-budget-exhausted' : 'incomplete' : 'complete', selected.length, results), coverage: snapshot.coverage, wouldReserve: input.execute ? 0 : selected.length };
}
export async function matchRecentVideoBatch(input: RecentMatchInput, env: NodeJS.ProcessEnv, clock: () => Date = () => new Date()) {
  validateRecentInput(input);
  if (input.execute) assertExecute(RECENT_VIDEO_EVIDENCE_JOB, executionPolicy(env, 'execute'));
  const db = await connectDatabase(env);
  try {
    // Shared lock with the existing one-off matcher, including during version flips.
    return input.execute ? await withWriterLock(db, VIDEO_EVIDENCE_JOB, check => continueRecentMatching(db, input, clock(), check, clock))
      : await continueRecentMatching(db, input, clock(), async () => {}, clock);
  } finally { await db.end(); }
}
