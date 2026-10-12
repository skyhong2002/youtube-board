import type { RowDataPacket } from 'mysql2/promise';
import { clearItemBackoff, recordItemBackoff } from './backoff.js';
import { jsonMap, selectOne, taipeiSql, update, upsert } from './legacy-db.js';
import type { SourceJobContext } from './video-statistics.js';
import type { ChannelStatistics, PlaylistItem } from './youtube.js';
import { isYoutubeItemFailure, YoutubeError } from './quota.js';

export function cap(value: number, max: number, min = 1) { if (!Number.isSafeInteger(value) || value < min || value > max) throw new Error('Invalid source workflow cap'); return value; }
export function channelId(value?: number) { if (value !== undefined) cap(value, 2147483647); }
export const activeChannel = '(c.flag_del IS NULL OR c.flag_del < 1)';
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
  const [rows] = await ctx.db.query<RowDataPacket[]>(`SELECT c.* FROM urt_channel c LEFT JOIN ts_youtube_item_backoff b ON b.workflow = ? AND BINARY b.video_id = BINARY CAST(c.u_id AS CHAR) WHERE ${activeChannel} AND ${input.uId ? 'c.u_id = ?' : '(c.stime IS NULL OR c.stime <= ?) AND (b.retry_after IS NULL OR b.retry_after <= ?)'} ORDER BY c.stime, c.u_id LIMIT ?`, [job, ...(input.uId ? [input.uId] : [taipeiSql(new Date(ctx.now.getTime() - hours * 3600000)), taipeiSql(ctx.now)]), input.limit]);
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
export async function publishUploads(ctx: SourceJobContext, uId: number, items: Iterable<PlaylistItem>, tvbs = false, publishedVideos: string[] = []) {
  const at = taipeiSql(ctx.now);
  const prepared = [...items];
  for (const item of prepared) {
    const existing = await selectOne(ctx.db, 'urt_video', { videoId: item.videoId });
    if (existing && Number(existing.u_id) !== uId) throw new Error('Uploads video has a different channel owner');
  }
  for (const item of prepared) {
    await ctx.assertOwnership(); const existing = await selectOne(ctx.db, 'urt_video', { videoId: item.videoId });
    if (existing && Number(existing.u_id) !== uId) throw new Error('Uploads video has a different channel owner');
    const publishedAt = taipeiSql(new Date(item.publishedAt));
    await upsert(ctx.db, 'urt_video', { videoId: item.videoId }, { ...(existing ? {} : { ctime: at }), id: item.id, publishedAt, channelId: item.channelId, title: item.title, description: item.description, thumbnails: item.thumbnails, channelTitle: item.channelTitle, playlistId: item.playlistId, position: item.position, u_id: uId });
    publishedVideos.push(item.videoId);
    const schedule = await selectOne(ctx.db, 'urt_video_schedule', { videoId: item.videoId });
    await upsert(ctx.db, 'urt_video_schedule', { videoId: item.videoId }, { ...(schedule ? {} : { ctime: at }), publishedAt });
    if (item.liveBroadcastContent !== 'none' || item.thumbnails.includes('default_live.jpg')) {
      const liveTable = tvbs ? 'urt_video_live_tvbs' : 'urt_video_live';
      const live = await selectOne(ctx.db, liveTable, { videoId: item.videoId });
      await upsert(ctx.db, liveTable, { videoId: item.videoId }, { ...(live ? {} : { ctime: at }), publishedAt, u_id: uId });
    }
  }
}
export function nextUploadsCheck(now: Date, weekCount: number) {
  let seconds = Math.max(7200, weekCount > 0 ? 604800 / weekCount / 3 : 604800);
  const hour = Number(taipeiSql(new Date(now.getTime() + seconds * 1000)).slice(11, 13));
  if (hour < 8) seconds += (8 - hour) * 3600;
  return taipeiSql(new Date(now.getTime() + Math.max(7200, Math.floor(seconds)) * 1000));
}
export async function channelUploadsJob(ctx: SourceJobContext, input: { uId?: number; limit: number; maxPages: number; days: number; maxResults?: number; live?: 1 | 2; tvbs?: boolean }) {
  channelId(input.uId); cap(input.limit, 100); cap(input.maxPages, 200); cap(input.days, 365, 7); const maxResults = cap(input.maxResults ?? 5,50);
  const job = input.tvbs ? 'youtube.tvbs.videos' : input.live === 1 ? 'youtube.channels.videos.live_group' : input.live === 2 ? 'youtube.channels.videos.live' : 'youtube.channels.videos.general';
  const [rows] = await ctx.db.query<RowDataPacket[]>(`SELECT c.* FROM urt_channel c LEFT JOIN ts_youtube_item_backoff b ON b.workflow = ? AND BINARY b.video_id = BINARY CAST(c.u_id AS CHAR) WHERE ${activeChannel} AND ${input.uId ? 'c.u_id = ?' : input.live ? '(b.retry_after IS NULL OR b.retry_after <= ?)' : '(c.vtime IS NULL OR c.vtime <= ?) AND (b.retry_after IS NULL OR b.retry_after <= ?)'} ${input.live || input.tvbs ? 'AND EXISTS (SELECT 1 FROM urt_count n WHERE n.u_id = c.u_id AND n.tags LIKE ?)' : ''} ORDER BY c.vtime,c.u_id LIMIT ?`, [job, ...(input.uId ? [input.uId] : input.live ? [taipeiSql(ctx.now)] : [taipeiSql(ctx.now), taipeiSql(ctx.now)]), ...(input.live || input.tvbs ? [`%[${input.tvbs ? 29 : input.live === 1 ? 52 : 89}]%`] : []), input.limit]);
  const applied: { uId: number; videos: number; apiItems: number; oldestPublishedAt: string | null; pageExhausted: boolean; pages: number }[] = [], skipped: { uId: number; reason: string; partialVideos: string[] }[] = [];
  if (!ctx.execute) return { mode: 'dry-run', selected: rows.length, apiAttempts: 0, applied, skipped };
  for (const row of rows) {
    await ctx.assertOwnership();
    const partialVideos: string[] = [];
    try {
      if (!String(row.uploads ?? '').trim()) throw new Error('Missing uploads');
      const items = new Map<string, PlaylistItem>(), seen = new Set<string>(); let token: string | null = null; let weekCount = 0;
      let apiItems = 0, oldestPublishedAt: string | null = null, pageExhausted = false, pages = 0;
      for (let p = 0; p < input.maxPages; p++) {
        await ctx.assertOwnership(); const page = await ctx.youtube.playlistItemsPage(row.uploads, token, maxResults);
        apiItems += page.items.length; pages++; pageExhausted = page.nextPageToken === null;
        for (const item of page.items) {
          if (item.channelId !== row.youtube_id) throw new Error('Uploads channel mismatch');
          if (oldestPublishedAt === null || Date.parse(item.publishedAt) < Date.parse(oldestPublishedAt)) oldestPublishedAt = new Date(item.publishedAt).toISOString();
          // Scheduled premieres make publishedAt non-monotonic. Discovery refreshes every returned item.
          if (p === 0 && Date.parse(item.publishedAt) >= ctx.now.getTime() - 604800000) weekCount++;
          items.set(item.videoId,item);
        }
        if (page.nextPageToken === null) break;
        if (seen.has(page.nextPageToken) || token === page.nextPageToken) throw new Error('Uploads cursor failed to advance');
        seen.add(page.nextPageToken); token = page.nextPageToken;
      }
      await publishUploads(ctx, row.u_id, items.values(), input.tvbs, partialVideos);
      await update(ctx.db, 'urt_channel', { u_id: row.u_id }, { vtime: nextUploadsCheck(ctx.now, weekCount) });
      await clearItemBackoff(ctx.db, job, String(row.u_id)); applied.push({ uId: row.u_id, videos: items.size, apiItems, oldestPublishedAt, pageExhausted, pages });
    } catch (error) {
      if (error instanceof YoutubeError && !isYoutubeItemFailure(error)) return { mode:'execute', selected:rows.length, apiAttempts:ctx.youtube.attemptsMade, applied, skipped, stoppedReason:error.code, remaining:rows.length-applied.length-skipped.length };
      await ctx.assertOwnership();
      await recordItemBackoff(ctx.db, job, String(row.u_id), 'incomplete-channel-crawl', ctx.now); skipped.push({ uId: row.u_id, reason: 'incomplete-channel-crawl', partialVideos });
    }
  }
  return { mode: 'execute', selected: rows.length, apiAttempts: ctx.youtube.attemptsMade, applied, skipped };
}
