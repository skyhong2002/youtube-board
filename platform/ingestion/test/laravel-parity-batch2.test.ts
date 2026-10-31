import { describe, it, expect } from 'vitest';
import type { Connection } from 'mysql2/promise';
import { YoutubeDataApiClient } from '../src/youtube.js';
import { YoutubeError, youtubeFailureDetail } from '../src/quota.js';
import { channelStatisticsJob, channelUploadsJob, isLiveThumbnail, nextUploadsCheck, uploadsJobKey } from '../src/channel-jobs.js';
import { videoStatisticsJob, publishVideoStatistics, nextStatisticsCheck, type SourceJobContext } from '../src/video-statistics.js';
import { livePollingJob, publishLiveDetails } from '../src/live-polling.js';
import { videoDurationsJob } from '../src/video-durations.js';
import { tagBackfillJob } from '../src/tag-backfill.js';
import { liveCleanupJob } from '../src/maintenance-caches.js';

// Batch 2 ("youtube-source") of the Laravel scheduler handoff: offline checks that the TS source jobs select,
// throttle and write like the production Laravel commands (app/Services/Ingestion/*Ingestion.php).
const now = new Date('2026-10-12T02:00:00Z'), at = '2026-10-12 10:00:00';
interface Call { sql: string; params: unknown[] }
function fakeDb(select: (sql: string, params: unknown[]) => unknown[] = () => [], failWrite?: (sql: string) => boolean) {
  const calls: Call[] = [];
  const db = {
    query: async (sql: string, params: unknown[] = []) => { calls.push({ sql, params }); return [select(sql, params), []]; },
    execute: async (sql: string, params: unknown[] = []) => { calls.push({ sql, params }); if (failWrite?.(sql)) throw new Error('write failed'); return [{ affectedRows: 1, insertId: 1 }, []]; },
  } as unknown as Connection;
  const writes = (table?: string) => calls.filter(c => /^(INSERT|UPDATE|DELETE)/.test(c.sql) && (!table || c.sql.includes('`' + table + '`') || c.sql.includes(' ' + table + ' ')));
  return { db, calls, writes };
}
/** Column → value map of an `UPDATE t SET a = ?, b = ? WHERE ...` produced by legacy-db.update. */
function setValues(call: Call) { const columns = [...call.sql.split(' WHERE ')[0]!.matchAll(/`([A-Za-z_]+)` = \?/g)].map(m => m[1]!).slice(0); return Object.fromEntries(columns.map((c, i) => [c, call.params[i]])); }
function insertValues(call: Call) { const columns = [...call.sql.split('VALUES')[0]!.matchAll(/`([A-Za-z_]+)`/g)].map(m => m[1]!).slice(1); return Object.fromEntries(columns.map((c, i) => [c, call.params[i]])); }
function youtube(handler: (url: URL) => { status?: number; body: unknown }) {
  return new YoutubeDataApiClient({ keys: ['k1', 'k2'], ledger: { precharge: async () => '2026-10-11', markDailyExhausted: async () => {} }, now: () => now, sleep: async () => {}, fetcher: async url => { const r = handler(new URL(String(url))); return new Response(JSON.stringify(r.body), { status: r.status ?? 200 }); } });
}
const noApi = youtube(() => { throw new Error('no API call expected'); });
const ctx = (db: Connection, client = noApi, execute = true): SourceJobContext => ({ db, youtube: client, now, execute, assertOwnership: async () => {} });
const item = (videoId: string, publishedAt: string, extra: Record<string, unknown> = {}) => ({ id: 'PI' + videoId, snippet: { resourceId: { videoId }, publishedAt, channelId: 'UCfixture', title: '  標題  ', description: ' 描述 ', thumbnails: { default: { url: 'https://i.ytimg.com/vi/x/default.jpg' } }, channelTitle: '頻道', playlistId: 'UUfixture', position: 0, ...extra } });

describe('channel discovery (youtube.channels.videos.* / youtube.tvbs.videos)', () => {
  it.each([
    { status: 404, reason: 'playlistNotFound', category: 'request-failed', failures: 0 },
    { status: 403, reason: 'playlistItemsNotAccessible', category: 'request-failed', failures: 0 },
    { status: 503, reason: 'backendError', category: 'transient', failures: 2 },
    { status: 400, reason: 'https://private.invalid/?key=private-fixture', category: 'request-failed', failures: 2 },
  ])('retains bounded failure details for HTTP $status / $category without raw provider content', async ({ status, reason, category, failures }) => {
    const f = fakeDb(sql => sql.includes('FROM urt_channel c') ? [{ u_id: 1, uploads: 'UUfixture' }, { u_id: 2, uploads: 'UUfixture' }] : []);
    const client = youtube(() => ({ status, body: { error: { message: 'private-fixture raw provider content', errors: [{ reason }] } } }));
    const result = await channelUploadsJob(ctx(f.db, client), { limit: 2, maxPages: 1, days: 7 });
    expect(result).toMatchObject({ selected: 2, applied: [], allSkipped: true, discoveryFailures: failures, skipCounts: { 'playlist-api-error': 2 }, failureCounts: { [category]: 2 } });
    expect(result.skipped[0]?.failure).toEqual({ category, status, reason: reason.startsWith('https:') ? 'other' : reason });
    expect(JSON.stringify(result)).not.toContain('private-fixture');
    expect(f.writes().map(setValues)).toEqual([{ vtime: '2026-10-12 11:00:00' }, { vtime: '2026-10-12 11:00:00' }]);
  });

  it('does not retain arbitrary thrown messages or error objects in discovery diagnostics', () => {
    const privateError = Object.assign(new Error('private-fixture with URL and credentials'), { code: 'private-fixture' });
    expect(youtubeFailureDetail(privateError)).toEqual({ category: 'unknown', status: null, reason: null });
  });
  it('maps --live=1 to tag 52 (youtube.channels.videos.live) and --live=2 to tag 89 (live_group) like Laravel', async () => {
    expect(uploadsJobKey({ live: 1 })).toBe('youtube.channels.videos.live');
    expect(uploadsJobKey({ live: 2 })).toBe('youtube.channels.videos.live_group');
    for (const [live, tag] of [[1, '%[52]%'], [2, '%[89]%']] as const) {
      const f = fakeDb();
      await channelUploadsJob(ctx(f.db, noApi, false), { live, limit: 3, maxPages: 1, days: 7, maxResults: 5 });
      expect(f.calls[0]!.sql).toContain('c.flag_del IS NULL'); expect(f.calls[0]!.sql).toContain('ORDER BY c.vtime, c.u_id');
      expect(f.calls[0]!.sql).not.toContain('vtime <='); expect(f.calls[0]!.params).toEqual([tag, 3]);
    }
  });

  it('estimates the next vtime exactly like Laravel estimateNextVtime (08:00 rule on the raw interval, then 2h floor)', () => {
    expect(nextUploadsCheck(new Date('2026-10-11T15:00:00Z'), 1000)).toBe('2026-10-12 01:00:00');
    expect(nextUploadsCheck(new Date('2026-10-11T21:00:00Z'), 100)).toBe('2026-10-12 08:33:36');
    expect(nextUploadsCheck(now, 1000)).toBe('2026-10-12 12:00:00');
    expect(nextUploadsCheck(new Date('2026-10-11T22:00:00Z'), 0)).toBe('2026-10-19 08:00:00');
    expect(nextUploadsCheck(now, 7)).toBe('2026-10-12 18:00:00');
  });

  it('rewrites ctime/u_id on re-discovery, trims titles, and schedules the next vtime from the week count', async () => {
    const f = fakeDb(sql => sql.includes('FROM urt_channel c') ? [{ u_id: 7, youtube_id: 'UCfixture', uploads: 'UUfixture', vtime: null }] : sql.includes('`urt_video`') ? [{ pk: 99, u_id: 3, ctime: '2020-01-01 00:00:00' }] : []);
    const client = youtube(url => { expect(url.searchParams.get('maxResults')).toBe('3'); return { body: { items: [item('Vid0000001', '2026-10-11T03:00:00Z', { liveBroadcastContent: 'upcoming' })] } }; });
    const result = await channelUploadsJob(ctx(f.db, client), { limit: 5, maxPages: 1, days: 7, maxResults: 3 });
    expect(result.skipped).toEqual([]); expect(f.calls[0]!.sql).toContain('(c.vtime <= ? OR c.vtime IS NULL)'); expect(f.calls[0]!.params).toEqual([at, 5]);
    const video = setValues(f.writes('urt_video').find(c => c.sql.startsWith('UPDATE `urt_video`'))!);
    expect(video).toMatchObject({ ctime: at, u_id: 7, title: '標題', description: ' 描述 ', channelTitle: '頻道', publishedAt: '2026-10-11 11:00:00' });
    expect(insertValues(f.writes('urt_video_schedule')[0]!)).toMatchObject({ videoId: 'Vid0000001', ctime: at, publishedAt: '2026-10-11 11:00:00' });
    expect(insertValues(f.writes('urt_video_live')[0]!)).toMatchObject({ videoId: 'Vid0000001', ctime: at, u_id: 7 });
    expect(setValues(f.writes('urt_channel').at(-1)!)).toEqual({ vtime: nextUploadsCheck(now, 1) });
  });

  it('defers a failed playlist by one hour, a failed write by five minutes, and stops on exhausted keys without writes', async () => {
    const rows = [{ u_id: 7, youtube_id: 'UCfixture', uploads: 'UUfixture' }, { u_id: 8, youtube_id: 'UCother', uploads: '' }];
    const f = fakeDb(sql => sql.includes('FROM urt_channel c') ? rows : []);
    const missing = await channelUploadsJob(ctx(f.db, youtube(() => ({ status: 404, body: { error: { errors: [{ reason: 'playlistNotFound' }] } } }))), { limit: 5, maxPages: 1, days: 7 });
    expect(missing.skipped.map(s => s.reason)).toEqual(['playlist-api-error', 'missing-uploads-playlist']);
    expect(f.writes().map(setValues)).toEqual([{ vtime: '2026-10-12 11:00:00' }, { vtime: '2026-10-12 11:00:00' }]);
    const transient = fakeDb(sql => sql.includes('FROM urt_channel c') ? rows.slice(0, 1) : []);
    await channelUploadsJob(ctx(transient.db, youtube(() => ({ status: 503, body: {} }))), { limit: 5, maxPages: 1, days: 7 });
    expect(transient.writes().map(setValues)).toEqual([{ vtime: '2026-10-12 11:00:00' }]);
    const failing = fakeDb(sql => sql.includes('FROM urt_channel c') ? rows.slice(0, 1) : [], sql => sql.includes('`urt_video_schedule`'));
    expect((await channelUploadsJob(ctx(failing.db, youtube(() => ({ body: { items: [item('Vid0000001', '2026-10-11T03:00:00Z')] } }))), { limit: 5, maxPages: 1, days: 7 })).skipped[0]).toMatchObject({ reason: 'item-processing-failed', partialVideos: ['Vid0000001'] });
    expect(setValues(failing.writes('urt_channel').at(-1)!)).toEqual({ vtime: '2026-10-12 10:05:00' });
    const quota = fakeDb(sql => sql.includes('FROM urt_channel c') ? rows : []);
    const stopped = await channelUploadsJob(ctx(quota.db, youtube(() => ({ status: 403, body: { error: { errors: [{ reason: 'quotaExceeded' }] } } }))), { limit: 5, maxPages: 1, days: 7 });
    expect(stopped).toMatchObject({ stoppedReason: 'quota-daily', remaining: 2 }); expect(quota.writes()).toEqual([]);
  });

  it('rotates TVBS tag-29 channels by u_id with --offset=auto, wraps, caps execute at 3 and never writes vtime', async () => {
    const f = fakeDb(sql => sql.startsWith('SELECT COUNT(*)') ? [{ n: 5 }] : []);
    await channelUploadsJob(ctx(f.db, noApi, false), { tvbs: true, limit: 1, maxPages: 1, days: 7, offset: 'auto' });
    expect(f.calls[0]!.params).toEqual(['%[29]%']); expect(f.calls[1]!.sql).toContain('ORDER BY c.u_id LIMIT ? OFFSET ?');
    expect(f.calls[1]!.params).toEqual(['%[29]%', 1, Math.floor(1791770400 / 300) % 5]);
    const wrap = fakeDb(sql => sql.startsWith('SELECT COUNT(*)') ? [{ n: 5 }] : !sql.includes('FROM urt_channel c') ? [] : sql.includes('OFFSET') ? [{ u_id: 5, uploads: 'UUfixture' }] : [{ u_id: 1, uploads: 'UUfixture' }, { u_id: 2, uploads: 'UUfixture' }]);
    const client = youtube(() => ({ body: { items: [item('Vid0000002', '2026-10-11T03:00:00Z', { thumbnails: { default: { url: 'https://i.ytimg.com/vi/x/default_live.jpg' } } })] } }));
    const result = await channelUploadsJob(ctx(wrap.db, client), { tvbs: true, limit: 50, maxPages: 1, days: 7, offset: 4 });
    expect(wrap.calls[1]!.params).toEqual(['%[29]%', 3, 4]); expect(wrap.calls[2]!.params).toEqual(['%[29]%', 2]);
    expect(result.applied.map(r => r.uId)).toEqual([5, 1, 2]);
    expect(wrap.writes('urt_channel')).toEqual([]); expect(wrap.writes('urt_video_live')).toEqual([]); expect(wrap.writes('urt_video_live_tvbs')).toHaveLength(3);
  });
});

describe('live thumbnail marker', () => {
  it('accepts the legacy default_live.jpg and the versioned default.jpg?v= form YouTube serves since 2026-10-22', () => {
    expect(isLiveThumbnail('https://i.ytimg.com/vi/kgZ8Es6vM0A/default_live.jpg')).toBe(true);
    expect(isLiveThumbnail('https://i.ytimg.com/vi/V1RMRVkmdZ0/default.jpg?v=6adaefde')).toBe(true);
    expect(isLiveThumbnail('https://i.ytimg.com/vi/Sn1eyjgnb0M/default.jpg')).toBe(false);
  });
  it('writes a urt_video_live row for a versioned-thumbnail upload in general discovery', async () => {
    const f = fakeDb(sql => sql.includes('FROM urt_channel c') ? [{ u_id: 8, uploads: 'UUfixture' }] : []);
    const client = youtube(() => ({ body: { items: [item('Vid0000003', '2026-10-23T06:00:00Z', { thumbnails: { default: { url: 'https://i.ytimg.com/vi/Vid0000003/default.jpg?v=6adaefde' } } })] } }));
    await channelUploadsJob(ctx(f.db, client), { limit: 1, maxPages: 1, days: 7 });
    expect(f.writes('urt_video_live')).toHaveLength(1);
  });
});

describe('channel statistics (youtube.channels.stats)', () => {
  it('selects like ChannelStatisticsPreview: flag_del NULL, non-blank youtube_id, channels without history first', async () => {
    const f = fakeDb();
    await channelStatisticsJob(ctx(f.db, noApi, false), { limit: 25 });
    const sql = f.calls[0]!.sql;
    expect(sql).toContain('c.flag_del IS NULL'); expect(sql).not.toContain('flag_del < 1'); expect(sql).toContain("TRIM(COALESCE(c.youtube_id, '')) <> ''");
    expect(sql).toMatch(/ORDER BY CASE WHEN NOT EXISTS \(SELECT 1 FROM urt_log l WHERE l\.u_id = c\.u_id\) THEN 0 ELSE 1 END, CASE WHEN NOT EXISTS .* THEN COALESCE\(c\.viewCount, 0\) ELSE 0 END DESC, c\.stime, c\.u_id LIMIT \?$/);
    expect(f.calls[0]!.params).toEqual(['youtube.channels.stats', '2026-10-11 12:00:00', at, 25]);
  });
});

describe('video statistics (youtube.videos.stats)', () => {
  it('calls YouTube only above 80% of the batch, without the TS-only aged-row shortcut', async () => {
    const rows = (n: number) => Array.from({ length: n }, (_, i) => ({ videoId: 'Vid' + String(i).padStart(8, '0'), mtime: null }));
    expect((await videoStatisticsJob(ctx(fakeDb(() => rows(20)).db, noApi, false), { limit: 25 })).wouldCallApi).toBe(false);
    expect((await videoStatisticsJob(ctx(fakeDb(() => rows(21)).db, noApi, false), { limit: 25 })).wouldCallApi).toBe(true);
    expect((await videoStatisticsJob(ctx(fakeDb(() => rows(1)).db, noApi, false), { videoId: 'Vid00000000', limit: 25 })).wouldCallApi).toBe(true);
  });

  it('uses the schedule row as prior observation only with a known viewCount, else publishedAt (estimateNextCheck)', () => {
    expect(nextStatisticsCheck(100, { viewCount: null, mtime: '2026-10-12 09:00:00' }, '2026-10-11 09:00:00', now)).toBe(nextStatisticsCheck(100, null, '2026-10-11 09:00:00', now));
    expect(nextStatisticsCheck(100, { viewCount: '50', mtime: '2026-10-12 09:00:00' }, '2026-10-11 09:00:00', now)).not.toBe(nextStatisticsCheck(100, null, '2026-10-11 09:00:00', now));
  });

  it('merges the monthly day point, keeps omitted counts, and rewrites the schedule ctime', async () => {
    const id = 'Vid00000001';
    const f = fakeDb(sql => sql.includes('`urt_video_log`') ? [{ pk: 1, thedata: JSON.stringify({ '2026-10-12': { like: 9, view: 1, extra: 5 }, '2026-10-11': { view: 0 } }) }]
      : sql.includes('`urt_video`') ? [{ pk: 2, videoId: id, viewCount: '50', likeCount: '9', favoriteCount: '1', commentCount: '2', mtime: '2026-10-11 10:00:00' }]
      : sql.includes('`urt_video_schedule`') ? [{ pk: 3, videoId: id, viewCount: null, mtime: null, ctime: '2026-10-01 00:00:00' }] : []);
    await publishVideoStatistics(f.db, { videoId: id, publishedAt: '2026-10-11 09:00:00' } as never, { viewCount: 100, likeCount: null, favoriteCount: null, commentCount: null, dislikeCount: 0 }, now, 'urt_video_schedule');
    expect(setValues(f.writes('urt_video_log')[0]!).thedata).toBe(JSON.stringify({ '2026-10-12': { like: 9, view: 100, extra: 5, dislike: 0, comment: 2 }, '2026-10-11': { view: 0 } }));
    expect(setValues(f.writes('urt_video_schedule')[0]!)).toMatchObject({ ctime: at, mtime: at, viewCount: 100, likeCount: 9, commentCount: 2, stime: nextStatisticsCheck(100, null, '2026-10-11 09:00:00', now) });
    expect(setValues(f.writes('urt_video')[0]!)).not.toHaveProperty('mtime');
  });
});

describe('live polling (youtube.live.poll / youtube.tvbs.live.poll)', () => {
  const rows = (n: number) => Array.from({ length: n }, (_, i) => ({ pk: i + 1, videoId: 'Live' + String(i).padStart(7, '0'), mtime: null }));
  it('polls the main table only with ten due streams in the 50-row legacy batch; TVBS polls any due row', async () => {
    const nine = fakeDb(() => rows(9));
    expect((await livePollingJob(ctx(nine.db, noApi, false), { limit: 50 })).wouldCallApi).toBe(false);
    expect(nine.calls[0]!.sql).toContain('(v.mtime IS NULL OR v.mtime < ?)'); expect(nine.calls[0]!.sql).toContain('v.scheduledStartTime < ?');
    expect(nine.calls[0]!.sql).toContain('(v.del_flag IS NULL OR v.del_flag < 1)'); expect(nine.calls[0]!.sql).toMatch(/ORDER BY v\.mtime, v\.videoId LIMIT 50$/);
    // Upcoming streams are due 30 minutes before their scheduled start (early starts), not only after it.
    expect(nine.calls[0]!.params).toEqual(['2026-10-12 09:49:00', '2026-10-12 10:30:00']);
    expect((await livePollingJob(ctx(fakeDb(() => rows(10)).db, noApi, false), { limit: 50 })).wouldCallApi).toBe(true);
    const tvbs = fakeDb(() => rows(30));
    const preview = await livePollingJob(ctx(tvbs.db, noApi, false), { tvbs: true, limit: 20 });
    expect(preview).toMatchObject({ wouldCallApi: true, selected: 20 }); expect(tvbs.calls[0]!.params).toEqual(['2026-10-12 09:59:20', '2026-10-12 10:30:00']);
  });

  it('raises max_current only above the stored maximum and keeps the day log owner', async () => {
    for (const [stored, viewers, expected] of [[null, '0', undefined], [3, '5', 5], [8, '5', undefined]] as const) {
      const f = fakeDb(sql => sql.includes('`urt_video_live_log`') ? [{ pk: 4, log_json: '{"09:59":1}' }] : []);
      await publishLiveDetails({ db: f.db, now }, { pk: 1, videoId: 'Live0000001', u_id: 9, max_current: stored } as never, { concurrentViewers: viewers });
      const log = setValues(f.writes('urt_video_live_log')[0]!); expect(log).not.toHaveProperty('u_id'); expect(log.log_json).toBe(JSON.stringify({ '09:59': 1, '10:00': Number(viewers) }));
      expect(setValues(f.writes('urt_video_live').at(-1)!).max_current).toBe(expected);
    }
  });
});

describe('durations and cleanup', () => {
  it('youtube.videos.duration calls YouTube only above 20% of the batch (VideoDurationsPreview)', async () => {
    const rows = (n: number) => Array.from({ length: n }, (_, i) => ({ pk: i, videoId: 'Dur' + String(i).padStart(8, '0'), pk_video: i + 1 }));
    expect((await videoDurationsJob(ctx(fakeDb(() => rows(5)).db), { limit: 25, enqueueMissing: false })).wouldCallApi).toBe(false);
    expect((await videoDurationsJob(ctx(fakeDb(() => rows(6)).db, noApi, false), { limit: 25, enqueueMissing: false })).wouldCallApi).toBe(true);
  });

  it('youtube.live.cleanup retires only del_flag IS NULL rows in mtime, videoId order', async () => {
    const f = fakeDb(() => [{ pk: 1, videoId: 'Live0000001' }]);
    await liveCleanupJob({ db: f.db, now, execute: true, assertOwnership: async () => {} }, 100);
    expect(f.calls[0]!.sql).toContain('del_flag IS NULL AND ctime<?'); expect(f.calls[0]!.sql).not.toContain('COALESCE(del_flag'); expect(f.calls[0]!.sql).toMatch(/ORDER BY mtime,videoId LIMIT \?$/);
    expect(f.calls[0]!.params).toEqual(['2026-10-12 09:00:00', '2026-10-12 08:00:00', at, 101]);
  });
});

describe('tag uploads backfill (youtube.tag_videos.backfill)', () => {
  const input = { tagIds: [102], from: '2026-10-11', to: '2026-10-11', channelLimit: 1, maxPages: 20, maxResults: 50, videoLimit: 10000, rebuildCache: false };
  it('crawls the first capped channels, stops at the first item before the window and never claims completeness when truncated', async () => {
    const f = fakeDb(sql => sql.includes('FROM urt_channel c JOIN urt_count n') ? [{ u_id: 1, uploads: 'UUfixture' }, { u_id: 2, uploads: 'UUfixture' }] : []);
    const pages = youtube(() => ({ body: { items: [item('NewInRange', '2026-10-11T03:00:00Z'), item('OlderThanW', '2026-10-09T01:00:00Z'), item('PremiereIn', '2026-10-11T04:00:00Z')], nextPageToken: 'more' } }));
    const result = await tagBackfillJob(ctx(f.db, pages), input);
    expect(f.calls[0]!.params).toEqual(['%[102]%', 2]);
    expect(result).toMatchObject({ truncated: true, crawlComplete: false, caches: [], applied: [{ uId: 1, pages: 1, videos: 1 }] });
    expect(f.writes('urt_video').map(insertValues)).toEqual([expect.objectContaining({ videoId: 'NewInRange', ctime: at, u_id: 1 })]);
  });

  it('rethrows all-keys rate limits instead of skipping to the next channel', async () => {
    const f = fakeDb(sql => sql.includes('FROM urt_channel c JOIN urt_count n') ? [{ u_id: 1, uploads: 'UUfixture' }] : []);
    const limited = youtube(() => ({ status: 429, body: { error: { errors: [{ reason: 'rateLimitExceeded' }] } } }));
    await expect(tagBackfillJob(ctx(f.db, limited), input)).rejects.toEqual(new YoutubeError('rate-limit'));
    expect(f.writes()).toEqual([]);
  });
});
