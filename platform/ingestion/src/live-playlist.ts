import { createHash, randomUUID } from 'node:crypto';
import type { RowDataPacket } from 'mysql2/promise';
import { parsePayload } from '../../shared/channel-admin.js';
import { clearItemBackoff, recordItemBackoff } from './backoff.js';
import { cap, isLiveCandidate, publishUploads } from './channel-jobs.js';
import { taipeiSql, upsert } from './legacy-db.js';
import { fetchPlaylistFeed, PLAYLIST_FEED_CAP, PlaylistFeedError, type PlaylistFeed } from './playlist-feed.js';
import { YoutubeError } from './quota.js';
import type { SourceJobContext } from './video-statistics.js';
import type { PlaylistItem } from './youtube.js';
import type { YoutubePlaylistOwner } from './youtube-owner.js';

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
/** The quota-free feed is read every run; the one-unit API read only when the feed failed or may be cut off, at most hourly. */
const API_HOLD_MS = 3600000;
const API_HOLD_WORKFLOW = 'youtube.live.playlist.api';
/** ts_youtube_item_backoff.video_id is VARCHAR(32). */
/** Owner calls (removal) failed: not again for an hour, so a revoked grant or a 50-unit failing delete is not retried every run. */
const OWNER_HOLD_WORKFLOW = 'youtube.live.playlist.owner';
/** A removed video may linger in the cached feed: it is not removed (listed) again for six hours. */
const REMOVED_WORKFLOW = 'youtube.live.playlist.removed';
const REMOVED_HOLD_MS = 6 * 3600000;
/** At most this many deletes (50 units each) per run. */
const REMOVE_LIMIT = 10;
/** An unavailable video is removed at its third failed lookup (about 15 minutes after the first), not at a passing glitch. */
const UNAVAILABLE_STRIKES = 3;
/** Consecutive unavailable lookups per video, counted apart from the lookup backoff (whose count mixes reasons). */
const STRIKES_WORKFLOW = 'youtube.live.playlist.unavailable';
/** Final skips: the video can never be handled from the list, so it is removed. */
const FINAL_SKIPS: ReadonlySet<Skipped['reason']> = new Set(['retired-by-poller', 'retired', 'retired-channel']);
const holdKey = (playlistId: string) => playlistId.length <= 32 ? playlistId : createHash('sha256').update(playlistId).digest('base64url').slice(0, 32);

type Applied = { videoId: string; outcome: 'restored' } | { videoId: string; outcome: 'published'; uId: number; live: PlaylistItem['liveBroadcastContent'] } | { videoId: string; outcome: 'channel-requested'; channelId: string };
type Skipped = { videoId: string; reason: 'retired-by-poller' | 'retired' | 'unavailable' | 'retired-channel' | 'request-queue-full' | 'backoff'; channelId?: string };
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
 * removes them, so a run over an already-handled list reads only the feed and the database.
 *
 * - Live row alive: nothing to do (unless urt_video lacks the video, then it is looked up so the display cache has metadata).
 * - Live row retired before live.poll ever read it (del_flag=1, no mtime, the old cleanup race): revived with a fresh ctime,
 *   so live.poll reads it before cleanup's two-hour grace runs out. A row the poller retired (mtime set) stays retired.
 * - No live row: one videos.list call (one unit for up to 50 videos). A video of a tracked channel is written exactly like an
 *   uploads sweep writes it, and always gets a live row: the administrator says it is a live, and live.poll fills the details
 *   or retires it if YouTube has none. A video of an unknown channel queues an add-channel request for youtube.channels.admin
 *   (actor `live-playlist`), and a later run publishes the video once the channel is tracked. A retired channel is not re-added.
 *
 * The list comes from the playlist's public feed (no quota, newest 15 entries at most). The API's first page (one unit, up to
 * `limit` entries) is read instead or as well only when the feed failed or came back full, and then at most once an hour, so a
 * playlist of more than 15 is still seen whole, an hour late at worst. Lookups that found nothing to do (private or deleted
 * video, retired channel, full request queue) back off per video (5 minutes doubling to 6 hours), so an item the administrator
 * has not removed yet costs almost nothing. `truncated` reports a list that may continue beyond what was read.
 */
export async function livePlaylistJob(ctx: SourceJobContext, input: { playlistId: string; limit: number; feed?: (playlistId: string) => Promise<PlaylistFeed>; owner?: YoutubePlaylistOwner | null }) {
  if (!LIVE_PLAYLIST_ID.test(input.playlistId)) throw new Error('Invalid live playlist');
  cap(input.limit, 50);
  const applied: Applied[] = [], skipped: Skipped[] = [], unchanged: string[] = [], waiting: { videoId: string; channelId: string }[] = [];
  const removed: string[] = [], strikes = new Map<string, number>();
  let removeError: string | undefined;
  let listed = 0, malformed = 0, truncated = false, source: 'feed' | 'api' | 'feed+api' | 'none' = 'none', feedError: string | undefined, apiError: string | undefined;
  const summary = (stoppedReason?: string) => ({
    mode: 'execute' as const, playlistId: input.playlistId, source, listed, malformed, truncated, apiAttempts: ctx.youtube.attemptsMade, ...(input.owner ? { ownerUnits: input.owner.unitsCharged } : {}), ...(feedError ? { feedError } : {}), ...(apiError ? { apiError } : {}), ...(removeError ? { removeError } : {}),
    counts: { unchanged: unchanged.length, restored: applied.filter(a => a.outcome === 'restored').length, published: applied.filter(a => a.outcome === 'published').length, requested: applied.filter(a => a.outcome === 'channel-requested').length, waiting: waiting.length, skipped: skipped.length, removed: removed.length },
    applied, skipped, unchanged, waiting, removed, ...(stoppedReason ? { stoppedReason } : {}),
  });
  if (!ctx.execute) return { mode: 'dry-run' as const, playlistId: input.playlistId, source, listed, malformed, truncated, apiAttempts: 0, applied, skipped, unchanged, waiting, removed };

  /**
   * With the owner's grant, a handled video leaves the list, so what stays is what needs a person: a channel still waiting for
   * youtube.channels.admin, a full request queue, or a video in backoff. Handled means tracked (unchanged, revived or published)
   * or final (retired, retired channel, unavailable at its third lookup).
   */
  const removeHandled = async () => {
    if (!input.owner) return;
    const keep = new Set([...waiting.map(w => w.videoId), ...skipped.filter(s => !FINAL_SKIPS.has(s.reason) && !(s.reason === 'unavailable' && (strikes.get(s.videoId) ?? 0) >= UNAVAILABLE_STRIKES)).map(s => s.videoId), ...applied.filter(a => a.outcome === 'channel-requested').map(a => a.videoId)]);
    let handled = [...new Set([...unchanged, ...applied.map(a => a.videoId), ...skipped.map(s => s.videoId)])].filter(videoId => !keep.has(videoId));
    if (!handled.length) return;
    const at = taipeiSql(ctx.now);
    const [recent] = await ctx.db.query<RowDataPacket[]>('SELECT video_id FROM ts_youtube_item_backoff WHERE workflow = ? AND video_id IN (?) AND retry_after > ?', [REMOVED_WORKFLOW, handled, at]);
    const recentlyRemoved = new Set(recent.map(row => String(row.video_id)));
    handled = handled.filter(videoId => !recentlyRemoved.has(videoId));
    if (!handled.length) return;
    const [ownerHeld] = await ctx.db.query<RowDataPacket[]>('SELECT 1 FROM ts_youtube_item_backoff WHERE workflow = ? AND video_id = ? AND retry_after > ?', [OWNER_HOLD_WORKFLOW, holdKey(input.playlistId), at]);
    if (ownerHeld.length) { removeError = 'held'; return; }
    const hold = async (workflow: string, key: string, ms: number, reason: string) => { await ctx.assertOwnership(); await ctx.db.execute('INSERT INTO ts_youtube_item_backoff (workflow, video_id, failures, retry_after, reason, updated_at) VALUES (?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE failures = VALUES(failures), retry_after = VALUES(retry_after), reason = VALUES(reason), updated_at = VALUES(updated_at)', [workflow, key, 1, taipeiSql(new Date(ctx.now.getTime() + ms)), reason, at]); };
    try {
      const listing = await input.owner.playlistItems(input.playlistId);
      let deletes = 0;
      for (const videoId of handled) {
        if (deletes >= REMOVE_LIMIT) break;
        const items = listing.items.filter(item => item.videoId === videoId), now = items.slice(0, REMOVE_LIMIT - deletes);
        for (const item of now) { await ctx.assertOwnership(); await input.owner.deleteItem(item.itemId); deletes++; }
        if (now.length) removed.push(videoId);
        // Marked (no listing again for six hours) only when every copy is known gone: all listed copies deleted and the listing
        // complete. Otherwise the next run lists again and deletes the rest.
        if (now.length === items.length && listing.complete) await hold(REMOVED_WORKFLOW, videoId, REMOVED_HOLD_MS, items.length ? 'removed' : 'absent');
      }
    } catch (error) {
      if (!(error instanceof YoutubeError)) throw error;
      removeError = error.code;
      await hold(OWNER_HOLD_WORKFLOW, holdKey(input.playlistId), API_HOLD_MS, error.code);
    }
  };
  const finish = async () => { await removeHandled(); return summary(); };

  let feedIds: string[] | null = null;
  try { const feed = await (input.feed ?? fetchPlaylistFeed)(input.playlistId); feedIds = feed.videoIds; truncated = feed.entries >= PLAYLIST_FEED_CAP; source = 'feed'; }
  catch (error) { if (!(error instanceof PlaylistFeedError)) throw error; feedError = error.reason; }
  let ids = feedIds ?? [];
  if (feedIds === null || truncated) {
    const [held] = await ctx.db.query<RowDataPacket[]>('SELECT 1 FROM ts_youtube_item_backoff WHERE workflow = ? AND video_id = ? AND retry_after > ?', [API_HOLD_WORKFLOW, holdKey(input.playlistId), taipeiSql(ctx.now)]);
    if (held.length) { if (feedIds === null) return summary('feed-' + feedError); }
    else {
      // Held before the call, so a failing API is not retried every five minutes either.
      await ctx.assertOwnership();
      await ctx.db.execute('INSERT INTO ts_youtube_item_backoff (workflow, video_id, failures, retry_after, reason, updated_at) VALUES (?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE failures = VALUES(failures), retry_after = VALUES(retry_after), reason = VALUES(reason), updated_at = VALUES(updated_at)', [API_HOLD_WORKFLOW, holdKey(input.playlistId), 1, taipeiSql(new Date(ctx.now.getTime() + API_HOLD_MS)), feedIds === null ? 'feed-failed' : 'feed-full', taipeiSql(ctx.now)]);
      try {
        const page = await ctx.youtube.playlistVideoIds(input.playlistId, input.limit);
        ids = [...page.videoIds, ...ids.filter(videoId => !page.videoIds.includes(videoId))];
        malformed = page.malformed; truncated = page.nextPageToken !== null; source = feedIds === null ? 'api' : 'feed+api';
      } catch (error) {
        if (!(error instanceof YoutubeError)) throw error;
        if (feedIds === null) return summary(error.code);
        apiError = error.code;
      }
    }
  }
  // `limit` bounds the work of a run (and keeps one videos.list batch within 50), whichever source the list came from.
  if (ids.length > input.limit) { ids = ids.slice(0, input.limit); truncated = true; }
  listed = ids.length;
  if (!ids.length) return finish();

  const [liveRows] = await ctx.db.query<RowDataPacket[]>('SELECT pk, videoId, del_flag, mtime FROM urt_video_live WHERE videoId IN (?)', [ids]);
  const [videoRows] = await ctx.db.query<RowDataPacket[]>('SELECT videoId FROM urt_video WHERE videoId IN (?)', [ids]);
  const [scheduleRows] = await ctx.db.query<RowDataPacket[]>('SELECT videoId FROM urt_video_schedule WHERE videoId IN (?)', [ids]);
  // The columns may compare case-insensitively; video ids are case-sensitive. A video counts as stored only when both rows an
  // uploads sweep writes exist, so a publish interrupted between them is completed by the next run.
  const scheduled = new Set(scheduleRows.map(row => String(row.videoId)));
  const stored = new Set(videoRows.map(row => String(row.videoId)).filter(videoId => scheduled.has(videoId)));
  let lookup: string[] = [];
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
  if (!lookup.length) return finish();

  /** Videos with a backoff row: held ones are not looked up again yet; the others are cleared once handled. */
  const [backoffRows] = await ctx.db.query<RowDataPacket[]>('SELECT video_id, failures, retry_after > ? AS held FROM ts_youtube_item_backoff WHERE workflow = ? AND video_id IN (?)', [taipeiSql(ctx.now), LIVE_PLAYLIST_JOB, lookup]);
  const backedOff = new Set(backoffRows.map(row => String(row.video_id))), held = new Set(backoffRows.filter(row => Number(row.held) === 1).map(row => String(row.video_id)));
  for (const videoId of lookup.filter(id => held.has(id))) skipped.push({ videoId, reason: 'backoff' });
  lookup = lookup.filter(id => !held.has(id));
  if (!lookup.length) return finish();
  const backoff = async (entry: Skipped) => { skipped.push(entry); await ctx.assertOwnership(); await recordItemBackoff(ctx.db, LIVE_PLAYLIST_JOB, entry.videoId, entry.reason, ctx.now); };
  const done = async (entry: Applied) => { applied.push(entry); if (backedOff.has(entry.videoId)) { await ctx.assertOwnership(); await clearItemBackoff(ctx.db, LIVE_PLAYLIST_JOB, entry.videoId); } };

  const [strikeList] = await ctx.db.query<RowDataPacket[]>('SELECT video_id, failures, retry_after > ? AS held FROM ts_youtube_item_backoff WHERE workflow = ? AND video_id IN (?)', [taipeiSql(ctx.now), STRIKES_WORKFLOW, lookup]);
  const strikeRows = new Map(strikeList.map(row => [String(row.video_id), Number(row.failures ?? 0)]));
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
    if (!item) {
      const count = (strikeRows.get(videoId) ?? 0) + 1; strikes.set(videoId, count);
      await ctx.assertOwnership();
      await ctx.db.execute('INSERT INTO ts_youtube_item_backoff (workflow, video_id, failures, retry_after, reason, updated_at) VALUES (?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE failures = VALUES(failures), retry_after = VALUES(retry_after), reason = VALUES(reason), updated_at = VALUES(updated_at)', [STRIKES_WORKFLOW, videoId, count, taipeiSql(ctx.now), 'unavailable', taipeiSql(ctx.now)]);
      await backoff({ videoId, reason: 'unavailable' }); continue;
    }
    if (strikeRows.has(videoId)) { await ctx.assertOwnership(); await clearItemBackoff(ctx.db, STRIKES_WORKFLOW, videoId); }
    const channelId = item.channelId, uId = channels.get(channelId);
    if (typeof uId === 'number') {
      await publishUploads(ctx, uId, [item]);
      if (!isLiveCandidate(item)) {
        await ctx.assertOwnership();
        await upsert(ctx.db, 'urt_video_live', { videoId }, { ctime: taipeiSql(ctx.now), publishedAt: taipeiSql(new Date(item.publishedAt)), u_id: uId });
      }
      await done({ videoId, outcome: 'published', uId, live: item.liveBroadcastContent });
      continue;
    }
    // Same refusal youtube.channels.admin gives (CHANNEL_RETIRED): a retired channel is not brought back from here.
    if (uId === null) { await backoff({ videoId, reason: 'retired-channel', channelId }); continue; }
    requests ??= await recentChannelRequests(ctx.db);
    if (requests.sources.has(channelId)) { waiting.push({ videoId, channelId }); continue; }
    if (requests.pending >= REQUEST_PENDING_LIMIT) { await backoff({ videoId, reason: 'request-queue-full', channelId }); continue; }
    // Stored exactly as the web stores a request: the parsed payload, whose source is the bare channel id.
    const payload = parsePayload('add-channel', { source: `https://www.youtube.com/channel/${channelId}`, tags: [] });
    if (!payload) throw new Error('Invalid add-channel request');
    await ctx.assertOwnership();
    await ctx.db.execute("INSERT INTO ts_channel_admin_requests (request_id, kind, actor, payload, status, created_at) VALUES (?, ?, ?, ?, 'pending', UTC_TIMESTAMP())", [randomUUID(), payload.kind, LIVE_PLAYLIST_ACTOR, JSON.stringify(payload)]);
    requests.sources.add(channelId); requests.pending++;
    await done({ videoId, outcome: 'channel-requested', channelId });
  }
  return finish();
}
