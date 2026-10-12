import {workflowHistory} from './history.js';
import {BadQuery} from '../reports/query.js';
import {DataSourceUnavailable} from '../db/client.js';
import { retiredCacheWorkflows } from '../../../jobs/src/cache-cli.js';
import { editorialCommands } from '../../../jobs/src/editorial-cli.js';
import { registeredWorkflows } from '../../../jobs/src/workflow-registry.js';
import type { FastifyInstance } from 'fastify';
import { sql } from 'drizzle-orm';
import { createReader, type Reader } from '../db/client.js';
import inventory from '../../../inventory/legacy.json' with { type: 'json' };
import { implementedYoutubeWorkflows } from '../../../jobs/src/ports.js';
import { executionPolicy, assertExecute } from '../../../jobs/src/policy.js';
import { validateVocabularyInput, enqueueVocabulary, QueueInputConflict, type VocabularyJobInput } from '../../../jobs/src/worker.js';
import { VOCABULARY_JOB } from '../../../jobs/src/vocabulary.js';
import { authorizeOps } from './auth.js';

const tagJobs = [VOCABULARY_JOB, 'tags.vocabulary.import', 'tags.videos.match'];
export function jobInventory() {
  const readOnly = new Set(['reports.groups.build']);
  const cli = [...Object.values(editorialCommands), 'notify.telegram.readiness', 'notify.telegram.reconcile', ...readOnly];
  const implemented = new Set<string>([...registeredWorkflows, ...implementedYoutubeWorkflows, ...tagJobs, ...cli]);
  const describe = (key: string, schedule: string | null) => ({
    key, schedule,
    implementation: Object.hasOwn(retiredCacheWorkflows, key) ? 'retired' : implemented.has(key) ? 'typescript' : 'pending',
    execution: Object.hasOwn(retiredCacheWorkflows, key) ? 'unavailable' : readOnly.has(key) ? 'read-only-cli' : key === VOCABULARY_JOB || registeredWorkflows.includes(key) ? 'queue' : implemented.has(key) ? 'cli-only' : 'unavailable',
    ...(Object.hasOwn(retiredCacheWorkflows, key) ? { replacement: retiredCacheWorkflows[key] } : {}),
    ...(readOnly.has(key) ? { writes: false, notes: 'Local tag_group status only; existing groups preserved. Remote sync unsupported because maintained vocabulary export has no group-membership contract.' } : {}),
  });
  return [...inventory.jobs.map(job => describe(job.key, job.schedule)),
    ...[...new Set([...tagJobs, ...registeredWorkflows, ...cli])].filter(key => !inventory.jobs.some(job => job.key === key)).map(key => describe(key, null))];
}
export interface IngestionOpsOptions {
  env?: NodeJS.ProcessEnv;
  reader?: Reader;
  enqueue?: (input: VocabularyJobInput, env: NodeJS.ProcessEnv) => Promise<{ id?: string; data?: VocabularyJobInput; state: string }>;
}
export async function registerIngestionOps(app: FastifyInstance, options: IngestionOpsOptions = {}) {
  const env = options.env ?? process.env;
  const enqueue = options.enqueue ?? enqueueVocabulary;
  const reader = options.reader ?? createReader(env.DATABASE_URL);
  if (!options.reader) app.addHook('onClose', async () => reader.close());
  await app.register(async ops => {
    ops.addHook('onRequest', async (request, reply) => { if (!authorizeOps(env, request, reply)) return reply; });
    ops.get('/api/ops/ingestion', async () => {
      let policy;
      try { const p = executionPolicy(env); policy = { environment: p.environment, enabled: p.enabled, productionEnabled: p.productionEnabled, schedulerEnabled: p.schedulerEnabled, allowlist: [...p.allowlist], typescriptOwners: [...p.typescriptOwners] }; }
      catch { policy = { configured: false }; }
      return { jobs: jobInventory(), legacyJobCount: inventory.jobs.length, policy, recurringSchedulesCreated: false, recurringScheduling: { supported: true, configuration: 'external-not-inspected' } };
    });
    ops.get('/api/ops/ingestion/history', async (request, reply) => {
      try { return await workflowHistory(reader, request.query as Record<string,unknown>); }
      catch (error) {
        if (error instanceof BadQuery) return reply.code(400).send({error:{code:'INVALID_HISTORY_QUERY'}});
        if (error instanceof DataSourceUnavailable) return reply.code(503).send({error:{code:'HISTORY_UNAVAILABLE'}});
        throw error;
      }
    });
    ops.get<{ Params: { id: string } }>('/api/ops/ingestion/runs/:id', async (request, reply) => {
      const id = request.params.id;
      if (!/^[A-Za-z0-9_-]{1,100}$/.test(id)) return reply.code(400).send({ error: { code: 'INVALID_RUN_ID' } });
      try {
        const rows = await reader.rows(sql`SELECT id, window_since AS windowSince, window_until AS windowUntil, pages, status, created_at AS createdAt, published_at AS publishedAt FROM ts_vocabulary_runs WHERE id = ${id} LIMIT 1`);
        if (!rows[0]) return reply.code(404).send({ error: { code: 'RUN_NOT_OBSERVED', message: 'No durable vocabulary run has been observed yet; this does not determine queue status.' } });
        return { workflow: VOCABULARY_JOB, run: rows[0], source: 'durable-vocabulary-run', queueState: 'not-inspected' };
      } catch { return reply.code(503).send({ error: { code: 'RUN_STATUS_UNAVAILABLE' } }); }
    });
    ops.post('/api/ops/ingestion/preview', async (request, reply) => {
      const parsed = parseRequest(request.body);
      if (!parsed) return reply.code(400).send({ error: { code: 'INVALID_JOB_INPUT' } });
      return { mode: 'dry-run', workflow: VOCABULARY_JOB, input: parsed, writes: 0, externalCalls: 0, queueWrites: 0 };
    });
    ops.post('/api/ops/ingestion/run', async (request, reply) => {
      const parsed = parseRequest(request.body);
      if (!parsed) return reply.code(400).send({ error: { code: 'INVALID_JOB_INPUT' } });
      try {
        const exact = new Set((env.TS_OPS_WRITE_ALLOWLIST ?? '').split(',').map(s => s.trim()).filter(Boolean));
        if (env.TS_OPS_EXECUTION_ENABLED !== 'true' || exact.has('*') || !exact.has(VOCABULARY_JOB)) throw new Error('Disabled');
        assertExecute(VOCABULARY_JOB, executionPolicy(env, 'execute', true));
      } catch { return reply.code(403).send({ error: { code: 'EXECUTION_GATED' } }); }
      try { const job = await enqueue(parsed, env); const state = job.state; return reply.code(['completed', 'failed'].includes(state) ? 200 : 202).send({ status: state, workflow: VOCABULARY_JOB, id: job.id, maxPages: job.data?.maxPages ?? null }); }
      catch (error) { return reply.code(error instanceof QueueInputConflict ? 409 : 503).send({ error: { code: error instanceof QueueInputConflict ? error.code : 'ENQUEUE_UNAVAILABLE', ...(error instanceof QueueInputConflict && error.queueId ? { queueId: error.queueId } : {}) } }); }
    });
  });
}
function parseRequest(value: unknown): VocabularyJobInput | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return;
  const body = value as Record<string, unknown>;
  if (Object.keys(body).some(key => !['workflow', 'input'].includes(key)) || body.workflow !== VOCABULARY_JOB) return;
  const input = body.input;
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !['id', 'window', 'maxPages'].includes(key))) return;
  try { const parsed = validateVocabularyInput(input as VocabularyJobInput); if (parsed.maxPages > 100) return; return parsed; } catch { return; }
}
