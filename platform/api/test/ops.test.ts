import { createHmac } from 'node:crypto';
import Fastify from 'fastify';
import { describe, it, expect, vi } from 'vitest';
import { registerIngestionOps, jobInventory } from '../src/ops/ingestion.js';
import { registerDeployOps } from '../src/ops/deploy.js';
import { VOCABULARY_JOB } from '../../jobs/src/vocabulary.js';
const token = 'test-ops-token-that-is-not-a-real-secret';
const input = { workflow: VOCABULARY_JOB, input: { id: 'test-run', window: { since: '2026-10-01T00:00:00Z', until: '2026-10-02T00:00:00Z' }, maxPages: 2 } };
const auth = { authorization: `Bearer ${token}` };
const enabled = { APP_ENV: 'test', TS_OPS_TOKEN: token, YOUTUBE_PUBLIC_URL: 'https://youtube.example', TS_OPS_EXECUTION_ENABLED: 'true', TS_OPS_WRITE_ALLOWLIST: VOCABULARY_JOB, TS_INGESTION_ENABLED: 'true', TS_INGESTION_OWNERS: VOCABULARY_JOB, TS_SCHEDULER_ENABLED: 'true' };
async function ops(env: NodeJS.ProcessEnv = enabled) { const app = Fastify(); const enqueue = vi.fn(async () => ({ id: 'job-1', state: 'waiting' })); await registerIngestionOps(app, { env, enqueue }); return { app, enqueue }; }
describe('ingestion operations', () => {
  it('lists the full legacy inventory and only truthful implementations', () => {
    const jobs = jobInventory(); expect(jobs.length).toBeGreaterThanOrEqual(45);
    expect(jobs.find(j => j.key === 'ai.daily')?.execution).toBe('queue');
    expect(jobs.find(j => j.key === 'youtube.videos.stats')?.execution).toBe('queue');
    expect(jobs.find(j => j.key === 'reports.groups.build')).toMatchObject({implementation:'typescript',execution:'read-only-cli',writes:false});
    expect(jobs.find(j => j.key === 'reports.static.html')).toMatchObject({implementation:'retired',execution:'unavailable'});
    expect(jobs.find(j => j.key === 'reports.static.html')?.replacement).toContain('Next');
    for (const key of ['youtube.channels.adopt','notify.telegram.readiness','notify.telegram.reconcile']) expect(jobs.find(j => j.key === key)?.execution).toBe('cli-only');
  });
  it('fails closed and never accepts cookies as authentication', async () => {
    const { app } = await ops({ APP_ENV: 'test' });
    expect((await app.inject('/api/ops/ingestion')).statusCode).toBe(404); await app.close();
    const enabledApp = await ops();
    expect((await enabledApp.app.inject({ url: '/api/ops/ingestion', headers: { cookie: `token=${token}` } })).statusCode).toBe(401); await enabledApp.app.close();
  });
  it('reports durable status without equating an unobserved run with queue failure', async () => {
    const app = Fastify();
    const rows = vi.fn(async () => []);
    await registerIngestionOps(app, { env: enabled, reader: { rows, close: async () => {} } });
    const absent = await app.inject({ url: '/api/ops/ingestion/runs/test-run', headers: auth });
    expect(absent.statusCode).toBe(404); expect(absent.json().error.code).toBe('RUN_NOT_OBSERVED');
    expect((await app.inject({ url: '/api/ops/ingestion/runs/invalid%20run', headers: auth })).statusCode).toBe(400); expect(rows).toHaveBeenCalledTimes(1);
    await app.close();
  });
  it('previews without any queue writes and rejects unregistered jobs/unknown fields', async () => {
    const { app, enqueue } = await ops();
    const result = await app.inject({ method: 'POST', url: '/api/ops/ingestion/preview', headers: auth, payload: input });
    expect(result.statusCode).toBe(200); expect(result.json().writes).toBe(0); expect(enqueue).not.toHaveBeenCalled();
    for (const payload of [{ ...input, workflow: 'ai.daily' }, { ...input, command: ';rm' }, { ...input, input: { ...input.input, maxPages: 101 } }]) expect((await app.inject({ method: 'POST', url: '/api/ops/ingestion/run', headers: auth, payload })).statusCode).toBe(400);
    await app.close();
  });
  it('requires every execution gate and rejects cross-origin mutations', async () => {
    for (const patch of [{ TS_OPS_EXECUTION_ENABLED: 'false' }, { TS_OPS_WRITE_ALLOWLIST: '*' }, { TS_INGESTION_OWNERS: '' }, { TS_SCHEDULER_ENABLED: 'false' }, { APP_ENV: 'production', TS_INGESTION_PRODUCTION_ENABLED: 'true', TS_INGESTION_WRITE_ALLOWLIST: '*' }]) {
      const { app, enqueue } = await ops({ ...enabled, ...patch });
      expect((await app.inject({ method: 'POST', url: '/api/ops/ingestion/run', headers: auth, payload: input })).statusCode).toBe(403); expect(enqueue).not.toHaveBeenCalled(); await app.close();
    }
    const { app, enqueue } = await ops();
    for (const headers of [{}, { authorization: 'Bearer wrong-token' }]) {
      expect((await app.inject({ method: 'POST', url: '/api/ops/ingestion/run', headers, payload: input })).statusCode).toBe(401);
      expect(enqueue).not.toHaveBeenCalled();
    }
    expect((await app.inject({ method: 'POST', url: '/api/ops/ingestion/run', headers: { ...auth, origin: 'https://evil.example' }, payload: input })).statusCode).toBe(403);
    expect(enqueue).not.toHaveBeenCalled();
    expect((await app.inject({ method: 'POST', url: '/api/ops/ingestion/run', headers: { ...auth, origin: 'https://youtube.example' }, payload: input })).statusCode).toBe(202); expect(enqueue).toHaveBeenCalledTimes(1); await app.close();
  });
  it('reports retained vocabulary state rather than falsely queuing completed work', async () => {
    const { app, enqueue } = await ops();
    for (const state of ['completed', 'active', 'waiting']) {
      enqueue.mockResolvedValue({ id: 'job-1', state });
      const response = await app.inject({ method: 'POST', url: '/api/ops/ingestion/run', headers: auth, payload: input });
      expect(response.statusCode).toBe(state === 'completed' ? 200 : 202); expect(response.json().status).toBe(state);
    }
    await app.close();
  });
});

describe('deployment relay', () => {
  const secret = 'test-signature-secret-not-production-1234';
  const env = { APP_ENV: 'test', TS_DEPLOY_RELAY_ENABLED: 'true', DOKPLOY_DEPLOY_RELAY_SECRET: secret, DOKPLOY_DEPLOY_WEBHOOK_URL: 'http://localhost/deploy-token', TS_DEPLOY_REPOSITORY: 'owner/repository' };
  const payload = JSON.stringify({ ref: 'refs/heads/main', after: 'a'.repeat(40), repository: { full_name: 'owner/repository' } });
  function headers(body = payload) { return { 'content-type': 'application/json', 'x-hub-signature-256': 'sha256=' + createHmac('sha256', secret).update(body).digest('hex'), 'x-github-event': 'push', 'x-github-delivery': 'delivery-1' }; }
  it('checks raw body HMAC and deduplicates signed commit even with a new delivery header', async () => {
    const app = Fastify(), keys = new Set<string>(), relay = vi.fn(async () => true);
    await registerDeployOps(app, { env, relay, deliveries: { async claim(key) { if (keys.has(key)) return false; keys.add(key); return true; } } });
    expect((await app.inject({ method: 'POST', url: '/ops/deploy/dokploy', headers: headers(), payload: payload + ' ' })).statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: '/ops/deploy/dokploy', headers: headers(), payload })).statusCode).toBe(200);
    expect((await app.inject({ method: 'POST', url: '/ops/deploy/dokploy', headers: { ...headers(), 'x-github-delivery': 'new-delivery' }, payload })).json().status).toBe('already-claimed'); expect(relay).toHaveBeenCalledTimes(1); await app.close();
  });
  it('ignores wrong repository and preserves ambiguous claims without leaking errors', async () => {
    const app = Fastify(), claim = vi.fn(async () => true), relay = vi.fn(async () => { throw new Error('secret-token-url'); });
    await registerDeployOps(app, { env, relay, deliveries: { claim } });
    const other = payload.replace('owner/repository', 'other/repository');
    expect((await app.inject({ method: 'POST', url: '/ops/deploy/dokploy', headers: headers(other), payload: other })).statusCode).toBe(202); expect(claim).not.toHaveBeenCalled();
    const result = await app.inject({ method: 'POST', url: '/ops/deploy/dokploy', headers: headers(), payload });
    expect(result.statusCode).toBe(503); expect(result.body).not.toContain('secret-token-url'); await app.close();
  });
  it('disabled by default', async () => { const app = Fastify(); const relay = vi.fn(async () => true); await registerDeployOps(app, { env: {}, relay }); expect((await app.inject({ method: 'POST', url: '/ops/deploy/dokploy', headers: headers(), payload })).statusCode).toBe(404); expect(relay).not.toHaveBeenCalled(); await app.close(); });
});
