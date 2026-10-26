import { describe, expect, it } from 'vitest';
import type { Connection } from 'mysql2/promise';
import type { Redis } from 'ioredis';
import { WEBSUB_COMMAND, WEBSUB_JOB, drainNotices, executeWebsubWorkflow, renewSubscriptions, validateWebsubArguments } from '../src/websub-cli.js';
import { validateWorkflowInput, workflowArgs } from '../src/workflow-registry.js';
import { validateScheduleConfig } from '../src/scheduler.js';
import { callbackToken, decodeEvent, encodeEvent, parseNotification, websubKeys, websubTopic, WEBSUB_PRIORITY_VTIME } from '../../shared/websub.js';

const SECRET = 's'.repeat(40), A = 'UC9EWrkZoT3agfx45s6FdVtQ', B = 'UCxxxxxxxxxxxxxxxxxxxxxx', C = 'UCyyyyyyyyyyyyyyyyyyyyyy';
/** Just the Redis commands the job uses, over plain maps. */
function fakeRedis(events: string[] = [], hashes: Record<string, Record<string, string>> = {}) {
  const hash = (key: string) => hashes[key] ??= {};
  const redis = {
    async lpop(_key: string, count: number) { const out = events.splice(0, count); return out.length ? out : null; },
    async hmget(key: string, ...fields: string[]) { return fields.map(f => hash(key)[f] ?? null); },
    async hset(key: string, field: string, value: string) { hash(key)[field] = value; },
    async hgetall(key: string) { return { ...hash(key) }; },
    async hdel(key: string, ...fields: string[]) { for (const f of fields) delete hash(key)[f]; },
    async hincrby(key: string, field: string, by: number) { hash(key)[field] = String(Number(hash(key)[field] ?? 0) + by); },
  };
  return { redis: redis as unknown as Redis, hashes };
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
  it('round-trips queue events and refuses forged ones', () => {
    expect(decodeEvent(encodeEvent({ channelId: A, videoId: 'zpqFQ8ilYD0' }))).toEqual({ channelId: A, videoId: 'zpqFQ8ilYD0' });
    for (const bad of ['', 'x', `${A}:short`, `${A}:zpqFQ8ilYD0:extra`, `bad:zpqFQ8ilYD0`]) expect(decodeEvent(bad)).toBeNull();
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
  const db = (known: string[], updated: string[]) => ({
    async query(_sql: string, params: unknown[][]) { return [(params[0] as string[]).filter(id => known.includes(id)).map(videoId => ({ videoId }))]; },
    async execute(_sql: string, params: unknown[]) { const [vtime, channelId] = params as string[]; expect(vtime).toBe(WEBSUB_PRIORITY_VTIME); const hit = channelId !== C; if (hit) updated.push(channelId!); return [{ affectedRows: hit ? 1 : 0 }]; },
  } as unknown as Connection);
  it('moves a channel with an unseen video to the front of discovery and ignores edits of known videos', async () => {
    const updated: string[] = [], { redis, hashes } = fakeRedis([`${A}:zpqFQ8ilYD0`, `${A}:zpqFQ8ilYD0`, `${B}:AAAAAAAAAAA`, `${C}:CCCCCCCCCCC`, 'garbage']);
    const result = await drainNotices(db(['AAAAAAAAAAA'], updated), redis, owner, NOW);
    expect(result).toEqual({ drained: 5, invalid: 1, channels: 2, bumped: 1, ignored: 1, alreadyQueuedOrUnknown: 1, watching: 2, resolved: 0, expired: 0, rebumped: 0 });
    expect(updated).toEqual([A]);
    expect(hashes[websubKeys.stats]).toEqual({ drained: '5', bumped: '1', ignored: '1' });
    expect(hashes[websubKeys.watch]).toEqual({ zpqFQ8ilYD0: `${A}|${NOW}|${NOW}|1`, CCCCCCCCCCC: `${C}|${NOW}|${NOW}|1` });
  });
  it('treats video ids case-sensitively when deciding what is known', async () => {
    const updated: string[] = [], { redis } = fakeRedis([`${A}:aaaaaaaaaaa`]);
    expect((await drainNotices(db(['AAAAAAAAAAA'], updated), redis, owner, NOW)).bumped).toBe(1);
  });
  it('does nothing when the queue is empty', async () => {
    expect(await drainNotices(db([], []), fakeRedis().redis, owner, NOW)).toMatchObject({ drained: 0, bumped: 0, watching: 0 });
  });
  it('does not bump again for a repeated notice of a video already being watched', async () => {
    const updated: string[] = [], { redis } = fakeRedis([`${A}:zpqFQ8ilYD0`], { [websubKeys.watch]: { zpqFQ8ilYD0: `${A}|${NOW - MIN}|${NOW - MIN}|1` } });
    expect(await drainNotices(db([], updated), redis, owner, NOW)).toMatchObject({ bumped: 0, rebumped: 0, watching: 1 });
    expect(updated).toEqual([]);
  });
  it('bumps a watched channel again after six minutes, at most three times in total', async () => {
    const updated: string[] = [], { redis, hashes } = fakeRedis([], { [websubKeys.watch]: { zpqFQ8ilYD0: `${A}|${NOW - 7 * MIN}|${NOW - 7 * MIN}|1` } });
    expect(await drainNotices(db([], updated), redis, owner, NOW)).toMatchObject({ bumped: 1, rebumped: 1, watching: 1 });
    expect(hashes[websubKeys.watch]!.zpqFQ8ilYD0).toBe(`${A}|${NOW - 7 * MIN}|${NOW}|2`);
    hashes[websubKeys.watch]!.zpqFQ8ilYD0 = `${A}|${NOW - 20 * MIN}|${NOW - 7 * MIN}|3`;
    expect(await drainNotices(db([], updated), redis, owner, NOW)).toMatchObject({ bumped: 0, rebumped: 0, watching: 1 });
    expect(updated).toEqual([A]);
  });
  it('stops watching a video once it is stored, or after half an hour', async () => {
    const updated: string[] = [], { redis, hashes } = fakeRedis([], { [websubKeys.watch]: {
      AAAAAAAAAAA: `${A}|${NOW - 2 * MIN}|${NOW - 2 * MIN}|1`, BBBBBBBBBBB: `${B}|${NOW - 31 * MIN}|${NOW - 25 * MIN}|2`, junkjunkjun: 'not-a-record' } });
    const result = await drainNotices(db(['AAAAAAAAAAA'], updated), redis, owner, NOW);
    expect(result).toMatchObject({ resolved: 1, expired: 2, watching: 0, bumped: 0 });
    expect(hashes[websubKeys.watch]).toEqual({});
    expect(hashes[websubKeys.stats]).toEqual({ resolved: '1', expired: '2' });
  });
});

describe('subscribing channels', () => {
  const NOW = 1_800_000_000_000, DAY = 86400000, base = { secret: SECRET, origin: 'https://youtube.observe.tw', limit: 10, now: NOW, assertOwnership: owner };
  it('asks the hub for channels with no or expiring lease, using this channel callback and a derived secret', async () => {
    const { redis, hashes } = fakeRedis([], { [websubKeys.leases]: { [A]: String(NOW + 3 * DAY), [B]: String(NOW + DAY / 2) } });
    const bodies: URLSearchParams[] = [];
    const result = await renewSubscriptions(redis, [A, B, C], { ...base, subscribe: async body => { bodies.push(body); return 202; } });
    expect(result).toMatchObject({ scoped: 3, established: 2, due: 2, attempted: 2, accepted: 2, failed: 0 });
    expect(bodies.map(b => b.get('hub.topic'))).toEqual([websubTopic(C), websubTopic(B)]);
    expect(bodies[0]!.get('hub.callback')).toBe(`https://youtube.observe.tw/websub/youtube/${C}/${callbackToken(SECRET, C)}`);
    expect(bodies[0]!.get('hub.mode')).toBe('subscribe');
    expect(bodies[0]!.get('hub.verify')).toBe('async');
    expect(bodies[0]!.get('hub.secret')).toHaveLength(64);
    expect(bodies[0]!.get('hub.lease_seconds')).toBe('432000');
    // The lease stays the receiver's to write; the job only holds off asking again.
    expect(hashes[websubKeys.leases]).toEqual({ [A]: String(NOW + 3 * DAY), [B]: String(NOW + DAY / 2) });
    expect(hashes[websubKeys.retry]![C]).toBe(String(NOW + 6 * 3600 * 1000));
  });
  it('holds off channels asked recently and honours the per-run cap', async () => {
    const { redis } = fakeRedis([], { [websubKeys.retry]: { [A]: String(NOW + 1000) } });
    const asked: string[] = [];
    const result = await renewSubscriptions(redis, [A, B, C], { ...base, limit: 1, subscribe: async body => { asked.push(body.get('hub.topic')!); return 204; } });
    expect(asked).toEqual([websubTopic(B)]);
    expect(result).toMatchObject({ due: 2, attempted: 1, accepted: 1 });
  });
  it('retries failures sooner and stops after repeated hub failures', async () => {
    const channels = Array.from({ length: 8 }, (_, i) => `UC${String(i).repeat(22)}`);
    const { redis, hashes } = fakeRedis();
    let calls = 0;
    const result = await renewSubscriptions(redis, channels, { ...base, subscribe: async () => { calls++; throw new Error('network'); } });
    expect(calls).toBe(5);
    expect(result).toMatchObject({ failed: 5, accepted: 0, stoppedEarly: true });
    expect(hashes[websubKeys.retry]![channels[0]!]).toBe(String(NOW + 30 * 60 * 1000));
    expect(hashes[websubKeys.stats]).toEqual({ subscribe_failed: '5' });
  });
});
