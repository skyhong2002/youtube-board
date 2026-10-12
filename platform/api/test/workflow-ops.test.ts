import { describe, it, expect, vi } from 'vitest';
import Fastify from 'fastify';
import { registerWorkflowOps } from '../src/ops/workflows.js';
import { enqueueWorkflow, QueueInputConflict } from '../../jobs/src/worker.js';
const token = 'workflow-test-token-not-a-runtime-secret';
const env = { APP_ENV: 'test', TS_OPS_TOKEN: token, TS_OPS_EXECUTION_ENABLED: 'true', TS_OPS_WRITE_ALLOWLIST: 'youtube.videos.stats', TS_INGESTION_ENABLED: 'true', TS_SCHEDULER_ENABLED: 'true', TS_INGESTION_OWNERS: 'youtube.videos.stats' };
const input = { workflow: 'youtube.videos.stats', id: 'reviewed-run', input: { options: { limit: 25 } } };
const auth = { authorization: `Bearer ${token}` };
async function setup(patch = {}) {
  const app = Fastify(), enqueue = vi.fn(async () => ({ id: 'queued-1', state: 'waiting' }));
  await registerWorkflowOps(app, { env: { ...env, ...patch }, enqueueWorkflow: enqueue as unknown as typeof enqueueWorkflow });
  return { app, enqueue };
}
describe('generalized workflow operator controls', () => {
  it('previews without enqueue and requires authorization for every request', async () => {
    const { app, enqueue } = await setup();
    try {
      expect((await app.inject({ method: 'POST', url: '/api/ops/workflows/run', payload: input })).statusCode).toBe(401);
      const preview = await app.inject({ method: 'POST', url: '/api/ops/workflows/preview', headers: auth, payload: input });
      expect(preview.statusCode).toBe(200); expect(preview.json().queueWrites).toBe(0); expect(enqueue).not.toHaveBeenCalled();
      const invalid = { ...input, input: { options: { limit: 999999 } } };
      expect((await app.inject({ method: 'POST', url: '/api/ops/workflows/preview', headers: auth, payload: invalid })).statusCode).toBe(400);
      const result = await app.inject({ method: 'POST', url: '/api/ops/workflows/run', headers: auth, payload: input });
      expect(result.statusCode).toBe(202); expect(enqueue).toHaveBeenCalledTimes(1);
    } finally { await app.close(); }
  });
  it('rejects closed ownership/allowlists and cross-site requests without queue effects', async () => {
    for (const patch of [{ TS_OPS_WRITE_ALLOWLIST: '*' }, { TS_INGESTION_OWNERS: '' }, { TS_SCHEDULER_ENABLED: 'false' }]) {
      const { app, enqueue } = await setup(patch);
      expect((await app.inject({ method: 'POST', url: '/api/ops/workflows/run', headers: auth, payload: input })).statusCode).toBe(403);
      expect(enqueue).not.toHaveBeenCalled(); await app.close();
    }
    const { app, enqueue } = await setup();
    expect((await app.inject({ method: 'POST', url: '/api/ops/workflows/run', headers: { ...auth, origin: 'https://other.example' }, payload: input })).statusCode).toBe(403);
    expect(enqueue).not.toHaveBeenCalled(); await app.close();
  });
  it('reports immutable run identity conflicts as409', async () => {
    const { app, enqueue } = await setup(); enqueue.mockRejectedValue(new QueueInputConflict());
    expect((await app.inject({ method: 'POST', url: '/api/ops/workflows/run', headers: auth, payload: input })).statusCode).toBe(409);
    await app.close();
  });
  it('reports completion and a newly submitted immediate failure without claiming a retry', async () => {
    const { app, enqueue } = await setup();
    enqueue.mockResolvedValue({ id: 'queued-1', state: 'completed' });
    const done = await app.inject({ method: 'POST', url: '/api/ops/workflows/run', headers: auth, payload: input });
    expect(done.statusCode).toBe(200); expect(done.json().status).toBe('completed');
    enqueue.mockResolvedValue({ id: 'queued-1', state: 'failed' });
    const failed = await app.inject({ method: 'POST', url: '/api/ops/workflows/run', headers: auth, payload: input });
    expect(failed.statusCode).toBe(200); expect(failed.json().status).toBe('failed');
    enqueue.mockResolvedValue({ id: 'queued-1', state: 'unknown' });
    const uncertain = await app.inject({ method: 'POST', url: '/api/ops/workflows/run', headers: auth, payload: input });
    expect(uncertain.statusCode).toBe(202); expect(uncertain.json()).toMatchObject({ status: 'unknown', id: 'queued-1' });
    await app.close();
  });
});
