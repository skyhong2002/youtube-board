import { isYoutubeItemFailure } from './quota.js';
import { recordItemBackoff, clearItemBackoff } from './backoff.js';
import type { Connection, RowDataPacket } from 'mysql2/promise';
import { YoutubeDataApiClient, unsigned, type VideoStatistics } from './youtube.js';
import { taipeiSql, legacyInstant, jsonMap, selectOne, upsert, update } from './legacy-db.js';
export interface SourceJobContext { db: Connection; youtube: YoutubeDataApiClient; execute: boolean; now: Date; clock?: () => Date; assertOwnership: () => Promise<void> }
/** Laravel estimateNextCheck: the prior observation counts only with a past mtime and a known viewCount. */
export function nextStatisticsCheck(current: number, previous: { viewCount?: unknown; mtime?: unknown } | null, publishedAt: unknown, now: Date): string {
  let from = legacyInstant(previous?.mtime), previousViews = unsigned(previous?.viewCount);
  if (!from || from >= now || previousViews === null) { from = legacyInstant(publishedAt); previousViews = 0; }
  if (!from || from >= now) from = new Date(now.getTime() - 2 * 3600000);
  const delta = Math.max(1, current - previousViews), period = Math.max(1, Math.floor((now.getTime() - from.getTime()) / 1000) + 1);
  let hours = 1000 / (delta / (period / 3600)); if (hours > 1000) hours = 3000; hours = Math.max(2, hours);
  return taipeiSql(new Date(now.getTime() + Math.round(hours * 3600) * 1000));
}
const known = (...values: unknown[]): number | null => { for (const value of values) { const count = unsigned(value); if (count !== null) return count; } return null; };
export async function publishVideoStatistics(db: Connection, row: RowDataPacket, stats: VideoStatistics, now: Date, source: 'urt_video' | 'urt_video_schedule' = 'urt_video'): Promise<void> {
  const videoId = String(row.videoId), at = taipeiSql(now), date = at.slice(0, 10), month = date.slice(0, 7) + '-01';
  const log = await selectOne(db, 'urt_video_log', { videoId, themonth: month });
  const data = jsonMap(log?.thedata); // Validate before even a nontransactional history write.
  const video = await selectOne(db, 'urt_video', { videoId }), schedule = await selectOne(db, 'urt_video_schedule', { videoId }), history = await selectOne(db, 'urt_video_log_history', { videoId });
  if (!video) throw new Error('Source video row is missing');
  const videoLike = known(stats.likeCount, video?.likeCount, schedule?.likeCount, history?.likeCount), scheduleLike = known(stats.likeCount, schedule?.likeCount, video?.likeCount, history?.likeCount);
  const favorite = known(stats.favoriteCount, video?.favoriteCount, history?.favoriteCount), videoComment = known(stats.commentCount, video?.commentCount, schedule?.commentCount, history?.commentCount), scheduleComment = known(stats.commentCount, schedule?.commentCount, video?.commentCount, history?.commentCount);
  // Laravel merges into the existing day point (keeping its other keys and key order).
  const point = data[date] && typeof data[date] === 'object' ? data[date] as Record<string, unknown> : {};
  if (stats.viewCount + (videoLike ?? 0) > 0) data[date] = { ...point, view: stats.viewCount, dislike: stats.dislikeCount, ...(videoLike === null ? {} : { like: videoLike }), ...(videoComment === null ? {} : { comment: videoComment }) };
  if (videoLike !== null && favorite !== null && videoComment !== null) await upsert(db, 'urt_video_log_history', { videoId, ctime: at }, { viewCount: stats.viewCount, likeCount: videoLike, dislikeCount: stats.dislikeCount, favoriteCount: favorite, commentCount: videoComment });
  await upsert(db, 'urt_video_log', { videoId, themonth: month }, { ...(log ? {} : { ctime: at }), mtime: at, thedata: JSON.stringify(data) });
  const previous = schedule ?? video;
  const nextCheck = nextStatisticsCheck(stats.viewCount, { viewCount: previous.viewCount, mtime: previous.mtime }, row.publishedAt, now);
  const common = { viewCount: stats.viewCount, publishedAt: taipeiSql(legacyInstant(row.publishedAt) ?? now) };
  const videoValues = { ...common, dislikeCount: stats.dislikeCount, ...(videoLike === null ? {} : { likeCount: videoLike }), ...(favorite === null ? {} : { favoriteCount: favorite }), ...(videoComment === null ? {} : { commentCount: videoComment }) };
  // Source freshness is last; a failed log write leaves the source due on MyISAM.
  await update(db, 'urt_video', { videoId }, videoValues);
  // Laravel writes the schedule row's ctime on every statistics refresh, not only on insert.
  await upsert(db, 'urt_video_schedule', { videoId }, { ctime: at, ...common, mtime: at, stime: nextCheck, ...(scheduleLike === null ? {} : { likeCount: scheduleLike }), ...(scheduleComment === null ? {} : { commentCount: scheduleComment }) });
  if (source === 'urt_video') await update(db, 'urt_video', { videoId }, { mtime: at, stime: nextCheck });
}
export async function videoStatisticsJob(ctx: SourceJobContext, input: { videoId?: string; limit: number; today?: boolean }) {
  if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 50) throw new Error('Statistics limit must be 1–50');
  const at = taipeiSql(ctx.now), from = taipeiSql(new Date(ctx.now.getTime() - (input.today ? 7 : 210) * 86400000)), before = taipeiSql(new Date(ctx.now.getTime() - 2 * 3600000));
  const table = input.videoId || input.today ? 'urt_video' : 'urt_video_schedule';
  const [rows] = await ctx.db.query<RowDataPacket[]>(input.videoId ? 'SELECT * FROM urt_video WHERE BINARY videoId = BINARY ? LIMIT 1' : `SELECT v.* FROM ${table} v LEFT JOIN ts_youtube_item_backoff b ON b.workflow = 'youtube.videos.stats' AND BINARY b.video_id = BINARY v.videoId WHERE (v.stime IS NULL OR v.stime <= ?) AND v.publishedAt >= ? AND v.publishedAt < ?${input.today ? ' AND v.viewCount IS NULL' : ''} AND (b.retry_after IS NULL OR b.retry_after <= ?) ORDER BY v.stime, BINARY v.videoId LIMIT ?`, input.videoId ? [input.videoId] : [at, from, before, at, input.limit]);
  // Laravel (legacy get_video_count.php): call only for an explicit video or a first batch above 80% of the cap.
  const wouldCallApi = rows.length > 0 && (!!input.videoId || rows.length > Math.floor(input.limit * 0.8));
  if (!ctx.execute || !wouldCallApi) return { mode: ctx.execute ? 'execute' : 'dry-run', selected: rows.length, wouldCallApi, apiAttempts: 0, applied: [], skipped: [] };
  await ctx.assertOwnership();
  let response: Map<string,VideoStatistics>;
  const applied: string[] = [], skipped: { videoId: string; reason: string }[] = [];
  try { response = await ctx.youtube.videoStatistics(rows.map(r => String(r.videoId))); } catch(error) {
    if(!isYoutubeItemFailure(error))throw error;
    for(const row of rows) {await ctx.assertOwnership();await update(ctx.db,table,{pk:row.pk},{stime:taipeiSql(new Date(ctx.now.getTime()+5*60000))});await recordItemBackoff(ctx.db,'youtube.videos.stats',row.videoId,'api-batch-item-rejected',ctx.now);skipped.push({videoId:row.videoId,reason:'api-batch-item-rejected'});}
    return {mode:'execute',selected:rows.length,wouldCallApi,apiAttempts:ctx.youtube.attemptsMade,applied,skipped};
  }
  for (const row of rows) {
    await ctx.assertOwnership(); const stats = response.get(String(row.videoId));
    if (!stats) { await update(ctx.db,table,{pk:row.pk},{stime:taipeiSql(new Date(ctx.now.getTime()+5*60000))}); await recordItemBackoff(ctx.db, 'youtube.videos.stats', row.videoId, 'api-item-missing-or-invalid', ctx.now); skipped.push({ videoId: row.videoId, reason: 'api-item-missing-or-invalid' }); continue; }
    try { await publishVideoStatistics(ctx.db, row, stats, ctx.now, table); await clearItemBackoff(ctx.db, 'youtube.videos.stats', row.videoId); applied.push(row.videoId); }
    catch { await ctx.assertOwnership(); await recordItemBackoff(ctx.db, 'youtube.videos.stats', row.videoId, 'item-write-failed', ctx.now); skipped.push({ videoId: row.videoId, reason: 'item-write-failed' }); }
  }
  return { mode: 'execute', selected: rows.length, wouldCallApi, apiAttempts: ctx.youtube.attemptsMade, applied, skipped };
}
