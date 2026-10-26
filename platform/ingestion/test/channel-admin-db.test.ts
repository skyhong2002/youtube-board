import { readFileSync } from 'node:fs';
import mysql, { type Connection, type RowDataPacket } from 'mysql2/promise';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { channelAdminJob } from '../src/channel-admin.js';
import type { SourceJobContext } from '../src/video-statistics.js';
import type { ChannelProfile } from '../src/youtube.js';

// Runs the job against a real MariaDB so transactions, row locks and the SQL itself are exercised, which the scripted
// fake in channel-admin.test.ts cannot. Needs a throwaway server, e.g.
//   docker run --rm -d -e MARIADB_ROOT_PASSWORD=x -p 127.0.0.1:23999:3306 mariadb:11.4
//   INGESTION_DB_TEST_URL=mysql://root:x@127.0.0.1:23999 npx vitest run test/channel-admin-db.test.ts
// It drops and recreates its own database, so only a loopback server is accepted.
const url = process.env.INGESTION_DB_TEST_URL, DATABASE = 'yb_channel_admin_it';
const enabled = Boolean(url) && ['127.0.0.1', 'localhost', '::1'].includes(new URL(url!).hostname);
const UC = 'UCnewnewnewnewnewnewnew1', now = new Date('2026-10-26T20:00:00Z');
const profile: ChannelProfile = { id: UC, title: '新頻道 🎉', description: '第一行\n第二行', uploads: 'UU' + UC.slice(2), publishedAt: '2020-01-02T03:04:05Z', thumbnail: 'https://yt3.ggpht.com/a', statistics: { viewCount: 10, videoCount: 2, subscriberCount: null, hiddenSubscriberCount: true } };

describe.skipIf(!enabled)('channelAdminJob on a real database', () => {
  let db: Connection;
  const ctx = () => ({ db, now, clock: () => now, execute: true, assertOwnership: async () => {},
    youtube: { attemptsMade: 0, channelProfiles: async (ids: string[]) => new Map(ids.filter(id => id === UC).map(id => [id, profile])), channelIdForHandle: async (handle: string) => handle === '@new.channel' ? UC : null } } as unknown as SourceJobContext);
  const rows = async <T = RowDataPacket>(sql: string, params: unknown[] = []) => (await db.query<RowDataPacket[]>(sql, params))[0] as unknown as T[];
  const enqueue = async (kind: string, payload: unknown) => { const [r] = await db.execute<mysql.ResultSetHeader>("INSERT INTO ts_channel_admin_requests (request_id, kind, actor, payload, created_at) VALUES (UUID(), ?, 'user:1', ?, UTC_TIMESTAMP())", [kind, JSON.stringify(payload)]); return r.insertId; };
  const request = async (id: number) => (await rows<RowDataPacket>('SELECT status, error_code, result, applied_at FROM ts_channel_admin_requests WHERE id = ?', [id]))[0]!;

  beforeAll(async () => {
    const root = await mysql.createConnection({ uri: url!, multipleStatements: true });
    await root.query(`DROP DATABASE IF EXISTS ${DATABASE}; CREATE DATABASE ${DATABASE} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    await root.end();
    db = await mysql.createConnection({ uri: url!, database: DATABASE, multipleStatements: true, dateStrings: true });
    await db.query(readFileSync(new URL('./fixtures/channel-admin-schema.sql', import.meta.url), 'utf8'));
  });
  afterAll(async () => { if (db) { await db.query(`DROP DATABASE IF EXISTS ${DATABASE}`); await db.end(); } });
  beforeEach(async () => {
    await db.query("DELETE FROM ts_channel_admin_requests; DELETE FROM urt_tag_log; DELETE FROM urt_count; DELETE FROM urt_channel; DELETE FROM urt_tag;");
    await db.query("ALTER TABLE urt_channel AUTO_INCREMENT = 1; ALTER TABLE urt_tag AUTO_INCREMENT = 1");
    await db.query("INSERT INTO urt_tag (ctime, tag_name, del_flag) VALUES ('2020-01-01 00:00:00','社論',NULL),('2020-01-01 00:00:00','泛藍',NULL),('2020-01-01 00:00:00','已停用',1)");
    await db.query("INSERT INTO urt_channel (ctime, youtube_id, title) VALUES ('2026-01-01 00:00:00','UCexistexistexistexist01','既有頻道')");
    await db.query("INSERT INTO urt_count (u_id, ctime, tags) VALUES (1,'2026-01-01 00:00:00','[1]')");
  });

  it('edits tags like the legacy site did: appended marker, cut marker, a log row per real change, request done', async () => {
    const id = await enqueue('set-tags', { uId: 1, add: [2], remove: [1] });
    const result = await channelAdminJob(ctx(), { limit: 10 });
    expect(result.applied).toHaveLength(1);
    expect((await rows('SELECT tags FROM urt_count WHERE u_id = 1'))[0]!.tags).toBe('[2]');
    expect(await rows('SELECT u_id, tag_id, log_type, ctime FROM urt_tag_log ORDER BY pk')).toEqual([
      { u_id: 1, tag_id: 2, log_type: 'add', ctime: '2026-10-27 04:00:00' }, { u_id: 1, tag_id: 1, log_type: 'del', ctime: '2026-10-27 04:00:00' }]);
    const done = await request(id);
    expect(done).toMatchObject({ status: 'done', error_code: null, applied_at: '2026-10-26 20:00:00' });
    expect(JSON.parse(done.result)).toEqual({ uId: 1, before: '[1]', after: '[2]', added: [2], removed: [1] });
  });

  it('keeps an emptied channel as an empty string, not NULL', async () => {
    await enqueue('set-tags', { uId: 1, add: [], remove: [1] });
    await channelAdminJob(ctx(), { limit: 10 });
    expect((await rows('SELECT tags FROM urt_count WHERE u_id = 1'))[0]!.tags).toBe('');
  });

  it('refuses a retired or unknown tag and a full column, changes nothing, and still finishes the batch', async () => {
    await db.query("UPDATE urt_count SET tags = ? WHERE u_id = 1", [Array.from({ length: 19 }, (_, i) => `[${100 + i}]`).join('') + '[1]']);
    const retired = await enqueue('set-tags', { uId: 1, add: [3], remove: [] }), unknown = await enqueue('set-tags', { uId: 1, add: [999], remove: [] });
    const full = await enqueue('set-tags', { uId: 1, add: [2], remove: [] }), missing = await enqueue('set-tags', { uId: 77, add: [2], remove: [] });
    const ok = await enqueue('create-tag', { name: '新分類' });
    const result = await channelAdminJob(ctx(), { limit: 10 });
    expect(result.rejected.map(r => r.code)).toEqual(['TAG_NOT_FOUND', 'TAG_NOT_FOUND', 'TAGS_TOO_LONG', 'CHANNEL_NOT_FOUND']);
    expect((await rows('SELECT tags FROM urt_count WHERE u_id = 1'))[0]!.tags).toHaveLength(98);
    expect(await rows('SELECT * FROM urt_tag_log')).toEqual([]);
    expect([retired, unknown, full, missing].map(async id => (await request(id)).status)).toHaveLength(4);
    for (const id of [retired, unknown, full, missing]) expect((await request(id)).status).toBe('failed');
    expect((await request(ok)).status).toBe('done');
  });

  it('creates a category once and returns the same one for the same name', async () => {
    const first = await enqueue('create-tag', { name: '新分類' }), second = await enqueue('create-tag', { name: '新分類' });
    await channelAdminJob(ctx(), { limit: 10 });
    const [a, b] = [JSON.parse((await request(first)).result), JSON.parse((await request(second)).result)];
    expect(a).toEqual({ tagId: 4, name: '新分類', created: true });
    expect(b).toEqual({ tagId: 4, name: '新分類', created: false });
    expect(await rows('SELECT tag_id, tag_name FROM urt_tag WHERE tag_name = ?', ['新分類'])).toHaveLength(1);
  });

  it('adds a channel from its YouTube profile with empty stime/vtime, emoji intact, a count row and the requested tags', async () => {
    const id = await enqueue('add-channel', { source: UC, tags: [1, 2] });
    await channelAdminJob(ctx(), { limit: 10 });
    const [channel] = await rows('SELECT * FROM urt_channel WHERE youtube_id = ?', [UC]);
    expect(channel).toMatchObject({ u_id: 2, title: '新頻道 🎉', description: '第一行\n第二行', uploads: 'UU' + UC.slice(2), viewCount: 10, subscriberCount: null, videoCount: 2, stime: null, vtime: null, flag_del: null, ctime: '2026-10-27 04:00:00', publishedAt: '2020-01-02 11:04:05' });
    expect((await rows('SELECT tags, viewCount, subscriberCount FROM urt_count WHERE u_id = 2'))[0]).toMatchObject({ tags: '[1][2]', viewCount: 10, subscriberCount: null });
    expect((await rows('SELECT tag_id, log_type FROM urt_tag_log WHERE u_id = 2 ORDER BY pk')).map(r => `${r.log_type}${r.tag_id}`)).toEqual(['add1', 'add2']);
    expect(JSON.parse((await request(id)).result)).toEqual({ uId: 2, youtubeId: UC, title: '新頻道 🎉', created: true, tags: '[1][2]' });
  });

  it('resolves an @handle, and treats a repeated or already tracked channel as existing instead of adding a duplicate', async () => {
    const a = await enqueue('add-channel', { source: '@new.channel' }), b = await enqueue('add-channel', { source: UC, tags: [2] }), c = await enqueue('add-channel', { source: 'UCexistexistexistexist01', tags: [2] });
    await channelAdminJob(ctx(), { limit: 10 });
    expect(JSON.parse((await request(a)).result)).toMatchObject({ uId: 2, created: true });
    expect(JSON.parse((await request(b)).result)).toMatchObject({ uId: 2, created: false, tags: '[2]' });
    expect(JSON.parse((await request(c)).result)).toMatchObject({ uId: 1, created: false, tags: '[1][2]' });
    expect(await rows('SELECT u_id FROM urt_channel ORDER BY u_id')).toEqual([{ u_id: 1 }, { u_id: 2 }]);
  });

  it('refuses a retired channel and an unknown handle', async () => {
    await db.query("UPDATE urt_channel SET flag_del = 1 WHERE u_id = 1");
    const retired = await enqueue('add-channel', { source: 'UCexistexistexistexist01' }), unknown = await enqueue('add-channel', { source: '@nobody' });
    await channelAdminJob(ctx(), { limit: 10 });
    expect((await request(retired)).error_code).toBe('CHANNEL_RETIRED');
    expect((await request(unknown)).error_code).toBe('CHANNEL_NOT_FOUND');
  });

  it('leaves nothing behind when part of an add fails: the channel row is rolled back with the rest', async () => {
    // Pass the early category check, then make the tag step fail after the channel and count rows were inserted.
    await db.query("CREATE TRIGGER fail_log BEFORE INSERT ON urt_tag_log FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'boom'");
    try {
      const id = await enqueue('add-channel', { source: UC, tags: [1] });
      const result = await channelAdminJob(ctx(), { limit: 10 });
      expect(result.rejected).toEqual([{ id, kind: 'add-channel', code: 'APPLY_FAILED' }]);
      expect(await rows('SELECT u_id FROM urt_channel WHERE youtube_id = ?', [UC])).toEqual([]);
      expect(await rows('SELECT u_id FROM urt_count WHERE u_id = 2')).toEqual([]);
      expect((await request(id)).status).toBe('failed');
    } finally { await db.query('DROP TRIGGER fail_log'); }
  });

  it('does not touch a request that is not pending, and applies requests oldest first', async () => {
    const first = await enqueue('create-tag', { name: '甲' }), second = await enqueue('create-tag', { name: '乙' });
    await db.query("UPDATE ts_channel_admin_requests SET status = 'done' WHERE id = ?", [first]);
    await channelAdminJob(ctx(), { limit: 10 });
    expect(await rows('SELECT tag_name FROM urt_tag WHERE tag_name IN (?, ?)', ['甲', '乙'])).toEqual([{ tag_name: '乙' }]);
    expect((await request(second)).status).toBe('done');
  });
});
