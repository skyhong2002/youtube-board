import { it, expect, describe, afterAll } from 'vitest';
import mysql, { type Connection, type RowDataPacket, type ResultSetHeader } from 'mysql2/promise';
import { randomUUID } from 'node:crypto';
import { isolatedTestEnv } from '../../shared/test-database.js';
import { commentQueueChannelFilter, commentQueueJob, commentFetchJob } from '../src/comments.js';
import { YoutubeDataApiClient } from '../src/youtube.js';
import type { SourceJobContext } from '../src/video-statistics.js';

// Laravel parity for youtube.comments.queue / youtube.comments.fetch (batch 3 of the scheduler handoff).
describe('comment queue channel filter (Laravel LegacyTagFilter::matchingChannelTags)', () => {
  it('ORs --or tags, ANDs --tagid, excludes --not and always requires a urt_count channel', () => {
    expect(commentQueueChannelFilter({ orTagIds: [1, 2, 81] })).toEqual({ sql: 'v.u_id IN (SELECT n.u_id FROM urt_count n WHERE (n.tags LIKE ? OR n.tags LIKE ? OR n.tags LIKE ?))', params: ['%[1]%', '%[2]%', '%[81]%'] });
    expect(commentQueueChannelFilter({ tagIds: [13, 14], notTagIds: [31] })).toEqual({ sql: 'v.u_id IN (SELECT n.u_id FROM urt_count n WHERE n.tags LIKE ? AND n.tags LIKE ? AND n.tags NOT LIKE ?)', params: ['%[13]%', '%[14]%', '%[31]%'] });
    expect(commentQueueChannelFilter({})).toEqual({ sql: 'v.u_id IN (SELECT n.u_id FROM urt_count n)', params: [] });
    expect(() => commentQueueChannelFilter({ orTagIds: Array.from({ length: 21 }, (_, i) => i + 1) })).toThrow('Too many');
  });
  it('orders candidates like Laravel (publishedAt DESC, videoId) without a urt_channel join', async () => {
    const seen: { sql: string; params: unknown[] }[] = [];
    const db = { query: async (sql: string, params: unknown[]) => { seen.push({ sql, params }); return [[]]; } } as unknown as Connection;
    await commentQueueJob({ db, now: new Date('2026-10-18T02:23:00Z'), execute: false, assertOwnership: async () => {}, youtube: {} as never }, { orTagIds: [1, 2, 3, 4, 5, 6, 13, 14, 81], hours: 72, min: 500, limit: 5 });
    expect(seen[0]!.sql).toContain('ORDER BY v.publishedAt DESC,v.videoId LIMIT ?');
    expect(seen[0]!.sql).not.toContain('urt_channel');
    expect(seen[0]!.params).toEqual(['2026-10-15 10:23:00', 500, 500, '%[1]%', '%[2]%', '%[3]%', '%[4]%', '%[5]%', '%[6]%', '%[13]%', '%[14]%', '%[81]%', 6]);
  });
});

const enabled = process.env.INGESTION_DB_TEST === '1', now = new Date('2026-10-12T02:00:00Z');
const uid = () => 'T' + randomUUID().replaceAll('-', '').slice(0, 10);
async function connect() { const env = isolatedTestEnv(); return mysql.createConnection({ host: env.DB_HOST, port: Number(env.DB_PORT), database: env.DB_DATABASE, user: env.DB_USERNAME, password: env.DB_PASSWORD, timezone: 'Z', dateStrings: true, supportBigNumbers: true, bigNumberStrings: true }); }

// Remove this file's synthetic channels so later DB suites (media sweep, evidence batches) see a clean source.
afterAll(async () => {
  if (process.env.INGESTION_DB_TEST !== '1') return;
  const db = await connect();
  try {
    const ids = `SELECT u_id FROM urt_channel WHERE title='parity test'`;
    for (const table of ['urt_count', 'urt_video', 'urt_video_schedule', 'urt_video_live']) await db.query(`DELETE FROM ${table} WHERE u_id IN (SELECT u_id FROM (${ids}) t)`).catch(() => undefined);
    await db.query(`DELETE FROM urt_channel WHERE title='parity test'`);
  } finally { await db.end(); }
});
function context(db: Connection, handler: (url: URL) => unknown, calls: string[] = []): SourceJobContext {
  return { db, now, execute: true, assertOwnership: async () => {}, youtube: new YoutubeDataApiClient({ keys: ['fake-key'], ledger: { precharge: async () => '2026-10-11', markDailyExhausted: async () => {} }, now: () => now, fetcher: async url => { calls.push(String(url)); return new Response(JSON.stringify(handler(new URL(String(url))))); } }) };
}
async function channel(db: Connection, youtubeId: string, tags = '[1]') { const [result] = await db.execute<ResultSetHeader>('INSERT INTO urt_channel (ctime,youtube_id,uploads,title,subscriberCount) VALUES (?,?,?,?,?)', ['2026-09-01 00:00:00', youtubeId, 'UU' + youtubeId, 'parity test', 7]); await db.execute('INSERT INTO urt_count (u_id,ctime,tags) VALUES (?,?,?)', [result.insertId, '2026-09-01 00:00:00', tags]); return result.insertId; }
async function video(db: Connection, id: string, uId: number, youtubeId: string, publishedAt = '2026-10-11 11:00:00') { await db.execute('INSERT INTO urt_video (ctime,u_id,id,publishedAt,channelId,title,thumbnails,channelTitle,playlistId,position,videoId,description,viewCount,commentCount) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)', ['2026-10-11 10:00:00', uId, id, publishedAt, youtubeId, 'test', '', 'channel', 'UU' + youtubeId, 0, id, 'test description', 500, 500]); }
async function clean(db: Connection, uIds: number[], ids: string[], authors: string[] = []) {
  for (const id of authors) { const [rows] = await db.query<RowDataPacket[]>('SELECT author_id FROM urt_comment_author WHERE BINARY ChannelId=BINARY ?', [id]); for (const row of rows) await db.execute('DELETE FROM urt_comment_rev WHERE author_id=?', [row.author_id]); await db.execute('DELETE FROM urt_comment_author WHERE BINARY ChannelId=BINARY ?', [id]); }
  for (const id of ids) {
    await db.execute('DELETE FROM ts_comment_stages WHERE video_id=?', [id]);
    await db.execute('DELETE FROM ts_youtube_item_backoff WHERE video_id=?', [id]);
    for (const table of ['urt_comment', 'urt_comment_queue', 'urt_comment_queue_done', 'urt_video']) await db.execute(`DELETE FROM ${table} WHERE BINARY videoId=BINARY ?`, [id]);
  }
  for (const uId of uIds) for (const table of ['urt_count', 'urt_channel']) await db.execute(`DELETE FROM ${table} WHERE u_id=?`, [uId]);
}
const snippet = (author: string, extra: Record<string, unknown> = {}) => ({ authorChannelId: { value: author }, authorDisplayName: 'new name', authorProfileImageUrl: 'https://example.test/new', textDisplay: '留言', textOriginal: '留言', publishedAt: '2026-10-12T01:00:00Z', updatedAt: '2026-10-12T01:00:00Z', ...extra });

it.skipIf(!enabled)('scheduled --or queue matches any listed tag and skips channels without them', async () => {
  const db = await connect(), a = uid(), b = uid(), ua = await channel(db, a, '[81][102]'), ub = await channel(db, b, '[31]'), va = uid(), vb = uid();
  try {
    await video(db, va, ua, a); await video(db, vb, ub, b);
    const ctx = { ...context(db, () => ({})), now: new Date('2026-10-11T04:00:00Z') };
    const result = await commentQueueJob(ctx, { orTagIds: [1, 2, 3, 4, 5, 6, 13, 14, 81], hours: 72, min: 500, limit: 20 });
    expect(result.applied).toContain(va); expect(result.applied).not.toContain(vb);
  } finally { await clean(db, [ua, ub], [va, vb]); await db.end(); }
});

it.skipIf(!enabled)('publication keeps existing author profiles, appends the reverse index once and keeps a missing channel URL NULL in authors_json', async () => {
  const db = await connect(), id = uid(), uId = await channel(db, id), vid = uid(), known = uid(), fresh = uid();
  try {
    await video(db, vid, uId, id);
    const [r] = await db.execute<ResultSetHeader>('INSERT INTO urt_comment_author (ctime,ChannelId,ChannelUrl,ImageUrl,DisplayName) VALUES (?,?,?,?,?)', ['2026-10-01 00:00:00', known, 'https://old', 'https://old/img', 'old name']);
    await db.execute('INSERT INTO urt_comment_rev (author_id,ctime,index_json,videos) VALUES (?,?,?,?)', [r.insertId, '2026-10-01 00:00:00', '["X1","X1"]', 2]);
    const ctx = context(db, () => ({ items: [
      { id: 'THREAD1', snippet: { videoId: vid, totalReplyCount: 0, topLevelComment: { id: 'TOP1', snippet: snippet(known, { likeCount: 2 }) } } },
      { id: 'THREAD2', snippet: { videoId: vid, channelId: id, totalReplyCount: 0, topLevelComment: { id: 'TOP2', snippet: snippet(fresh) } } },
    ] }));
    await commentQueueJob(ctx, { videoId: vid, limit: 1, hours: 24, min: 0 });
    expect((await commentFetchJob(ctx, { videoId: vid, limit: 1, maxPages: 1, maxReplyPages: 1 })).applied[0]?.complete).toBe(true);
    const [authors] = await db.query<RowDataPacket[]>('SELECT ChannelId,DisplayName,ChannelUrl,mtime FROM urt_comment_author WHERE ChannelId IN (?,?) ORDER BY author_id', [known, fresh]);
    expect(authors[0]).toMatchObject({ DisplayName: 'old name', ChannelUrl: 'https://old', mtime: null });
    expect(authors[1]).toMatchObject({ DisplayName: 'new name', ChannelUrl: '' });
    const [rev] = await db.query<RowDataPacket[]>('SELECT index_json,videos FROM urt_comment_rev WHERE author_id=?', [r.insertId]);
    expect(JSON.parse(rev[0]!.index_json)).toEqual(['X1', 'X1', vid]); expect(Number(rev[0]!.videos)).toBe(3);
    const [rows] = await db.query<RowDataPacket[]>('SELECT likes_count,channelId,u_id,authors_json FROM urt_comment WHERE videoId=?', [vid]);
    expect(rows[0]).toMatchObject({ channelId: id }); expect(Number(rows[0]!.u_id)).toBe(uId); expect(Number(rows[0]!.likes_count)).toBe(2);
    expect(JSON.parse(rows[0]!.authors_json)[fresh].ChannelUrl).toBeNull();
  } finally { await clean(db, [uId], [vid], [known, fresh]); await db.end(); }
});

it.skipIf(!enabled)('a video without comment threads keeps NULL channel fields like Laravel', async () => {
  const db = await connect(), id = uid(), uId = await channel(db, id), vid = uid();
  try {
    await video(db, vid, uId, id);
    const ctx = context(db, () => ({ items: [] }));
    await commentQueueJob(ctx, { videoId: vid, limit: 1, hours: 24, min: 0 });
    expect((await commentFetchJob(ctx, { videoId: vid, limit: 1, maxPages: 1, maxReplyPages: 1 })).applied[0]?.complete).toBe(true);
    const [rows] = await db.query<RowDataPacket[]>('SELECT channelId,u_id,comments_count FROM urt_comment WHERE videoId=?', [vid]);
    expect(rows[0]).toMatchObject({ channelId: null, u_id: null }); expect(Number(rows[0]!.comments_count)).toBe(0);
  } finally { await clean(db, [uId], [vid]); await db.end(); }
});

it.skipIf(!enabled)('a cache completed within three hours finishes the queue row without YouTube calls', async () => {
  const db = await connect(), id = uid(), uId = await channel(db, id), vid = uid(), calls: string[] = [];
  try {
    await video(db, vid, uId, id);
    await db.execute("INSERT INTO urt_comment (videoId,ctime,mtime,stime,pageToken,comments_json) VALUES (?,?,?,?,'','{}')", [vid, '2026-10-12 09:00:00', '2026-10-12 09:00:00', '2026-10-12 09:00:00']);
    const ctx = context(db, () => { throw new Error('no YouTube call expected'); }, calls);
    await db.execute('INSERT INTO urt_comment_queue (videoId,ctime) VALUES (?,?)', [vid, '2026-10-12 09:30:00']);
    const result = await commentFetchJob(ctx, { videoId: vid, limit: 1, maxPages: 1, maxReplyPages: 1 });
    expect(result.applied[0]).toMatchObject({ complete: true, recentCache: true, pages: 0 }); expect(calls).toHaveLength(0);
    const [queue] = await db.query<RowDataPacket[]>('SELECT pk FROM urt_comment_queue WHERE videoId=?', [vid]); expect(queue).toHaveLength(0);
    const [done] = await db.query<RowDataPacket[]>('SELECT ftime FROM urt_comment_queue_done WHERE videoId=?', [vid]); expect(done[0]?.ftime).toBe('2026-10-12 10:00:00');
    const [comment] = await db.query<RowDataPacket[]>('SELECT mtime FROM urt_comment WHERE videoId=?', [vid]); expect(comment[0]?.mtime).toBe('2026-10-12 09:00:00');
  } finally { await clean(db, [uId], [vid]); await db.end(); }
});
