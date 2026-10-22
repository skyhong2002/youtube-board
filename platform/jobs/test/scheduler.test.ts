import { describe, it, expect, vi } from 'vitest';
import { validateScheduleConfig, planSchedules, tickSchedules, runScheduleCycle, SCHEDULER_WATERMARK, type ScheduleConfig } from '../src/scheduler.js';
import { QueueInputConflict, type enqueueWorkflow, type redisConnection } from '../src/worker.js';
const config: ScheduleConfig = { version: 1, timezone: 'Asia/Taipei', schedules: [
  { id: 'stats-v1', workflow: 'youtube.videos.stats', cron: '*/9 * * * *', options: { limit: 25 } },
  { id: 'daily-v1', workflow: 'ai.daily', cron: '5 0 * * *', options: { 'missing-only': true }, window: 'previous-day' },
] };
describe('explicit recurring schedule plans', () => {
  it('uses Taipei boundaries and stable slots across midnight/year and process restarts', () => {
    const now = new Date('2031-12-31T16:05:47Z');
    const [run] = planSchedules(config, now);
    expect(run?.workflow).toBe('ai.daily');
    expect(run?.input.options).toMatchObject({ from: '2031-12-31 00:00:00', to: '2031-12-31 23:59:59', 'missing-only': true });
    expect(planSchedules(config, new Date('2031-12-31T16:06:01Z'))[0]?.runId).toBe(run?.runId);
    expect(planSchedules(config, new Date('2031-12-31T16:07:01Z'))).toEqual([]);
    expect(planSchedules(config, new Date('2031-12-31T16:09:00Z'))[0]?.input.options.limit).toBe(25);
  });
  it('bounds catch-up, validates all entries, and refuses hidden commands or repair recurrence', () => {
    expect(() => planSchedules(config, new Date(), 61)).toThrow();
    for (const patch of [{ cron: '* * * * * *' }, { cron: '60 * * * *' }, { cron: '*/0 * * * *' }, { workflow: 'youtube.comments.reset' }, { options: { execute: true } }, { id: 'bad id' }])
      expect(() => validateScheduleConfig({ ...config, schedules: [{ ...config.schedules[0], ...patch }] })).toThrow();
    expect(() => validateScheduleConfig({ ...config, schedules: [config.schedules[0], config.schedules[0]] })).toThrow();
    expect(() => validateScheduleConfig({ ...config, timezone: 'UTC' })).toThrow();
  });
  it('keeps previous-hour and date-only windows exact and applies Vixie restricted OR and star-step AND day rules', () => {
    const hourly: ScheduleConfig = { ...config, schedules: [{ id: 'hour-v1', workflow: 'ai.channel', cron: '10 * * * *', options: { 'channel-id': 1 }, window: 'previous-hour' }] };
    expect(planSchedules(hourly, new Date('2032-01-01T16:10:00Z'))[0]?.input.options).toMatchObject({ from: '2032-01-01 23:00:00', to: '2032-01-01 23:59:59' });
    const date: ScheduleConfig = { ...config, schedules: [{ id: 'catchup', workflow: 'ai.daily.catchup', cron: '* * * * *', options: {}, window: 'yesterday-date' }] };
    expect(planSchedules(date, new Date('2032-01-01T16:10:00Z'), 1)[0]?.input.options.date).toBe('2032-01-01');
    const weekly: ScheduleConfig = { ...config, schedules: [{ ...config.schedules[0]!, cron: '0 0 1 * 1' }] };
    expect(planSchedules(weekly, new Date('2032-01-04T16:00:00Z'), 1)).toHaveLength(1); // Monday Jan5
    const stepped = { ...config, schedules: [{ ...config.schedules[0]!, cron: '0 0 */2 * 1' }] };
    expect(planSchedules(stepped, new Date('2032-01-04T16:00:00Z'), 1)).toHaveLength(1);
    expect(planSchedules(stepped, new Date('2032-01-11T16:00:00Z'), 1)).toHaveLength(0); // Monday Jan12 not odd DOM
    const weekdayStep = { ...config, schedules: [{ ...config.schedules[0]!, cron: '0 0 5 * */2' }] };
    expect(planSchedules(weekdayStep, new Date('2032-01-04T16:00:00Z'), 1)).toHaveLength(0); // Monday excluded by DOW step
  });
  it('checks all ownership gates before queue effects and keeps ambiguous IDs unchanged', async () => {
    const enqueue = vi.fn(async () => ({ id: 'queue-id', state: 'waiting' }));
    const env = { APP_ENV: 'test', TS_INGESTION_ENABLED: 'true', TS_SCHEDULER_ENABLED: 'true', TS_INGESTION_OWNERS: 'youtube.videos.stats' };
    await expect(tickSchedules(config, env, new Date(), 2, enqueue as unknown as typeof enqueueWorkflow)).rejects.toThrow('ownership');
    expect(enqueue).not.toHaveBeenCalled();
    const stats = { ...config, schedules: [config.schedules[0]!] };
    const now = new Date('2032-01-01T00:09:20Z');
    const first = await tickSchedules(stats, env, now, 1, enqueue as unknown as typeof enqueueWorkflow);
    expect(first[0]?.state).toBe('waiting');
    enqueue.mockRejectedValue(new QueueInputConflict('uncertain', 'SUBMISSION_UNOBSERVED'));
    const later = await tickSchedules(stats, env, now, 1, enqueue as unknown as typeof enqueueWorkflow);
    expect(later[0]).toMatchObject({ runId: first[0]?.runId, state: 'SUBMISSION_UNOBSERVED' });
    expect(enqueue.mock.calls).toHaveLength(2);
  });
  it('continues later slots after one transport failure, and a fresh cycle reconnects', async () => {
    const both = { ...config, schedules: [0, 1].map(i => ({ ...config.schedules[0]!, id: `stats-${i}`, cron: '* * * * *' })) };
    const env = { APP_ENV: 'test', TS_INGESTION_ENABLED: 'true', TS_SCHEDULER_ENABLED: 'true', TS_INGESTION_OWNERS: 'youtube.videos.stats' };
    const enqueue = vi.fn().mockRejectedValueOnce(new Error('network')).mockResolvedValue({ id: 'accepted', state: 'waiting' });
    const runs = await tickSchedules(both, env, new Date(), 1, enqueue);
    expect(runs.map(r => r.state)).toEqual(['ENQUEUE_ERROR', 'waiting']);
    const dead = { ping: vi.fn().mockRejectedValue(new Error('Redis restarting')), quit: async () => {}, disconnect: () => {} };
    const alive = { ping: async () => 'PONG', get: async () => String(Math.floor(Date.now() / 60000)), eval: vi.fn().mockResolvedValue(1), xadd: vi.fn(), quit: async () => {}, disconnect: () => {} };
    const connect = vi.fn().mockReturnValueOnce(dead).mockReturnValue(alive);
    await expect(runScheduleCycle(both, env, new Date(), connect as unknown as typeof redisConnection, enqueue)).rejects.toThrow('Redis restarting');
    expect((await runScheduleCycle(both, env, new Date(), connect as unknown as typeof redisConnection, enqueue)).healthy).toBe(true);
    expect(connect).toHaveBeenCalledTimes(2);
    enqueue.mockRejectedValue(new QueueInputConflict('unknown', 'SUBMISSION_UNOBSERVED', 'a'.repeat(64)));
    const uncertain = await runScheduleCycle(both, env, new Date(), connect as unknown as typeof redisConnection, enqueue);
    expect(uncertain.healthy).toBe(false); expect(uncertain.ready).toBe(false); expect(uncertain.attention[0]?.queueId).toBe('a'.repeat(64)); expect(alive.xadd).toHaveBeenCalled();
    alive.xadd.mockRejectedValue(new Error('audit sink unavailable'));
    const unpersisted = await runScheduleCycle(both, env, new Date(), connect as unknown as typeof redisConnection, enqueue);
    expect(unpersisted.healthy).toBe(false); expect(unpersisted.ready).toBe(false); expect(unpersisted.persistenceError).toBe(true); expect(unpersisted.runs[0]?.queueId).toBe('a'.repeat(64)); expect(alive.eval).toHaveBeenCalledTimes(3);
  });
  it.each(['PREVIOUS_RUN_FAILED', 'FAILED_REQUIRES_RESUME'])('keeps the scheduler ready while preserving %s in durable attention', async state => {
    const now = new Date('2032-01-01T00:09:00Z');
    const stats = { ...config, schedules: [config.schedules[0]!] };
    const env = { APP_ENV: 'test', TS_INGESTION_ENABLED: 'true', TS_SCHEDULER_ENABLED: 'true', TS_INGESTION_OWNERS: 'youtube.videos.stats' };
    const redis = { ping: async () => 'PONG', get: async () => String(Math.floor(now.getTime() / 60000)), eval: vi.fn().mockResolvedValue(1), xadd: vi.fn(), quit: async () => {}, disconnect() {} };
    const enqueue = vi.fn().mockRejectedValue(new QueueInputConflict('Retained failure', state, 'retained-failed-job'));
    const failed = await runScheduleCycle(stats, env, now, (() => redis) as unknown as typeof redisConnection, enqueue);
    expect(failed).toMatchObject({ ready: true, healthy: false, attention: [{ state, queueId: 'retained-failed-job' }] });
    expect(JSON.parse(redis.xadd.mock.calls[0]!.at(-1))).toMatchObject({ runs: [{ state, queueId: 'retained-failed-job' }] });
    expect(enqueue).toHaveBeenCalledTimes(1); // Inspect the retained slot once, without retrying it.
    enqueue.mockResolvedValue({ id: 'next-slot', state: 'waiting' });
    const next = await runScheduleCycle(stats, env, new Date(now.getTime() + 9 * 60000), (() => redis) as unknown as typeof redisConnection, enqueue);
    expect(next.ready).toBe(true);
    expect(next.runs[0]?.queueId).toBe('next-slot');
    expect(next.missedWindow).not.toBeNull(); // Historical coverage gaps stay visible too.
    enqueue.mockRejectedValue(new Error('Queue transport unavailable'));
    const transportFailure = await runScheduleCycle(stats, env, now, (() => redis) as unknown as typeof redisConnection, enqueue);
    expect(transportFailure).toMatchObject({ ready: false, healthy: false, attention: [{ state: 'ENQUEUE_ERROR' }] });
    redis.xadd.mockRejectedValue(new Error('Audit persistence unavailable'));
    enqueue.mockRejectedValue(new QueueInputConflict('Retained failure', state, 'retained-failed-job'));
    const unavailable = await runScheduleCycle(stats, env, now, (() => redis) as unknown as typeof redisConnection, enqueue);
    expect(unavailable).toMatchObject({ ready: false, healthy: false, persistenceError: true });
  });
});

it.skipIf(process.env.REDIS_WORKFLOW_TEST !== '1')('real Redis schedule ticks reuse one job and do not replay removed records', async () => {
  const { randomUUID, createHash } = await import('node:crypto');
  const { Redis } = await import('ioredis');
  const { Queue } = await import('bullmq');
  const env = { APP_ENV: 'test', TS_INGESTION_ENABLED: 'true', TS_SCHEDULER_ENABLED: 'true', TS_INGESTION_OWNERS: 'youtube.videos.stats', REDIS_URL: 'redis://127.0.0.1:26379/14' };
  const redis = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null }), queue = new Queue('youtube-board-ts', { connection: redis });
  const testConfig: ScheduleConfig = { ...config, schedules: [{ id: randomUUID(), workflow: 'youtube.videos.stats', cron: '* * * * *', options: { limit: 1 } }] };
  const now = new Date('2038-02-01T04:01:00Z'), run = planSchedules(testConfig, now, 1)[0]!;
  const id = createHash('sha256').update(JSON.stringify([run.workflow, run.runId])).digest('hex');
  const watermark = SCHEDULER_WATERMARK;
  try {
    expect((await tickSchedules(testConfig, env, now, 1))[0]).toMatchObject({ queueId: id, state: 'waiting' });
    expect((await tickSchedules(testConfig, env, now, 1))[0]).toMatchObject({ queueId: id, state: 'waiting' });
    await (await queue.getJob(id))!.remove();
    expect((await tickSchedules(testConfig, env, now, 1))[0]?.state).toBe('SUBMISSION_UNOBSERVED');
    expect(await queue.getJob(id)).toBeUndefined();
    const accepted = vi.fn().mockResolvedValue({ id: 'synthetic', data: run.input, state: 'waiting' });
    const baseline = await runScheduleCycle(testConfig, env, now, undefined, accepted);
    expect(baseline.healthy).toBe(false); expect(baseline.baseline).toBe('unobserved'); expect(await redis.xlen(watermark + ':attention')).toBe(1);
    const afterOutage = new Date(now.getTime() + 10 * 60000);
    const revised = { ...testConfig, schedules: [...testConfig.schedules, { ...testConfig.schedules[0]!, id: randomUUID() }] };
    const recovery = await runScheduleCycle(revised, env, afterOutage, undefined, accepted);
    expect(recovery.missedWindow).toEqual({ from: '2038-02-01T04:02:00.000Z', to: '2038-02-01T04:09:00.000Z' });
    expect(recovery.healthy).toBe(false); expect(await redis.xlen(watermark + ':attention')).toBe(2);
    expect((await runScheduleCycle(testConfig, env, afterOutage, undefined, accepted)).healthy).toBe(true);
  } finally { await (await queue.getJob(id))?.remove(); await redis.del(`youtube-board-ts:input:${id}`, watermark, watermark + ':attention'); await queue.close(); await redis.quit(); }
});


it('reports missing baseline and future watermark through attention without hiding accepted IDs', async () => {
  const env = { APP_ENV: 'test', TS_INGESTION_ENABLED: 'true', TS_SCHEDULER_ENABLED: 'true', TS_INGESTION_OWNERS: 'youtube.videos.stats' };
  const stats = { ...config, schedules: [config.schedules[0]!] }, now = new Date('2032-01-01T00:09:00Z');
  const redis = { ping: async () => 'PONG', get: vi.fn().mockResolvedValue(null), eval: vi.fn().mockResolvedValue(1), xadd: vi.fn().mockResolvedValue('1-0'), quit: async () => {}, disconnect() {} };
  const enqueue = vi.fn().mockResolvedValue({ id: 'accepted', data: { options: { limit: 25 } }, state: 'waiting' });
  const baseline = await runScheduleCycle(stats, env, now, (() => redis) as unknown as typeof redisConnection, enqueue);
  expect(baseline).toMatchObject({ ready: true, healthy: false, baseline: 'unobserved', clockSkew: false });
  expect(redis.xadd).toHaveBeenCalledTimes(1); expect(redis.eval).toHaveBeenCalledTimes(1);
  redis.get.mockResolvedValue(String(Math.floor(now.getTime() / 60000) + 10));
  const future = await runScheduleCycle(stats, env, now, (() => redis) as unknown as typeof redisConnection, enqueue);
  expect(future).toMatchObject({ ready: false, healthy: false, baseline: 'known', clockSkew: true });
  expect(future.runs[0]?.queueId).toBe('accepted'); expect(redis.xadd).toHaveBeenCalledTimes(2); expect(redis.eval).toHaveBeenCalledTimes(1);
});
