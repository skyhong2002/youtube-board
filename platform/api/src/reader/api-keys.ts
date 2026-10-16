import type {FastifyInstance, FastifyReply, FastifyRequest} from 'fastify';
import {privateAuthReply, type AuthRuntime} from '../auth/index.js';
import {AuthStoreFailure} from '../auth/store.js';
import {boundedLimiter, clientNetwork, RateLimitError} from '../rate-limit.js';
import {ingressClientIp} from '../ingress-client-ip.js';
import {ApiKeyError, ApiKeyStoreUnavailable, apiKeyId, apiKeyLabel, mysqlApiKeyStore, type ApiKeyStore} from './api-key-store.js';
import type {IssuedPersonalApiKey, PersonalApiKeys, RevokedPersonalApiKey} from '../../../shared/api-key-contracts.js';

export interface PersonalApiKeyOptions { databaseUrl?: string; store?: ApiKeyStore | null; clock?: () => Date }
export async function registerPersonalApiKeys(app: FastifyInstance, auth: AuthRuntime, options: PersonalApiKeyOptions = {}): Promise<{available: boolean}> {
  const clock = options.clock ?? (() => new Date());
  // Injected store can also serve the public quota hook; its caller owns shutdown.
  const ownsStore = options.store === undefined && auth.enabled && !!options.databaseUrl;
  const store = options.store !== undefined ? options.store : ownsStore ? mysqlApiKeyStore(options.databaseUrl!) : null;
  const available = !!store && await store.ready().catch(() => false);
  if (ownsStore && store) app.addHook('onClose', async () => { await store.close(); });
  const network = boundedLimiter(120, 60000, 12000), reads = boundedLimiter(60, 60000, 12000), writes = boundedLimiter(12, 60000, 1200);
  await app.register(async routes => {
    routes.addHook('onRequest', async (request, reply) => {
      privateAuthReply(reply);
      if (!network(clientNetwork(ingressClientIp(request)), +clock()))
        return reply.header('Retry-After', '60').code(429).send({error: {code: 'RATE_LIMITED'}});
    });
    routes.setErrorHandler((error, _request, reply) => {
      privateAuthReply(reply);
      if (error instanceof RateLimitError) return reply.header('Retry-After', String(error.retryAfter)).code(429).send({error: {code: 'RATE_LIMITED'}});
      if (error instanceof ApiKeyError) return reply.code(error.status).send({error: {code: error.code}});
      if (error instanceof ApiKeyStoreUnavailable || error instanceof AuthStoreFailure)
        return reply.code(503).send({error: {code: 'API_KEY_UNAVAILABLE'}});
      const status = error && typeof error === 'object' && 'statusCode' in error ? error.statusCode : undefined;
      if (typeof status === 'number' && status >= 400 && status < 500) return reply.code(status).send({error: {code: 'INVALID_REQUEST'}});
      return reply.code(500).send({error: {code: 'API_KEY_FAILED'}});
    });
    const user = async (request: FastifyRequest, reply: FastifyReply, write = false) => {
      const current = await auth.requireReader(request, reply, write);
      if (!current) return null;
      if (!available) { reply.code(503).send({error: {code: 'API_KEY_UNAVAILABLE'}}); return null; }
      const id = String(current.id);
      if (!(write ? writes : reads)(id, +clock())) { reply.header('Retry-After', '60').code(429).send({error: {code: 'RATE_LIMITED'}}); return null; }
      return apiKeyId(id);
    };
    routes.get('/auth/me/api-keys', async (request, reply) => {
      const id = await user(request, reply);
      if (!id) return reply;
      return {keys: await store!.list(id)} satisfies PersonalApiKeys;
    });
    routes.post('/auth/me/api-keys', {bodyLimit: 1024}, async (request, reply) => {
      const id = await user(request, reply, true);
      if (!id) return reply;
      const body = request.body;
      if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length !== 1 || !Object.hasOwn(body, 'label'))
        throw new ApiKeyError('INVALID_REQUEST');
      const label = apiKeyLabel((body as {label: unknown}).label);
      return reply.code(201).send(await store!.issue(id, label, clock()) satisfies IssuedPersonalApiKey);
    });
    routes.delete<{Params: {id: string}}>('/auth/me/api-keys/:id', async (request, reply) => {
      const id = await user(request, reply, true);
      if (!id) return reply;
      if (!await store!.revoke(id, apiKeyId(request.params.id), clock())) throw new ApiKeyError('API_KEY_NOT_FOUND', 404);
      return {revoked: true} satisfies RevokedPersonalApiKey;
    });
  });
  return {available};
}
