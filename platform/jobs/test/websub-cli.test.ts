import { describe, expect, it } from 'vitest';
import type { Connection } from 'mysql2/promise';
import type { Redis } from 'ioredis';
import { WEBSUB_COMMAND, WEBSUB_JOB, drainNotices, executeWebsubWorkflow, loadLeases, pruneEvents, renewSubscriptions, validateWebsubArguments } from '../src/websub-cli.js';
import { validateWorkflowInput, workflowArgs } from '../src/workflow-registry.js';
import { validateScheduleConfig } from '../src/scheduler.js';
import { callbackToken, parseNotification, websubKeys, websubTopic } from '../../shared/websub.js';
import { YoutubeError, type PlaylistItem } from '@youtube-board/ingestion';

const SECRET = 's'.repeat(40), A = 'UC9EWrkZoT3agfx45s6FdVtQ', B = 'UCxxxxxxxxxxxxxxxxxxxxxx', C = 'UCyyyyyyyyyyyyyyyyyyyyyy';
/** Just the Redis commands the job uses, over plain maps. */
function fakeRedis(hashes: Record<string, Record<string, string>> = {}, strings: Record<string, string> = {}) {
  const hash = (key: string) => hashes[key] ??= {};
  const redis = {
    async get(key: string) { return strings[key] ?? null; },
    async set(key: string, value: string) { strings[key] = value; return 'OK'; },
    async hmget(key: string, ...fields: string[]) { return fields.map(f => hash(key)[f] ?? null); },
    async hset(key: string, field: string, value: string) { hash(key)[field] = value; },
    async hgetall(key: string) { return { ...hash(key) }; },
    async hdel(key: string, ...fields: string[]) { for (const f of fields) delete hash(key)[f]; },
    async hincrby(key: string, field: string, by: number) { hash(key)[field] = String(Number(hash(key)[field] ?? 0) + by); },
  };
  return { redis: redis as unknown as Redis, hashes, strings };
}
const owner = async () => {};

describe('WebSub notice parsing', () => {
  it('reads video and channel ids from entries and ignores tombstones and malformed ids', () => {
    const xml = `<feed><at:deleted-entry ref="yt:video:zzzzzzzzzzz"><at:by><uri>x</uri></at:by></at:deleted-entry>
      <entry><yt:videoId>zpqFQ8ilYD0</yt:videoId><yt:channelId>${A}</yt:channelId></entry>
      <entry><yt:videoId>short</yt:videoId><yt:channelId>${A}</yt:channelId></entry>
      <entry><yt:videoId>AAAAAAAAAAA</yt:videoId><yt:channelId>nope</yt:channelId></entry></feed>`;
    expect(parseNotification(xml)).toEqual([{ channelId: A, videoId: 'zpqFQ8ilYD0' }]);
  });
});

describe('WebSub sync boundary', () => {
  it('validates bounds and unknown options, and a dry run touches nothing', async () => {
    expect(validateWebsubArguments([WEBSUB_COMMAND])).toEqual({ execute: false, limit: 40, tagIds: [1, 2, 12, 13, 14, 81] });
    expect(validateWebsubArguments([WEBSUB_COMMAND, '--limit=10', '--or=2,3', '--execute'])).toEqual({ execute: true, limit: 10, tagIds: [2, 3] });
    for (const bad of [['--limit=0'], ['--limit=101'], ['--or=0'], ['--or=a'], ['--limit=1', '--limit=2'], ['--url=x'], ['--execute', '--execute']]) expect(() => validateWebsubArguments([WEBSUB_COMMAND, ...bad])).toThrow();
    expect(await executeWebsubWorkflow([WEBSUB_COMMAND], {})).toMatchObject({ mode: 'dry-run', externalCalls: 0, sourceWrites: 0 });
  });
  it('execute needs the ownership, scheduler and WebSub gates before any connection', async () => {
    const args = [WEBSUB_COMMAND, '--execute'];
    await expect(executeWebsubWorkflow(args, { APP_ENV: 'local' })).rejects.toThrow();
    await expect(executeWebsubWorkflow(args, { APP_ENV: 'local', TS_INGESTION_ENABLED: 'true', TS_INGESTION_OWNERS: WEBSUB_JOB })).rejects.toThrow('WebSub is not enabled');
    await expect(executeWebsubWorkflow(args, { APP_ENV: 'local', TS_INGESTION_ENABLED: 'true', TS_INGESTION_OWNERS: WEBSUB_JOB, TS_WEBSUB_ENABLED: 'true', WEBSUB_SECRET: SECRET, TS_WEBSUB_CALLBACK_ORIGIN: 'http://insecure.example' })).rejects.toThrow('callback origin');
  });
  it('queue registration and the recurring schedule share the validated options', () => {
    const input = validateWorkflowInput(WEBSUB_JOB, { options: { limit: 40 } });
    expect(workflowArgs(WEBSUB_JOB, input)).toEqual([WEBSUB_COMMAND, '--limit=40', '--execute']);
    expect(() => validateWorkflowInput(WEBSUB_JOB, { options: { limit: 101 } })).toThrow();
    expect(validateScheduleConfig({ version: 1, timezone: 'Asia/Taipei', schedules: [{ id: 'websub', workflow: WEBSUB_JOB, cron: '*/2 * * * *', options: { limit: 40 } }] }).schedules).toHaveLength(1);
  });
});

describe('draining notices', () => {
  const NOW = 1_800_000_000_000, MIN = 60000;
  type Row = { id: number; channel_id: string; video_id: string };
  type Seen = { sql?: string; params?: unknown[]; inserts: { table: string; row: Record<string, unknown> }[] };
  /** Answers the drain's reads and records the rows publishUploads inserts. Only channel A and B are active. */
  function fakeDb(rows: Row[], known: string[], seen: Seen = { inserts: [] }) {
    return {
      async query(sql: string, params: unknown[] = []) {
        if (sql.includes('FROM ts_websub_events')) { seen.sql = sql; seen.params = params; const after = sql.includes('id > ?') ? Number(params[0]) : 0; return [rows.filter(r => r.id > after)]; }
        if (sql.includes('SELECT videoId FROM urt_video')) return [(params[0] as string[]).filter(id => known.includes(id)).map(videoId => ({ videoId }))];
        if (sql.includes('FROM urt_channel')) return [(params[0] as string[]).filter(id => id === A || id === B).map(youtube_id => ({ u_id: youtube_id === A ? 7 : 8, youtube_id }))];
        if (sql.startsWith('SELECT * FROM')) return [[]];
        throw new Error('unexpected query ' + sql);
      },
      async execute(sql: string, params: unknown[]) {
        const match = /^INSERT INTO `(\w+)` \((.*?)\)/.exec(sql);
        if (!match) throw new Error('unexpected write ' + sql);
        const columns = match[2]!.split(', ').map(c => c.replace(/`/g, ''));
        seen.inserts.push({ table: match[1]!, row: Object.fromEntries(columns.map((c, i) => [c, params[i]])) });
        return [{ affectedRows: 1 }];
      },
    } as unknown as Connection;
  }
  const notices = (...list: [string, string][]): Row[] => list.map(([channel_id, video_id], i) => ({ id: 101 + i, channel_id, video_id }));
  const video = (videoId: string, channelId: string, live: PlaylistItem['liveBroadcastContent'] = 'none'): PlaylistItem => ({ id: '', videoId, publishedAt: '2027-01-15T08:00:00Z', channelId, title: 't ' + videoId, description: '', thumbnails: `https://i.ytimg.com/vi/${videoId}/default.jpg`, channelTitle: 'c', playlistId: 'UU' + channelId.slice(2), position: 0, liveBroadcastContent: live });
  const lookupOf = (found: PlaylistItem[], asked: string[][] = []) => async (ids: string[]) => { asked.push(ids); return found.filter(item => ids.includes(item.videoId)); };

  it('looks up unseen videos by id in one batch, stores them and their live rows, and ignores edits of known videos', async () => {
    const { redis, hashes, strings } = fakeRedis(), seen: Seen = { inserts: [] }, asked: string[][] = [];
    const rows = notices([A, 'zpqFQ8ilYD0'], [A, 'zpqFQ8ilYD0'], [B, 'AAAAAAAAAAA'], [B, 'LLLLLLLLLLL'], [A, 'PPPPPPPPPPP'], [A, 'short']);
    const result = await drainNotices(fakeDb(rows, ['AAAAAAAAAAA'], seen), redis, owner, lookupOf([video('zpqFQ8ilYD0', A, 'upcoming'), video('LLLLLLLLLLL', B)], asked), NOW);
    expect(asked).toEqual([['zpqFQ8ilYD0', 'LLLLLLLLLLL', 'PPPPPPPPPPP']]);
    expect(result).toMatchObject({ drained: 6, invalid: 1, ignored: 1, watched: 3, watching: 1, due: 3, lookups: { attempted: 3, published: 2, live: 1, unavailable: 1, failed: false } });
    expect(seen.inserts.map(i => [i.table, i.row.videoId])).toEqual([['urt_video', 'zpqFQ8ilYD0'], ['urt_video_schedule', 'zpqFQ8ilYD0'], ['urt_video_live', 'zpqFQ8ilYD0'], ['urt_video', 'LLLLLLLLLLL'], ['urt_video_schedule', 'LLLLLLLLLLL']]);
    expect(seen.inserts[0]!.row).toMatchObject({ u_id: 7, channelId: A, playlistId: 'UU' + A.slice(2), id: '', position: 0 });
    expect(seen.inserts[2]!.row).toMatchObject({ u_id: 7, publishedAt: '2027-01-15 16:00:00' });
    // The video YouTube did not serve yet stays watched with one check recorded.
    expect(hashes[websubKeys.watch]).toEqual({ PPPPPPPPPPP: `${A}|${NOW}|${NOW}|1` });
    expect(hashes[websubKeys.stats]).toEqual({ drained: '6', ignored: '1', watched: '3', published: '2', published_live: '1', unavailable: '1', lookups: '1' });
    expect(strings[websubKeys.cursor]).toBe('106');
    expect(strings[websubKeys.lookup]).toBe(String(NOW));
  });
  it('never moves channels in the general discovery queue', async () => {
    const { redis } = fakeRedis(), db = fakeDb(notices([A, 'zpqFQ8ilYD0']), []);
    (db as unknown as { execute: unknown }).execute = async (sql: string) => { throw new Error('unexpected write ' + sql); };
    expect(await drainNotices(db, redis, owner, null, NOW)).toMatchObject({ watched: 1, lookups: { attempted: 0 } });
  });
  it('spaces lookups four minutes apart unless a full batch is waiting', async () => {
    const recent = String(NOW - 2 * MIN), asked: string[][] = [];
    const few = fakeRedis({}, { [websubKeys.lookup]: recent });
    expect((await drainNotices(fakeDb(notices([A, 'zpqFQ8ilYD0']), []), few.redis, owner, lookupOf([], asked), NOW)).lookups.attempted).toBe(0);
    expect(few.hashes[websubKeys.watch]).toEqual({ zpqFQ8ilYD0: `${A}|${NOW}|0|0` });
    const ids = Array.from({ length: 55 }, (_, i) => `V${String(i).padStart(10, '0')}`);
    const many = fakeRedis({}, { [websubKeys.lookup]: recent });
    expect((await drainNotices(fakeDb(notices(...ids.map(id => [A, id] as [string, string])), []), many.redis, owner, lookupOf([], asked), NOW)).lookups.attempted).toBe(50);
    expect(asked).toEqual([ids.slice(0, 50)]);
    const later = fakeRedis({ [websubKeys.watch]: { zpqFQ8ilYD0: `${A}|${NOW - 5 * MIN}|0|0` } }, { [websubKeys.lookup]: String(NOW - 4 * MIN) });
    expect((await drainNotices(fakeDb([], []), later.redis, owner, lookupOf([]), NOW)).lookups.attempted).toBe(1);
  });
  it('asks again for a missing video every ten minutes, never-checked videos first', async () => {
    const asked: string[][] = [], { redis, hashes } = fakeRedis({ [websubKeys.watch]: {
      AAAAAAAAAAA: `${A}|${NOW - 30 * MIN}|${NOW - 11 * MIN}|2`, BBBBBBBBBBB: `${A}|${NOW - 30 * MIN}|${NOW - 9 * MIN}|2`, CCCCCCCCCCC: `${B}|${NOW - MIN}|0|0` } });
    const result = await drainNotices(fakeDb([], []), redis, owner, lookupOf([], asked), NOW);
    expect(asked).toEqual([['CCCCCCCCCCC', 'AAAAAAAAAAA']]);
    expect(result).toMatchObject({ due: 2, watching: 3, lookups: { unavailable: 2 } });
    expect(hashes[websubKeys.watch]).toMatchObject({ AAAAAAAAAAA: `${A}|${NOW - 30 * MIN}|${NOW}|3`, BBBBBBBBBBB: `${A}|${NOW - 30 * MIN}|${NOW - 9 * MIN}|2`, CCCCCCCCCCC: `${B}|${NOW - MIN}|${NOW}|1` });
  });
  it('keeps videos watched when the lookup fails on quota or the API, and rethrows anything else', async () => {
    const { redis, hashes } = fakeRedis();
    const failing = async () => { throw new YoutubeError('quota-exhausted'); };
    expect(await drainNotices(fakeDb(notices([A, 'zpqFQ8ilYD0']), []), redis, owner, failing, NOW)).toMatchObject({ lookups: { attempted: 1, failed: true, published: 0 } });
    expect(hashes[websubKeys.watch]).toEqual({ zpqFQ8ilYD0: `${A}|${NOW}|0|0` });
    expect(hashes[websubKeys.stats]).toMatchObject({ lookup_failed: '1' });
    await expect(drainNotices(fakeDb([], []), fakeRedis({ [websubKeys.watch]: { zpqFQ8ilYD0: `${A}|${NOW}|0|0` } }).redis, owner, async () => { throw new Error('bug'); }, NOW)).rejects.toThrow('bug');
  });
  it('drops a looked-up video whose channel is not an active channel', async () => {
    const seen: Seen = { inserts: [] }, { redis, hashes } = fakeRedis();
    const result = await drainNotices(fakeDb(notices([C, 'CCCCCCCCCCC']), [], seen), redis, owner, lookupOf([video('CCCCCCCCCCC', C)]), NOW);
    expect(result.lookups).toMatchObject({ unknownChannel: 1, published: 0 });
    expect(seen.inserts).toEqual([]);
    expect(hashes[websubKeys.watch]).toEqual({});
  });
  it('starts from the recent past without a cursor, then continues after the stored cursor', async () => {
    const seen: Seen = { inserts: [] }, rows = notices([A, 'zpqFQ8ilYD0'], [A, 'BBBBBBBBBBB']);
    const first = fakeRedis();
    await drainNotices(fakeDb(rows, [], seen), first.redis, owner, null, NOW);
    expect(seen.sql).toContain('received_at >= UTC_TIMESTAMP() - INTERVAL 30 MINUTE');
    expect(first.strings[websubKeys.cursor]).toBe('102');
    const resumed = fakeRedis({}, { [websubKeys.cursor]: '101' });
    const result = await drainNotices(fakeDb(rows, [], seen), resumed.redis, owner, null, NOW);
    expect(seen.sql).toContain('id > ?');
    expect(seen.params).toEqual(['101', 500]);
    expect(result.drained).toBe(1);
    expect(resumed.strings[websubKeys.cursor]).toBe('102');
  });
  it('ignores a corrupt cursor instead of trusting it', async () => {
    const seen: Seen = { inserts: [] }, { redis } = fakeRedis({}, { [websubKeys.cursor]: '1; DROP TABLE x' });
    await drainNotices(fakeDb([], [], seen), redis, owner, null, NOW);
    expect(seen.sql).toContain('received_at >= UTC_TIMESTAMP()');
  });
  it('treats video ids case-sensitively when deciding what is known', async () => {
    const { redis } = fakeRedis();
    expect((await drainNotices(fakeDb(notices([A, 'aaaaaaaaaaa']), ['AAAAAAAAAAA']), redis, owner, null, NOW)).watched).toBe(1);
  });
  it('does nothing when there are no notices', async () => {
    const { redis, strings } = fakeRedis();
    expect(await drainNotices(fakeDb([], []), redis, owner, lookupOf([]), NOW)).toMatchObject({ drained: 0, watched: 0, watching: 0, lookups: { attempted: 0 } });
    expect(strings[websubKeys.cursor]).toBeUndefined();
    expect(strings[websubKeys.lookup]).toBeUndefined();
  });
  it('does not watch a repeated notice twice', async () => {
    const { redis, hashes } = fakeRedis({ [websubKeys.watch]: { zpqFQ8ilYD0: `${A}|${NOW - MIN}|${NOW - MIN}|1` } });
    expect(await drainNotices(fakeDb(notices([A, 'zpqFQ8ilYD0']), []), redis, owner, null, NOW)).toMatchObject({ watched: 0, watching: 1 });
    expect(hashes[websubKeys.watch]).toEqual({ zpqFQ8ilYD0: `${A}|${NOW - MIN}|${NOW - MIN}|1` });
  });
  it('stops watching a video once it is stored, or after two hours, and drops corrupt entries', async () => {
    const { redis, hashes } = fakeRedis({ [websubKeys.watch]: {
      AAAAAAAAAAA: `${A}|${NOW - 2 * MIN}|${NOW - 2 * MIN}|1`, BBBBBBBBBBB: `${B}|${NOW - 121 * MIN}|${NOW - 5 * MIN}|9`, DDDDDDDDDDD: `${B}|${NOW - 119 * MIN}|${NOW - 5 * MIN}|9`, junkjunkjun: 'not-a-record' } });
    const result = await drainNotices(fakeDb([], ['AAAAAAAAAAA']), redis, owner, null, NOW);
    expect(result).toMatchObject({ resolved: 1, expired: 2, watching: 1 });
    expect(hashes[websubKeys.watch]).toEqual({ DDDDDDDDDDD: `${B}|${NOW - 119 * MIN}|${NOW - 5 * MIN}|9` });
    expect(hashes[websubKeys.stats]).toEqual({ resolved: '1', expired: '2' });
  });
});

describe('leases and retention', () => {
  it('turns the latest verification of each channel into an expiry from the database clock', async () => {
    const NOW = 1_800_000_000_000, db = { async query(sql: string) { expect(sql).toContain("kind = 'verify'"); expect(sql).toContain('MAX(id)'); return [[{ channel_id: A, remaining: 100 }, { channel_id: B, remaining: -50 }]]; } } as unknown as Connection;
    expect(await loadLeases(db, NOW)).toEqual(new Map([[A, NOW + 100_000], [B, NOW - 50_000]]));
  });
  it('prunes notices after three days and verifications after 35, in bounded batches', async () => {
    const sent: string[] = [], db = { async execute(sql: string) { sent.push(sql); return [{ affectedRows: sent.length }]; } } as unknown as Connection;
    expect(await pruneEvents(db, owner)).toEqual({ notices: 1, verifications: 2 });
    expect(sent[0]).toMatch(/kind = 'notice' AND received_at < UTC_TIMESTAMP\(\) - INTERVAL 3 DAY LIMIT 1000$/);
    expect(sent[1]).toMatch(/kind = 'verify' AND received_at < UTC_TIMESTAMP\(\) - INTERVAL 35 DAY LIMIT 1000$/);
  });
});

describe('subscribing channels', () => {
  const NOW = 1_800_000_000_000, DAY = 86400000, base = { secret: SECRET, origin: 'https://youtube.observe.tw', limit: 10, now: NOW, assertOwnership: owner };
  it('asks the hub for channels with no or expiring lease, using this channel callback and a derived secret', async () => {
    const { redis, hashes } = fakeRedis();
    const leases = new Map([[A, NOW + 3 * DAY], [B, NOW + DAY / 2]]);
    const bodies: URLSearchParams[] = [];
    const result = await renewSubscriptions(redis, [A, B, C], { ...base, leases, subscribe: async body => { bodies.push(body); return 202; } });
    expect(result).toMatchObject({ scoped: 3, established: 2, due: 2, attempted: 2, accepted: 2, failed: 0 });
    expect(bodies.map(b => b.get('hub.topic'))).toEqual([websubTopic(C), websubTopic(B)]);
    expect(bodies[0]!.get('hub.callback')).toBe(`https://youtube.observe.tw/websub/youtube/${C}/${callbackToken(SECRET, C)}`);
    expect(bodies[0]!.get('hub.mode')).toBe('subscribe');
    expect(bodies[0]!.get('hub.verify')).toBe('async');
    expect(bodies[0]!.get('hub.secret')).toHaveLength(64);
    expect(bodies[0]!.get('hub.lease_seconds')).toBe('432000');
    // A lease exists only once the hub verified the callback; the job merely holds off asking again.
    expect(hashes[websubKeys.retry]![A]).toBeUndefined();
    expect(hashes[websubKeys.retry]![C]).toBe(String(NOW + 6 * 3600 * 1000));
  });
  it('holds off channels asked recently and honours the per-run cap', async () => {
    const { redis } = fakeRedis({ [websubKeys.retry]: { [A]: String(NOW + 1000) } });
    const asked: string[] = [];
    const result = await renewSubscriptions(redis, [A, B, C], { ...base, leases: new Map(), limit: 1, subscribe: async body => { asked.push(body.get('hub.topic')!); return 204; } });
    expect(asked).toEqual([websubTopic(B)]);
    expect(result).toMatchObject({ due: 2, attempted: 1, accepted: 1 });
  });
  it('retries failures sooner and stops after repeated hub failures', async () => {
    const channels = Array.from({ length: 8 }, (_, i) => `UC${String(i).repeat(22)}`);
    const { redis, hashes } = fakeRedis();
    let calls = 0;
    const result = await renewSubscriptions(redis, channels, { ...base, leases: new Map(), subscribe: async () => { calls++; throw new Error('network'); } });
    expect(calls).toBe(5);
    expect(result).toMatchObject({ failed: 5, accepted: 0, stoppedEarly: true });
    expect(hashes[websubKeys.retry]![channels[0]!]).toBe(String(NOW + 30 * 60 * 1000));
    expect(hashes[websubKeys.stats]).toEqual({ subscribe_failed: '5' });
  });
});
