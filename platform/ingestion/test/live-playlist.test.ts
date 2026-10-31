import { describe, expect, it } from 'vitest';
import { livePlaylistJob, LIVE_PLAYLIST_ACTOR } from '../src/live-playlist.js';
import { YoutubeError } from '../src/quota.js';
import type { SourceJobContext } from '../src/video-statistics.js';
import type { PlaylistItem } from '../src/youtube.js';

const PLAYLIST = 'PLWDKpvlDapjQ';
const UC_TRACKED = 'UCtrackedtrackedtracked1', UC_NEW = 'UCnewnewnewnewnewnewnew1', UC_RETIRED = 'UCretiredretiredretired1';
const now = new Date('2026-11-01T04:00:00Z'), at = '2026-11-01 12:00:00';
type Row = Record<string, unknown>;
interface Call { sql: string; params: unknown[] }

function item(videoId: string, channelId: string, live: PlaylistItem['liveBroadcastContent'] = 'live'): PlaylistItem {
  return { id: '', videoId, publishedAt: '2026-11-01T03:00:00Z', channelId, title: '直播 ' + videoId, description: 'd', thumbnails: 'https://i.ytimg.com/vi/' + videoId + '/default.jpg', channelTitle: '頻道', playlistId: 'UU' + channelId.slice(2), position: 0, liveBroadcastContent: live };
}

/** A small stateful fake of the tables the job reads and writes, answering only the statements it issues. */
function harness(state: { playlist: string[]; live?: Row[]; videos?: string[]; schedules?: string[]; channels?: Row[]; requests?: Row[]; found?: PlaylistItem[]; playlistError?: YoutubeError; lookupError?: YoutubeError; execute?: boolean }) {
  const calls: Call[] = [], live = (state.live ?? []).map(row => ({ ...row })), videos = new Set(state.videos ?? []), schedules = new Set(state.schedules ?? state.videos ?? []), requests = (state.requests ?? []).map(row => ({ ...row }));
  const api = { playlist: 0, lookups: [] as string[][] };
  const answer = async (raw: string, params: unknown[] = []): Promise<unknown> => {
    const sql = raw.replace(/\s+/g, ' ').trim(); calls.push({ sql, params });
    const ids = (params[0] ?? []) as string[];
    if (sql.startsWith('SELECT pk, videoId, del_flag, mtime FROM urt_video_live')) return live.filter(row => ids.includes(String(row.videoId)));
    if (sql.startsWith('SELECT videoId FROM urt_video WHERE')) return [...videos].filter(id => ids.includes(id)).map(videoId => ({ videoId }));
    if (sql.startsWith('SELECT videoId FROM urt_video_schedule WHERE')) return [...schedules].filter(id => ids.includes(id)).map(videoId => ({ videoId }));
    if (sql.startsWith('UPDATE urt_video_live SET del_flag = NULL')) { const row = live.find(r => r.pk === params[1] && r.del_flag === 1 && r.mtime === null); if (row) { row.del_flag = null; row.ctime = params[0]; } return { affectedRows: row ? 1 : 0 }; }
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
    get attemptsMade() { return api.playlist + api.lookups.length; },
    playlistVideoIds: async (playlistId: string) => { expect(playlistId).toBe(PLAYLIST); api.playlist++; if (state.playlistError) throw state.playlistError; return { videoIds: state.playlist, malformed: 0, nextPageToken: null }; },
    videoUploads: async (ids: string[]) => { api.lookups.push(ids); if (state.lookupError) throw state.lookupError; return (state.found ?? []).filter(found => ids.includes(found.videoId)); },
  };
  let owned = 0;
  const ctx = { db, youtube, now, clock: () => now, execute: state.execute ?? true, assertOwnership: async () => { owned++; } } as unknown as SourceJobContext;
  const sqls = (prefix: string) => calls.filter(call => call.sql.startsWith(prefix));
  return { ctx, calls, sqls, live, videos, requests, api, owned: () => owned };
}
const run = (h: ReturnType<typeof harness>, limit = 50) => livePlaylistJob(h.ctx, { playlistId: PLAYLIST, limit });

describe('youtube.live.playlist', () => {
  it('revives a row cleanup retired before its first poll, with a fresh ctime, and spends only the playlist read', async () => {
    const h = harness({ playlist: ['dKGM2rzKRjs'], videos: ['dKGM2rzKRjs'], live: [{ pk: 7, videoId: 'dKGM2rzKRjs', del_flag: 1, mtime: null, ctime: '2026-10-30 09:26:00' }] });
    const result = await run(h);
    expect(h.live[0]).toMatchObject({ del_flag: null, ctime: at });
    expect(result).toMatchObject({ mode: 'execute', listed: 1, applied: [{ videoId: 'dKGM2rzKRjs', outcome: 'restored' }], skipped: [], counts: { restored: 1 } });
    expect(h.api.lookups).toEqual([]); expect(result.apiAttempts).toBe(1);
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
    expect(result).toMatchObject({ applied: [], skipped: [], unchanged: ['Alive123456', 'Alive765432'], apiAttempts: 1 });
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
  it('never re-adds a retired channel', async () => {
    const h = harness({ playlist: ['OldCh123456'], channels: [{ u_id: 8, youtube_id: UC_RETIRED, flag_del: 1 }], found: [item('OldCh123456', UC_RETIRED)] });
    expect(await run(h)).toMatchObject({ applied: [], skipped: [{ videoId: 'OldCh123456', reason: 'retired-channel', channelId: UC_RETIRED }] });
    expect(h.calls.filter(call => !call.sql.startsWith('SELECT'))).toEqual([]);
  });
  it('reports a video YouTube does not serve as unavailable', async () => {
    const h = harness({ playlist: ['Private1234'], found: [] });
    expect(await run(h)).toMatchObject({ applied: [], skipped: [{ videoId: 'Private1234', reason: 'unavailable' }] });
    expect(h.calls.filter(call => !call.sql.startsWith('SELECT'))).toEqual([]);
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

  it('surfaces YouTube failures as a stopped run instead of swallowing them', async () => {
    const quota = harness({ playlist: ['x'], playlistError: new YoutubeError('quota-exhausted') });
    expect(await run(quota)).toMatchObject({ stoppedReason: 'quota-exhausted', applied: [], listed: 0 });
    expect(quota.calls).toEqual([]);
    const missing = harness({ playlist: [], playlistError: new YoutubeError('request-failed', 404, 'playlistNotFound') });
    expect(await run(missing)).toMatchObject({ stoppedReason: 'request-failed' });
    const lookup = harness({ playlist: ['dKGM2rzKRjs', 'NewCh123456'], live: [{ pk: 7, videoId: 'dKGM2rzKRjs', del_flag: 1, mtime: null }], lookupError: new YoutubeError('quota-daily') });
    expect(await run(lookup)).toMatchObject({ stoppedReason: 'quota-daily', applied: [{ videoId: 'dKGM2rzKRjs', outcome: 'restored' }] });
    await expect(run(harness({ playlist: ['x'], playlistError: new Error('db down') as YoutubeError }))).rejects.toThrow('db down');
  });
  it('checks ownership before every write, spends nothing in a dry run, and validates its input', async () => {
    const h = harness({ playlist: ['dKGM2rzKRjs', 'NewCh123456'], live: [{ pk: 7, videoId: 'dKGM2rzKRjs', del_flag: 1, mtime: null }], found: [item('NewCh123456', UC_NEW)] });
    await run(h);
    expect(h.owned()).toBeGreaterThanOrEqual(2);
    const dry = harness({ playlist: ['dKGM2rzKRjs'], execute: false });
    expect(await run(dry)).toMatchObject({ mode: 'dry-run', apiAttempts: 0 }); expect(dry.api.playlist).toBe(0); expect(dry.calls).toEqual([]);
    await expect(livePlaylistJob(h.ctx, { playlistId: 'UUabcdefghijkl', limit: 50 })).rejects.toThrow('Invalid live playlist');
    await expect(livePlaylistJob(h.ctx, { playlistId: PLAYLIST, limit: 51 })).rejects.toThrow();
  });
});
