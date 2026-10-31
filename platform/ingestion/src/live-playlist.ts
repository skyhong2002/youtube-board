import { randomUUID } from 'node:crypto';
import type { RowDataPacket } from 'mysql2/promise';
import { parsePayload } from '../../shared/channel-admin.js';
import { cap, isLiveCandidate, publishUploads } from './channel-jobs.js';
import { taipeiSql, upsert } from './legacy-db.js';
import { YoutubeError } from './quota.js';
import type { SourceJobContext } from './video-statistics.js';
import type { PlaylistItem } from './youtube.js';

export const LIVE_PLAYLIST_JOB = 'youtube.live.playlist';
export const LIVE_PLAYLIST_COMMAND = 'youtube:live:playlist';
/** Shown as the requester in /admin's recent changes, so a channel this job asked for is recognisable. */
export const LIVE_PLAYLIST_ACTOR = 'live-playlist';
export const LIVE_PLAYLIST_ID = /^PL[A-Za-z0-9_-]{10,64}$/;
/** Same cap the web applies before queueing (api/src/channel-admin.ts PENDING_LIMIT). */
const REQUEST_PENDING_LIMIT = 100;
/** A channel requested within this window is not requested again, whatever the outcome. Only the newest 1,000 requests are
 * read: with at most 100 pending, a day with more than 1,000 answered add-channel requests is not expected. */
const REQUEST_HOLD = 'INTERVAL 1 DAY';

type Applied = { videoId: string; outcome: 'restored' } | { videoId: string; outcome: 'published'; uId: number; live: PlaylistItem['liveBroadcastContent'] } | { videoId: string; outcome: 'channel-requested'; channelId: string };
type Skipped = { videoId: string; reason: 'retired-by-poller' | 'retired' | 'unavailable' | 'retired-channel' | 'request-queue-full'; channelId?: string };
const alive = (row: RowDataPacket) => row.del_flag === null || Number(row.del_flag) < 1;

/**
 * Channels with an add-channel request still pending, or answered within the hold, and the pending total. A request is known by
 * its source (a channel id, @handle or video link) and, once answered, by the channel id its result names.
 */
async function recentChannelRequests(db: SourceJobContext['db']) {
  const [rows] = await db.query<RowDataPacket[]>(`SELECT payload, result FROM ts_channel_admin_requests WHERE kind = 'add-channel' AND (status = 'pending' OR applied_at >= UTC_TIMESTAMP() - ${REQUEST_HOLD}) ORDER BY id DESC LIMIT 1000`);
  const [count] = await db.query<RowDataPacket[]>("SELECT COUNT(*) AS n FROM ts_channel_admin_requests WHERE status = 'pending'");
  const sources = new Set<string>();
  for (const row of rows) {
    try { const payload = parsePayload('add-channel', JSON.parse(String(row.payload))); if (payload?.kind === 'add-channel') sources.add(payload.source); } catch { /* unreadable rows are ignored, as /admin does */ }
    try { const result: unknown = row.result === null ? null : JSON.parse(String(row.result)); if (result && typeof result === 'object' && typeof (result as { youtubeId?: unknown }).youtubeId === 'string') sources.add((result as { youtubeId: string }).youtubeId); } catch { /* no usable result */ }
  }
  return { sources, pending: Number(count[0]?.n ?? 0) };
}

/**
 * 加入直播: an administrator lists live streams the discovery sweeps missed in a public playlist of our channel, and every run
 * makes each listed video part of the live tracking. Everything in the playlist is trusted. Items stay until the administrator
 * removes them, so a run over an already-handled list only spends the one-unit playlist read.
 *
 * - Live row alive: nothing to do (unless urt_video lacks the video, then it is looked up so the display cache has metadata).
 * - Live row retired before live.poll ever read it (del_flag=1, no mtime, the old cleanup race): revived with a fresh ctime,
 *   so live.poll reads it before cleanup's two-hour grace runs out. A row the poller retired (mtime set) stays retired.
 * - No live row: one videos.list call (one unit for up to 50 videos). A video of a tracked channel is written exactly like an
 *   uploads sweep writes it, and always gets a live row: the administrator says it is a live, and live.poll fills the details
 *   or retires it if YouTube has none. A video of an unknown channel queues an add-channel request for youtube.channels.admin
 *   (actor `live-playlist`), and a later run publishes the video once the channel is tracked. A retired channel is not re-added.
 *
 * Only the first page is read: the playlist is a short work list that the administrator empties, and `truncated` reports more.
 */
export async function livePlaylistJob(ctx: SourceJobContext, input: { playlistId: string; limit: number }) {
  if (!LIVE_PLAYLIST_ID.test(input.playlistId)) throw new Error('Invalid live playlist');
  cap(input.limit, 50);
  const applied: Applied[] = [], skipped: Skipped[] = [], unchanged: string[] = [], waiting: { videoId: string; channelId: string }[] = [];
  let listed = 0, malformed = 0, truncated = false;
  const summary = (stoppedReason?: string) => ({
    mode: 'execute' as const, playlistId: input.playlistId, listed, malformed, truncated, apiAttempts: ctx.youtube.attemptsMade,
    counts: { unchanged: unchanged.length, restored: applied.filter(a => a.outcome === 'restored').length, published: applied.filter(a => a.outcome === 'published').length, requested: applied.filter(a => a.outcome === 'channel-requested').length, waiting: waiting.length, skipped: skipped.length },
    applied, skipped, unchanged, waiting, ...(stoppedReason ? { stoppedReason } : {}),
  });
  if (!ctx.execute) return { mode: 'dry-run' as const, playlistId: input.playlistId, listed, malformed, truncated, apiAttempts: 0, applied, skipped, unchanged, waiting };

  let page: Awaited<ReturnType<SourceJobContext['youtube']['playlistVideoIds']>>;
  try { page = await ctx.youtube.playlistVideoIds(input.playlistId, input.limit); }
  catch (error) { if (error instanceof YoutubeError) return summary(error.code); throw error; }
  const ids = page.videoIds; listed = ids.length; malformed = page.malformed; truncated = page.nextPageToken !== null;
  if (!ids.length) return summary();

  const [liveRows] = await ctx.db.query<RowDataPacket[]>('SELECT pk, videoId, del_flag, mtime FROM urt_video_live WHERE videoId IN (?)', [ids]);
  const [videoRows] = await ctx.db.query<RowDataPacket[]>('SELECT videoId FROM urt_video WHERE videoId IN (?)', [ids]);
  const [scheduleRows] = await ctx.db.query<RowDataPacket[]>('SELECT videoId FROM urt_video_schedule WHERE videoId IN (?)', [ids]);
  // The columns may compare case-insensitively; video ids are case-sensitive. A video counts as stored only when both rows an
  // uploads sweep writes exist, so a publish interrupted between them is completed by the next run.
  const scheduled = new Set(scheduleRows.map(row => String(row.videoId)));
  const stored = new Set(videoRows.map(row => String(row.videoId)).filter(videoId => scheduled.has(videoId)));
  const lookup: string[] = [];
  for (const videoId of ids) {
    const rows = liveRows.filter(row => String(row.videoId) === videoId);
    if (!rows.length) { lookup.push(videoId); continue; }
    if (rows.some(alive)) { if (stored.has(videoId)) unchanged.push(videoId); else lookup.push(videoId); continue; }
    const unpolled = rows.filter(row => Number(row.del_flag) === 1 && row.mtime === null);
    if (!unpolled.length) { skipped.push({ videoId, reason: rows.some(row => row.mtime !== null) ? 'retired-by-poller' : 'retired' }); continue; }
    for (const row of unpolled) {
      await ctx.assertOwnership();
      await ctx.db.execute('UPDATE urt_video_live SET del_flag = NULL, ctime = ? WHERE pk = ? AND del_flag = 1 AND mtime IS NULL', [taipeiSql(ctx.now), row.pk]);
    }
    applied.push({ videoId, outcome: 'restored' });
    if (!stored.has(videoId)) lookup.push(videoId);
  }
  if (!lookup.length) return summary();

  let found: PlaylistItem[];
  try { found = await ctx.youtube.videoUploads(lookup); }
  catch (error) { if (error instanceof YoutubeError) return summary(error.code); throw error; }
  const byVideo = new Map(found.map(item => [item.videoId, item])), channelIds = [...new Set(found.map(item => item.channelId))];
  /** youtube_id -> tracked u_id, or null when every row of that channel is retired. */
  const channels = new Map<string, number | null>();
  if (channelIds.length) {
    const [rows] = await ctx.db.query<RowDataPacket[]>('SELECT u_id, youtube_id, flag_del FROM urt_channel WHERE youtube_id IN (?) ORDER BY u_id', [channelIds]);
    for (const row of rows) {
      const youtubeId = String(row.youtube_id);
      if (!channelIds.includes(youtubeId)) continue;
      const tracked = row.flag_del === null || Number(row.flag_del) < 1;
      if (tracked && channels.get(youtubeId) == null) channels.set(youtubeId, Number(row.u_id));
      else if (!channels.has(youtubeId)) channels.set(youtubeId, null);
    }
  }
  let requests: Awaited<ReturnType<typeof recentChannelRequests>> | null = null;
  for (const videoId of lookup) {
    const item = byVideo.get(videoId);
    if (!item) { skipped.push({ videoId, reason: 'unavailable' }); continue; }
    const channelId = item.channelId, uId = channels.get(channelId);
    if (typeof uId === 'number') {
      await publishUploads(ctx, uId, [item]);
      if (!isLiveCandidate(item)) {
        await ctx.assertOwnership();
        await upsert(ctx.db, 'urt_video_live', { videoId }, { ctime: taipeiSql(ctx.now), publishedAt: taipeiSql(new Date(item.publishedAt)), u_id: uId });
      }
      applied.push({ videoId, outcome: 'published', uId, live: item.liveBroadcastContent });
      continue;
    }
    // Same refusal youtube.channels.admin gives (CHANNEL_RETIRED): a retired channel is not brought back from here.
    if (uId === null) { skipped.push({ videoId, reason: 'retired-channel', channelId }); continue; }
    requests ??= await recentChannelRequests(ctx.db);
    if (requests.sources.has(channelId)) { waiting.push({ videoId, channelId }); continue; }
    if (requests.pending >= REQUEST_PENDING_LIMIT) { skipped.push({ videoId, reason: 'request-queue-full', channelId }); continue; }
    // Stored exactly as the web stores a request: the parsed payload, whose source is the bare channel id.
    const payload = parsePayload('add-channel', { source: `https://www.youtube.com/channel/${channelId}`, tags: [] });
    if (!payload) throw new Error('Invalid add-channel request');
    await ctx.assertOwnership();
    await ctx.db.execute("INSERT INTO ts_channel_admin_requests (request_id, kind, actor, payload, status, created_at) VALUES (?, ?, ?, ?, 'pending', UTC_TIMESTAMP())", [randomUUID(), payload.kind, LIVE_PLAYLIST_ACTOR, JSON.stringify(payload)]);
    requests.sources.add(channelId); requests.pending++;
    applied.push({ videoId, outcome: 'channel-requested', channelId });
  }
  return summary();
}
