import mysql from 'mysql2/promise';
import type { FastifyInstance, FastifyReply } from 'fastify';
import {
  WEBSUB_CHANNEL_ID, WEBSUB_MAX_LEASE_SECONDS, callbackToken, parseNotification, safeEqual, verifyHubSignature, websubSecret, websubTopic,
  type WebsubEntry,
} from '../../shared/websub.js';

export interface WebsubStore {
  /** Append the notices of one signed notification. */
  notice(entries: WebsubEntry[]): Promise<void>;
  /** The hub verified a subscription: record the lease it will honour. */
  verified(channelId: string, leaseSeconds: number): Promise<void>;
  close?(): Promise<void>;
}
export interface WebsubOptions { env?: NodeJS.ProcessEnv; store?: WebsubStore; databaseUrl?: string }

/**
 * Append-only writer over the web's own-state principal, which holds INSERT (and SELECT) on `ts_websub_events` and
 * nothing else there. The pool is small and its queue bounded: when the database is slow the hub gets a 503 and retries.
 */
export function websubStore(databaseUrl: string): WebsubStore {
  const pool = mysql.createPool({ uri: databaseUrl, connectionLimit: 2, queueLimit: 16, connectTimeout: 3000, dateStrings: true, timezone: 'Z', supportBigNumbers: true, bigNumberStrings: true, multipleStatements: false });
  return {
    async notice(entries) {
      await pool.query(`INSERT INTO ts_websub_events (kind, channel_id, video_id, lease_seconds, received_at) VALUES ${entries.map(() => "('notice', ?, ?, NULL, UTC_TIMESTAMP())").join(',')}`, entries.flatMap(entry => [entry.channelId, entry.videoId]));
    },
    async verified(channelId, leaseSeconds) {
      await pool.query("INSERT INTO ts_websub_events (kind, channel_id, video_id, lease_seconds, received_at) VALUES ('verify', ?, NULL, ?, UTC_TIMESTAMP())", [channelId, leaseSeconds]);
    },
    async close() { await pool.end(); },
  };
}

/**
 * WebSub callback for YouTube channel feeds. Off unless `TS_WEBSUB_ENABLED=true`, `WEBSUB_SECRET` is set and a store
 * (or the own-state database URL) is given; the paths then fall through to the UI like any unknown path. The channel id
 * and a token derived from the secret are in the URL, and notification bodies are checked against a per-channel HMAC,
 * so an unsigned request writes nothing and the receiver never reads the database.
 */
export async function registerWebsub(app: FastifyInstance, options: WebsubOptions = {}) {
  const env = options.env ?? process.env, secret = websubSecret(env);
  if (!secret) return;
  const store = options.store ?? (options.databaseUrl ? websubStore(options.databaseUrl) : undefined);
  if (!store) { process.stderr.write(JSON.stringify({ event: 'websub-disabled', reason: 'no own-state database' }) + '\n'); return; }
  app.addHook('onClose', async () => { await store.close?.(); });
  await app.register(async websub => {
    for (const type of ['application/atom+xml', 'application/xml', 'text/xml']) websub.addContentTypeParser(type, { parseAs: 'buffer', bodyLimit: 65536 }, (_request, body, done) => done(null, body));
    const reject = (reply: FastifyReply, status: number) => reply.code(status).send({ error: { code: status === 403 ? 'SIGNATURE_REJECTED' : 'NOT_FOUND' } });
    const unavailable = (reply: FastifyReply) => reply.code(503).send({ error: { code: 'WEBSUB_UNAVAILABLE' } });
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
      try { await store.verified(params.channelId!, lease); } catch { return unavailable(reply); }
      return reply.code(200).type('text/plain').send(challenge);
    });
    websub.post('/websub/youtube/:channelId/:token', { bodyLimit: 65536 }, async (request, reply) => {
      reply.header('Cache-Control', 'no-store');
      const params = request.params as { channelId?: string; token?: string };
      if (!authorized(params)) return reject(reply, 404);
      if (!Buffer.isBuffer(request.body) || !verifyHubSignature(secret, params.channelId!, request.body, request.headers['x-hub-signature'])) return reject(reply, 403);
      // A notice for another channel than the URL's would be a hub bug; only the signed channel's entries count.
      const entries = parseNotification(request.body.toString('utf8')).filter(entry => entry.channelId === params.channelId);
      if (entries.length) {
        try { await store.notice(entries); } catch { return unavailable(reply); }
      }
      return reply.code(204).send();
    });
  });
}
