import {assertQueueJob,consumerQueue,partitionedQueues,workflowQueueName} from './queue-scope.js';
import { registeredWorkflows, executeRegisteredWorkflow, validateWorkflowInput, type WorkflowInput } from './workflow-registry.js';
import { Queue, Worker, type Job } from 'bullmq';
import { Redis } from 'ioredis';
import { createHash, randomUUID } from 'node:crypto';
import { connectDatabase, withWriterLock } from './database.js';
import { assertExecute, executionPolicy } from './policy.js';
import { MysqlVocabularyStore } from './mysql-vocabulary-store.js';
import { TagArticleSource } from './tag-source.js';
import { synchronizeVocabulary, validateWindow, VOCABULARY_JOB, type Window } from './vocabulary.js';
export interface VocabularyJobInput { id: string; window: Window; maxPages: number }
export function validateVocabularyInput(input: VocabularyJobInput): VocabularyJobInput {
  if (!input || typeof input.id !== 'string' || input.id.startsWith('tag-') || !/^[A-Za-z0-9_-]{1,100}$/.test(input.id) || !input.window || typeof input.window.since !== 'string' || typeof input.window.until !== 'string') throw new Error('Invalid vocabulary job input');
  validateWindow(input.window);
  if (!Number.isSafeInteger(input.maxPages) || input.maxPages < 1 || input.maxPages > 1000) throw new Error('maxPages must be 1–1000');
  return { id: input.id, window: { since: new Date(input.window.since).toISOString(), until: new Date(input.window.until).toISOString() }, maxPages: input.maxPages };
}
export async function executeVocabulary(input: VocabularyJobInput, env: NodeJS.ProcessEnv, scheduled = false) {
  input = validateVocabularyInput(input);
  assertExecute(VOCABULARY_JOB, executionPolicy(env, 'execute', scheduled));
  const db = await connectDatabase(env);
  try {
    return await withWriterLock(db, VOCABULARY_JOB, assertOwnership => synchronizeVocabulary({ ...input, source: new TagArticleSource(), store: new MysqlVocabularyStore(db), assertOwnership }));
  } finally { await db.end(); }
}
export function redisConnection(env: NodeJS.ProcessEnv, blocking = false) {
  const url = new URL(env.REDIS_URL ?? 'redis://127.0.0.1:26379');
  if (env.APP_ENV !== 'production' && !['127.0.0.1', 'localhost', 'redis'].includes(url.hostname)) throw new Error('Local worker requires local Redis');
  const redis = new Redis(url.toString(), { maxRetriesPerRequest: blocking ? null : 1, connectTimeout: 3000, ...(blocking ? {} : { commandTimeout: 3000, retryStrategy: (times: number) => times <= 2 ? 100 : null }) });
  redis.on('error', () => {}); // callers receive bounded failures; never log connection configuration
  return redis;
}
/** Starting a worker is explicit. It never schedules jobs on startup. */
export function startWorker(env: NodeJS.ProcessEnv) {
  const policy = executionPolicy(env, 'execute', true);
  if (![VOCABULARY_JOB, ...registeredWorkflows].some(name => { try { assertExecute(name, policy); return true; } catch { return false; } })) throw new Error('No authorized scheduled workflow');
  const scope=consumerQueue(env);if(scope.workflow)assertExecute(scope.workflow,policy);
  const redis = redisConnection(env, true);
  const worker = new Worker<VocabularyJobInput>(scope.name, async (job: Job<VocabularyJobInput>) => {
    assertQueueJob(scope,job.name,env);
    if (job.name !== VOCABULARY_JOB) return executeRegisteredWorkflow(job.name, job.data, env);
    const result = await executeVocabulary(job.data, env, true);
    if (result.status === 'incomplete') throw new Error('Vocabulary page cap reached; checkpoint retained for explicit resume');
    return { status: result.status, version: result.snapshot.id, terms: result.snapshot.terms.length };
  }, { connection: redis, concurrency: 1, maxStalledCount: 0, limiter: { max: 1, duration: 1000 } });
  return { worker, close: async () => { await worker.close(); await redis.quit(); } };
}
export async function enqueueVocabulary(input: VocabularyJobInput, env: NodeJS.ProcessEnv) {
  input = validateVocabularyInput(input);
  assertExecute(VOCABULARY_JOB, executionPolicy(env, 'execute', true));
  const queueName=workflowQueueName(VOCABULARY_JOB,env),redis = redisConnection(env);
  const queue = new Queue<VocabularyJobInput>(queueName, { connection: redis });
  const jobId = createHash('sha256').update(input.id).digest('hex');
  const retryLock = `youtube-board-ts:submission:${jobId}`, owner = randomUUID();
  let acquired = false;
  try {
    acquired = await redis.set(retryLock, owner, 'EX', 30, 'NX') === 'OK';
    if (!acquired) throw new QueueInputConflict('Submission already in progress; inspect this same run ID', 'SUBMISSION_IN_PROGRESS');
    const created = await bindQueuedInput(redis, jobId, { id: input.id, window: input.window });
    const existing = await queue.getJob(jobId);
    if (existing) {
      if (JSON.stringify(existing.data.window) !== JSON.stringify(input.window)) throw new QueueInputConflict('Queued run id is already bound to a different window');
      if (await existing.getState() === 'failed') {
        if (await redis.get(retryLock) !== owner) throw new QueueInputConflict('Submission lease lost; inspect this same run ID', 'SUBMISSION_UNOBSERVED', jobId);
        await existing.updateData(input);
        if (await redis.get(retryLock) !== owner) throw new QueueInputConflict('Submission lease lost; inspect this same run ID', 'SUBMISSION_UNOBSERVED', jobId);
        await existing.retry('failed');
      }
      return await snapshotSubmission(existing);
    }
    if (!created) throw new QueueInputConflict('Submission pending or queue record no longer retained; inspect this run ID and durable history before retrying', 'SUBMISSION_UNOBSERVED', jobId);
    const added = await queue.add(VOCABULARY_JOB, input, { jobId, attempts: 1, removeOnComplete: { age: 7 * 86400, count: 1000 }, removeOnFail: { age: 30 * 86400, count: 1000 } }).catch(() => { throw new QueueInputConflict('Submission outcome unknown; inspect this queue ID and durable history', 'SUBMISSION_UNOBSERVED', jobId); });
    return await snapshotSubmission(added);
  } finally {
    if (acquired) await redis.eval("if redis.call('GET',KEYS[1])==ARGV[1] then return redis.call('DEL',KEYS[1]) else return 0 end", 1, retryLock, owner).catch(() => {});
    await queue.close().catch(() => {}); await redis.quit().catch(() => { redis.disconnect(); });
  }
}

export class QueueInputConflict extends Error {
  constructor(message = 'Run ID conflicts with retained history', readonly code = 'RUN_ID_CONFLICT', readonly queueId?: string) { super(message); }
}
export async function submissionState(job: { getState(): Promise<string> }): Promise<string> {
  try { return await job.getState(); } catch { return 'unknown'; }
}
async function snapshotSubmission<T>(job: { id?: string; data: T; getState(): Promise<string> }) {
  return { id: job.id, data: job.data, state: await submissionState(job) };
}
async function bindQueuedInput(redis: Redis, jobId: string, input: unknown) {
  const digest = createHash('sha256').update(JSON.stringify(input)).digest('hex');
  // Persistent tombstones outlive BullMQ record retention. Redis persistence/backup
  // is part of the deployment contract; this is not cross-Redis exactly-once.
  const result = await redis.eval("local v=redis.call('GET',KEYS[1]); if v then if v==ARGV[1] then return 1 else return 0 end end; redis.call('SET',KEYS[1],ARGV[1]); return 2", 1, `youtube-board-ts:input:${jobId}`, digest);
  if (result !== 1 && result !== 2) throw new QueueInputConflict('Run ID already bound to different workflow input', 'RUN_ID_CONFLICT', jobId);
  return result === 2;
}
/** Explicit enqueue only; this does not create recurring schedules. */
export async function enqueueWorkflow(name: string, runId: string, raw: unknown, env: NodeJS.ProcessEnv) {
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(runId)) throw new Error('Invalid workflow run ID');
  const input = validateWorkflowInput(name, raw);
  assertExecute(name, executionPolicy(env, 'execute', true));
  if (name === 'ai.daily') assertExecute('ai.channel', executionPolicy(env, 'execute', true));
  const queueName=workflowQueueName(name,env),redis = redisConnection(env), queue = new Queue<WorkflowInput>(queueName, { connection: redis });
  try {
    const jobId = createHash('sha256').update(JSON.stringify([name, runId])).digest('hex');
    const created = await bindQueuedInput(redis, jobId, input);
    const existing = await queue.getJob(jobId);
    if (existing) {
      if (JSON.stringify(existing.data) !== JSON.stringify(input)) throw new QueueInputConflict('Run ID already bound to different workflow input', 'RUN_ID_CONFLICT', jobId);
      if (await existing.getState() === 'failed') throw new QueueInputConflict('Previous run failed; inspect history and use a new reviewed run ID', 'PREVIOUS_RUN_FAILED', jobId);
      return await snapshotSubmission(existing);
    }
    if (!created) throw new QueueInputConflict('Submission pending or queue record no longer retained; inspect this run ID and durable history before retrying', 'SUBMISSION_UNOBSERVED', jobId);
    const added = await queue.add(name, input, { jobId, attempts: 1, removeOnComplete: { age: 7 * 86400, count: 1000 }, removeOnFail: { age: 30 * 86400, count: 1000 } }).catch(() => { throw new QueueInputConflict('Submission outcome unknown; inspect this queue ID and durable history', 'SUBMISSION_UNOBSERVED', jobId); });
    return await snapshotSubmission(added);
  } finally { await queue.close().catch(() => {}); await redis.quit().catch(() => { redis.disconnect(); }); }
}

/** Read-only queue status; expiry is reported as unobserved, never success. */
export async function workflowQueueStatus(id: string, env: NodeJS.ProcessEnv) {
  if (!/^[a-f0-9]{64}$/.test(id)) throw new Error('Invalid queue ID');
  const workflows=partitionedQueues(env)?(env.TS_WORKER_WORKFLOW?[env.TS_WORKER_WORKFLOW]:[...executionPolicy(env).typescriptOwners]):[''];
  if(workflows.length>64)throw new Error('Queue status scope exceeds cap');
  const redis=redisConnection(env);try{
   for(const workflow of workflows){const queue=new Queue(workflowQueueName(workflow,env),{connection:redis});try{
    const job=await queue.getJob(id);if(!job)continue;
    if(workflow&&job.name!==workflow)throw new Error('Queue job profile mismatch');
    const result=job.returnvalue&&typeof job.returnvalue==='object'?job.returnvalue as Record<string,unknown>:{},state=await job.getState();
    return {id,workflow:job.name,state,enqueuedAt:job.timestamp,startedAt:job.processedOn??null,finishedAt:job.finishedOn??null,attemptsMade:job.attemptsMade,failed:state==='failed',result:Object.fromEntries(Object.entries(result).filter(([key,value])=>['status','mode','executionKey','runId','version','vocabularyVersion','total','processed','nextAfterPk','calls'].includes(key)&&(value===null||typeof value==='string'||typeof value==='number')))};
   }finally{await queue.close().catch(()=>{});}}
   return null;
  }finally{await redis.quit().catch(()=>{redis.disconnect();});}
}
