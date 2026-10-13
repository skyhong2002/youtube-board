import { expect, it, vi } from 'vitest';
import type { Connection, RowDataPacket } from 'mysql2/promise';
import { publishVideoStatistics, videoStatisticsJob } from '../src/video-statistics.js';
import { YoutubeDataApiClient, type VideoStatistics } from '../src/youtube.js';

const now = new Date('2026-10-13T02:00:00Z');
const stats = (viewCount: number): VideoStatistics => ({ viewCount, likeCount: null, dislikeCount: 0, favoriteCount: null, commentCount: null });

/** One synthetic identity per table. This is a publisher control-flow mock, not a SQL engine. */
function source(logData?: string, failTable?: string) {
  const video = { pk: 1, videoId: 'Abc12345678', publishedAt: '2026-10-12 10:00:00', viewCount: null, likeCount: null, favoriteCount: null, commentCount: null, mtime: null, stime: null };
  const tables: Record<string, Record<string, unknown>[]> = {
    urt_video: [video], urt_video_schedule: [], urt_video_log_history: [],
    urt_video_log: logData === undefined ? [] : [{ pk: 2, videoId: video.videoId, themonth: '2026-10-01', thedata: logData }],
  };
  const query = vi.fn(async (sql: string) => {
    const table = /^SELECT \* FROM `([a-z_]+)` WHERE /.exec(sql)?.[1];
    if (!table || !tables[table]) throw new Error('Unexpected mock SELECT');
    return [tables[table]!.map(row => ({ ...row })), []];
  });
  const execute = vi.fn(async (sql: string, values: unknown[]) => {
    const table = /^(?:UPDATE|INSERT INTO) `([a-z_]+)`/.exec(sql)?.[1];
    if (!table || !tables[table]) throw new Error('Unexpected mock write');
    if (table === failTable) throw new Error('Synthetic write failure');
    const insert = sql.startsWith('INSERT');
    const columns = insert ? [...sql.slice(sql.indexOf('('), sql.indexOf(')')).matchAll(/`([a-zA-Z_]+)`/g)].map(m => m[1]!) : [...sql.split(' SET ')[1]!.split(' WHERE ')[0]!.matchAll(/`([a-zA-Z_]+)` = \?/g)].map(m => m[1]!);
    const changes = Object.fromEntries(columns.map((column, i) => [column, values[i]]));
    if (insert) tables[table]!.push({ pk: 10, ...changes });
    else Object.assign(tables[table]![0]!, changes);
    return [{ affectedRows: 1 }, []];
  });
  return { db: { query, execute } as unknown as Connection, row: video as unknown as RowDataPacket, tables, query, execute };
}

it('fills a source NULL with a valid count while optional metrics and NOT NULL history remain unavailable', async () => {
  const fixture = source();
  await publishVideoStatistics(fixture.db, fixture.row, stats(123), now);
  expect(fixture.tables.urt_video![0]).toMatchObject({ viewCount: 123, likeCount: null, favoriteCount: null, commentCount: null, mtime: '2026-10-13 10:00:00' });
  expect(fixture.tables.urt_video_schedule![0]?.viewCount).toBe(123);
  expect(fixture.tables.urt_video_log_history).toEqual([]);
  expect(JSON.parse(String(fixture.tables.urt_video_log![0]?.thedata))).toEqual({ '2026-10-13': { view: 123, dislike: 0 } });
});

it('writes a measured zero to source and schedule despite the omitted zero-only monthly point', async () => {
  const fixture = source();
  await publishVideoStatistics(fixture.db, fixture.row, stats(0), now);
  expect(fixture.tables.urt_video![0]?.viewCount).toBe(0);
  expect(fixture.tables.urt_video_schedule![0]?.viewCount).toBe(0);
  expect(JSON.parse(String(fixture.tables.urt_video_log![0]?.thedata))).toEqual({});
});

it.each(['{broken', 'null', '42', '[1]'])('retains source NULL and freshness when monthly JSON is rejected: %s', async log => {
  const fixture = source(log);
  await expect(publishVideoStatistics(fixture.db, fixture.row, stats(123), now)).rejects.toThrow();
  expect(fixture.execute).not.toHaveBeenCalled();
  expect(fixture.tables.urt_video![0]).toMatchObject({ viewCount: null, mtime: null, stime: null });
});

it.each(['urt_video_log', 'urt_video_log_history'])('a failed %s write preserves source NULL and freshness', async table => {
  const fixture = source(undefined, table);
  const observation = table === 'urt_video_log_history' ? { ...stats(123), likeCount: 0, favoriteCount: 0, commentCount: 0 } : stats(123);
  await expect(publishVideoStatistics(fixture.db, fixture.row, observation, now)).rejects.toThrow('Synthetic write failure');
  expect(fixture.tables.urt_video![0]).toMatchObject({ viewCount: null, mtime: null, stime: null });
  expect(fixture.tables.urt_video_schedule).toEqual([]);
  expect(fixture.execute.mock.calls.some(([sql]) => sql.startsWith('UPDATE `urt_video`'))).toBe(false);
});

it('API parsing omits absent/invalid views and invalid present optional counts, while retaining known zero', async () => {
  const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ items: [
    { id: 'Missing', statistics: {} }, { id: 'Null', statistics: { viewCount: null } },
    { id: 'Negative', statistics: { viewCount: '-1' } }, { id: 'Unsafe', statistics: { viewCount: '9007199254740992' } },
    { id: 'BadOptional', statistics: { viewCount: '123', likeCount: 'invalid' } }, { id: 'Zero', statistics: { viewCount: '0' } },
  ] }), { status: 200 }));
  const api = new YoutubeDataApiClient({ keys: ['synthetic-key'], fetcher, now: () => now, ledger: { precharge: vi.fn().mockResolvedValue('2026-10-12'), markDailyExhausted: vi.fn() } });
  const observations = await api.videoStatistics(['Missing', 'Null', 'Negative', 'Unsafe', 'BadOptional', 'Zero']);
  expect([...observations.entries()]).toEqual([['Zero', stats(0)]]);
  expect(fetcher).toHaveBeenCalledOnce(); // Supplied fetch stub; no external HTTP.
});

it.each([
  { today: true, table: 'urt_video', from: '2026-10-06 10:00:00' },
  { today: false, table: 'urt_video_schedule', from: '2026-03-17 10:00:00' },
])('dry-run selection binds the $table source and its eligibility window', async ({ today, table, from }) => {
  const query = vi.fn().mockResolvedValue([[], []]);
  const assertOwnership = vi.fn();
  const youtube = { videoStatistics: vi.fn() } as unknown as YoutubeDataApiClient;
  await videoStatisticsJob({ db: { query } as unknown as Connection, youtube, execute: false, now, assertOwnership }, { today, limit: 50 });
  const [sql, bindings] = query.mock.calls[0]!;
  expect(sql).toContain(`FROM ${table} v`);
  expect(sql).toContain('(v.stime IS NULL OR v.stime <= ?)');
  expect(sql).toContain('v.publishedAt >= ? AND v.publishedAt < ?');
  expect(sql.includes('v.viewCount IS NULL')).toBe(today);
  expect(bindings).toEqual(['2026-10-13 10:00:00', from, '2026-10-13 08:00:00', '2026-10-13 10:00:00', 50]);
  expect(youtube.videoStatistics).not.toHaveBeenCalled();
  expect(assertOwnership).not.toHaveBeenCalled();
});
