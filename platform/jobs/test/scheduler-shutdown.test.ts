import { it, expect, vi } from 'vitest';
import { runScheduleCycle, type ScheduleConfig } from '../src/scheduler.js';
import { requestWorkflowShutdown } from '../../shared/shutdown.js';
import type { redisConnection } from '../src/worker.js';

it('shutdown retains accepted queue IDs and does not advance a partially attempted watermark', async () => {
  const config: ScheduleConfig = { version: 1, timezone: 'Asia/Taipei', schedules: ['first', 'second', 'third'].map(id => ({ id, workflow: 'youtube.videos.stats', cron: '* * * * *', options: { limit: 1 } })) };
  const env = { APP_ENV: 'test', TS_INGESTION_ENABLED: 'true', TS_SCHEDULER_ENABLED: 'true', TS_INGESTION_OWNERS: 'youtube.videos.stats' };
  const redis = { ping: async () => 'PONG', get: async () => null, xadd: vi.fn().mockResolvedValue('1-0'), eval: vi.fn(), quit: async () => {}, disconnect() {} };
  const enqueue = vi.fn(async () => { requestWorkflowShutdown(); return { id: 'accepted-before-shutdown', data: { options: { limit: 1 } }, state: 'waiting' }; });
  const cycle = await runScheduleCycle(config, env, new Date('2032-01-01T00:00:00Z'), (() => redis) as unknown as typeof redisConnection, enqueue);
  expect(cycle.aborted).toBe(true); expect(cycle.healthy).toBe(false);
  expect(cycle.runs[0]?.queueId).toBe('accepted-before-shutdown');
  expect(cycle.runs).toHaveLength(6);
  expect(cycle.runs.slice(1).every(run => run.state === 'SHUTDOWN_ABORTED')).toBe(true);
  expect(enqueue).toHaveBeenCalledTimes(1); expect(redis.eval).not.toHaveBeenCalled();
});
