import proxy from '@fastify/http-proxy';
import type { FastifyInstance } from 'fastify';
import { validImageOptimizationQuery } from '../../shared/image-policy.js';

/** The gateway owns API/ops namespaces; the exact read-only console page reaches Next. */
export async function registerUiProxy(app: FastifyInstance, options: { origin: string }) {
  const origin = new URL(options.origin);
  if (!['http:', 'https:'].includes(origin.protocol) || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash) throw new Error('Invalid UI origin');
  await app.register(proxy, {
    upstream: origin.origin,
    prefix: '/',
    websocket: false,
    preHandler(request, reply, done) {
      let path = request.url.split('?')[0] ?? '';
      try {
        if (/%25[0-9a-f]{2}/i.test(path)) { reply.code(400).send({ error: { code: 'INVALID_PATH' } }); return; }
        path = new URL(decodeURIComponent(path).replaceAll('\\', '/').replace(/^\/+/, '/'), 'http://gateway.invalid').pathname; }
      catch { reply.code(400).send({ error: { code: 'INVALID_PATH' } }); return; }
      if (!['GET', 'HEAD'].includes(request.method)) { reply.code(405).header('Allow', 'GET, HEAD').send({ error: { code: 'METHOD_NOT_ALLOWED' } }); return; }
      if (path === '/_next/image' && !validImageOptimizationQuery(new URL(request.url, 'http://gateway.invalid').searchParams)) {
        reply.code(400).header('Cache-Control', 'no-store').send({ error: { code: 'INVALID_IMAGE' } }); return;
      }
      const ingestionConsole = /^\/ops\/ingestion\/?$/.test(path) && ['GET', 'HEAD'].includes(request.method);
      if ((/^\/(?:api|ops|auth)(?:\/|$)/.test(path) || /^\/feeds\/u(?:\/|$)/.test(path)) && !ingestionConsole) {
        reply.code(404).header('Cache-Control', 'no-store').send({ error: { code: 'NOT_FOUND' } });
        return;
      }
      done();
    },
    replyOptions: { rewriteRequestHeaders: (_request, headers) => { const safe = { ...headers }; delete safe.authorization; delete safe.cookie; delete safe['proxy-authorization']; return safe; } },
  });
}
