import { randomUUID } from 'node:crypto';
import { Redis } from 'ioredis';
import type { Connection, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { connectDatabase, withWriterLock } from './database.js';
import { assertExecute, executionPolicy } from './policy.js';
import { workflowShutdownSignal } from '../../shared/shutdown.js';
import {
  WEBSUB_CHANNEL_ID, WEBSUB_COMMAND, WEBSUB_VIDEO_ID, WEBSUB_HUB_URL, WEBSUB_JOB, WEBSUB_LEASE_SECONDS, WEBSUB_PRIORITY_VTIME, callbackUrl, hubSecret, websubKeys, websubSecret, websubTopic,
} from '../../shared/websub.js';

export { WEBSUB_COMMAND, WEBSUB_JOB };
/** The news and politics scope of /live/current: editorials, politicians, TV, news, parties, radio. */
export const WEBSUB_DEFAULT_TAGS = [1, 2, 12, 13, 14, 81];
const DRAIN_LIMIT = 500, FIRST_RUN_WINDOW_MINUTES = 30, NOTICE_RETENTION_DAYS = 3, VERIFY_RETENTION_DAYS = 35, PRUNE_LIMIT = 1000, WATCH_LIMIT = 2000, WATCH_REBUMP_MS = 6 * 60 * 1000, WATCH_EXPIRE_MS = 30 * 60 * 1000, WATCH_MAX_BUMPS = 3, RENEW_BEFORE_MS = 24 * 3600 * 1000, ACCEPTED_RETRY_MS = 6 * 3600 * 1000, FAILED_RETRY_MS = 30 * 60 * 1000, MAX_CONSECUTIVE_FAILURES = 5;

export function validateWebsubArguments(args: string[]) {
  if (args[0] !== WEBSUB_COMMAND || args.length > 4) throw new Error('Invalid WebSub command');
  let execute = false, limit = 40, tagIds = WEBSUB_DEFAULT_TAGS;
  const seen = new Set<string>();
  for (const arg of args.slice(1)) {
    if (arg === '--execute' && !execute) { execute = true; continue; }
    const match = /^--(limit|or)=(\d+(?:,\d+)*)$/.exec(arg);
    if (!match || seen.has(match[1]!)) throw new Error('Invalid WebSub option');
    seen.add(match[1]!);
    if (match[1] === 'limit') { limit = Number(match[2]); if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new Error('Invalid WebSub subscription cap'); }
    else { tagIds = match[2]!.split(',').map(Number); if (tagIds.length > 20 || tagIds.some(id => id < 1 || id > 2147483647)) throw new Error('Invalid WebSub taxonomy IDs'); }
  }
  return { execute, limit, tagIds };
}

function websubRedis(env: NodeJS.ProcessEnv) {
  const url = new URL(env.REDIS_URL ?? 'redis://127.0.0.1:26379');
  if (env.APP_ENV !== 'production' && !['127.0.0.1', 'localhost', 'redis'].includes(url.hostname)) throw new Error('Local worker requires local Redis');
  const redis = new Redis(url.toString(), { maxRetriesPerRequest: 1, connectTimeout: 3000, commandTimeout: 3000, retryStrategy: times => times <= 2 ? 100 : null });
  redis.on('error', () => {});
  return redis;
}
/** Channels whose uploads or live streams the news/politics pages should see within minutes. */
export async function scopedChannels(db: Connection, tagIds: number[]) {
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT DISTINCT c.youtube_id FROM urt_channel c JOIN urt_count n ON n.u_id = c.u_id WHERE (c.flag_del IS NULL OR c.flag_del < 1) AND c.youtube_id LIKE 'UC%' AND (${tagIds.map(() => 'n.tags LIKE ?').join(' OR ')}) ORDER BY c.youtube_id`,
    tagIds.map(id => `%[${id}]%`));
  return rows.map(row => String(row.youtube_id)).filter(id => WEBSUB_CHANNEL_ID.test(id));
}

/**
 * Turn pushed notices into discovery work. A notice for a video we already hold is a metadata edit and is ignored;
 * an unknown video moves its channel to the front of the general discovery queue, whose next sweep (every five
 * minutes) reads the uploads playlist and registers live candidates exactly as it always has.
 *
 * The hub can announce a video before the uploads playlist lists it, which would spend the notice on a sweep that
 * finds nothing. Unknown videos are therefore watched: until the video is stored (or half an hour has passed) the
 * channel is moved to the front again, at most three times, six minutes apart.
 */
export async function drainNotices(db: Connection, redis: Redis, assertOwnership: () => Promise<void>, now = Date.now()) {
  // The cursor is the last processed row id. Without one (first run, or Redis lost it) only the recent past is read.
  const stored = await redis.get(websubKeys.cursor), cursor = stored !== null && /^\d+$/.test(stored) ? stored : null;
  const [popped] = await db.query<RowDataPacket[]>(
    `SELECT id, channel_id, video_id FROM ts_websub_events WHERE kind = 'notice' AND ${cursor !== null ? 'id > ?' : `received_at >= UTC_TIMESTAMP() - INTERVAL ${FIRST_RUN_WINDOW_MINUTES} MINUTE`} ORDER BY id LIMIT ?`,
    cursor !== null ? [cursor, DRAIN_LIMIT] : [DRAIN_LIMIT]);
  const watch = await redis.hgetall(websubKeys.watch);
  const noticed: { channelId: string; videoId: string }[] = [];
  let invalid = 0;
  for (const row of popped) {
    const channelId = String(row.channel_id), videoId = String(row.video_id);
    if (WEBSUB_CHANNEL_ID.test(channelId) && WEBSUB_VIDEO_ID.test(videoId)) noticed.push({ channelId, videoId }); else invalid++;
  }
  const wanted = [...new Set([...noticed.map(event => event.videoId), ...Object.keys(watch)])], known = new Set<string>();
  if (wanted.length) {
    const [rows] = await db.query<RowDataPacket[]>('SELECT videoId FROM urt_video WHERE videoId IN (?)', [wanted]);
    for (const row of rows) known.add(String(row.videoId));
  }
  const bump = new Set<string>(), updates = new Map<string, string>(), removals: string[] = [];
  let ignored = 0, resolved = 0, expired = 0, rebumped = 0, watching = Object.keys(watch).length;
  for (const { channelId, videoId } of noticed) {
    if (known.has(videoId)) { ignored++; continue; }
    if (watch[videoId] !== undefined || updates.has(videoId)) continue;
    bump.add(channelId);
    if (watching < WATCH_LIMIT) { updates.set(videoId, `${channelId}|${now}|${now}|1`); watching++; }
  }
  for (const [videoId, value] of Object.entries(watch)) {
    const [channelId = '', first = 0, last = 0, bumps = 0] = value.split('|'), age = now - Number(first);
    if (known.has(videoId)) { removals.push(videoId); resolved++; }
    else if (!WEBSUB_CHANNEL_ID.test(channelId) || age > WATCH_EXPIRE_MS) { removals.push(videoId); expired++; }
    else if (Number(bumps) < WATCH_MAX_BUMPS && now - Number(last) >= WATCH_REBUMP_MS) { bump.add(channelId); updates.set(videoId, `${channelId}|${first}|${now}|${Number(bumps) + 1}`); rebumped++; }
  }
  let bumped = 0, alreadyQueuedOrUnknown = 0;
  for (const channelId of bump) {
    await assertOwnership();
    const [result] = await db.execute<ResultSetHeader>(
      'UPDATE urt_channel SET vtime = ? WHERE BINARY youtube_id = BINARY ? AND (flag_del IS NULL OR flag_del < 1) AND (vtime IS NULL OR vtime > ?)', [WEBSUB_PRIORITY_VTIME, channelId, WEBSUB_PRIORITY_VTIME]);
    if (result.affectedRows > 0) bumped++; else alreadyQueuedOrUnknown++;
  }
  for (const [videoId, value] of updates) await redis.hset(websubKeys.watch, videoId, value);
  if (popped.length) await redis.set(websubKeys.cursor, String(popped[popped.length - 1]!.id));
  if (removals.length) await redis.hdel(websubKeys.watch, ...removals);
  for (const [field, count] of Object.entries({ drained: popped.length, bumped, ignored, rebumped, resolved, expired })) if (count) await redis.hincrby(websubKeys.stats, field, count);
  return { drained: popped.length, invalid, channels: bump.size, bumped, ignored, alreadyQueuedOrUnknown, watching: watching - removals.length, resolved, expired, rebumped };
}

/** Subscription leases the hub confirmed (the receiver records each verification), as channelId -> expiry in epoch ms. */
export async function loadLeases(db: Connection, now: number) {
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT e.channel_id, TIMESTAMPDIFF(SECOND, UTC_TIMESTAMP(), e.received_at + INTERVAL e.lease_seconds SECOND) AS remaining
     FROM ts_websub_events e JOIN (SELECT channel_id, MAX(id) AS id FROM ts_websub_events WHERE kind = 'verify' GROUP BY channel_id) latest ON latest.id = e.id`);
  return new Map(rows.map(row => [String(row.channel_id), now + Number(row.remaining) * 1000]));
}
/** Notices are consumed within minutes; verifications must outlive the longest lease the hub can grant. */
export async function pruneEvents(db: Connection, assertOwnership: () => Promise<void>) {
  await assertOwnership();
  const [notices] = await db.execute<ResultSetHeader>(`DELETE FROM ts_websub_events WHERE kind = 'notice' AND received_at < UTC_TIMESTAMP() - INTERVAL ${NOTICE_RETENTION_DAYS} DAY LIMIT ${PRUNE_LIMIT}`);
  const [verifications] = await db.execute<ResultSetHeader>(`DELETE FROM ts_websub_events WHERE kind = 'verify' AND received_at < UTC_TIMESTAMP() - INTERVAL ${VERIFY_RETENTION_DAYS} DAY LIMIT ${PRUNE_LIMIT}`);
  return { notices: notices.affectedRows, verifications: verifications.affectedRows };
}

type Subscribe = (body: URLSearchParams) => Promise<number>;
const postToHub: Subscribe = async body => {
  const response = await fetch(WEBSUB_HUB_URL, { method: 'POST', redirect: 'error', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body, signal: AbortSignal.timeout(10000) });
  await response.body?.cancel();
  return response.status;
};
/**
 * Ask the hub to subscribe the next batch of channels. The lease itself is written by the receiver when the hub
 * verifies the callback, so "requested" and "established" stay separate: a channel is asked again only when it has
 * no lease, or its lease ends within a day, and never more often than the retry hold.
 */
export async function renewSubscriptions(redis: Redis, channels: string[], options: { secret: string; origin: string; limit: number; now: number; leases: ReadonlyMap<string, number>; subscribe?: Subscribe; assertOwnership: () => Promise<void> }) {
  const holds = channels.length ? await redis.hmget(websubKeys.retry, ...channels) : [];
  const due = channels.flatMap((channelId, index) => {
    const lease = options.leases.get(channelId) ?? 0, hold = holds[index] == null ? 0 : Number(holds[index]);
    return hold <= options.now && lease < options.now + RENEW_BEFORE_MS ? [{ channelId, lease }] : [];
  }).sort((a, b) => a.lease - b.lease || (a.channelId < b.channelId ? -1 : 1));
  const subscribe = options.subscribe ?? postToHub;
  let accepted = 0, failed = 0, consecutive = 0, attempted = 0;
  for (const { channelId } of due.slice(0, options.limit)) {
    await options.assertOwnership();
    attempted++;
    let status = 0;
    try {
      status = await subscribe(new URLSearchParams({
        'hub.callback': callbackUrl(options.origin, options.secret, channelId), 'hub.topic': websubTopic(channelId), 'hub.verify': 'async', 'hub.mode': 'subscribe',
        'hub.secret': hubSecret(options.secret, channelId), 'hub.lease_seconds': String(WEBSUB_LEASE_SECONDS),
      }));
    } catch { /* network failure: counted below */ }
    const ok = status === 202 || status === 204;
    await redis.hset(websubKeys.retry, channelId, String(options.now + (ok ? ACCEPTED_RETRY_MS : FAILED_RETRY_MS)));
    if (ok) { accepted++; consecutive = 0; } else { failed++; if (++consecutive >= MAX_CONSECUTIVE_FAILURES) break; }
  }
  if (accepted) await redis.hincrby(websubKeys.stats, 'subscribe_accepted', accepted);
  if (failed) await redis.hincrby(websubKeys.stats, 'subscribe_failed', failed);
  const established = channels.filter(channelId => (options.leases.get(channelId) ?? 0) > options.now).length;
  return { scoped: channels.length, established, due: due.length, attempted, accepted, failed, stoppedEarly: consecutive >= MAX_CONSECUTIVE_FAILURES };
}

export async function executeWebsubWorkflow(args: string[], env: NodeJS.ProcessEnv, scheduled = false) {
  const input = validateWebsubArguments(args);
  // A dry run neither connects nor contacts the hub.
  if (!input.execute) return { mode: 'dry-run', workflow: WEBSUB_JOB, ...input, externalCalls: 0, sourceWrites: 0 };
  assertExecute(WEBSUB_JOB, executionPolicy(env, 'execute', scheduled));
  const secret = websubSecret(env), origin = env.TS_WEBSUB_CALLBACK_ORIGIN ?? 'https://youtube.observe.tw';
  if (!secret) throw new Error('WebSub is not enabled: TS_WEBSUB_ENABLED and WEBSUB_SECRET are required');
  const parsed = new URL(origin);
  if (parsed.protocol !== 'https:' || parsed.pathname !== '/' || parsed.search || parsed.hash || parsed.username || parsed.password) throw new Error('Invalid WebSub callback origin');
  const db = await connectDatabase(env), redis = websubRedis(env);
  try {
    return await withWriterLock(db, WEBSUB_JOB, async assertOwnership => {
      const executionKey = randomUUID();
      await assertOwnership();
      await db.execute('INSERT INTO ts_job_runs(job_key,execution_key,status) VALUES(?,?,?)', [WEBSUB_JOB, executionKey, 'running']);
      try {
        const drained = await drainNotices(db, redis, assertOwnership);
        workflowShutdownSignal().throwIfAborted();
        const now = Date.now(), subscriptions = await renewSubscriptions(redis, await scopedChannels(db, input.tagIds), { secret, origin: parsed.origin, limit: input.limit, now, leases: await loadLeases(db, now), assertOwnership });
        const pruned = await pruneEvents(db, assertOwnership);
        const result = { executionKey, drained, subscriptions, pruned };
        await db.execute('UPDATE ts_job_runs SET status=?,result=? WHERE job_key=? AND execution_key=?', [subscriptions.stoppedEarly ? 'incomplete' : 'completed', JSON.stringify(result), WEBSUB_JOB, executionKey]);
        return result;
      } catch (error) {
        await db.execute('UPDATE ts_job_runs SET status=?,result=? WHERE job_key=? AND execution_key=?', ['failed', JSON.stringify({ error: 'websub-sync-failed' }), WEBSUB_JOB, executionKey]).catch(() => {});
        throw error;
      }
    });
  } finally { redis.disconnect(); await db.end(); }
}
export async function handleWebsubCli(args: string[], env: NodeJS.ProcessEnv) {
  if (args[0] !== WEBSUB_COMMAND) return false;
  console.log(JSON.stringify(await executeWebsubWorkflow(args, env))); return true;
}
