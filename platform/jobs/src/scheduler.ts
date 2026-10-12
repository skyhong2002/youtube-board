import {VOCABULARY_JOB} from './vocabulary.js';
import {schedulerNamespace,partitionedQueues} from './queue-scope.js';
import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { validateWorkflowInput, type WorkflowInput } from './workflow-registry.js';
import { assertExecute, executionPolicy } from './policy.js';
import { enqueueWorkflow, QueueInputConflict, redisConnection } from './worker.js';
import { workflowShutdownSignal } from '../../shared/shutdown.js';

export interface Schedule {
  id: string;
  workflow: string;
  cron: string;
  options: WorkflowInput['options'];
  window?: 'previous-hour' | 'previous-day' | 'yesterday-date';
}
export interface ScheduleConfig { version: 1; timezone: 'Asia/Taipei'; schedules: Schedule[] }
export interface DueRun { schedule: string; workflow: string; runId: string; scheduledAt: string; input: WorkflowInput }
/** One reviewed schedule configuration per queue namespace, shared across deploy revisions. */
export const SCHEDULER_WATERMARK = 'youtube-board-ts:scheduler:attempted-minute';
export async function readScheduleConfig(path: string) {
  if ((await stat(path)).size > 65536) throw new Error('Schedule configuration exceeds 64KiB');
  const text = await readFile(path, 'utf8');
  if (Buffer.byteLength(text) > 65536) throw new Error('Schedule configuration exceeds 64KiB');
  return validateScheduleConfig(JSON.parse(text));
}
const record = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);
const bounds = [[0, 59], [0, 23], [1, 31], [1, 12], [0, 6]] as const;

/** Numeric five-field cron only; Taiwan has no daylight-saving clock transitions. */
export function cronFields(value: string): Set<number>[] {
  const parts = value.split(' ');
  if (parts.length !== 5 || value.length > 150) throw new Error('Use five numeric cron fields');
  return parts.map((part, index) => {
    const [min, max] = bounds[index]!, values = new Set<number>();
    if (part.split(',').length > 60) throw new Error('Cron list too long');
    for (const component of part.split(',')) {
      const match = /^(\*|\d+|\d+-\d+)(?:\/(\d+))?$/.exec(component);
      if (!match) throw new Error('Invalid cron component');
      const base = match[1]!, step = Number(match[2] ?? 1);
      if (!Number.isSafeInteger(step) || step < 1 || step > max - min + 1) throw new Error('Invalid cron step');
      const [start, end] = base === '*' ? [min, max] : base.includes('-') ? base.split('-').map(Number) : [Number(base), Number(base)];
      if (start! < min || end! > max || start! > end! || (match[2] && base !== '*' && !base.includes('-'))) throw new Error('Invalid cron range');
      for (let n = start!; n <= end!; n += step) values.add(n);
    }
    return values;
  });
}
const local = (date: Date) => new Date(date.getTime() + 8 * 3600000);
const sql = (date: Date) => local(date).toISOString().slice(0, 19).replace('T', ' ');
export function scheduleInput(schedule: Schedule, date: Date): WorkflowInput {
  const options = { ...schedule.options };
  if(schedule.workflow===VOCABULARY_JOB&&(schedule.window!=='previous-day'||['since','until'].some(k=>Object.hasOwn(options,k))))throw new Error('Scheduled vocabulary sync requires an automatic previous-day window');
  if (schedule.window) {
    if (['from', 'to', 'date'].some(k => Object.hasOwn(options, k))) throw new Error('Automatic windows cannot override explicit dates');
    const shifted = local(date);
    const hour = date.getTime() - (shifted.getUTCMinutes() * 60 + shifted.getUTCSeconds()) * 1000 - shifted.getUTCMilliseconds();
    const midnight = hour - shifted.getUTCHours() * 3600000;
    const end = schedule.window === 'previous-hour' ? hour : midnight;
    const start = end - (schedule.window === 'previous-hour' ? 3600000 : 86400000);
    if(schedule.workflow===VOCABULARY_JOB){options.since=new Date(start).toISOString();options.until=new Date(end).toISOString();}
    else if (schedule.window === 'yesterday-date') options.date = sql(new Date(start)).slice(0, 10);
    else { options.from = sql(new Date(start)); options.to = sql(new Date(end - 1000)); }
  }
  return validateWorkflowInput(schedule.workflow, { options });
}
export function validateScheduleConfig(raw: unknown): ScheduleConfig {
  if (!record(raw) || raw.version !== 1 || raw.timezone !== 'Asia/Taipei' || !Array.isArray(raw.schedules) || raw.schedules.length > 64
      || Object.keys(raw).some(k => !['version', 'timezone', 'schedules'].includes(k))) throw new Error('Invalid schedule configuration');
  const ids = new Set<string>();
  const schedules = raw.schedules.map(value => {
    if (!record(value) || Object.keys(value).some(k => !['id', 'workflow', 'cron', 'options', 'window'].includes(k))
        || typeof value.id !== 'string' || !/^[a-zA-Z0-9_-]{1,48}$/.test(value.id) || ids.has(value.id)
        || typeof value.workflow !== 'string' || typeof value.cron !== 'string' || !record(value.options)
        || value.window !== undefined && !['previous-hour', 'previous-day', 'yesterday-date'].includes(String(value.window))) throw new Error('Invalid schedule entry');
    if (['youtube.comments.reset', 'youtube.channels.adopt'].includes(value.workflow) || value.options.restore === true || value.options.force === true) throw new Error('Operator-only workflow cannot recur');
    ids.add(value.id); cronFields(value.cron);
    const entry = value as unknown as Schedule;
    scheduleInput(entry, new Date('2030-01-15T12:00:00Z'));
    return entry;
  });
  return { version: 1, timezone: 'Asia/Taipei', schedules };
}
export function planSchedules(config: ScheduleConfig, now: Date, lookbackMinutes = 2): DueRun[] {
  if (!Number.isFinite(now.getTime()) || !Number.isSafeInteger(lookbackMinutes) || lookbackMinutes < 1 || lookbackMinutes > 60) throw new Error('Invalid bounded schedule window');
  const validated = validateScheduleConfig(config), runs: DueRun[] = [];
  const minute = Math.floor(now.getTime() / 60000) * 60000;
  for (let offset = lookbackMinutes - 1; offset >= 0; offset--) {
    const date = new Date(minute - offset * 60000), taipei = local(date);
    for (const schedule of validated.schedules) {
      const fields = cronFields(schedule.cron), parts = schedule.cron.split(' ');
      const day = fields[2]!.has(taipei.getUTCDate()), weekday = fields[4]!.has(taipei.getUTCDay());
      const dayMatch = parts[2]!.startsWith('*') || parts[4]!.startsWith('*') ? day && weekday : day || weekday;
      if (!fields[0]!.has(taipei.getUTCMinutes()) || !fields[1]!.has(taipei.getUTCHours()) || !fields[3]!.has(taipei.getUTCMonth() + 1) || !dayMatch) continue;
      // Identity includes configuration entry + slot, never the producer process.
      const runId = 'schedule-' + createHash('sha256').update(JSON.stringify([schedule.id, date.toISOString()])).digest('hex');
      runs.push({ schedule: schedule.id, workflow: schedule.workflow, runId, scheduledAt: date.toISOString(), input: scheduleInput(schedule, date) });
      if (runs.length > 256) throw new Error('Schedule tick exceeds 256 runs; reduce lookback or configured entries');
    }
  }
  return runs;
}
export async function tickSchedules(config: ScheduleConfig, env: NodeJS.ProcessEnv, now = new Date(), lookbackMinutes = 2, enqueue = enqueueWorkflow) {
  const validated = validateScheduleConfig(config);
  // Validate every configured owner before making any queue mutation.
  for (const schedule of validated.schedules) {
    if(partitionedQueues(env)&&env.TS_WORKER_WORKFLOW&&schedule.workflow!==env.TS_WORKER_WORKFLOW)throw new Error('Schedule does not match declared worker workflow');
    assertExecute(schedule.workflow, executionPolicy(env, 'execute', true));
    if (schedule.workflow === 'ai.daily') assertExecute('ai.channel', executionPolicy(env, 'execute', true));
  }
  const output: Array<{ schedule: string; scheduledAt: string; workflow: string; runId: string; queueId?: string; state: string }> = [];
  for (const run of planSchedules(validated, now, lookbackMinutes)) {
    if (workflowShutdownSignal().aborted) {
      output.push({ schedule: run.schedule, scheduledAt: run.scheduledAt, workflow: run.workflow, runId: run.runId, state: 'SHUTDOWN_ABORTED' });
      continue;
    }
    try {
      const job = await enqueue(run.workflow, run.runId, run.input, env);
      output.push({ schedule: run.schedule, scheduledAt: run.scheduledAt, workflow: run.workflow, runId: run.runId, queueId: job.id, state: job.state });
    } catch (error) {
      // A retained failed or ambiguous run is never silently re-added; later
      // configured catch-up slots get new IDs and consult durable source state.
      const queueId = error instanceof QueueInputConflict ? error.queueId : undefined;
      output.push({ schedule: run.schedule, scheduledAt: run.scheduledAt, workflow: run.workflow, runId: run.runId, ...(queueId ? { queueId } : {}), state: error instanceof QueueInputConflict ? error.code : 'ENQUEUE_ERROR' });
    }
  }
  return output;
}

/** A fresh bounded connection each cycle recovers after a Redis restart even in plain Compose. */
export async function runScheduleCycle(config: ScheduleConfig, env: NodeJS.ProcessEnv, now = new Date(), connect = redisConnection, enqueue = enqueueWorkflow) {
  const validated = validateScheduleConfig(config);
  const namespace = schedulerNamespace(env)+':scheduler:attempted-minute';
  const redis = connect(env);
  try {
    await redis.ping();
    const minute = Math.floor(now.getTime() / 60000), stored = await redis.get(namespace);
    if (stored !== null && (!/^\d+$/.test(stored) || !Number.isSafeInteger(Number(stored)) || Number(stored) > 144000000000)) throw new Error('Invalid scheduler watermark');
    const previous = stored === null ? null : Number(stored);
    const baseline = previous === null ? 'unobserved' : 'known';
    const clockSkew = previous !== null && previous > minute + 1;
    const missedWindow = previous !== null && minute - previous > 2 ? {
      from: new Date((previous + 1) * 60000).toISOString(), to: new Date((minute - 2) * 60000).toISOString(),
    } : null;
    const runs = await tickSchedules(validated, env, now, 2, enqueue);
    const attention = runs.filter(run => !['waiting', 'active', 'delayed', 'completed', 'prioritized', 'waiting-children'].includes(run.state));
    const aborted = workflowShutdownSignal().aborted;
    let auditError = false, watermarkError = false;
    try {
      if (baseline === 'unobserved' || clockSkew || missedWindow || attention.length) await redis.xadd(namespace + ':attention', 'MAXLEN', '~', '1000', '*', 'event', JSON.stringify({ at: now.toISOString(), baseline, clockSkew, missedWindow, runs: attention }));
    } catch { auditError = true; }
    try {
      // This records attempts, not success. Audit failure must not erase that fact.
      // Never mark a shutdown-truncated plan attempted or silently repair a future clock.
      if (!aborted && !clockSkew) await redis.eval("local n=tonumber(ARGV[1]); local p=tonumber(redis.call('GET',KEYS[1]) or '-1'); if n>p then redis.call('SET',KEYS[1],ARGV[1]) end; return 1", 1, namespace, minute);
    } catch { watermarkError = true; }
    const persistenceError = auditError || watermarkError;
    // Preserve accepted queue IDs even if the audit sink failed after enqueue.
    return { healthy: baseline === 'known' && !clockSkew && !missedWindow && attention.length === 0 && !persistenceError && !aborted, runs, missedWindow, attention, persistenceError, auditError, watermarkError, clockSkew, aborted, baseline };
  } finally { await redis.quit().catch(() => { redis.disconnect(); }); }
}
