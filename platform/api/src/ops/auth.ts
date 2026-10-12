import { createHash, timingSafeEqual } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';

export function equalSecret(actual: string, expected: string): boolean {
  return timingSafeEqual(createHash('sha256').update(actual).digest(), createHash('sha256').update(expected).digest());
}

/** Token-only automation authentication. Production requires explicit CI mode;
 * browser administrators use the editorial session guard, never this token path. */
export function authorizeOps(env: NodeJS.ProcessEnv, request: FastifyRequest, reply: FastifyReply): boolean {
  reply.header('Cache-Control', 'no-store');
  const token = env.TS_OPS_TOKEN;
  if (!token || token.length < 32) { reply.code(404).send({ error: { code: 'OPS_DISABLED' } }); return false; }
  if ((env.APP_ENV ?? env.NODE_ENV) === 'production') {
    if (env.TS_OPS_SERVICE_AUTH_ENABLED !== 'true') {
      reply.code(403).send({ error: { code: 'OPS_SERVICE_AUTH_DISABLED' } }); return false;
    }
    if (request.headers.cookie !== undefined || request.headers.origin !== undefined || Object.keys(request.headers).some(name => name.startsWith('sec-fetch-'))) {
      reply.code(403).send({ error: { code: 'OPS_SERVICE_CLIENT_REQUIRED' } }); return false;
    }
  }
  const value = request.headers.authorization;
  if (!value || !equalSecret(value, `Bearer ${token}`)) {
    reply.code(401).header('WWW-Authenticate', 'Bearer').send({ error: { code: 'UNAUTHORIZED' } }); return false;
  }
  // A browser mutation must originate at the explicitly configured public site.
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    const origin = request.headers.origin;
    let expected: string | undefined;
    try { expected = env.YOUTUBE_PUBLIC_URL ? new URL(env.YOUTUBE_PUBLIC_URL).origin : undefined; } catch { /* fail closed */ }
    if ((origin && origin !== expected) || request.headers['sec-fetch-site'] === 'cross-site') {
      reply.code(403).send({ error: { code: 'ORIGIN_REJECTED' } }); return false;
    }
  }
  return true;
}
