import { it, expect, vi, beforeEach } from 'vitest';
const mocks = vi.hoisted(() => ({ queueConstruct:vi.fn(),workerConstruct:vi.fn(),getJob: vi.fn(), add: vi.fn(), close: vi.fn(), quit: vi.fn(), eval: vi.fn(), set: vi.fn(), get: vi.fn(), disconnect: vi.fn() }));
vi.mock('bullmq', () => ({ Queue: class { constructor(...args:unknown[]){mocks.queueConstruct(...args);} getJob = mocks.getJob; add = mocks.add; close = mocks.close; }, Worker: class { constructor(...args:unknown[]){mocks.workerConstruct(...args);} close=mocks.close; } }));
vi.mock('ioredis', () => ({ Redis: class { quit = mocks.quit; eval = mocks.eval; set = mocks.set; get = mocks.get; disconnect = mocks.disconnect; on() {} } }));
import { startWorker, enqueueVocabulary, enqueueWorkflow, validateVocabularyInput } from '../src/worker.js';
const env = { APP_ENV: 'test', TS_INGESTION_ENABLED: 'true', TS_SCHEDULER_ENABLED: 'true', TS_INGESTION_OWNERS: 'tags.vocabulary.sync' };
const input = { id: 'same-run', window: { since: '2026-10-10T00:00:00.000Z', until: '2026-10-11T00:00:00.000Z' }, maxPages: 5 };
beforeEach(() => { vi.resetAllMocks(); mocks.close.mockResolvedValue(undefined); mocks.quit.mockResolvedValue(undefined); mocks.add.mockResolvedValue({ id: "queued", data: input, getState: async () => "waiting" }); mocks.eval.mockResolvedValue(2); mocks.set.mockImplementation(async (_key, token) => { mocks.get.mockResolvedValue(token); return "OK"; }); });
it('re-enqueue explicitly retries a failed checkpoint run without waiting for failed job retention expiry', async () => {
  const existing = { data: input, getState: vi.fn().mockResolvedValue('failed'), updateData: vi.fn(), retry: vi.fn() };
  mocks.getJob.mockResolvedValue(existing);
  expect(await enqueueVocabulary({ ...input, maxPages: 2 }, env)).toMatchObject({ data: input, state: 'failed' });
  expect(existing.retry).toHaveBeenCalledWith('failed');
  expect(existing.updateData).toHaveBeenCalledWith({ ...input, maxPages: 2 });
  expect(mocks.add).not.toHaveBeenCalled();
});
it('uses one bounded queue attempt and a stable run identity', async () => {
  mocks.getJob.mockResolvedValue(undefined);
  await enqueueVocabulary(input, env);
  expect(mocks.add.mock.calls[0]?.[2]).toMatchObject({ attempts: 1 });
  const firstId = mocks.add.mock.calls[0]?.[2]?.jobId;
  mocks.eval.mockResolvedValue(1);
  await expect(enqueueVocabulary({ maxPages: 8, window: input.window, id: input.id }, env)).rejects.toMatchObject({ code: 'SUBMISSION_UNOBSERVED', queueId: firstId });
  expect(mocks.add).toHaveBeenCalledTimes(1);
});
it('does not retry an existing run with a different window or unknown source query fields', async () => {
  const existing = { data: input, getState: vi.fn(), retry: vi.fn() };
  mocks.getJob.mockResolvedValue(existing);
  await expect(enqueueVocabulary({ ...input, window: { ...input.window, since: '2026-10-09T00:00:00Z' } }, env)).rejects.toThrow('different window');
  expect(existing.retry).not.toHaveBeenCalled();
  expect(validateVocabularyInput({ ...input, window: { ...input.window, q: 'injected-filter' } } as typeof input).window).not.toHaveProperty('q');
});
it('rejects failed generic runs and tombstones whose queue records expired', async () => {
  const sourceEnv = { ...env, TS_INGESTION_OWNERS: 'youtube.videos.stats' };
  const data = { options: { limit: 1 } };
  mocks.eval.mockResolvedValue(1);
  mocks.getJob.mockResolvedValue({ data, getState: async () => 'failed' });
  await expect(enqueueWorkflow('youtube.videos.stats', 'old-run', data, sourceEnv)).rejects.toThrow('Previous run failed');
  mocks.getJob.mockResolvedValue(undefined);
  await expect(enqueueWorkflow('youtube.videos.stats', 'old-run', data, sourceEnv)).rejects.toThrow('queue record no longer retained');
  expect(mocks.add).not.toHaveBeenCalled();
});

it('preserves ambiguous add outcomes and never automatically replays them', async () => {
  mocks.getJob.mockResolvedValue(undefined); mocks.add.mockRejectedValueOnce(new Error('transport timeout'));
  await expect(enqueueVocabulary(input, env)).rejects.toMatchObject({ code: 'SUBMISSION_UNOBSERVED' });
  mocks.eval.mockResolvedValue(1);
  await expect(enqueueVocabulary(input, env)).rejects.toMatchObject({ code: 'SUBMISSION_UNOBSERVED' });
  expect(mocks.add).toHaveBeenCalledTimes(1);
});
it('cleanup failures cannot turn an accepted enqueue or conflict into a transport failure', async () => {
  mocks.getJob.mockResolvedValue(undefined); mocks.add.mockResolvedValue({ id: 'accepted', data: input, getState: async () => 'waiting' });
  mocks.quit.mockRejectedValue(new Error('connection closed')); mocks.close.mockRejectedValue(new Error('close failed'));
  expect(await enqueueVocabulary(input, env)).toMatchObject({ id: 'accepted', state: 'waiting' });
  mocks.eval.mockResolvedValue(0);
  await expect(enqueueVocabulary(input, env)).rejects.toMatchObject({ code: 'RUN_ID_CONFLICT' });
});

it('snapshots accepted status before closing connections and preserves unknown accepted state', async () => {
  let closed=false;
  mocks.getJob.mockResolvedValue(undefined);
  mocks.close.mockImplementation(async()=>{closed=true;});
  mocks.add.mockResolvedValue({id:'status',data:input,getState:async()=>{if(closed)throw new Error('closed');return 'waiting';}});
  expect(await enqueueVocabulary(input,env)).toMatchObject({id:'status',state:'waiting'});
  expect(closed).toBe(true);
  mocks.add.mockResolvedValue({id:'unknown',data:input,getState:async()=>{throw new Error('transport');}});
  expect(await enqueueVocabulary(input,env)).toMatchObject({id:'unknown',state:'unknown'});
});

it('partitioned producers and consumers construct the same workflow queue and reject wrong jobs before execution',async()=>{
 const scoped={...env,TS_QUEUE_MODE:'workflow',TS_WORKER_WORKFLOW:'youtube.videos.stats',TS_INGESTION_OWNERS:'youtube.videos.stats'};
 mocks.getJob.mockResolvedValue(undefined);await enqueueWorkflow('youtube.videos.stats','partition-fixture',{options:{limit:1}},scoped);
 const queueName=mocks.queueConstruct.mock.calls[0]?.[0];const handle=startWorker(scoped);
 expect(mocks.workerConstruct.mock.calls[0]?.[0]).toBe(queueName);expect(queueName).toMatch(/^youtube-board-ts-wf-/);
 const consume=mocks.workerConstruct.mock.calls[0]?.[1] as (job:unknown)=>Promise<unknown>;
 await expect(consume({name:'youtube.channels.stats',data:{options:{limit:1}}})).rejects.toThrow('does not match consumer');
 await handle.close();
});
