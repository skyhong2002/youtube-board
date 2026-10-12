import { createHash, createHmac } from 'node:crypto';
import { Redis } from 'ioredis';
import type { FastifyInstance } from 'fastify';
import { equalSecret } from './auth.js';

export interface DeliveryStore { claim(key: string): Promise<boolean>; close?(): Promise<void> }
export interface DeployOpsOptions { env?: NodeJS.ProcessEnv; deliveries?: DeliveryStore; relay?: (url: string) => Promise<boolean> }
export function deliveryStore(env: NodeJS.ProcessEnv): DeliveryStore {
  const url = new URL(env.REDIS_URL ?? 'redis://127.0.0.1:26379/0');
  if (env.APP_ENV !== 'production' && !['127.0.0.1', 'localhost', 'redis'].includes(url.hostname)) throw new Error('Non-local relay Redis is forbidden');
  const clients = new Set<Redis>();
  return {
    async claim(key) {
      // Infrequent deploy events get isolated bounded connections: no shared
      // startup race, and a transient outage cannot poison future requests.
      const redis = new Redis(url.toString(), { lazyConnect: true, connectTimeout: 2000, commandTimeout: 2000, maxRetriesPerRequest: 1, enableOfflineQueue: false, retryStrategy: () => null });
      clients.add(redis); redis.on('error', () => {});
      try { await redis.connect(); return await redis.set(`yt-ts:deploy:${key}`, 'claimed', 'EX', 30 * 86400, 'NX') === 'OK'; }
      finally { redis.disconnect(); clients.delete(redis); }
    },
    async close() { for (const redis of clients) redis.disconnect(); },
  };
}
export async function registerDeployOps(app: FastifyInstance, options: DeployOpsOptions = {}) {
  const env = options.env ?? process.env;
  let store = options.deliveries;
  const relay = options.relay ?? (async (url: string) => {
    const response = await fetch(url, { method: 'POST', redirect: 'error', headers: { 'Content-Type': 'application/json', 'X-GitHub-Event': 'push' }, body: JSON.stringify({ ref: 'refs/heads/main' }), signal: AbortSignal.timeout(15000) });
    await response.body?.cancel(); return response.ok;
  });
  // Scope the raw JSON parser to the webhook; HMAC covers the exact request bytes.
  await app.register(async deploy => {
    deploy.removeContentTypeParser('application/json');
    deploy.addContentTypeParser('application/json', { parseAs: 'buffer', bodyLimit: 1024 * 1024 }, (_request, body, done) => done(null, body));
    deploy.post('/ops/deploy/dokploy', { bodyLimit: 1024 * 1024 }, async (request, reply) => {
      reply.header('Cache-Control', 'no-store');
      const secret = env.DOKPLOY_DEPLOY_RELAY_SECRET, url = env.DOKPLOY_DEPLOY_WEBHOOK_URL, repo = env.TS_DEPLOY_REPOSITORY;
      if (env.TS_DEPLOY_RELAY_ENABLED !== 'true' || !secret || secret.length < 32 || !url || !repo) return reply.code(404).send({ error: { code: 'RELAY_DISABLED' } });
      if (!Buffer.isBuffer(request.body)) return reply.code(400).send({ error: { code: 'INVALID_BODY' } });
      const expected = 'sha256=' + createHmac('sha256', secret).update(request.body).digest('hex');
      const signature = request.headers['x-hub-signature-256'];
      if (typeof signature !== 'string' || !equalSecret(signature, expected)) return reply.code(403).send({ error: { code: 'SIGNATURE_REJECTED' } });
      let body;
      try { body = JSON.parse(request.body.toString('utf8')); } catch { return reply.code(400).send({ error: { code: 'INVALID_JSON' } }); }
      if (request.headers['x-github-event'] !== 'push' || body?.ref !== 'refs/heads/main' || body?.repository?.full_name !== repo || body?.deleted === true) return reply.code(202).send({ status: 'ignored' });
      const delivery = request.headers['x-github-delivery'];
      if (typeof delivery !== 'string' || !/^[a-zA-Z0-9-]{1,100}$/.test(delivery) || !/^[a-f0-9]{40,64}$/.test(body?.after ?? '')) return reply.code(400).send({ error: { code: 'INVALID_DELIVERY' } });
      try {
        const target = new URL(url);
        if (!['http:', 'https:'].includes(target.protocol) || target.username || target.password) throw new Error('Invalid relay target');
        store ??= deliveryStore(env);
        // Bind idempotence to signed commit content, not an unsigned delivery header.
        const key = createHash('sha256').update(`${repo}\n${body.after}`).digest('hex');
        if (!await store.claim(key)) return reply.code(202).send({ status: 'already-claimed' });
        // Keep the claim on errors/timeouts: the remote deploy may have accepted the request.
        // Explicit operator inspection is required before retrying an ambiguous deployment.
        process.stdout.write(JSON.stringify({ event: 'deployment-claimed', commit: body.after, delivery, claim: key }) + '\n');
        const accepted = await relay(url);
        process.stdout.write(JSON.stringify({ event: 'deployment-relayed', commit: body.after, claim: key, accepted }) + '\n');
        return accepted ? { status: 'deploy-requested', deploymentTarget: 'current-main-head' } : reply.code(502).send({ error: { code: 'DEPLOY_UNCONFIRMED' } });
      } catch { return reply.code(503).send({ error: { code: 'RELAY_UNAVAILABLE' } }); }
    });
  });
  app.addHook('onClose', async () => { await store?.close?.(); });
}
