import { describe, it, expect } from 'vitest';
import { validateWorkflowInput, workflowArgs, executeRegisteredWorkflow } from '../src/workflow-registry.js';
import { startWorker } from '../src/worker.js';
const env = { APP_ENV: 'test', TS_INGESTION_ENABLED: 'true', TS_SCHEDULER_ENABLED: 'true', TS_INGESTION_OWNERS: 'youtube.videos.stats' };
describe('registered background workflows', () => {
  it('binds commands by reviewed job name and rejects arbitrary flags/environments', () => {
    expect(workflowArgs('youtube.videos.stats', { options: { limit: 25, today: true } })).toEqual(['youtube:videos:stats', '--limit=25', '--today', '--execute']);
    for (const name of ['constructor', '__proto__', 'unknown']) expect(() => validateWorkflowInput(name, { options: {} })).toThrow('Unregistered');
    for (const options of [{ execute: true }, { env: 'production' }, { limit: NaN }, { videoId: 'x\ny' }, { today: 'yes' }])
      expect(() => validateWorkflowInput('youtube.videos.stats', { options })).toThrow();
    expect(() => validateWorkflowInput('youtube.videos.stats', { options: {}, command: 'anything' })).toThrow();
  });
  it('enforces per-job ownership and scheduler gates before database/provider access', async () => {
    await expect(executeRegisteredWorkflow('youtube.live.poll', { options: {} }, env)).rejects.toThrow('ownership');
    await expect(executeRegisteredWorkflow('youtube.videos.stats', { options: {} }, { ...env, TS_SCHEDULER_ENABLED: 'false' })).rejects.toThrow('Scheduler');
    await expect(executeRegisteredWorkflow('ai.daily', { options: { from: '2026-10-10 00:00:00', to: '2026-10-10 23:59:59' } }, { ...env, TS_INGESTION_OWNERS: 'ai.daily' })).rejects.toThrow('ownership');
    expect(() => startWorker({ ...env, TS_INGESTION_OWNERS: 'not-a-real-job' })).toThrow('No authorized');
  });
  it('normalizes option order for durable queue identity', () => {
    expect(validateWorkflowInput('ai.hourly', { options: { to: '2026-10-11 23:59:59', from: '2026-10-11 23:00:00', condition: 'all' } })).toEqual(validateWorkflowInput('ai.hourly', { options: { condition: 'all', from: '2026-10-11 23:00:00', to: '2026-10-11 23:59:59' } }));
  });
});

it.skipIf(process.env.REDIS_WORKFLOW_TEST !== '1')('real isolated Redis atomically binds concurrent queue submissions to one input', async () => {
  const { Redis } = await import('ioredis');
  const { Queue } = await import('bullmq');
  const { randomUUID, createHash } = await import('node:crypto');
  const { enqueueWorkflow } = await import('../src/worker.js');
  const redis = new Redis('redis://127.0.0.1:26379/14', { maxRetriesPerRequest: null });
  const queue = new Queue('youtube-board-ts', { connection: redis });
  const runId = 'queue-test-' + randomUUID(), name = 'youtube.videos.stats';
  const id = createHash('sha256').update(JSON.stringify([name, runId])).digest('hex');
  const queuedEnv = { ...env, REDIS_URL: 'redis://127.0.0.1:26379/14' };
  try {
    const result = await Promise.allSettled([enqueueWorkflow(name, runId, { options: { limit: 1 } }, queuedEnv), enqueueWorkflow(name, runId, { options: { limit: 2 } }, queuedEnv)]);
    expect(result.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    expect(result.filter(r => r.status === 'rejected')).toHaveLength(1);
    const job = await queue.getJob(id);
    expect(job?.name).toBe(name);
    expect([1, 2]).toContain(job?.data.options.limit);
    expect(await job?.getState()).toBe('waiting');
    expect(await redis.ttl(`youtube-board-ts:input:${id}`)).toBe(-1);
    await job?.remove();
    await expect(enqueueWorkflow(name, runId, job!.data, queuedEnv)).rejects.toThrow('queue record no longer retained');
    expect(await queue.getJob(id)).toBeUndefined();
  } finally {
    await (await queue.getJob(id))?.remove();
    await redis.del(`youtube-board-ts:input:${id}`);
    await queue.close(); await redis.quit();
  }
});

it.skipIf(process.env.REDIS_WORKFLOW_TEST !== '1')('same-input concurrent submissions never advise creating another run ID', async () => {
  const { Redis } = await import('ioredis');
  const { Queue } = await import('bullmq');
  const { randomUUID, createHash } = await import('node:crypto');
  const { enqueueWorkflow, QueueInputConflict } = await import('../src/worker.js');
  const redis = new Redis('redis://127.0.0.1:26379/14', { maxRetriesPerRequest: null });
  const queue = new Queue('youtube-board-ts', { connection: redis });
  const runId = randomUUID(), name = 'youtube.videos.stats';
  const id = createHash('sha256').update(JSON.stringify([name, runId])).digest('hex');
  const input = { options: { limit: 1 } }, queuedEnv = { ...env, REDIS_URL: 'redis://127.0.0.1:26379/14' };
  try {
    const results = await Promise.allSettled(Array.from({ length: 8 }, () => enqueueWorkflow(name, runId, input, queuedEnv)));
    expect(results.some(r => r.status === 'fulfilled')).toBe(true);
    for (const result of results) {
      if (result.status === 'fulfilled') expect(result.value.id).toBe(id);
      else { expect(result.reason).toBeInstanceOf(QueueInputConflict); expect(result.reason.code).toBe('SUBMISSION_UNOBSERVED'); expect(result.reason.message).not.toContain('new'); }
    }
    expect((await queue.getJob(id))?.data).toEqual(input);
  } finally { await (await queue.getJob(id))?.remove(); await redis.del(`youtube-board-ts:input:${id}`); await queue.close(); await redis.quit(); }
});

it.skipIf(process.env.REDIS_WORKFLOW_TEST !== '1')('a source-only worker starts without vocabulary ownership and rejects unknown jobs before dispatch', async () => {
  const { Redis } = await import('ioredis');
  const { Queue } = await import('bullmq');
  const { randomBytes } = await import('node:crypto');
  const redis = new Redis('redis://127.0.0.1:26379/14', { maxRetriesPerRequest: null }), queue = new Queue('youtube-board-ts', { connection: redis });
  if (await queue.getWaitingCount() || await queue.getActiveCount() || await queue.getDelayedCount()) { await queue.close(); await redis.quit(); throw new Error('Dedicated test queue must have no runnable jobs'); }
  const handle = startWorker({ ...env, REDIS_URL: 'redis://127.0.0.1:26379/14' });
  const id = randomBytes(32).toString('hex');
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await handle.worker.waitUntilReady();
    expect(handle.worker.opts.maxStalledCount).toBe(0);
    const failed = new Promise<string>((resolve, reject) => {
      handle.worker.on('failed', (job, error) => { if (job?.id === id) resolve(error.message); });
      timer = setTimeout(() => reject(new Error('Worker test timed out')), 5000);
    });
    await queue.add('test.unregistered', { options: {} }, { jobId: id, attempts: 1 });
    expect(await failed).toBe('Unregistered workflow');
    expect(await (await queue.getJob(id))?.getState()).toBe('failed');
  } finally { if (timer) clearTimeout(timer); await handle.close(); await (await queue.getJob(id))?.remove(); await queue.close(); await redis.quit(); }
});
