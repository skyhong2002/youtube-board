import type { FastifyInstance } from 'fastify';
import { authorizeOps } from './auth.js';
import { enqueueWorkflow, QueueInputConflict, workflowQueueStatus } from '../../../jobs/src/worker.js';
import { registeredWorkflows, validateWorkflowInput, type WorkflowInput } from '../../../jobs/src/workflow-registry.js';
import { assertExecute, executionPolicy } from '../../../jobs/src/policy.js';
interface Options {
  env?: NodeJS.ProcessEnv;
  enqueueWorkflow?: typeof enqueueWorkflow;
}
export async function registerWorkflowOps(app: FastifyInstance, options: Options = {}) {
  const env = options.env ?? process.env, enqueue = options.enqueueWorkflow ?? enqueueWorkflow;
  await app.register(async ops => {
    ops.addHook('onRequest', async (request, reply) => { if (!authorizeOps(env, request, reply)) return reply; });
    ops.get<{ Params: { id: string } }>('/api/ops/workflows/jobs/:id', async (request, reply) => {
      if (!/^[a-f0-9]{64}$/.test(request.params.id)) return reply.code(400).send({ error: { code: 'INVALID_QUEUE_ID' } });
      try { const job = await workflowQueueStatus(request.params.id, env); return job ?? reply.code(404).send({ error: { code: 'JOB_UNOBSERVED', message: 'No retained queue record. Check durable workflow history; this is not evidence of success.' } }); }
      catch { return reply.code(503).send({ error: { code: 'QUEUE_UNAVAILABLE' } }); }
    });
    ops.get('/api/ops/workflows', async () => ({ workflows: registeredWorkflows, recurringSchedulesCreated: false }));
    for (const mode of ['preview', 'run'] as const) ops.post(`/api/ops/workflows/${mode}`, async (request, reply) => {
      let parsed: { workflow: string; id: string; input: WorkflowInput };
      try { parsed = parse(request.body); }
      catch { return reply.code(400).send({ error: { code: 'INVALID_WORKFLOW_INPUT' } }); }
      if (mode === 'preview') return { mode: 'input-validation', ...parsed, writes: 0, externalCalls: 0, queueWrites: 0, note: 'Source availability and workflow-specific eligibility are checked by the executing job.' };
      try {
        const allow = new Set((env.TS_OPS_WRITE_ALLOWLIST ?? '').split(',').map(value => value.trim()));
        if (env.TS_OPS_EXECUTION_ENABLED !== 'true' || allow.has('*') || !allow.has(parsed.workflow)) throw new Error('Gated');
        assertExecute(parsed.workflow, executionPolicy(env, 'execute', true));
        if (parsed.workflow === 'ai.daily') {
          if (!allow.has('ai.channel')) throw new Error('Dependent channel stage gated');
          assertExecute('ai.channel', executionPolicy(env, 'execute', true));
        }
      } catch { return reply.code(403).send({ error: { code: 'EXECUTION_GATED' } }); }
      try {
        const job = await enqueue(parsed.workflow, parsed.id, parsed.input, env);
        const state = job.state;
        return reply.code(['completed', 'failed'].includes(state) ? 200 : 202).send({ status: state, workflow: parsed.workflow, id: job.id });
      } catch (error) { return reply.code(error instanceof QueueInputConflict ? 409 : 503).send({ error: { code: error instanceof QueueInputConflict ? error.code : 'QUEUE_SUBMISSION_FAILED', ...(error instanceof QueueInputConflict && error.queueId ? { queueId: error.queueId } : {}) } }); }
    });
  });
}
function parse(raw: unknown) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Invalid input');
  const body = raw as Record<string, unknown>;
  if (Object.keys(body).some(key => !['workflow', 'id', 'input'].includes(key)) || typeof body.workflow !== 'string' || typeof body.id !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(body.id)) throw new Error('Invalid input');
  return { workflow: body.workflow, id: body.id, input: validateWorkflowInput(body.workflow, body.input) };
}
