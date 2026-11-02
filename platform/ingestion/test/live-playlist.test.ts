import { describe, expect, it } from 'vitest';
import { livePlaylistJob, LIVE_PLAYLIST_ACTOR } from '../src/live-playlist.js';
import { PlaylistFeedError } from '../src/playlist-feed.js';
import { YoutubeError } from '../src/quota.js';
import type { SourceJobContext } from '../src/video-statistics.js';
import type { PlaylistItem } from '../src/youtube.js';
import type { YoutubePlaylistOwner } from '../src/youtube-owner.js';

const PLAYLIST = 'PLWDKpvlDapjQ';
const UC_TRACKED = 'UCtrackedtrackedtracked1', UC_NEW = 'UCnewnewnewnewnewnewnew1', UC_RETIRED = 'UCretiredretiredretired1';
const now = new Date('2026-11-01T04:00:00Z'), at = '2026-11-01 12:00:00';
type Row = Record<string, unknown>;
interface Call { sql: string; params: unknown[] }

function item(videoId: string, channelId: string, live: PlaylistItem['liveBroadcastContent'] = 'live'): PlaylistItem {
  return { id: '', videoId, publishedAt: '2026-11-01T03:00:00Z', channelId, title: '直播 ' + videoId, description: 'd', thumbnails: 'https://i.ytimg.com/vi/' + videoId + '/default.jpg', channelTitle: '頻道', playlistId: 'UU' + channelId.slice(2), position: 0, liveBroadcastContent: live };
}

/** A small stateful fake of the tables the job reads and writes, answering only the statements it issues. */
function harness(state: { playlist: string[]; live?: Row[]; videos?: string[]; schedules?: string[]; channels?: Row[]; requests?: Row[]; found?: PlaylistItem[]; playlistError?: YoutubeError; lookupError?: YoutubeError; execute?: boolean; feed?: string[] | PlaylistFeedError; apiPage?: { videoIds: string[]; nextPageToken: string | null }; backoff?: Row[]; owner?: { items: { itemId: string; videoId: string }[]; complete?: boolean; listError?: YoutubeError; deleteError?: YoutubeError } }) {
  const calls: Call[] = [], live = (state.live ?? []).map(row => ({ ...row })), videos = new Set(state.videos ?? []), schedules = new Set(state.schedules ?? state.videos ?? []), requests = (state.requests ?? []).map(row => ({ ...row }));
  const api = { playlist: 0, feed: 0, lookups: [] as string[][], before: 0 };
  /** ts_youtube_item_backoff, keyed workflow|video_id; retry_after in Taipei time like taipeiSql. */
  const backoff = new Map<string, Row>((state.backoff ?? []).map(row => [row.workflow + '|' + row.video_id, { ...row }]));
  const answer = async (raw: string, params: unknown[] = []): Promise<unknown> => {
    const sql = raw.replace(/\s+/g, ' ').trim(); calls.push({ sql, params });
    const ids = (params[0] ?? []) as string[];
    if (sql.startsWith('SELECT pk, videoId, del_flag, mtime FROM urt_video_live')) return live.filter(row => ids.includes(String(row.videoId)));
    if (sql.startsWith('SELECT videoId FROM urt_video WHERE')) return [...videos].filter(id => ids.includes(id)).map(videoId => ({ videoId }));
    if (sql.startsWith('SELECT videoId FROM urt_video_schedule WHERE')) return [...schedules].filter(id => ids.includes(id)).map(videoId => ({ videoId }));
    if (sql.startsWith('UPDATE urt_video_live SET del_flag = NULL')) { const row = live.find(r => r.pk === params[1] && r.del_flag === 1 && r.mtime === null); if (row) { row.del_flag = null; row.ctime = params[0]; } return { affectedRows: row ? 1 : 0 }; }
    if (sql.startsWith('SELECT 1 FROM ts_youtube_item_backoff')) { const row = backoff.get(params[0] + '|' + params[1]); return row && String(row.retry_after) > String(params[2]) ? [{ 1: 1 }] : []; }
    if (sql.startsWith('SELECT video_id, failures, retry_after > ? AS held FROM ts_youtube_item_backoff')) return [...backoff.values()].filter(row => row.workflow === params[1] && (params[2] as string[]).includes(String(row.video_id))).map(row => ({ video_id: row.video_id, failures: row.failures, held: String(row.retry_after) > String(params[0]) ? 1 : 0 }));
    if (sql.startsWith('SELECT video_id FROM ts_youtube_item_backoff WHERE workflow = ? AND video_id IN (?) AND retry_after > ?')) return [...backoff.values()].filter(row => row.workflow === params[0] && (params[1] as string[]).includes(String(row.video_id)) && String(row.retry_after) > String(params[2])).map(row => ({ video_id: row.video_id }));
    if (sql.startsWith('SELECT failures FROM ts_youtube_item_backoff')) { const row = backoff.get(params[0] + '|' + params[1]); return row ? [{ failures: row.failures }] : []; }
    if (sql.startsWith('INSERT INTO ts_youtube_item_backoff')) { backoff.set(params[0] + '|' + params[1], { workflow: params[0], video_id: params[1], failures: params[2], retry_after: params[3], reason: params[4] }); return { affectedRows: 1 }; }
    if (sql.startsWith('DELETE FROM ts_youtube_item_backoff')) { backoff.delete(params[0] + '|' + params[1]); return { affectedRows: 1 }; }
    if (sql.startsWith('SELECT u_id, youtube_id, flag_del FROM urt_channel')) return (state.channels ?? []).filter(row => ids.includes(String(row.youtube_id)));
    if (sql.startsWith("SELECT payload, result FROM ts_channel_admin_requests WHERE kind = 'add-channel'")) return requests.filter(row => row.kind === 'add-channel' && (row.status === 'pending' || row.recent));
    if (sql.startsWith('SELECT COUNT(*) AS n FROM ts_channel_admin_requests')) return [{ n: requests.filter(row => row.status === 'pending').length }];
    if (sql.startsWith('INSERT INTO ts_channel_admin_requests')) { requests.push({ request_id: params[0], kind: params[1], actor: params[2], payload: params[3], status: 'pending', result: null }); return { affectedRows: 1, insertId: requests.length }; }
    // legacy-db upsert: SELECT * by key, then INSERT or UPDATE.
    const select = /^SELECT \* FROM `(\w+)` WHERE `videoId` = \?/.exec(sql);
    if (select) return select[1] === 'urt_video_live' ? live.filter(row => row.videoId === params[0]) : select[1] === 'urt_video' && videos.has(String(params[0])) ? [{ pk: 1, videoId: params[0] }] : [];
    const insert = /^INSERT INTO `(\w+)` \(([^)]*)\)/.exec(sql);
    if (insert) {
      const row = Object.fromEntries(insert[2]!.split(', ').map((column, index) => [column.replace(/`/g, ''), params[index]]));
      if (insert[1] === 'urt_video') videos.add(String(row.videoId));
      if (insert[1] === 'urt_video_schedule') schedules.add(String(row.videoId));
      if (insert[1] === 'urt_video_live') live.push({ pk: 100 + live.length, del_flag: null, mtime: null, ...row });
      return { affectedRows: 1, insertId: 1 };
    }
    if (/^UPDATE `urt_video(?:_live|_schedule)?` SET/.test(sql)) return { affectedRows: 1 };
    throw new Error('Unexpected SQL: ' + sql);
  };
  const db = { query: async (sql: string, params?: unknown[]) => [await answer(sql, params)], execute: async (sql: string, params?: unknown[]) => [await answer(sql, params)] };
  const youtube = {
    /** Per run, like the real client (one per job). */
    get attemptsMade() { return api.playlist + api.lookups.length - api.before; },
    playlistVideoIds: async (playlistId: string) => { expect(playlistId).toBe(PLAYLIST); api.playlist++; if (state.playlistError) throw state.playlistError; return { malformed: 0, ...(state.apiPage ?? { videoIds: state.playlist, nextPageToken: null }) }; },
    videoUploads: async (ids: string[]) => { api.lookups.push(ids); if (state.lookupError) throw state.lookupError; return (state.found ?? []).filter(found => ids.includes(found.videoId)); },
  };
  let owned = 0;
  const ctx = { db, youtube, now, clock: () => now, execute: state.execute ?? true, assertOwnership: async () => { owned++; } } as unknown as SourceJobContext;
  const feed = async (playlistId: string) => { expect(playlistId).toBe(PLAYLIST); api.feed++; const value = state.feed ?? state.playlist; if (value instanceof PlaylistFeedError) throw value; return { videoIds: [...new Set(value)], entries: value.length }; };
  const sqls = (prefix: string) => calls.filter(call => call.sql.startsWith(prefix));
  const ownerLog = { lists: 0, deleted: [] as string[] };
  const owner = state.owner ? {
    unitsCharged: 0,
    async playlistItems(playlistId: string) { expect(playlistId).toBe(PLAYLIST); ownerLog.lists++; this.unitsCharged += 1; if (state.owner!.listError) throw state.owner!.listError; return { items: state.owner!.items, complete: state.owner!.complete ?? true }; },
    async deleteItem(itemId: string) { if (state.owner!.deleteError) throw state.owner!.deleteError; this.unitsCharged += 50; ownerLog.deleted.push(itemId); state.owner!.items = state.owner!.items.filter(item => item.itemId !== itemId); return 'deleted' as const; },
  } : null;
  return { ctx, feed, owner, ownerLog, calls, sqls, live, videos, requests, api, backoff, owned: () => owned };
}
const run = (h: ReturnType<typeof harness>, limit = 50) => (h.api.before = h.api.playlist + h.api.lookups.length, livePlaylistJob(h.ctx, { playlistId: PLAYLIST, limit, feed: h.feed, owner: h.owner as unknown as YoutubePlaylistOwner }));

describe('youtube.live.playlist', () => {
  it('revives a row cleanup retired before its first poll, with a fresh ctime, and spends only the playlist read', async () => {
    const h = harness({ playlist: ['dKGM2rzKRjs'], videos: ['dKGM2rzKRjs'], live: [{ pk: 7, videoId: 'dKGM2rzKRjs', del_flag: 1, mtime: null, ctime: '2026-10-30 09:26:00' }] });
    const result = await run(h);
    expect(h.live[0]).toMatchObject({ del_flag: null, ctime: at });
    expect(result).toMatchObject({ mode: 'execute', listed: 1, applied: [{ videoId: 'dKGM2rzKRjs', outcome: 'restored' }], skipped: [], counts: { restored: 1 } });
    expect(h.api.lookups).toEqual([]); expect(result.apiAttempts).toBe(0); expect(result.source).toBe('feed');
    // A second run over the same list is a no-op.
    const again = await run(h);
    expect(again).toMatchObject({ applied: [], unchanged: ['dKGM2rzKRjs'], skipped: [] });
    expect(h.sqls('UPDATE')).toHaveLength(1);
  });
  it('leaves a row the poller retired (mtime set) and reports it', async () => {
    const h = harness({ playlist: ['Gone1234567'], videos: ['Gone1234567'], live: [{ pk: 3, videoId: 'Gone1234567', del_flag: 1, mtime: '2026-10-31 10:00:00' }] });
    const result = await run(h);
    expect(result).toMatchObject({ applied: [], skipped: [{ videoId: 'Gone1234567', reason: 'retired-by-poller' }] });
    expect(h.live[0]!.del_flag).toBe(1); expect(h.sqls('UPDATE')).toEqual([]); expect(h.api.lookups).toEqual([]);
  });
  it('does nothing for an alive row and never calls videos.list when nothing is missing', async () => {
    const h = harness({ playlist: ['Alive123456', 'Alive765432'], videos: ['Alive123456', 'Alive765432'], live: [{ pk: 1, videoId: 'Alive123456', del_flag: null, mtime: null }, { pk: 2, videoId: 'Alive765432', del_flag: 0, mtime: '2026-11-01 11:00:00' }] });
    const result = await run(h);
    expect(result).toMatchObject({ applied: [], skipped: [], unchanged: ['Alive123456', 'Alive765432'], apiAttempts: 0 });
    expect(h.api.playlist).toBe(0);
    expect(h.api.lookups).toEqual([]);
    expect(h.calls.filter(call => !call.sql.startsWith('SELECT'))).toEqual([]);
  });
  it('an empty playlist reads nothing else', async () => {
    const h = harness({ playlist: [] });
    expect(await run(h)).toMatchObject({ listed: 0, applied: [], skipped: [] });
    expect(h.calls).toEqual([]);
  });
  it('publishes a video of a tracked channel like an uploads sweep, and gives even a non-candidate a live row', async () => {
    const h = harness({ playlist: ['Live1234567', 'Plain123456'], channels: [{ u_id: 42, youtube_id: UC_TRACKED, flag_del: null }], found: [item('Live1234567', UC_TRACKED, 'live'), item('Plain123456', UC_TRACKED, 'none')] });
    const result = await run(h);
    expect(h.api.lookups).toEqual([['Live1234567', 'Plain123456']]);
    expect(result).toMatchObject({ applied: [{ videoId: 'Live1234567', outcome: 'published', uId: 42, live: 'live' }, { videoId: 'Plain123456', outcome: 'published', uId: 42, live: 'none' }], skipped: [], counts: { published: 2 } });
    expect([...h.videos].sort()).toEqual(['Live1234567', 'Plain123456']);
    expect(h.live.map(row => [row.videoId, row.u_id, row.del_flag, row.ctime])).toEqual([['Live1234567', 42, null, at], ['Plain123456', 42, null, at]]);
    expect(h.sqls('INSERT INTO `urt_video_schedule`')).toHaveLength(2);
    expect(h.sqls('INSERT INTO ts_channel_admin_requests')).toEqual([]);
    // The next run finds both rows alive and does not look them up again.
    const again = await run(h);
    expect(again).toMatchObject({ applied: [], unchanged: ['Live1234567', 'Plain123456'] }); expect(h.api.lookups).toHaveLength(1);
  });
  it('treats flag_del 0 as tracked and prefers a tracked row over a retired duplicate', async () => {
    const h = harness({ playlist: ['Live1234567'], channels: [{ u_id: 5, youtube_id: UC_TRACKED, flag_del: 1 }, { u_id: 9, youtube_id: UC_TRACKED, flag_del: 0 }], found: [item('Live1234567', UC_TRACKED)] });
    expect(await run(h)).toMatchObject({ applied: [{ videoId: 'Live1234567', outcome: 'published', uId: 9 }] });
  });
  it('queues one add-channel request per unknown channel, shaped like the web’s, then waits for youtube.channels.admin', async () => {
    const h = harness({ playlist: ['NewCh123456', 'NewCh765432'], found: [item('NewCh123456', UC_NEW), item('NewCh765432', UC_NEW)] });
    const result = await run(h);
    expect(result).toMatchObject({ applied: [{ videoId: 'NewCh123456', outcome: 'channel-requested', channelId: UC_NEW }], waiting: [{ videoId: 'NewCh765432', channelId: UC_NEW }], skipped: [] });
    const inserts = h.sqls('INSERT INTO ts_channel_admin_requests');
    expect(inserts).toHaveLength(1);
    expect(inserts[0]!.sql).toBe("INSERT INTO ts_channel_admin_requests (request_id, kind, actor, payload, status, created_at) VALUES (?, ?, ?, ?, 'pending', UTC_TIMESTAMP())");
    expect(inserts[0]!.params[0]).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(inserts[0]!.params.slice(1)).toEqual(['add-channel', LIVE_PLAYLIST_ACTOR, JSON.stringify({ kind: 'add-channel', source: UC_NEW, tags: [] })]);
    expect(h.live).toEqual([]); expect(h.videos.size).toBe(0);
    // Next run: the request is still pending, so nothing is queued again.
    const again = await run(h);
    expect(again).toMatchObject({ applied: [], waiting: [{ videoId: 'NewCh123456' }, { videoId: 'NewCh765432' }] });
    expect(h.sqls('INSERT INTO ts_channel_admin_requests')).toHaveLength(1);
  });
  it('does not re-request a channel requested by anyone and answered within the last day', async () => {
    const h = harness({ playlist: ['NewCh123456'], found: [item('NewCh123456', UC_NEW)], requests: [{ kind: 'add-channel', status: 'done', recent: true, payload: JSON.stringify({ kind: 'add-channel', source: UC_NEW, tags: [3] }) }] });
    expect(await run(h)).toMatchObject({ applied: [], waiting: [{ videoId: 'NewCh123456', channelId: UC_NEW }] });
    expect(h.sqls('INSERT INTO ts_channel_admin_requests')).toEqual([]);
    // A request made from a video link of that channel counts once its result names the channel.
    const viaVideo = harness({ playlist: ['NewCh123456'], found: [item('NewCh123456', UC_NEW)], requests: [{ kind: 'add-channel', status: 'failed', recent: true, payload: JSON.stringify({ kind: 'add-channel', source: 'https://youtu.be/Other123456', tags: [] }), result: JSON.stringify({ videoId: 'Other123456', youtubeId: UC_NEW }) }] });
    expect(await run(viaVideo)).toMatchObject({ applied: [], waiting: [{ videoId: 'NewCh123456', channelId: UC_NEW }] });
    // An older answered request does not hold it back.
    const old = harness({ playlist: ['NewCh123456'], found: [item('NewCh123456', UC_NEW)], requests: [{ kind: 'add-channel', status: 'done', recent: false, payload: JSON.stringify({ kind: 'add-channel', source: UC_NEW, tags: [] }) }] });
    expect(await run(old)).toMatchObject({ applied: [{ outcome: 'channel-requested' }] });
  });
  it('respects the web’s pending-queue cap', async () => {
    const pending = Array.from({ length: 100 }, (_, i) => ({ kind: 'create-tag', status: 'pending', payload: JSON.stringify({ kind: 'create-tag', name: 't' + i }) }));
    const h = harness({ playlist: ['NewCh123456'], found: [item('NewCh123456', UC_NEW)], requests: pending });
    expect(await run(h)).toMatchObject({ applied: [], skipped: [{ videoId: 'NewCh123456', reason: 'request-queue-full' }] });
    expect(h.sqls('INSERT INTO ts_channel_admin_requests')).toEqual([]);
  });
  it('never re-adds a retired channel, and backs off from looking it up again', async () => {
    const h = harness({ playlist: ['OldCh123456'], channels: [{ u_id: 8, youtube_id: UC_RETIRED, flag_del: 1 }], found: [item('OldCh123456', UC_RETIRED)] });
    expect(await run(h)).toMatchObject({ applied: [], skipped: [{ videoId: 'OldCh123456', reason: 'retired-channel', channelId: UC_RETIRED }] });
    expect(h.calls.filter(call => !call.sql.startsWith('SELECT')).map(call => call.sql.slice(0, 37))).toEqual(['INSERT INTO ts_youtube_item_backoff (']);
    expect(await run(h)).toMatchObject({ skipped: [{ videoId: 'OldCh123456', reason: 'backoff' }] }); expect(h.api.lookups).toHaveLength(1);
  });
  it('reports a video YouTube does not serve as unavailable and backs off 5 minutes, doubling', async () => {
    const h = harness({ playlist: ['Private1234'], found: [] });
    expect(await run(h)).toMatchObject({ applied: [], skipped: [{ videoId: 'Private1234', reason: 'unavailable' }], apiAttempts: 1 });
    expect(h.backoff.get('youtube.live.playlist|Private1234')).toMatchObject({ failures: 1, retry_after: '2026-11-01 12:05:00', reason: 'unavailable' });
    expect(h.sqls('INSERT INTO `')).toEqual([]);
    // Held: no lookup, nothing written.
    const held = await run(h);
    expect(held).toMatchObject({ skipped: [{ videoId: 'Private1234', reason: 'backoff' }], apiAttempts: 0 }); expect(h.api.lookups).toHaveLength(1);
    // Expired: looked up again, the hold doubles.
    h.backoff.get('youtube.live.playlist|Private1234')!.retry_after = '2026-11-01 11:59:00';
    await run(h);
    expect(h.api.lookups).toHaveLength(2);
    expect(h.backoff.get('youtube.live.playlist|Private1234')).toMatchObject({ failures: 2, retry_after: '2026-11-01 12:10:00' });
  });
  it('clears an expired backoff once the video is handled', async () => {
    const h = harness({ playlist: ['Live1234567'], channels: [{ u_id: 42, youtube_id: UC_TRACKED, flag_del: null }], found: [item('Live1234567', UC_TRACKED)], backoff: [{ workflow: 'youtube.live.playlist', video_id: 'Live1234567', failures: 3, retry_after: '2026-11-01 11:00:00' }] });
    expect(await run(h)).toMatchObject({ applied: [{ videoId: 'Live1234567', outcome: 'published' }] });
    expect(h.backoff.size).toBe(0);
  });
  it('reads the API instead of a failed feed, at most hourly', async () => {
    const h = harness({ playlist: ['Alive123456'], videos: ['Alive123456'], live: [{ pk: 1, videoId: 'Alive123456', del_flag: null, mtime: null }], feed: new PlaylistFeedError('status') });
    expect(await run(h)).toMatchObject({ source: 'api', feedError: 'status', listed: 1, unchanged: ['Alive123456'], apiAttempts: 1 });
    expect(h.backoff.get('youtube.live.playlist.api|' + PLAYLIST)).toMatchObject({ retry_after: '2026-11-01 13:00:00', reason: 'feed-failed' });
    expect(await run(h)).toMatchObject({ source: 'none', listed: 0, stoppedReason: 'feed-status', apiAttempts: 0 });
    expect(h.api.playlist).toBe(1);
    // The hold is also taken when the API read fails, so a broken API is not retried every run.
    const broken = harness({ playlist: [], feed: new PlaylistFeedError('request-failed'), playlistError: new YoutubeError('quota-exhausted') });
    expect(await run(broken)).toMatchObject({ stoppedReason: 'quota-exhausted' });
    expect(await run(broken)).toMatchObject({ stoppedReason: 'feed-request-failed' }); expect(broken.api.playlist).toBe(1);
  });
  it('adds the API page to a full feed, which may be cut off at 15, at most hourly', async () => {
    const feed = Array.from({ length: 15 }, (_, i) => `Feed${String(i).padStart(7, '0')}`), extra = 'Beyond15000';
    const all = [...feed, extra];
    const h = harness({ playlist: feed, videos: all, live: all.map((videoId, pk) => ({ pk, videoId, del_flag: null, mtime: null })), apiPage: { videoIds: all, nextPageToken: null } });
    expect(await run(h)).toMatchObject({ source: 'feed+api', listed: 16, truncated: false, apiAttempts: 1 });
    expect(h.backoff.get('youtube.live.playlist.api|' + PLAYLIST)).toMatchObject({ reason: 'feed-full' });
    // Within the hour: the feed alone, reported as possibly cut off.
    expect(await run(h)).toMatchObject({ source: 'feed', listed: 15, truncated: true, apiAttempts: 0 });
    // A failing API read does not stop the feed's list from being handled.
    const failing = harness({ playlist: feed, videos: feed, live: feed.map((videoId, pk) => ({ pk, videoId, del_flag: null, mtime: null })), playlistError: new YoutubeError('quota-daily') });
    expect(await run(failing)).toMatchObject({ source: 'feed', apiError: 'quota-daily', listed: 15 });
    expect((await run(failing)).unchanged).toHaveLength(15);
  });
  it('looks up an alive or revived row whose video metadata is missing', async () => {
    const h = harness({ playlist: ['Bare1234567', 'Revive12345'], channels: [{ u_id: 42, youtube_id: UC_TRACKED, flag_del: null }], live: [{ pk: 1, videoId: 'Bare1234567', del_flag: null, mtime: null }, { pk: 2, videoId: 'Revive12345', del_flag: 1, mtime: null }], found: [item('Bare1234567', UC_TRACKED), item('Revive12345', UC_TRACKED, 'upcoming')] });
    const result = await run(h);
    expect(h.api.lookups).toEqual([['Bare1234567', 'Revive12345']]);
    expect(result.applied.map(a => [a.videoId, a.outcome])).toEqual([['Revive12345', 'restored'], ['Bare1234567', 'published'], ['Revive12345', 'published']]);
    expect(h.sqls('INSERT INTO `urt_video_live`')).toEqual([]);
    expect(h.live.every(row => row.del_flag === null)).toBe(true);
  });
  it('completes a publish interrupted after urt_video but before urt_video_schedule', async () => {
    const h = harness({ playlist: ['HalfDone001'], videos: ['HalfDone001'], schedules: [], live: [{ pk: 3, videoId: 'HalfDone001', del_flag: null, mtime: null }], channels: [{ u_id: 5, youtube_id: UC_TRACKED, flag_del: null }], found: [item('HalfDone001', UC_TRACKED)] });
    const result = await run(h);
    expect(h.api.lookups).toEqual([['HalfDone001']]);
    expect(result.applied).toEqual([expect.objectContaining({ videoId: 'HalfDone001', outcome: 'published', uId: 5 })]);
    expect(h.sqls('INSERT INTO `urt_video_schedule`')).toHaveLength(1);
    const again = await run(h);
    expect(again.unchanged).toEqual(['HalfDone001']);
    expect(h.api.lookups).toHaveLength(1);
  });

  it('counts duplicate feed entries toward the cap and bounds the work by limit', async () => {
    const dup = Array.from({ length: 14 }, (_, i) => `Dupe${String(i).padStart(7, '0')}`);
    const h = harness({ playlist: [...dup, dup[0]!], videos: dup, live: dup.map((videoId, pk) => ({ pk, videoId, del_flag: null, mtime: null })), apiPage: { videoIds: dup, nextPageToken: null } });
    expect(await run(h)).toMatchObject({ source: 'feed+api', listed: 14 });
    const many = Array.from({ length: 50 }, (_, i) => `Api${String(i).padStart(8, '0')}`), feed = Array.from({ length: 15 }, (_, i) => `Feed${String(i).padStart(7, '0')}`);
    const big = harness({ playlist: feed, apiPage: { videoIds: many, nextPageToken: null }, found: [] });
    const result = await run(big);
    expect(result).toMatchObject({ listed: 50, truncated: true }); expect(big.api.lookups[0]).toHaveLength(50);
    const small = harness({ playlist: ['Private1234', 'Private5678'], found: [] });
    expect(await run(small, 1)).toMatchObject({ listed: 1, truncated: true }); expect(small.api.lookups).toEqual([['Private1234']]);
  });
  describe('removing handled items with the owner grant', () => {
    const ch = { u_id: 42, youtube_id: UC_TRACKED, flag_del: null };
    it('removes tracked, revived and published videos, keeps a channel that is still waiting', async () => {
      const h = harness({
        playlist: ['Alive123456', 'Revive12345', 'Live1234567', 'NewCh123456'], videos: ['Alive123456', 'Revive12345'], channels: [ch],
        live: [{ pk: 1, videoId: 'Alive123456', del_flag: null, mtime: null }, { pk: 2, videoId: 'Revive12345', del_flag: 1, mtime: null }],
        found: [item('Live1234567', UC_TRACKED), item('NewCh123456', UC_NEW)],
        owner: { items: [{ itemId: 'i1', videoId: 'Alive123456' }, { itemId: 'i2', videoId: 'Revive12345' }, { itemId: 'i3', videoId: 'Live1234567' }, { itemId: 'i3b', videoId: 'Live1234567' }, { itemId: 'i4', videoId: 'NewCh123456' }] },
      });
      const result = await run(h);
      expect(h.ownerLog.deleted).toEqual(['i1', 'i2', 'i3', 'i3b']);
      expect(result).toMatchObject({ removed: ['Alive123456', 'Revive12345', 'Live1234567'], counts: { removed: 3 }, ownerUnits: 201 });
      expect(h.backoff.get('youtube.live.playlist.removed|Alive123456')).toMatchObject({ retry_after: '2026-11-01 18:00:00', reason: 'removed' });
      // The cached feed still lists them: no listing again, only the waiting video is left.
      const again = await run(h);
      expect(again.removed).toEqual([]); expect(h.ownerLog.lists).toBe(1);
    });
    it('removes final skips, and an unavailable video only at its third failed lookup', async () => {
      const h = harness({ playlist: ['Gone1234567', 'OldCh123456', 'Private1234'], live: [{ pk: 3, videoId: 'Gone1234567', del_flag: 1, mtime: '2026-10-31 10:00:00' }], channels: [{ u_id: 8, youtube_id: UC_RETIRED, flag_del: 1 }], found: [item('OldCh123456', UC_RETIRED)],
        owner: { items: [{ itemId: 'g', videoId: 'Gone1234567' }, { itemId: 'o', videoId: 'OldCh123456' }, { itemId: 'p', videoId: 'Private1234' }] } });
      expect((await run(h)).removed).toEqual(['Gone1234567', 'OldCh123456']);
      const expire = () => { h.backoff.get('youtube.live.playlist|Private1234')!.retry_after = '2026-11-01 11:00:00'; };
      expire(); expect((await run(h)).removed).toEqual([]);
      expire(); expect((await run(h)).removed).toEqual(['Private1234']);
      expect(h.ownerLog.deleted).toEqual(['g', 'o', 'p']);
    });
    it('counts only unavailable lookups as strikes, and resets them once the video is found', async () => {
      const h = harness({ playlist: ['Private1234'], found: [], channels: [ch], owner: { items: [{ itemId: 'p', videoId: 'Private1234' }] },
        backoff: [{ workflow: 'youtube.live.playlist', video_id: 'Private1234', failures: 2, retry_after: '2026-11-01 11:00:00', reason: 'request-queue-full' }] });
      expect((await run(h)).removed).toEqual([]);
      expect(h.backoff.get('youtube.live.playlist.unavailable|Private1234')).toMatchObject({ failures: 1 });
      const found = harness({ playlist: ['Live1234567'], channels: [ch], found: [item('Live1234567', UC_TRACKED)], backoff: [{ workflow: 'youtube.live.playlist.unavailable', video_id: 'Live1234567', failures: 2, retry_after: '2026-11-01 11:00:00', reason: 'unavailable' }] });
      await run(found);
      expect(found.backoff.has('youtube.live.playlist.unavailable|Live1234567')).toBe(false);
    });
    it('deletes many copies of one video across runs, marking it only once every copy is gone', async () => {
      const copies = Array.from({ length: 12 }, (_, i) => ({ itemId: 'c' + i, videoId: 'Alive123456' }));
      const h = harness({ playlist: ['Alive123456'], videos: ['Alive123456'], live: [{ pk: 1, videoId: 'Alive123456', del_flag: null, mtime: null }], owner: { items: copies } });
      expect((await run(h)).removed).toEqual(['Alive123456']); expect(h.ownerLog.deleted).toHaveLength(10);
      expect(h.backoff.has('youtube.live.playlist.removed|Alive123456')).toBe(false);
      await run(h); expect(h.ownerLog.deleted).toHaveLength(12);
      expect(h.backoff.get('youtube.live.playlist.removed|Alive123456')).toMatchObject({ reason: 'removed' });
      const partial = harness({ playlist: ['Alive123456'], videos: ['Alive123456'], live: [{ pk: 1, videoId: 'Alive123456', del_flag: null, mtime: null }], owner: { items: [{ itemId: 'a', videoId: 'Alive123456' }], complete: false } });
      expect((await run(partial)).removed).toEqual(['Alive123456']);
      expect(partial.backoff.has('youtube.live.playlist.removed|Alive123456')).toBe(false);
    });
    it('keeps a held or queue-full video and lists nothing when nothing is handled', async () => {
      const pending = Array.from({ length: 100 }, (_, i) => ({ kind: 'create-tag', status: 'pending', payload: JSON.stringify({ kind: 'create-tag', name: 't' + i }) }));
      const h = harness({ playlist: ['NewCh123456'], found: [item('NewCh123456', UC_NEW)], requests: pending, owner: { items: [{ itemId: 'n', videoId: 'NewCh123456' }] } });
      expect(await run(h)).toMatchObject({ removed: [], skipped: [{ reason: 'request-queue-full' }] });
      expect(await run(h)).toMatchObject({ removed: [], skipped: [{ reason: 'backoff' }] });
      expect(h.ownerLog.lists).toBe(0);
    });
    it('marks an item already gone from the list without deleting, caps deletes, and holds off an hour after an owner failure', async () => {
      const gone = harness({ playlist: ['Alive123456'], videos: ['Alive123456'], live: [{ pk: 1, videoId: 'Alive123456', del_flag: null, mtime: null }], owner: { items: [] } });
      expect((await run(gone)).removed).toEqual([]);
      expect(gone.backoff.get('youtube.live.playlist.removed|Alive123456')).toMatchObject({ reason: 'absent' });
      const ids = Array.from({ length: 12 }, (_, i) => `Many${String(i).padStart(7, '0')}`);
      const many = harness({ playlist: ids, videos: ids, live: ids.map((videoId, pk) => ({ pk, videoId, del_flag: null, mtime: null })), owner: { items: ids.map(videoId => ({ itemId: 'x' + videoId, videoId })) } });
      expect((await run(many)).removed).toHaveLength(10);
      expect((await run(many)).removed).toHaveLength(2);
      const revoked = harness({ playlist: ['Alive123456'], videos: ['Alive123456'], live: [{ pk: 1, videoId: 'Alive123456', del_flag: null, mtime: null }], owner: { items: [{ itemId: 'a', videoId: 'Alive123456' }], listError: new YoutubeError('authentication', 400, 'invalid_grant') } });
      expect(await run(revoked)).toMatchObject({ removeError: 'authentication', removed: [], unchanged: ['Alive123456'] });
      expect(revoked.backoff.get('youtube.live.playlist.owner|' + PLAYLIST)).toMatchObject({ retry_after: '2026-11-01 13:00:00' });
      expect(await run(revoked)).toMatchObject({ removeError: 'held' }); expect(revoked.ownerLog.lists).toBe(1);
      const failing = harness({ playlist: ['Alive123456'], videos: ['Alive123456'], live: [{ pk: 1, videoId: 'Alive123456', del_flag: null, mtime: null }], owner: { items: [{ itemId: 'a', videoId: 'Alive123456' }], deleteError: new YoutubeError('quota-daily', 403, 'quotaExceeded') } });
      expect(await run(failing)).toMatchObject({ removeError: 'quota-daily', removed: [] });
    });
    it('never removes without the grant', async () => {
      const h = harness({ playlist: ['Alive123456'], videos: ['Alive123456'], live: [{ pk: 1, videoId: 'Alive123456', del_flag: null, mtime: null }] });
      const result = await run(h);
      expect(result).toMatchObject({ removed: [], unchanged: ['Alive123456'] }); expect(result).not.toHaveProperty('ownerUnits');
      expect(h.calls.filter(call => call.sql.includes('ts_youtube_item_backoff'))).toEqual([]);
    });
  });
  it('surfaces YouTube failures as a stopped run instead of swallowing them', async () => {
    const quota = harness({ playlist: ['x'], feed: new PlaylistFeedError('invalid-feed'), playlistError: new YoutubeError('quota-exhausted') });
    expect(await run(quota)).toMatchObject({ stoppedReason: 'quota-exhausted', applied: [], listed: 0 });
    expect(quota.calls.map(call => call.sql.slice(0, 40))).toEqual(['SELECT 1 FROM ts_youtube_item_backoff WH', 'INSERT INTO ts_youtube_item_backoff (wor']);
    const missing = harness({ playlist: [], feed: new PlaylistFeedError('status'), playlistError: new YoutubeError('request-failed', 404, 'playlistNotFound') });
    expect(await run(missing)).toMatchObject({ stoppedReason: 'request-failed' });
    const lookup = harness({ playlist: ['dKGM2rzKRjs', 'NewCh123456'], live: [{ pk: 7, videoId: 'dKGM2rzKRjs', del_flag: 1, mtime: null }], lookupError: new YoutubeError('quota-daily') });
    expect(await run(lookup)).toMatchObject({ stoppedReason: 'quota-daily', applied: [{ videoId: 'dKGM2rzKRjs', outcome: 'restored' }] });
    await expect(run(harness({ playlist: ['x'], feed: new PlaylistFeedError('status'), playlistError: new Error('db down') as YoutubeError }))).rejects.toThrow('db down');
    // Only a feed failure falls back; anything else (a shutdown, a bug) propagates.
    await expect(livePlaylistJob(harness({ playlist: [] }).ctx, { playlistId: PLAYLIST, limit: 50, feed: async () => { throw new Error('aborted'); } })).rejects.toThrow('aborted');
  });
  it('checks ownership before every write, spends nothing in a dry run, and validates its input', async () => {
    const h = harness({ playlist: ['dKGM2rzKRjs', 'NewCh123456'], live: [{ pk: 7, videoId: 'dKGM2rzKRjs', del_flag: 1, mtime: null }], found: [item('NewCh123456', UC_NEW)] });
    await run(h);
    expect(h.owned()).toBeGreaterThanOrEqual(2);
    const dry = harness({ playlist: ['dKGM2rzKRjs'], execute: false });
    expect(await run(dry)).toMatchObject({ mode: 'dry-run', apiAttempts: 0 }); expect(dry.api.playlist + dry.api.feed).toBe(0); expect(dry.calls).toEqual([]);
    await expect(livePlaylistJob(h.ctx, { playlistId: 'UUabcdefghijkl', limit: 50 })).rejects.toThrow('Invalid live playlist');
    await expect(livePlaylistJob(h.ctx, { playlistId: PLAYLIST, limit: 51 })).rejects.toThrow();
  });
});
