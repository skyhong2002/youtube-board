import Fastify from 'fastify';
import { expect, it } from 'vitest';
import { validImageOptimizationQuery } from '../../shared/image-policy.js';
import { registerUiProxy } from '../src/ui-proxy.js';

const canonical = 'https://i.ytimg.com/vi/FixtureAa01/mqdefault.jpg';
it('accepts only exact public video derivatives with bounded dimensions and no duplicate keys', () => {
  const valid = new URLSearchParams({ url: canonical, w: '320', q: '75' });
  expect(validImageOptimizationQuery(valid)).toBe(true);
  for (const source of ['http://i.ytimg.com/vi/FixtureAa01/mqdefault.jpg', canonical + '?x=1', canonical + '#x', canonical.replace('FixtureAa01', '..'), canonical.replace('FixtureAa01', 'short'), '/api/v1/home', 'https://127.0.0.1/x', canonical.replace('i.ytimg.com', 'i.ytimg.com.evil.test')]) {
    expect(validImageOptimizationQuery(new URLSearchParams({ url: source, w: '320', q: '75' }))).toBe(false);
  }
  for (const query of [valid + '&url=' + encodeURIComponent(canonical), valid + '&x=1', valid.toString().replace('w=320', 'w=3200'), valid.toString().replace('q=75', 'q=100'), valid.toString().replace('w=320', 'w=0320')]) expect(validImageOptimizationQuery(new URLSearchParams(query))).toBe(false);
});
it('rejects optimizer abuse at gateway before forwarding and passes valid requests without external calls', async () => {
  const ui = Fastify(); let forwarded = 0;
  ui.get('/_next/image', () => { forwarded++; return { synthetic: true }; });
  await ui.listen({ host: '127.0.0.1', port: 0 });
  const addr = ui.server.address(); if (!addr || typeof addr === 'string') throw new Error('No port');
  const app = Fastify();
  try {
    await registerUiProxy(app, { origin: `http://127.0.0.1:${addr.port}` });
    expect((await app.inject('/_next/image?url=/api/v1/home&w=320&q=75')).statusCode).toBe(400);
    // Encoded route-family aliases are rejected before reaching any optimizer.
    expect((await app.inject('/_next%2Fimage?url=/auth/me&w=320&q=75')).statusCode).toBe(404);
    expect(forwarded).toBe(0);
    expect((await app.inject('/_next/image?' + new URLSearchParams({ url: canonical, w: '320', q: '75' }))).json()).toEqual({ synthetic: true });
    expect(forwarded).toBe(1);
  } finally { await app.close(); await ui.close(); }
});
