import { isolatedTestEnv } from '../../shared/test-database.js';
import { it, expect } from 'vitest';
import mysql, { type Connection, type RowDataPacket } from 'mysql2/promise';
import { randomUUID } from 'node:crypto';
import { YoutubeDataApiClient } from '../src/youtube.js';
import { MysqlQuotaLedger } from '../src/quota.js';
import { videoStatisticsJob, type SourceJobContext } from '../src/video-statistics.js';
import { livePollingJob } from '../src/live-polling.js';
import { tagBackfillJob, type BackfillInput } from '../src/tag-backfill.js';
const enabled = process.env.INGESTION_DB_TEST === '1';
const now = new Date('2026-10-12T02:00:00Z');
async function connect() { const env = isolatedTestEnv(); return mysql.createConnection({ host: env.DB_HOST, port: Number(env.DB_PORT), database: env.DB_DATABASE, user: env.DB_USERNAME, password: env.DB_PASSWORD, timezone: 'Z', dateStrings: true }); }
function api(responses: unknown[]) { let index = 0; return new YoutubeDataApiClient({ keys: ['fake-not-a-key'], ledger: { precharge: async () => '2026-10-11', markDailyExhausted: async () => {} }, now: () => now, fetcher: async () => new Response(JSON.stringify(responses[Math.min(index++, responses.length - 1)])) }); }
const ctx = (db: Connection, youtube: YoutubeDataApiClient): SourceJobContext => ({ db, youtube, now, execute: true, assertOwnership: async () => {} });
const uid = () => 'T' + randomUUID().replaceAll('-', '').slice(0, 10);
async function insertVideo(db: Connection, id: string) { await db.execute('INSERT INTO urt_video (ctime, mtime, stime, u_id, id, publishedAt, channelId, title, thumbnails, channelTitle, playlistId, position, videoId, description, viewCount, likeCount, favoriteCount, commentCount) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', ['2026-10-11 09:00:00', '2026-10-11 10:00:00', null, 1, id, '2026-10-11 09:00:00', 'UC-test', '台灣新聞', '', 'test', 'UU-test', 0, id, '', 50, 7, 2, 3]); }
async function cleanVideo(db: Connection, id: string) { await db.execute('DELETE FROM ts_youtube_item_backoff WHERE video_id = ?', [id]); for (const table of ['urt_video_live_log', 'urt_video_live', 'urt_video_log_history', 'urt_video_log', 'urt_video_schedule', 'urt_video']) await db.execute(`DELETE FROM ${table} WHERE BINARY videoId = BINARY ?`, [id]); }
it.skipIf(!enabled)('real shared quota ledger atomically precharges attempts without consuming Laravel reservations', async () => {
  const db = await connect(), other = await connect(), date = '2099-01-10';
  let inserted = false;
  try {
    await db.execute('INSERT INTO ingestion_youtube_quota_daily (provider, quota_date, consumed_units, reserved_units) VALUES (?, ?, 1, 2)', ['youtube_data_api_v3', date]);
    inserted = true;
    const ledger = new MysqlQuotaLedger(db, 4, () => new Date('2099-01-10T20:00:00Z'));
    const competitor = new MysqlQuotaLedger(other, 4, () => new Date('2099-01-10T20:00:00Z'));
    const attempts = await Promise.allSettled([ledger.precharge(15000), competitor.precharge(15000)]);
    expect(attempts.filter(x => x.status === 'fulfilled')).toHaveLength(1);
    const [rows] = await db.query<RowDataPacket[]>('SELECT consumed_units, reserved_units FROM ingestion_youtube_quota_daily WHERE provider = ? AND quota_date = ?', ['youtube_data_api_v3', date]);
    expect(Number(rows[0]?.consumed_units)).toBe(2); expect(Number(rows[0]?.reserved_units)).toBe(2);
    await ledger.markDailyExhausted(date);
    await expect(new MysqlQuotaLedger(db, 9999, () => new Date('2099-01-10T20:00:00Z')).precharge(15000)).rejects.toMatchObject({ code: 'quota-exhausted' });
  } finally { if (inserted) await db.execute('DELETE FROM ingestion_youtube_quota_daily WHERE provider = ? AND quota_date = ?', ['youtube_data_api_v3', date]); await db.end(); await other.end(); }
});
it.skipIf(!enabled)('statistics writes history/monthly cache before freshness, preserves omitted counts, and replays idempotently on MyISAM', async () => {
  const db = await connect(), id = uid();
  try {
    await insertVideo(db, id);
    const context = ctx(db, api([{ items: [{ id, statistics: { viewCount: '100' } }] }]));
    const preview = await videoStatisticsJob({ ...context, execute: false }, { videoId: id, limit: 1 }); expect(preview.apiAttempts).toBe(0);
    expect((await videoStatisticsJob(context, { videoId: id, limit: 1 })).applied).toEqual([id]);
    await videoStatisticsJob(context, { videoId: id, limit: 1 });
    const [source] = await db.query<RowDataPacket[]>('SELECT * FROM urt_video WHERE BINARY videoId = BINARY ?', [id]);
    expect([source[0]?.viewCount, source[0]?.likeCount, source[0]?.favoriteCount, source[0]?.commentCount].map(Number)).toEqual([100, 7, 2, 3]);
    const [history] = await db.query<RowDataPacket[]>('SELECT * FROM urt_video_log_history WHERE BINARY videoId = BINARY ?', [id]); expect(history).toHaveLength(1);
    const [logs] = await db.query<RowDataPacket[]>('SELECT thedata FROM urt_video_log WHERE BINARY videoId = BINARY ?', [id]); expect(JSON.parse(logs[0]?.thedata)['2026-10-12']).toMatchObject({ view: 100, like: 7, comment: 3 });
    await db.execute('UPDATE urt_video_log SET thedata = ? WHERE BINARY videoId = BINARY ?', ['{broken', id]);
    const fail = await videoStatisticsJob({ ...context, now: new Date(now.getTime() + 3600000), youtube: api([{ items: [{ id, statistics: { viewCount: '200' } }] }]) }, { videoId: id, limit: 1 });
    expect(fail.skipped[0]?.reason).toBe('item-write-failed');
    const [unchanged] = await db.query<RowDataPacket[]>('SELECT viewCount, mtime FROM urt_video WHERE BINARY videoId = BINARY ?', [id]); expect(Number(unchanged[0]?.viewCount)).toBe(100); expect(unchanged[0]?.mtime).toBe('2026-10-12 10:00:00');
  } finally { await cleanVideo(db, id); await db.end(); }
});
it.skipIf(!enabled)('live polling preserves malformed rows, publishes minute log then current values, and retires only absent ids', async () => {
  const db = await connect(), id = uid();
  try {
    await db.execute('INSERT INTO urt_video_live (ctime,publishedAt,videoId,u_id) VALUES (?, ?, ?, ?)', ['2026-10-11 09:00:00', '2026-10-11 09:00:00', id, 1]);
    const malformed = await livePollingJob(ctx(db, api([{ items: [{ id, liveStreamingDetails: { concurrentViewers: 'invalid' } }] }])), { videoId: id, limit: 1 }); expect(malformed.skipped[0]?.reason).toBe('api-item-invalid');
    const [due] = await db.query<RowDataPacket[]>('SELECT mtime, del_flag FROM urt_video_live WHERE BINARY videoId = BINARY ?', [id]); expect(due[0]?.mtime).toBeNull(); expect(due[0]?.del_flag).toBeNull();
    const valid = ctx(db, api([{ items: [{ id, liveStreamingDetails: { concurrentViewers: '25', actualStartTime: '2026-10-12T01:00:00Z' } }] }]));
    await livePollingJob(valid, { videoId: id, limit: 1 }); await livePollingJob(valid, { videoId: id, limit: 1 });
    const [logs] = await db.query<RowDataPacket[]>('SELECT * FROM urt_video_live_log WHERE BINARY videoId = BINARY ?', [id]); expect(logs).toHaveLength(1); expect(JSON.parse(logs[0]?.log_json)['10:00']).toBe(25);
    await livePollingJob(ctx(db, api([{ items: [] }])), { videoId: id, limit: 1 });
    const [retired] = await db.query<RowDataPacket[]>('SELECT del_flag FROM urt_video_live WHERE BINARY videoId = BINARY ?', [id]); expect(retired[0]?.del_flag).toBe(1);
  } finally { await cleanVideo(db, id); await db.end(); }
});
it.skipIf(!enabled)('tag backfill refuses truncated crawl publication, then fills source/schedule and versioned tag-date caches', async () => {
  const db = await connect(), id = uid(), olderId = uid(), youtubeId = 'UC' + randomUUID().replaceAll('-', '').slice(0, 22), tag = 900000000 + Math.floor(Math.random() * 1000000);
  let channelId: number | undefined;
  const selection = JSON.stringify([[tag], [], []]);
  try {
    const [insert] = await db.execute<mysql.ResultSetHeader>('INSERT INTO urt_channel (ctime,youtube_id,title,uploads) VALUES (?, ?, ?, ?)', ['2026-10-11 09:00:00', youtubeId, 'test', 'UUfixture']); channelId = insert.insertId;
    await db.execute('INSERT INTO urt_count (u_id,ctime,tags) VALUES (?, ?, ?)', [channelId, '2026-10-11 09:00:00', `[${tag}]`]);
    const item = (videoId: string, publishedAt: string, position: number) => ({ id: 'playlist-' + videoId, snippet: { resourceId: { videoId }, publishedAt, channelId: youtubeId, title: '台灣新聞', description: '', thumbnails: { default: { url: 'https://i.ytimg.com/a.jpg' } }, channelTitle: 'test', playlistId: 'UUfixture', position } });
    const pages = [{ items: [item(id, '2026-10-11T01:00:00Z', 0)], nextPageToken: 'next' }, { items: [item(olderId, '2026-10-09T01:00:00Z', 1)] }];
    const input: BackfillInput = { tagIds: [tag], from: '2026-10-11', to: '2026-10-11', channelLimit: 1, maxPages: 1, maxResults: 50, videoLimit: 100, rebuildCache: true };
    const dictionary = { version: 'fixture-vocab', coverage: 'observed-article-window', rule: 'youtube-tag-exact-v1-title2-length', match: (title: string) => title.includes('台灣') ? [{ term: '台灣', field: 'title' as const }] : [] };
    const incomplete = await tagBackfillJob(ctx(db, api(pages)), input, dictionary); expect(incomplete.skipped).toHaveLength(1); expect(incomplete.caches).toHaveLength(0);
    const [none] = await db.query<RowDataPacket[]>('SELECT pk FROM urt_video WHERE BINARY videoId = BINARY ?', [id]); expect(none).toHaveLength(0);
    const complete = await tagBackfillJob(ctx(db, api(pages)), { ...input, maxPages: 2 }, dictionary); expect(complete.skipped).toHaveLength(0); expect(complete.caches).toHaveLength(1);
    const [cache] = await db.query<RowDataPacket[]>('SELECT * FROM urt_show_tag_date WHERE tagid = ? AND the_date = ?', [String(tag), input.from]); expect(Number(cache[0]?.count_videos)).toBe(1); expect(JSON.parse(cache[0]?.tags_video)).toEqual({ 台灣: 1 });
    const [lineage] = await db.query<RowDataPacket[]>('SELECT * FROM ts_tag_cache_lineage WHERE selection_key = ?', [selection]); expect(lineage[0]?.status).toBe('published'); expect(lineage[0]?.unknown_view_videos).toBe(1); expect(lineage[0]?.vocabulary_version).toBe('fixture-vocab');
    const [schedule] = await db.query<RowDataPacket[]>('SELECT videoId FROM urt_video_schedule WHERE BINARY videoId = BINARY ?', [id]); expect(schedule).toHaveLength(1);
  } finally {
    await cleanVideo(db, id); await cleanVideo(db, olderId); await db.execute('DELETE FROM ts_tag_cache_lineage WHERE selection_key = ?', [selection]); await db.execute('DELETE FROM urt_show_tag_date WHERE tagid = ?', [String(tag)]);
    if (channelId) { await db.execute('DELETE FROM urt_count WHERE u_id = ?', [channelId]); await db.execute('DELETE FROM urt_channel WHERE u_id = ?', [channelId]); } await db.end();
  }
});
it.skipIf(!enabled)('schedule statistics preserve main-video timestamps and fall back to publishedAt when the schedule has no observed viewCount (Laravel)', async () => {
  const { publishVideoStatistics, nextStatisticsCheck } = await import('../src/video-statistics.js');
  const db = await connect(), id = uid();
  try {
    await insertVideo(db, id);
    await db.execute('INSERT INTO urt_video_schedule (ctime,mtime,videoId,publishedAt,viewCount) VALUES (?, ?, ?, ?, NULL)', ['2026-10-11 09:00:00', '2026-10-12 09:00:00', id, '2026-10-11 09:00:00']);
    const [rows] = await db.query<RowDataPacket[]>('SELECT * FROM urt_video_schedule WHERE BINARY videoId = BINARY ?', [id]);
    await publishVideoStatistics(db, rows[0]!, { viewCount: 100, likeCount: null, favoriteCount: null, commentCount: null, dislikeCount: 0 }, now, 'urt_video_schedule');
    const [source] = await db.query<RowDataPacket[]>('SELECT mtime,stime,viewCount FROM urt_video WHERE BINARY videoId = BINARY ?', [id]);
    expect(source[0]?.mtime).toBe('2026-10-11 10:00:00'); expect(source[0]?.stime).toBeNull(); expect(Number(source[0]?.viewCount)).toBe(100);
    const [schedule] = await db.query<RowDataPacket[]>('SELECT ctime,mtime,stime FROM urt_video_schedule WHERE BINARY videoId = BINARY ?', [id]);
    expect(schedule[0]?.mtime).toBe('2026-10-12 10:00:00'); expect(schedule[0]?.ctime).toBe('2026-10-12 10:00:00');
    expect(schedule[0]?.stime).toBe(nextStatisticsCheck(100, null, '2026-10-11 09:00:00', now));
  } finally { await cleanVideo(db, id); await db.end(); }
});
it.skipIf(!enabled)('orphan schedules never claim a source publication, and item backoff does not fake source freshness', async () => {
  const { publishVideoStatistics } = await import('../src/video-statistics.js');
  const { recordItemBackoff } = await import('../src/backoff.js');
  const db = await connect(), id = uid();
  try {
    await db.execute('INSERT INTO urt_video_schedule (ctime,videoId,publishedAt) VALUES (?, ?, ?)', ['2026-10-11 09:00:00', id, '2026-10-11 09:00:00']);
    const [rows] = await db.query<RowDataPacket[]>('SELECT * FROM urt_video_schedule WHERE BINARY videoId = BINARY ?', [id]);
    await expect(publishVideoStatistics(db, rows[0]!, { viewCount: 100, likeCount: null, favoriteCount: null, commentCount: null, dislikeCount: 0 }, now, 'urt_video_schedule')).rejects.toThrow('missing');
    await recordItemBackoff(db, 'youtube.videos.stats', id, 'item-write-failed', now);
    const [source] = await db.query<RowDataPacket[]>('SELECT mtime,stime FROM urt_video_schedule WHERE BINARY videoId = BINARY ?', [id]); expect(source[0]?.mtime).toBeNull(); expect(source[0]?.stime).toBeNull();
    const [eligible] = await db.query<RowDataPacket[]>('SELECT v.pk FROM urt_video_schedule v LEFT JOIN ts_youtube_item_backoff b ON b.workflow = ? AND BINARY b.video_id = BINARY v.videoId WHERE BINARY v.videoId = BINARY ? AND (b.retry_after IS NULL OR b.retry_after <= ?)', ['youtube.videos.stats', id, '2026-10-12 10:01:00']); expect(eligible).toHaveLength(0);
  } finally { await cleanVideo(db, id); await db.end(); }
});
it.skipIf(!enabled)('duplicate logical live history rows fail closed instead of selecting one arbitrary cache', async () => {
  const { publishLiveDetails } = await import('../src/live-polling.js');
  const db = await connect(), id = uid();
  try {
    await db.execute('INSERT INTO urt_video_live (ctime,publishedAt,videoId,u_id) VALUES (?, ?, ?, ?)', ['2026-10-11 09:00:00', '2026-10-11 09:00:00', id, 1]);
    for (let i = 0; i < 2; i++) await db.execute('INSERT INTO urt_video_live_log (videoId,the_date,ctime,log_json) VALUES (?, ?, ?, ?)', [id, '2026-10-12', '2026-10-12 09:00:00', '{}']);
    const [rows] = await db.query<RowDataPacket[]>('SELECT * FROM urt_video_live WHERE BINARY videoId = BINARY ?', [id]);
    await expect(publishLiveDetails({ db, now }, rows[0]!, { concurrentViewers: '20' })).rejects.toThrow('Duplicate');
    const [fresh] = await db.query<RowDataPacket[]>('SELECT mtime FROM urt_video_live WHERE BINARY videoId = BINARY ?', [id]); expect(fresh[0]?.mtime).toBeNull();
  } finally { await cleanVideo(db, id); await db.end(); }
});
it.skipIf(!enabled)('missing statistics use isolated exponential backoff, preserve source timestamps and keep case-sensitive identities separate', async () => {
  const { recordItemBackoff, clearItemBackoff } = await import('../src/backoff.js');
  const db = await connect(), id = uid(), lower = id.toLowerCase();
  try {
    await insertVideo(db, id);
    await videoStatisticsJob(ctx(db, api([{ items: [] }])), { videoId: id, limit: 1 });
    let [retry] = await db.query<RowDataPacket[]>('SELECT failures,retry_after FROM ts_youtube_item_backoff WHERE workflow = ? AND video_id = ?', ['youtube.videos.stats', id]);
    expect(retry[0]?.failures).toBe(1); expect(retry[0]?.retry_after).toBe('2026-10-12 10:05:00');
    await videoStatisticsJob(ctx(db, api([{ items: [] }])), { videoId: id, limit: 1 });
    [retry] = await db.query<RowDataPacket[]>('SELECT failures,retry_after FROM ts_youtube_item_backoff WHERE workflow = ? AND video_id = ?', ['youtube.videos.stats', id]);
    expect(retry[0]?.failures).toBe(2); expect(retry[0]?.retry_after).toBe('2026-10-12 10:10:00');
    const [source] = await db.query<RowDataPacket[]>('SELECT stime,mtime FROM urt_video WHERE BINARY videoId = BINARY ?', [id]); expect(source[0]?.stime).toBe('2026-10-12 10:05:00'); expect(source[0]?.mtime).toBe('2026-10-11 10:00:00');
    for (let i = 0; i < 10; i++) await recordItemBackoff(db, 'youtube.videos.stats', id, 'api-item-missing-or-invalid', now);
    [retry] = await db.query<RowDataPacket[]>('SELECT retry_after FROM ts_youtube_item_backoff WHERE workflow = ? AND video_id = ?', ['youtube.videos.stats', id]); expect(retry[0]?.retry_after).toBe('2026-10-12 16:00:00');
    await recordItemBackoff(db, 'youtube.videos.stats', lower, 'api-item-missing-or-invalid', now);
    await clearItemBackoff(db, 'youtube.videos.stats', id);
    const [independent] = await db.query<RowDataPacket[]>('SELECT video_id,failures FROM ts_youtube_item_backoff WHERE video_id IN (?, ?)', [id, lower]); expect(independent.map(row => [row.video_id, row.failures])).toEqual([[lower, 1]]);
  } finally { await cleanVideo(db, id); await cleanVideo(db, lower); await db.end(); }
});
