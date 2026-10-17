import { it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import mysql, { type RowDataPacket } from 'mysql2/promise';
import { isolatedTestEnv } from '../../shared/test-database.js';
import { tagMetricsFromEvidence, tagMetricsAccumulator } from '../../shared/cache-metrics.js';
import { keywordsCacheJob, tagCloudCacheJob, tagDateCacheJob, taipeiSql, type CacheContext } from '../src/index.js';
import { countsCacheJob, liveCacheCleanJob, liveDisplayCacheJob, scheduleCacheJob } from '../src/maintenance-caches.js';
import { eligibleKeyword, laravelKeywordMetrics, laravelMetricEntries, mergedMetricJson, peopleCacheJob, peopleOffset, substrCount } from '../src/people-cache.js';
// Batch 1 of the Laravel scheduler handoff: each case reproduces what the Laravel command writes.
const enabled = process.env.INGESTION_DB_TEST === '1';
const dictionary = { version: 'batch1-fixture', coverage: 'observed-article-window', rule: 'youtube-tag-exact-v1-title2-length', match: (title: string, description: string) => [...title.includes('台灣') ? [{ term: '台灣', field: 'title' as const }] : [], ...description.includes('AI') ? [{ term: 'AI', field: 'description' as const }] : []] };
const ago = (now: Date, ms: number) => taipeiSql(new Date(now.getTime() - ms));
const HOUR = 3600000, DAY = 86400000;

it('streamed tag metrics equal the in-memory reader metrics', () => {
  const videos = [{ videoId: 'a', uId: 1, publishedAt: '', viewCount: 5, matches: [{ term: '台灣', field: 'title' as const }, { term: 'AI', field: 'description' as const }] }, { videoId: 'b', uId: 1, publishedAt: '', viewCount: null, matches: [{ term: 'AI', field: 'description' as const }] }];
  const acc = tagMetricsAccumulator(); for (const v of videos) acc.add(v);
  expect(acc.result()).toEqual(tagMetricsFromEvidence(videos));
});
it('people metrics follow TagDateCacheBuilder: substr_count on title twice + description, longer names subtract contained ones', () => {
  expect(substrCount('aaaa', 'aa')).toBe(2); expect(substrCount('台灣台灣', '台灣')).toBe(2);
  const m = laravelKeywordMetrics([{ tag: '柯文哲', divisor: 1 }, { tag: '文哲', divisor: 3.5 }], [{ title: '柯文哲談文哲', description: '', viewCount: '10' }, { title: 'x', description: '', viewCount: null }] as RowDataPacket[]);
  // "柯文哲談文哲 柯文哲談文哲 " → 柯文哲 2, 文哲 4 - 2 = 2.
  expect(m.tags_video).toEqual({ 柯文哲: 1, 文哲: 1 }); expect(m.tags_views).toEqual({ 柯文哲: 10, 文哲: 10 });
  expect(m.tags_result).toEqual({ 柯文哲: (2 * (Math.log(3.5) - 0.5)).toFixed(3), 文哲: (2 * (Math.log(2.5) - 0.5) / 3.5).toFixed(3) });
  expect(m).toMatchObject({ count_tags: 4, count_videos: 2, total_views: 10 });
  expect([eligibleKeyword('柯'), eligibleKeyword('123'), eligibleKeyword('AI'), eligibleKeyword('TSMC'), eligibleKeyword('柯P')]).toEqual([false, false, false, true, true]);
});
it('people merge keeps other names, overwrites the merged ones, drops PHP int keys and sorts numerically like arsort', () => {
  expect(mergedMetricJson('{"其他":"9.000","乙":"0.100","2024":"5","壞":"x"}', { 甲: '1.250', 乙: '0.050' })).toBe('{"其他":"9.000","甲":"1.250","乙":"0.050"}');
  expect(mergedMetricJson('{"data":{"其他":4}}', { 甲: 1 })).toBe('{"其他":4,"甲":1}');
  expect(mergedMetricJson('not json', {})).toBe('[]'); expect(mergedMetricJson('[]', { 甲: 2 })).toBe('{"甲":2}');
  expect(laravelMetricEntries('[1,2]')).toEqual([]);
});
it('offset=auto rotates by the Unix hour slot exactly like Laravel effectiveOffset', () => {
  const now = new Date('2093-03-04T05:27:00Z'), slot = Math.floor(now.getTime() / 1000 / 3600);
  expect(peopleOffset('auto', 37, 5, now)).toBe(slot * 5 % 37); expect(peopleOffset(40, 37, 5, now)).toBe(3); expect(peopleOffset('auto', 0, 5, now)).toBe(0);
});
it('live clean orders newest ctime first like Laravel', async () => {
  const sql: string[] = [], db = { query: async (q: string) => { sql.push(q); return [[]]; } };
  await liveCacheCleanJob({ db, now: new Date(), execute: false, assertOwnership: async () => {} } as unknown as CacheContext, 200);
  expect(sql[0]).toMatch(/ORDER BY ctime DESC,pk LIMIT \?$/);
  await expect(liveCacheCleanJob({ db, now: new Date(), execute: false, assertOwnership: async () => {} } as unknown as CacheContext, 201)).rejects.toThrow();
});

async function fixture(now: Date) {
  const env = isolatedTestEnv(), db = await mysql.createConnection({ host: env.DB_HOST, port: Number(env.DB_PORT), database: env.DB_DATABASE, user: env.DB_USERNAME, password: env.DB_PASSWORD, dateStrings: true, timezone: 'Z', charset: 'utf8mb4_bin' });
  await db.query("SET SESSION sql_mode='STRICT_ALL_TABLES'");
  for (const statement of (await readFile(new URL('../../jobs/migrations/008_report_cache_lineage.sql', import.meta.url), 'utf8')).split(';').map(s => s.trim()).filter(Boolean)) await db.query(statement);
  const id = 'B' + randomUUID().replaceAll('-', '').slice(0, 10), tag = 810000000 + Math.floor(Math.random() * 1000000), at = ago(now, 0), videos: string[] = [];
  const [insert] = await db.execute<mysql.ResultSetHeader>('INSERT INTO urt_channel(ctime,youtube_id,title,flag_del) VALUES(?,?,?,1)', [at, 'UC' + id, 'batch1 fixture']); const uid = insert.insertId;
  await db.execute('INSERT INTO urt_count(u_id,ctime,mtime,tags) VALUES(?,?,?,?)', [uid, at, '2000-01-01 00:00:00', `[${tag}]`]);
  const video = async (publishedAt: string, title: string, description: string, viewCount: number | null) => { const videoId = id + videos.length; videos.push(videoId); await db.execute('INSERT INTO urt_video(ctime,u_id,id,publishedAt,channelId,title,thumbnails,channelTitle,playlistId,position,videoId,description,viewCount) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)', [at, uid, videoId, publishedAt, 'UC' + id, title, '', 'fixture', 'UUfixture', 0, videoId, description, viewCount]); return videoId; };
  const ctx: CacheContext = { db, now, execute: true, assertOwnership: async () => {} };
  const cleanup = async () => {
    for (const table of ['urt_video_live', 'urt_video_log_history', 'urt_video_schedule', 'urt_show_video_live', 'urt_video']) await db.query(`DELETE FROM ${table} WHERE videoId IN (?)`, [videos.length ? videos : ['-']]);
    for (const table of ['urt_show_tag_date', 'urt_show_tag_cloud']) await db.execute(`DELETE FROM ${table} WHERE tagid=?`, [String(tag)]);
    await db.execute('DELETE FROM ts_tag_cache_lineage WHERE selection_key=?', [JSON.stringify([[tag], [], []])]);
    await db.execute('DELETE FROM ts_report_cache_lineage WHERE vocabulary_version IN (?,?)', ['batch1-fixture', 'laravel-tag-group']);
    await db.execute('DELETE FROM ts_cache_item_state WHERE item_key IN (?)', [[String(uid), ...videos]]);
    await db.execute('DELETE FROM tag_group WHERE group_name=?', ['G' + id]); await db.execute('DELETE FROM urt_log WHERE u_id=?', [uid]); await db.execute('DELETE FROM urt_count WHERE u_id=?', [uid]); await db.execute('DELETE FROM urt_channel WHERE u_id=?', [uid]); await db.end();
  };
  return { db, ctx, id, uid, tag, at, video, videos, cleanup, input: { from: at.slice(0, 10), to: at.slice(0, 10), days: 1, tagIds: [tag], orTagIds: [], notTagIds: [], channelLimit: 5, videoLimit: 50 } };
}
const uniqueNow = () => new Date(Date.UTC(2093, 0, 1, 2) + Math.floor(Math.random() * 300) * DAY + Math.floor(Math.random() * 60) * 60000);

it.skipIf(!enabled)('tag cloud writes every Laravel rolling period in one run, blocks only the oversized period, and uses urt_count markers', async () => {
  const now = uniqueNow(), f = await fixture(now); try {
    // 20 hours ago is "yesterday" on the calendar but inside Laravel's rolling 1-day window. The channel is flag_del=1 in urt_channel.
    await f.video(ago(now, 20 * HOUR), '台灣', 'AI', 10); await f.video(ago(now, 2 * DAY), '台灣', '', 20); await f.video(ago(now, 20 * DAY), 'x', 'AI', 30); await f.video(ago(now, 31 * DAY), '台灣', '', 40);
    const result = await tagCloudCacheJob(f.ctx, f.input, [1, 3, 30], dictionary);
    expect(result).toMatchObject({ applied: [1, 3, 30], skipped: [], channels: 1 });
    const rows = async () => Object.fromEntries((await f.db.query<RowDataPacket[]>('SELECT days,count_channels,count_videos,count_tags,tags_count,tags_result FROM urt_show_tag_cloud WHERE tagid=? ORDER BY days', [String(f.tag)]))[0].map(r => [r.days, r]));
    const first = await rows();
    expect([first[1]!.count_videos, first[3]!.count_videos, first[30]!.count_videos].map(Number)).toEqual([1, 2, 3]);
    expect(Number(first[30]!.count_channels)).toBe(1); expect(Object.keys(JSON.parse(first[3]!.tags_result))).toEqual(['台灣', 'AI']);
    await f.video(ago(now, 10 * DAY), '台灣', '', 50);
    const blocked = await tagCloudCacheJob(f.ctx, { ...f.input, videoLimit: 3 }, [1, 3, 30], dictionary);
    expect(blocked.applied).toEqual([1, 3]); expect(blocked.skipped).toEqual([{ days: 30, reason: 'video_scan_limit_exceeded' }]);
    expect(Number((await rows())[30]!.count_videos)).toBe(3);
  } finally { await f.cleanup(); }
});
it.skipIf(!enabled)('tags_all uses the 31-day calendar window with the Laravel 7-day recent window and keeps the old row when blocked', async () => {
  const now = uniqueNow(), f = await fixture(now); try {
    await f.db.execute('UPDATE urt_count SET tags=? WHERE u_id=?', [`[${f.tag}][13]`, f.uid]);
    const today = f.at.slice(0, 10), from = new Date(Date.parse(today) - 30 * DAY).toISOString().slice(0, 10), recentStart = new Date(Date.parse(today) - 7 * DAY).toISOString().slice(0, 10);
    const secondBefore = (day: string) => new Date(Date.parse(day) - 1000).toISOString().replace('T', ' ').slice(0, 19);
    // Recent = on/after the start of (today - 7 days); the 31-day window starts at today - 30 days.
    await f.video(recentStart + ' 00:00:00', '台灣', '', 5); await f.video(secondBefore(recentStart), '台灣', 'AI', 100); await f.video(from + ' 00:00:00', 'x', 'AI', 1); await f.video(secondBefore(from), '台灣', 'AI', 1000);
    await f.db.beginTransaction(); try {
      const input = { from, to: today, days: 31, recentDays: 7, tagIds: [], orTagIds: [1, 2, 13, 14], notTagIds: [], channelLimit: 5000, videoLimit: 50 };
      expect((await keywordsCacheJob(f.ctx, input, dictionary)).skipped).toEqual([]);
      const read = async () => (await f.db.query<RowDataPacket[]>("SELECT the_result,api,para FROM urt_show_data WHERE data_name='tags_all'"))[0][0]!;
      const row = await read();
      expect(row.the_result).toBe(JSON.stringify({ 台灣: { video: 1, video_all: 2, views: 5, views_all: 105 }, AI: { video: 0, video_all: 2, views: 0, views_all: 101 } }));
      expect([row.api, row.para]).toEqual(['api/tags_all.php', 'or=1,2,13,14']);
      const [lineage] = await f.db.query<RowDataPacket[]>("SELECT window_from,window_to FROM ts_report_cache_lineage WHERE cache_table='urt_show_data' AND vocabulary_version='batch1-fixture'");
      expect(lineage[0]).toMatchObject({ window_from: from, window_to: today });
      expect((await keywordsCacheJob(f.ctx, { ...input, videoLimit: 2 }, dictionary)).skipped).toEqual([{ reason: 'video_scan_limit_exceeded' }]);
      expect((await read()).the_result).toBe(row.the_result);
    } finally { await f.db.rollback(); }
  } finally { await f.cleanup(); }
});
it.skipIf(!enabled)('tag date blocks one over-cap date, writes stime and selects channels from urt_count markers', async () => {
  const now = uniqueNow(), f = await fixture(now); try {
    const today = f.at.slice(0, 10), yesterday = new Date(Date.parse(today) - DAY).toISOString().slice(0, 10);
    await f.video(today + ' 00:00:01', '台灣', '', 1); await f.video(yesterday + ' 10:00:00', '台灣', '', 1); await f.video(yesterday + ' 11:00:00', '台灣', '', 1);
    const result = await tagDateCacheJob(f.ctx, { ...f.input, from: yesterday, days: 2, videoLimit: 1 }, dictionary);
    expect(result.applied).toEqual([today]); expect(result.skipped).toEqual([{ date: yesterday, reason: 'video_scan_limit_exceeded' }]);
    const [rows] = await f.db.query<RowDataPacket[]>('SELECT the_date,stime,mtime,count_channels FROM urt_show_tag_date WHERE tagid=?', [String(f.tag)]);
    expect(rows).toHaveLength(1); expect(rows[0]).toMatchObject({ the_date: today, stime: f.at, mtime: f.at, count_channels: 1 });
    await expect(tagDateCacheJob(f.ctx, { ...f.input, from: yesterday, days: 2, dateLimit: 1 }, dictionary)).rejects.toThrow('date limit');
  } finally { await f.cleanup(); }
});
it.skipIf(!enabled)('counts keep previous deltas on stale history, bump mtime as cooldown, and write zeros for a single observation', async () => {
  const now = uniqueNow(), f = await fixture(now); try {
    const today = f.at.slice(0, 10), month = taipeiSql(new Date(now.getTime() - 31 * DAY)).slice(0, 7) + '-01';
    await f.db.execute('UPDATE urt_count SET view_week=111,sub_week=7,view_month=222,sub_month=8 WHERE u_id=?', [f.uid]);
    expect((await countsCacheJob(f.ctx, { uId: f.uid, limit: 1 })).selected).toBe(0);
    await f.db.execute('INSERT INTO urt_log(ctime,u_id,themonth,thedata) VALUES(?,?,?,?)', [f.at, f.uid, month, JSON.stringify({ [new Date(Date.parse(today) - 40 * DAY).toISOString().slice(0, 10)]: { view: 1, video: 1, subscriber: 1 } })]);
    const stale = await countsCacheJob(f.ctx, { uId: f.uid, limit: 1 });
    expect(stale.skipped).toEqual([{ uId: f.uid, reason: 'invalid_log_payload' }]);
    const read = async () => { const r = (await f.db.query<RowDataPacket[]>('SELECT mtime,view_week,sub_week,video_week,view_month,sub_month FROM urt_count WHERE u_id=?', [f.uid]))[0][0]!; return { ...r, ...Object.fromEntries(['view_week', 'sub_week', 'video_week', 'view_month', 'sub_month'].map(k => [k, r[k] === null ? null : Number(r[k])])) }; };
    expect(await read()).toMatchObject({ mtime: f.at, view_week: 111, sub_week: 7, view_month: 222 });
    await f.db.execute('INSERT INTO urt_log(ctime,u_id,themonth,thedata) VALUES(?,?,?,?)', [f.at, f.uid, today.slice(0, 7) + '-01', JSON.stringify({ [today]: { view: 100, video: 5, hidden: true } })]);
    expect((await countsCacheJob(f.ctx, { uId: f.uid, limit: 1 })).applied).toEqual([f.uid]);
    expect(await read()).toMatchObject({ view_week: 0, video_week: 0, view_month: 0, sub_week: 7, sub_month: 8 });
  } finally { await f.cleanup(); }
});
it.skipIf(!enabled)('schedule only recalculates rows refreshed in the last hour and sets mtime to now', async () => {
  const now = uniqueNow(), f = await fixture(now); try {
    const recent = await f.video(ago(now, 5 * HOUR), 'x', '', 1), old = await f.video(ago(now, 5 * HOUR), 'x', '', 1), broken = await f.video(ago(now, 5 * HOUR), 'x', '', 1);
    for (const [videoId, mtime] of [[recent, ago(now, 30 * 60000)], [old, ago(now, 2 * HOUR)], [broken, ago(now, 10 * 60000)]] as const) {
      await f.db.execute('INSERT INTO urt_video_schedule(ctime,mtime,stime,publishedAt,videoId) VALUES(?,?,?,?,?)', [f.at, mtime, '2000-01-01 00:00:00', ago(now, 5 * HOUR), videoId]);
      await f.db.execute('INSERT INTO urt_video_log_history(ctime,videoId,viewCount,likeCount,dislikeCount,favoriteCount,commentCount) VALUES(?,?,?,0,0,0,0)', [ago(now, HOUR), videoId, 4000]);
    }
    // Newest history row (by pk) observed before the previous one: Laravel's period is <= 0, so the row is invalid.
    await f.db.execute('INSERT INTO urt_video_log_history(ctime,videoId,viewCount,likeCount,dislikeCount,favoriteCount,commentCount) VALUES(?,?,?,0,0,0,0)', [ago(now, 2 * HOUR), broken, 5000]);
    expect((await scheduleCacheJob(f.ctx, { videoId: old, limit: 1 })).selected).toBe(0);
    expect((await scheduleCacheJob(f.ctx, { videoId: recent, limit: 1 })).applied).toEqual([recent]);
    const read = async (videoId: string) => (await f.db.query<RowDataPacket[]>('SELECT mtime,stime FROM urt_video_schedule WHERE BINARY videoId=BINARY ?', [videoId]))[0][0]!;
    // 4000 views over 4h+1s since publishedAt → 1000 views per ~1h → floored to 2h after the source mtime.
    expect(await read(recent)).toEqual({ mtime: f.at, stime: taipeiSql(new Date(now.getTime() - 30 * 60000 + 2 * HOUR)) });
    expect((await scheduleCacheJob(f.ctx, { videoId: broken, limit: 1 })).skipped).toEqual([{ videoId: broken, reason: 'invalid_history_payload' }]);
    expect(await read(broken)).toEqual({ mtime: f.at, stime: '2000-01-01 00:00:00' });
  } finally { await f.cleanup(); }
});
it.skipIf(!enabled)('people rotate tag_group names and merge them into urt_show_tag_date without touching other names or totals', async () => {
  const now = uniqueNow(), f = await fixture(now); try {
    const today = f.at.slice(0, 10), yesterday = new Date(Date.parse(today) - DAY).toISOString().slice(0, 10), [p1, p2, p3] = ['甲' + f.id, '乙' + f.id, '丙' + f.id], group = 'G' + f.id;
    for (const [tag, hours] of [[p1, 1], [p2, 2], [p3, 3]] as const) await f.db.execute('INSERT INTO tag_group(ctime,latest_time,tag,group_name) VALUES(?,?,?,?)', [f.at, ago(now, hours * HOUR), tag, group]);
    await f.video(today + ' 01:00:00', `${p1}與${p2}`, p1, 10); await f.video(today + ' 02:00:00', 'other', '', 5);
    await f.db.execute('INSERT INTO urt_show_tag_date(ctime,mtime,the_date,tagid,count_videos,total_views,count_channels,tags_result,tags_video,tags_views) VALUES(?,?,?,?,?,?,?,?,?,?)', ['2000-01-01 00:00:00', '2000-01-01 00:00:00', today, String(f.tag), 99, 999, 9, JSON.stringify({ 其他: '9.000', [p2]: '0.100' }), JSON.stringify({ 其他: 4, [p3]: 7 }), JSON.stringify({ 其他: 40 })]);
    const input = { group, tagId: f.tag, days: 2, limit: 2, offset: 0, keywordLimit: 5000, channelLimit: 1000, videoLimit: 10000 } as const;
    const run = await peopleCacheJob(f.ctx, input);
    expect(run).toMatchObject({ people: [p1, p2], applied: [yesterday, today], skipped: [], nextOffset: 2 });
    const [rows] = await f.db.query<RowDataPacket[]>('SELECT * FROM urt_show_tag_date WHERE tagid=? ORDER BY the_date', [String(f.tag)]);
    const score = (n: number, name: string) => (n * (Math.log([...name].length + 0.5) - 0.5)).toFixed(3);
    expect(rows[0]).toMatchObject({ the_date: yesterday, count_videos: 0, total_views: 0, tags_count: 0, tags_result: '[]', ctime: f.at, stime: f.at });
    expect(rows[1]).toMatchObject({ the_date: today, count_videos: 99, total_views: 999, count_channels: 9, tags_count: 3, mtime: f.at, stime: f.at, ctime: '2000-01-01 00:00:00' });
    expect(rows[1]!.tags_result).toBe(JSON.stringify({ 其他: '9.000', [p1]: score(3, p1), [p2]: score(2, p2) }));
    expect(rows[1]!.tags_video).toBe(JSON.stringify({ [p3]: 7, 其他: 4, [p1]: 1, [p2]: 1 }));
    expect(rows[1]!.tags_views).toBe(JSON.stringify({ 其他: 40, [p1]: 10, [p2]: 10 }));
    const [lineage] = await f.db.query<RowDataPacket[]>('SELECT status,rule_version FROM ts_tag_cache_lineage WHERE selection_key=? AND the_date=?', [JSON.stringify([[f.tag], [], []]), today]);
    expect(lineage[0]).toEqual({ status: 'published', rule_version: 'laravel-substr-title2-merge-v1' });
    expect(await peopleCacheJob({ ...f.ctx, execute: false }, { ...input, offset: 2 })).toMatchObject({ people: [p3, p1], wrapped: true, applied: [] });
  } finally { await f.cleanup(); }
});
it.skipIf(!enabled)('live display cache takes the newest live rows first and orphans never consume the limit', async () => {
  const now = uniqueNow(), f = await fixture(now); try {
    const older = await f.video(ago(now, HOUR), 'old', '', 1), newer = await f.video(ago(now, HOUR), 'new', '', 1), orphan = f.id + 'orphan'; f.videos.push(orphan);
    for (const [videoId, minutes] of [[older, 30], [newer, 10], [orphan, 5]] as const) await f.db.execute('INSERT INTO urt_video_live(ctime,publishedAt,videoId,u_id) VALUES(?,?,?,?)', [ago(now, minutes * 60000), ago(now, HOUR), videoId, f.uid]);
    const result = await liveDisplayCacheJob(f.ctx, { hours: 1, limit: 1 });
    const [rows] = await f.db.query<RowDataPacket[]>('SELECT l.videoId FROM urt_show_video_live s JOIN urt_video_live l ON l.pk=s.pk_live WHERE l.videoId IN (?)', [[older, newer, orphan]]);
    expect(rows.map(r => r.videoId)).toEqual([newer]); expect(result.skipped).toHaveLength(1); expect(result.truncated).toBe(true);
    await expect(liveDisplayCacheJob(f.ctx, { hours: 1, limit: 101 })).rejects.toThrow();
  } finally { await f.db.query('DELETE s FROM urt_show_video_live s JOIN urt_video_live l ON l.pk=s.pk_live WHERE l.videoId IN (?)', [f.videos]); await f.cleanup(); }
});
