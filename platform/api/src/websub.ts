import { Redis } from 'ioredis';
import type { FastifyInstance, FastifyReply } from 'fastify';
import {
  WEBSUB_CHANNEL_ID, WEBSUB_EVENT_CAP, WEBSUB_MAX_LEASE_SECONDS, callbackToken, encodeEvent, parseNotification, safeEqual, verifyHubSignature, websubKeys, websubSecret, websubTopic,
  type WebsubEntry,
} from '../../shared/websub.js';

export interface WebsubStore {
  push(entries: WebsubEntry[]): Promise<void>;
  count(field: string): Promise<void>;
  /** The hub verified a subscription: remember the lease it will honour. */
  verified(channelId: string, leaseSeconds: number): Promise<void>;
  close?(): Promise<void>;
}
export interface WebsubOptions { env?: NodeJS.ProcessEnv; store?: WebsubStore }

/** One lazily connected, bounded client: a Redis outage fails requests (the hub retries) and never queues them. */
export function websubStore(env: NodeJS.ProcessEnv): WebsubStore {
  const url = new URL(env.REDIS_URL ?? 'redis://127.0.0.1:26379/0');
  if (env.APP_ENV !== 'production' && !['127.0.0.1', 'localhost', 'redis'].includes(url.hostname)) throw new Error('Non-local WebSub Redis is forbidden');
  const redis = new Redis(url.toString(), { lazyConnect: true, connectTimeout: 2000, commandTimeout: 2000, maxRetriesPerRequest: 1, enableOfflineQueue: false, retryStrategy: times => Math.min(times * 200, 2000) });
  redis.on('error', () => {});
  const ready = async () => { if (redis.status === 'wait') await redis.connect(); };
  return {
    async push(entries) {
      await ready();
      await redis.multi().lpush(websubKeys.events, ...entries.map(encodeEvent)).ltrim(websubKeys.events, 0, WEBSUB_EVENT_CAP - 1).hincrby(websubKeys.stats, 'received', entries.length).exec();
    },
    async count(field) { await ready(); await redis.hincrby(websubKeys.stats, field, 1); },
    async verified(channelId, leaseSeconds) { await ready(); await redis.hset(websubKeys.leases, channelId, String(Date.now() + leaseSeconds * 1000)); },
    async close() { redis.disconnect(); },
  };
}

/**
 * WebSub callback for YouTube channel feeds. Off unless `TS_WEBSUB_ENABLED=true` and `WEBSUB_SECRET` is set,
 * in which case the paths fall through to the UI like any unknown path. The channel id and a token derived
 * from the secret are in the URL, and notification bodies are checked against a per-channel HMAC, so nothing
 * here reads the database and an unsigned request changes nothing.
 */
export async function registerWebsub(app: FastifyInstance, options: WebsubOptions = {}) {
  const env = options.env ?? process.env, secret = websubSecret(env);
  if (!secret) return;
  let store = options.store;
  const redis = () => store ??= websubStore(env);
  app.addHook('onClose', async () => { await store?.close?.(); });
  await app.register(async websub => {
    for (const type of ['application/atom+xml', 'application/xml', 'text/xml']) websub.addContentTypeParser(type, { parseAs: 'buffer', bodyLimit: 65536 }, (_request, body, done) => done(null, body));
    const reject = (reply: FastifyReply, status: number) => reply.code(status).send({ error: { code: status === 403 ? 'SIGNATURE_REJECTED' : 'NOT_FOUND' } });
    const authorized = (params: { channelId?: string; token?: string }) => typeof params.channelId === 'string' && WEBSUB_CHANNEL_ID.test(params.channelId) && typeof params.token === 'string' && safeEqual(params.token, callbackToken(secret, params.channelId));
    // Subscription verification: echo the challenge only for a subscribe request this channel's callback URL was given for.
    websub.get('/websub/youtube/:channelId/:token', async (request, reply) => {
      reply.header('Cache-Control', 'no-store');
      const params = request.params as { channelId?: string; token?: string }, query = request.query as Record<string, unknown>;
      if (!authorized(params)) return reject(reply, 404);
      if (query['hub.mode'] === 'denied') return reply.code(200).type('text/plain').send('');
      const challenge = query['hub.challenge'], lease = Number(query['hub.lease_seconds']);
      if (query['hub.mode'] !== 'subscribe' || query['hub.topic'] !== websubTopic(params.channelId!) || typeof challenge !== 'string' || !/^[\x21-\x7e]{1,200}$/.test(challenge)
        || !Number.isInteger(lease) || lease < 1 || lease > WEBSUB_MAX_LEASE_SECONDS) return reject(reply, 404);
      try { await redis().verified(params.channelId!, lease); } catch { return reply.code(503).send({ error: { code: 'WEBSUB_UNAVAILABLE' } }); }
      return reply.code(200).type('text/plain').send(challenge);
    });
    websub.post('/websub/youtube/:channelId/:token', { bodyLimit: 65536 }, async (request, reply) => {
      reply.header('Cache-Control', 'no-store');
      const params = request.params as { channelId?: string; token?: string };
      if (!authorized(params)) return reject(reply, 404);
      if (!Buffer.isBuffer(request.body) || !verifyHubSignature(secret, params.channelId!, request.body, request.headers['x-hub-signature'])) {
        await redis().count('rejected').catch(() => {});
        return reject(reply, 403);
      }
      // A notice for another channel than the URL's would be a hub bug; only the signed channel's entries count.
      const entries = parseNotification(request.body.toString('utf8')).filter(entry => entry.channelId === params.channelId);
      if (entries.length) {
        try { await redis().push(entries); } catch { return reply.code(503).send({ error: { code: 'WEBSUB_UNAVAILABLE' } }); }
      }
      return reply.code(204).send();
    });
  });
}
