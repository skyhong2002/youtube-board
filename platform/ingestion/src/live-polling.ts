import { recordItemBackoff, clearItemBackoff } from './backoff.js';
import type { RowDataPacket } from 'mysql2/promise';
import { taipeiSql, jsonMap, selectOne, upsert, update } from './legacy-db.js';
import { unsigned, type Json } from './youtube.js';
import type { SourceJobContext } from './video-statistics.js';
export async function publishLiveDetails(ctx: Pick<SourceJobContext, 'db' | 'now'>, row: RowDataPacket, details: Json, tvbs = false): Promise<void> {
  const liveTable = tvbs ? 'urt_video_live_tvbs' : 'urt_video_live', logTable = tvbs ? 'urt_video_live_log_tvbs' : 'urt_video_live_log';
  const videoId = String(row.videoId), at = taipeiSql(ctx.now), date = at.slice(0, 10), minute = at.slice(11, 16);
  const viewers = unsigned(details.concurrentViewers);
  const values: Record<string, unknown> = { mtime: at };
  for (const key of ['actualStartTime', 'actualEndTime', 'scheduledStartTime']) if (typeof details[key] === 'string') values[key] = taipeiSql(new Date(details[key]));
  if (typeof details.activeLiveChatId === 'string') values.activeLiveChatId = details.activeLiveChatId;
  if (viewers !== null) {
    const log = await selectOne(ctx.db, logTable, { videoId, the_date: date });
    const points = jsonMap(log?.log_json);
    if (Object.values(points).some(point => unsigned(point) === null)) throw new Error('Invalid existing live history');
    points[minute] = viewers;
    const maximum = Math.max(...Object.values(points).map(Number));
    // Laravel sets u_id only when it creates the day row; later minutes update mtime/log/max only.
    await upsert(ctx.db, logTable, { videoId, the_date: date }, { ...(log ? {} : { ctime: at, u_id: row.u_id }), mtime: at, max_current: maximum, log_json: JSON.stringify(points) });
    values.concurrentViewers = viewers;
    // Laravel raises max_current only above the stored value (an unset maximum stays NULL for zero viewers).
    if (viewers > (unsigned(row.max_current) ?? 0)) values.max_current = viewers;
  }
  await update(ctx.db, liveTable, { pk: row.pk }, values);
}
/** How long before scheduledStartTime an upcoming stream is polled (streams often start early). */
export const UPCOMING_LEAD_MS = 30 * 60000;
export async function livePollingJob(ctx: SourceJobContext, input: { videoId?: string; limit: number; intervalMinutes?: number; tvbs?: boolean; staleSeconds?: number }) {
  const interval = input.intervalMinutes ?? 11, liveTable = input.tvbs ? 'urt_video_live_tvbs' : 'urt_video_live', job = input.tvbs ? 'youtube.tvbs.live.poll' : 'youtube.live.poll';
  const delay = input.tvbs ? (input.staleSeconds ?? 40) * 1000 : interval * 60000;
  if (!Number.isInteger(delay) || delay < 10000 || delay > 14400000) throw new Error('Invalid live interval');
  if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 50 || !Number.isInteger(interval) || interval < 1 || interval > 240) throw new Error('Invalid live polling caps');
  // Laravel LivePollingPreview / TvbsLivePollingPreview: strict cutoffs, del_flag NULL or < 1, a fixed 50-row legacy batch
  // (the threshold counts that batch), then the first `limit` rows are polled. Unlike Laravel, upcoming streams become due
  // UPCOMING_LEAD_MS before their scheduled start, so a stream that goes live early is picked up within one interval.
  const [batch] = await ctx.db.query<RowDataPacket[]>(input.videoId ? `SELECT * FROM ${liveTable} WHERE BINARY videoId = BINARY ? LIMIT 1` : `SELECT v.* FROM ${liveTable} v WHERE (v.mtime IS NULL OR v.mtime < ?) AND v.actualEndTime IS NULL AND (v.scheduledStartTime IS NULL OR v.scheduledStartTime < ?) AND (v.del_flag IS NULL OR v.del_flag < 1) ORDER BY v.mtime, v.videoId LIMIT 50`, input.videoId ? [input.videoId] : [taipeiSql(new Date(ctx.now.getTime() - delay)), taipeiSql(new Date(ctx.now.getTime() + UPCOMING_LEAD_MS))]);
  const rows = batch.slice(0, input.limit);
  // Legacy get_live.php exits below ten due streams unless one video is named; the TVBS poller polls any due row.
  const wouldCallApi = rows.length > 0 && (!!input.tvbs || !!input.videoId || batch.length >= 10);
  if (!ctx.execute || !wouldCallApi) return { mode: ctx.execute ? 'execute' : 'dry-run', selected: rows.length, wouldCallApi, apiAttempts: 0, applied: [], skipped: [] };
  await ctx.assertOwnership(); const data = await ctx.youtube.videoLiveStreamingDetails(rows.map(r => String(r.videoId)));
  const applied: string[] = [], skipped: { videoId: string; reason: string }[] = [];
  for (const row of rows) {
    await ctx.assertOwnership(); const details = data.get(String(row.videoId));
    if (details === undefined) { await update(ctx.db, liveTable, { pk: row.pk }, { del_flag: 1, mtime: taipeiSql(ctx.now) }); await clearItemBackoff(ctx.db, job, row.videoId); skipped.push({ videoId: row.videoId, reason: 'api-item-absent' }); continue; }
    if (details === null) { await recordItemBackoff(ctx.db, job, row.videoId, 'api-item-invalid', ctx.now); skipped.push({ videoId: row.videoId, reason: 'api-item-invalid' }); continue; }
    try { await publishLiveDetails(ctx, row, details, input.tvbs); await clearItemBackoff(ctx.db, job, row.videoId); applied.push(row.videoId); } catch { await recordItemBackoff(ctx.db, job, row.videoId, 'item-write-failed', ctx.now); skipped.push({ videoId: row.videoId, reason: 'item-write-failed' }); }
  }
  return { mode: 'execute', selected: rows.length, wouldCallApi, apiAttempts: ctx.youtube.attemptsMade, applied, skipped };
}
