import type { RowDataPacket } from 'mysql2/promise';
import { clearItemBackoff, recordItemBackoff } from './backoff.js';
import { jsonMap, selectOne, taipeiSql, update, upsert } from './legacy-db.js';
import type { SourceJobContext } from './video-statistics.js';
import type { ChannelStatistics, PlaylistItem } from './youtube.js';
import { isYoutubeItemFailure, YoutubeError, youtubeFailureDetail } from './quota.js';

export function cap(value: number, max: number, min = 1) { if (!Number.isSafeInteger(value) || value < min || value > max) throw new Error('Invalid source workflow cap'); return value; }
export function channelId(value?: number) { if (value !== undefined) cap(value, 2147483647); }
export const activeChannel = '(c.flag_del IS NULL OR c.flag_del < 1)';
/** Laravel's channel statistics and discovery sources only poll `urt_channel.flag_del IS NULL` (a stored 0 is skipped). */
const laravelActiveChannel = 'c.flag_del IS NULL';
/** Errors that make Laravel stop the whole run (all keys exhausted, quota window/budget): no per-channel write. */
const RUN_STOPPING = new Set(['quota-exhausted', 'quota-budget', 'quota-comment-budget', 'quota-daily', 'quota-window', 'authentication', 'rate-limit', 'not-configured']);
export const isRunStoppingYoutubeError = (error: unknown): error is YoutubeError => error instanceof YoutubeError && RUN_STOPPING.has(error.code);
const missingLog = 'NOT EXISTS (SELECT 1 FROM urt_log l WHERE l.u_id = c.u_id)';
export async function publishChannelStatistics(ctx: SourceJobContext, row: RowDataPacket, stats: ChannelStatistics) {
  if (stats.viewCount <= 0) throw new Error('Channel view count is not positive');
  const at = taipeiSql(ctx.now), date = at.slice(0, 10), month = date.slice(0, 7) + '-01', u_id = row.u_id;
  const log = await selectOne(ctx.db, 'urt_log', { u_id, themonth: month });
  const history = jsonMap(log?.thedata);
  history[date] = { view: stats.viewCount, video: stats.videoCount, ...(stats.subscriberCount === null ? {} : { subscriber: stats.subscriberCount }), ...(stats.hiddenSubscriberCount ? { hidden: true } : {}) };
  await upsert(ctx.db, 'urt_log', { u_id, themonth: month }, { ...(log ? {} : { ctime: at }), mtime: at, thedata: JSON.stringify(history) });
  const count = await selectOne(ctx.db, 'urt_count', { u_id });
  const values = { mtime: at, viewCount: stats.viewCount, videoCount: stats.videoCount, ...(stats.subscriberCount === null ? {} : { subscriberCount: stats.subscriberCount }) };
  await upsert(ctx.db, 'urt_count', { u_id }, { ...(count ? {} : { ctime: at }), ...values });
  await update(ctx.db, 'urt_channel', { u_id }, { ...values, stime: at });
}
export async function channelStatisticsJob(ctx: SourceJobContext, input: { uId?: number; limit: number; hours?: number }) {
  channelId(input.uId); cap(input.limit, 50); const hours = cap(input.hours ?? 22, 168), job = 'youtube.channels.stats';
  // Laravel ChannelStatisticsPreview: channels without any urt_log history first (largest stored viewCount first), then oldest stime.
  const [rows] = await ctx.db.query<RowDataPacket[]>(`SELECT c.* FROM urt_channel c LEFT JOIN ts_youtube_item_backoff b ON b.workflow = ? AND BINARY b.video_id = BINARY CAST(c.u_id AS CHAR) WHERE ${laravelActiveChannel} AND ${input.uId ? 'c.u_id = ? ORDER BY c.u_id' : `TRIM(COALESCE(c.youtube_id, '')) <> '' AND (c.stime IS NULL OR c.stime <= ?) AND (b.retry_after IS NULL OR b.retry_after <= ?) ORDER BY CASE WHEN ${missingLog} THEN 0 ELSE 1 END, CASE WHEN ${missingLog} THEN COALESCE(c.viewCount, 0) ELSE 0 END DESC, c.stime, c.u_id`} LIMIT ?`, [job, ...(input.uId ? [input.uId] : [taipeiSql(new Date(ctx.now.getTime() - hours * 3600000)), taipeiSql(ctx.now)]), input.limit]);
  const applied: number[] = [], skipped: { uId: number; reason: string }[] = [];
  if (!ctx.execute || !rows.length) return { mode: ctx.execute ? 'execute' : 'dry-run', selected: rows.length, apiAttempts: 0, applied, skipped };
  await ctx.assertOwnership(); const valid = rows.filter(r => /^[A-Za-z0-9_-]{1,32}$/.test(String(r.youtube_id)));
  let result: Map<string, ChannelStatistics>;
  try { result = await ctx.youtube.channelStatistics(valid.map(r => r.youtube_id)); }
  catch (error) {
    if (!isYoutubeItemFailure(error)) throw error;
    for (const row of rows) { await ctx.assertOwnership(); await recordItemBackoff(ctx.db,job,String(row.u_id),'api-batch-item-rejected',ctx.now); skipped.push({uId:row.u_id,reason:'api-batch-item-rejected'}); }
    return {mode:'execute',selected:rows.length,apiAttempts:ctx.youtube.attemptsMade,applied,skipped};
  }
  for (const row of rows) {
    await ctx.assertOwnership(); const stats = result.get(row.youtube_id);
    if (!stats || stats.viewCount <= 0) { const reason = stats ? 'viewCount-not-positive' : 'api-item-missing-or-invalid'; await update(ctx.db,'urt_channel',{u_id:row.u_id},{stime:taipeiSql(ctx.now)}); await recordItemBackoff(ctx.db, job, String(row.u_id), reason, ctx.now); skipped.push({ uId: row.u_id, reason }); continue; }
    try { await publishChannelStatistics(ctx, row, stats); await clearItemBackoff(ctx.db, job, String(row.u_id)); applied.push(row.u_id); }
    catch { await ctx.assertOwnership(); await recordItemBackoff(ctx.db, job, String(row.u_id), 'item-write-failed', ctx.now); skipped.push({ uId: row.u_id, reason: 'item-write-failed' }); }
  }
  return { mode: 'execute', selected: rows.length, apiAttempts: ctx.youtube.attemptsMade, applied, skipped };
}
export async function channelRetirementJob(ctx: SourceJobContext, input: { uId?: number; limit: number; staleDays?: number; restore?: boolean }) {
  channelId(input.uId); cap(input.limit, 50); const days = cap(input.staleDays ?? 14, 365, 7);
  const job = 'youtube.channels.retire';
  if (input.restore && !input.uId) throw new Error('Restore requires an explicit channel');
  const [rows] = await ctx.db.query<RowDataPacket[]>(`SELECT c.* FROM urt_channel c LEFT JOIN ts_youtube_item_backoff b ON b.workflow = ? AND BINARY b.video_id = BINARY CAST(c.u_id AS CHAR) WHERE ${input.restore ? 'c.flag_del >= 1' : activeChannel} AND ${input.uId ? 'c.u_id = ?' : 'c.stime IS NOT NULL AND COALESCE(c.mtime,c.ctime) < ? AND (b.retry_after IS NULL OR b.retry_after <= ?)'} ORDER BY c.mtime,c.u_id LIMIT ?`, [job, ...(input.uId ? [input.uId] : [taipeiSql(new Date(ctx.now.getTime() - days * 86400000)), taipeiSql(ctx.now)]), input.limit]);
  const applied: number[] = [], skipped: { uId: number; reason: string }[] = [];
  if (!ctx.execute || !rows.length) return { mode: ctx.execute ? 'execute' : 'dry-run', selected: rows.length, apiAttempts: 0, applied, skipped };
  await ctx.assertOwnership(); const valid = rows.filter(r => /^[A-Za-z0-9_-]{1,32}$/.test(String(r.youtube_id)));
  let present: Set<string>;
  try { present = new Set(await ctx.youtube.channelPresence(valid.map(r => r.youtube_id))); }
  catch (error) {
    if (!isYoutubeItemFailure(error)) throw error;
    for (const row of rows) { await ctx.assertOwnership(); await recordItemBackoff(ctx.db,job,String(row.u_id),'api-batch-item-rejected',ctx.now); skipped.push({uId:row.u_id,reason:'api-batch-item-rejected'}); }
    return {mode:'execute',selected:rows.length,apiAttempts:ctx.youtube.attemptsMade,applied,skipped};
  }
  for (const row of rows) {
    await ctx.assertOwnership();
    if (!valid.includes(row) || present.has(row.youtube_id) !== !!input.restore) { const reason = !valid.includes(row) ? 'invalid-channel-identity' : input.restore ? 'still-absent' : 'still-present'; await recordItemBackoff(ctx.db, job, String(row.u_id), reason, ctx.now); skipped.push({ uId: row.u_id, reason }); continue; }
    await update(ctx.db, 'urt_channel', { u_id: row.u_id }, { flag_del: input.restore ? null : 1, mtime: taipeiSql(ctx.now) }); applied.push(row.u_id);
    await clearItemBackoff(ctx.db, job, String(row.u_id));
  }
  return { mode: 'execute', selected: rows.length, apiAttempts: ctx.youtube.attemptsMade, applied, skipped };
}
/** Laravel upsertByKeys: insert or overwrite every column, including `ctime` (re-discovery refreshes it), with no owner check. */
export async function publishUploads(ctx: SourceJobContext, uId: number, items: Iterable<PlaylistItem>, tvbs = false, publishedVideos: string[] = []) {
  const at = taipeiSql(ctx.now);
  for (const item of items) {
    await ctx.assertOwnership();
    const publishedAt = taipeiSql(new Date(item.publishedAt));
    await upsert(ctx.db, 'urt_video', { videoId: item.videoId }, { ctime: at, id: item.id, publishedAt, channelId: item.channelId, title: item.title, thumbnails: item.thumbnails, channelTitle: item.channelTitle, playlistId: item.playlistId, position: item.position, u_id: uId, description: item.description });
    publishedVideos.push(item.videoId);
    await upsert(ctx.db, 'urt_video_schedule', { videoId: item.videoId }, { ctime: at, publishedAt });
    if (isLiveCandidate(item)) await upsert(ctx.db, tvbs ? 'urt_video_live_tvbs' : 'urt_video_live', { videoId: item.videoId }, { ctime: at, publishedAt, u_id: uId });
  }
}
export const isLiveCandidate = (item: PlaylistItem) => item.liveBroadcastContent === 'live' || item.liveBroadcastContent === 'upcoming' || item.thumbnails.includes('default_live.jpg');
/** Laravel estimateNextVtime: the 08:00 Taipei rule is checked on the raw interval, then the two-hour floor applies. */
export function nextUploadsCheck(now: Date, weekCount: number) {
  let interval = weekCount > 0 ? 604800 / weekCount / 3 : 604800;
  const hour = Number(taipeiSql(new Date(now.getTime() + Math.trunc(interval) * 1000)).slice(11, 13));
  if (hour < 8) interval += (8 - hour) * 3600;
  if (interval < 7200) interval = 7200;
  return taipeiSql(new Date(now.getTime() + Math.trunc(interval) * 1000));
}
/** `stopAt` (epoch ms) ends paging once a returned publication reaches it, so a window proof reads only the pages it needs. */
export type UploadsInput = { uId?: number; limit: number; maxPages: number; days: number; maxResults?: number; stopAt?: number; live?: 1 | 2; tvbs?: boolean; tagId?: number; offset?: number | 'auto' };
/** `--live=1` is Laravel's tag 52 (youtube.channels.videos.live), `--live=2` tag 89 (youtube.channels.videos.live_group). */
export const uploadsJobKey = (input: Pick<UploadsInput, 'live' | 'tvbs'>) => input.tvbs ? 'youtube.tvbs.videos' : input.live === 1 ? 'youtube.channels.videos.live' : input.live === 2 ? 'youtube.channels.videos.live_group' : 'youtube.channels.videos.general';
const later = (now: Date, seconds: number) => taipeiSql(new Date(now.getTime() + seconds * 1000));
async function crawlUploads(ctx: SourceJobContext, row: RowDataPacket, maxPages: number, maxResults: number, stopAt?: number) {
  const items = new Map<string, PlaylistItem>(), seen = new Set<string>(); let token: string | null = null;
  let weekCount = 0, apiItems = 0, oldestPublishedAt: string | null = null, pageExhausted = false, pages = 0;
  for (let p = 0; p < maxPages; p++) {
    await ctx.assertOwnership(); const page = await ctx.youtube.playlistItemsPage(String(row.uploads).trim(), token, maxResults);
    apiItems += page.items.length; pages++; pageExhausted = page.nextPageToken === null;
    for (const item of page.items) {
      if (oldestPublishedAt === null || Date.parse(item.publishedAt) < Date.parse(oldestPublishedAt)) oldestPublishedAt = new Date(item.publishedAt).toISOString();
      // Scheduled premieres make publishedAt non-monotonic. Discovery refreshes every returned item.
      if (p === 0 && Date.parse(item.publishedAt) >= ctx.now.getTime() - 604800000) weekCount++;
      items.set(item.videoId, item);
    }
    if (page.nextPageToken === null || stopAt !== undefined && oldestPublishedAt !== null && Date.parse(oldestPublishedAt) <= stopAt) break;
    if (seen.has(page.nextPageToken) || token === page.nextPageToken) throw new Error('Uploads cursor failed to advance');
    seen.add(page.nextPageToken); token = page.nextPageToken;
  }
  return { items, weekCount, apiItems, oldestPublishedAt, pageExhausted, pages };
}
/** Laravel TvbsChannelVideosDiscoveryPreview: tag-29 channels by u_id, a wrapped window rotated every five minutes with `auto`. */
async function tvbsChannels(ctx: SourceJobContext, input: UploadsInput, limit: number) {
  const where = `${laravelActiveChannel} AND EXISTS (SELECT 1 FROM urt_count n WHERE n.u_id = c.u_id AND n.tags LIKE ?)${input.uId ? ' AND c.u_id = ?' : ''}`;
  const params = [`%[${cap(input.tagId ?? 29, 2147483647)}]%`, ...(input.uId ? [input.uId] : [])];
  const [counted] = await ctx.db.query<RowDataPacket[]>(`SELECT COUNT(*) AS n FROM urt_channel c WHERE ${where}`, params);
  const total = Number(counted[0]?.n ?? 0); if (total < 1) return [];
  const offset = input.offset === 'auto' ? (Math.floor(Math.floor(ctx.now.getTime() / 1000) / 300) * limit) % total : (input.offset ?? 0) % total;
  const [rows] = await ctx.db.query<RowDataPacket[]>(`SELECT c.* FROM urt_channel c WHERE ${where} ORDER BY c.u_id LIMIT ? OFFSET ?`, [...params, limit, offset]);
  const wanted = Math.min(limit, total);
  if (rows.length < wanted && offset > 0) { const [wrapped] = await ctx.db.query<RowDataPacket[]>(`SELECT c.* FROM urt_channel c WHERE ${where} ORDER BY c.u_id LIMIT ?`, [...params, wanted - rows.length]); rows.push(...wrapped); }
  return rows;
}
export async function channelUploadsJob(ctx: SourceJobContext, input: UploadsInput) {
  channelId(input.uId); cap(input.limit, 100); cap(input.maxPages, 200); cap(input.days, 365, 7); const maxResults = cap(input.maxResults ?? 5,50);
  if (input.offset !== undefined && input.offset !== 'auto') cap(input.offset, 2147483647, 0);
  // Laravel clamps execute batches to 10 discovery / 3 TVBS channels (previews to 81 / 80).
  const limit = Math.min(input.limit, input.tvbs ? (ctx.execute ? 3 : 80) : (ctx.execute ? 10 : 81));
  let rows: RowDataPacket[];
  if (input.tvbs) rows = await tvbsChannels(ctx, input, limit);
  else if (input.uId) [rows] = await ctx.db.query<RowDataPacket[]>('SELECT c.* FROM urt_channel c WHERE c.u_id = ? ORDER BY c.u_id LIMIT ?', [input.uId, limit]);
  else if (input.live) [rows] = await ctx.db.query<RowDataPacket[]>(`SELECT c.* FROM urt_channel c WHERE ${laravelActiveChannel} AND EXISTS (SELECT 1 FROM urt_count n WHERE n.u_id = c.u_id AND n.tags LIKE ?) ORDER BY c.vtime, c.u_id LIMIT ?`, [`%[${input.live === 1 ? 52 : 89}]%`, limit]);
  else [rows] = await ctx.db.query<RowDataPacket[]>(`SELECT c.* FROM urt_channel c WHERE ${laravelActiveChannel} AND (c.vtime <= ? OR c.vtime IS NULL) ORDER BY c.vtime, c.u_id LIMIT ?`, [taipeiSql(ctx.now), limit]);
  const applied: { uId: number; videos: number; apiItems: number; oldestPublishedAt: string | null; pageExhausted: boolean; pages: number }[] = [], skipped: { uId: number; reason: string; partialVideos: string[]; failure?: ReturnType<typeof youtubeFailureDetail> }[] = [];
  let discoveryFailures = 0;
  const summary = () => ({ allSkipped: rows.length > 0 && skipped.length === rows.length, discoveryFailures,
    skipCounts: Object.fromEntries([...new Set(skipped.map(item => item.reason))].map(reason => [reason, skipped.filter(item => item.reason === reason).length])),
    failureCounts: Object.fromEntries([...new Set(skipped.flatMap(item => item.failure ? [item.failure.category] : []))].map(category => [category, skipped.filter(item => item.failure?.category === category).length])) });
  if (!ctx.execute) return { mode: 'dry-run', selected: rows.length, apiAttempts: 0, applied, skipped, ...summary() };
  const stopped = (error: YoutubeError) => ({ mode:'execute', selected:rows.length, apiAttempts:ctx.youtube.attemptsMade, applied, skipped, ...summary(), stoppedReason:error.code, remaining:rows.length-applied.length-skipped.length });
  for (const row of rows) {
    await ctx.assertOwnership();
    const uId = Number(row.u_id), partialVideos: string[] = [];
    if (!String(row.uploads ?? '').trim()) {
      // Laravel defers a channel without an uploads playlist by one hour (TVBS discovery writes nothing).
      if (!input.tvbs) await update(ctx.db, 'urt_channel', { u_id: uId }, { vtime: later(ctx.now, 3600) });
      skipped.push({ uId, reason: 'missing-uploads-playlist', partialVideos }); continue;
    }
    let crawl: Awaited<ReturnType<typeof crawlUploads>>;
    try { crawl = await crawlUploads(ctx, row, input.maxPages, maxResults, input.stopAt); }
    catch (error) {
      if (isRunStoppingYoutubeError(error)) return stopped(error);
      await ctx.assertOwnership();
      if (!input.tvbs) await update(ctx.db, 'urt_channel', { u_id: uId }, { vtime: later(ctx.now, 3600) });
      const failure = youtubeFailureDetail(error);
      // A genuinely missing/inaccessible playlist remains an expected per-item skip.
      if (!(failure.category === 'request-failed' && ([404, 410].includes(failure.status ?? 0) || failure.reason === 'playlistItemsNotAccessible'))) discoveryFailures++;
      skipped.push({ uId, reason: 'playlist-api-error', partialVideos, failure }); continue;
    }
    try {
      await publishUploads(ctx, uId, crawl.items.values(), input.tvbs, partialVideos);
      // TVBS discovery rotates by offset and never touches the general discovery cadence column.
      if (!input.tvbs) await update(ctx.db, 'urt_channel', { u_id: uId }, { vtime: nextUploadsCheck(ctx.now, crawl.weekCount) });
      applied.push({ uId, videos: crawl.items.size, apiItems: crawl.apiItems, oldestPublishedAt: crawl.oldestPublishedAt, pageExhausted: crawl.pageExhausted, pages: crawl.pages });
    } catch {
      await ctx.assertOwnership();
      // Laravel DATABASE_FAILURE_RETRY_MINUTES: a five-minute cooldown so a capped batch rotates and retries idempotently.
      if (!input.tvbs) await update(ctx.db, 'urt_channel', { u_id: uId }, { vtime: later(ctx.now, 300) }).catch(() => undefined);
      skipped.push({ uId, reason: 'item-processing-failed', partialVideos });
      discoveryFailures++;
    }
  }
  return { mode: 'execute', selected: rows.length, apiAttempts: ctx.youtube.attemptsMade, applied, skipped, ...summary() };
}
