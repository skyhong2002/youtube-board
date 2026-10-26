import { createHmac } from 'node:crypto';
import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { registerWebsub, type WebsubStore } from '../src/websub.js';
import { callbackToken, hubSecret, websubTopic } from '../../shared/websub.js';

const SECRET = 's'.repeat(40), CHANNEL = 'UC9EWrkZoT3agfx45s6FdVtQ', OTHER = 'UCxxxxxxxxxxxxxxxxxxxxxx', VIDEO = 'zpqFQ8ilYD0';
const env = { TS_WEBSUB_ENABLED: 'true', WEBSUB_SECRET: SECRET, APP_ENV: 'test' };
const atom = (channelId = CHANNEL, videoId = VIDEO) => `<?xml version='1.0' encoding='UTF-8'?><feed xmlns:yt="http://www.youtube.com/xml/schemas/2015" xmlns="http://www.w3.org/2005/Atom"><entry><id>yt:video:${videoId}</id><yt:videoId>${videoId}</yt:videoId><yt:channelId>${channelId}</yt:channelId><title>t</title></entry></feed>`;
const sign = (body: string, channelId = CHANNEL, algorithm = 'sha1') => `${algorithm}=${createHmac(algorithm, hubSecret(SECRET, channelId)).update(body).digest('hex')}`;
function memoryStore() {
  const pushed: string[] = [], leases: Record<string, number> = {}, counts: Record<string, number> = {};
  const store: WebsubStore = {
    async push(entries) { pushed.push(...entries.map(e => `${e.channelId}:${e.videoId}`)); },
    async count(field) { counts[field] = (counts[field] ?? 0) + 1; },
    async verified(channelId, lease) { leases[channelId] = lease; },
  };
  return { store, pushed, leases, counts };
}
async function build(overrides: Partial<typeof env> = {}) {
  const memory = memoryStore(), app = Fastify();
  await registerWebsub(app, { env: { ...env, ...overrides }, store: memory.store });
  return { app, ...memory };
}
const path = (channelId = CHANNEL, token = callbackToken(SECRET, channelId)) => `/websub/youtube/${channelId}/${token}`;

describe('WebSub callback', () => {
  it('is absent unless enabled with a long enough secret', async () => {
    for (const off of [{ TS_WEBSUB_ENABLED: 'false' }, { WEBSUB_SECRET: 'short' }]) {
      const { app } = await build(off);
      expect((await app.inject({ method: 'GET', url: path() })).statusCode).toBe(404);
    }
  });
  it('echoes the challenge for a subscribe request that names this channel topic, and records the lease', async () => {
    const { app, leases } = await build();
    const query = new URLSearchParams({ 'hub.mode': 'subscribe', 'hub.topic': websubTopic(CHANNEL), 'hub.challenge': 'abc-123', 'hub.lease_seconds': '432000' });
    const response = await app.inject({ method: 'GET', url: `${path()}?${query}` });
    expect(response.statusCode).toBe(200);
    expect(response.body).toBe('abc-123');
    expect(response.headers['cache-control']).toBe('no-store');
    expect(leases[CHANNEL]).toBe(432000);
  });
  it('refuses verification with a wrong token, topic, mode, challenge or lease', async () => {
    const { app, leases } = await build();
    const good = { 'hub.mode': 'subscribe', 'hub.topic': websubTopic(CHANNEL), 'hub.challenge': 'abc', 'hub.lease_seconds': '100' };
    const get = (url: string, query: Record<string, string>) => app.inject({ method: 'GET', url: `${url}?${new URLSearchParams(query)}` });
    expect((await get(path(CHANNEL, 'f'.repeat(32)), good)).statusCode).toBe(404);
    expect((await get(path(), { ...good, 'hub.topic': websubTopic(OTHER) })).statusCode).toBe(404);
    expect((await get(path(), { ...good, 'hub.mode': 'unsubscribe' })).statusCode).toBe(404);
    expect((await get(path(), { ...good, 'hub.challenge': 'has space' })).statusCode).toBe(404);
    expect((await get(path(), { ...good, 'hub.lease_seconds': '99999999999' })).statusCode).toBe(404);
    expect((await get(path('not-a-channel', 'x'), good)).statusCode).toBe(404);
    expect(leases).toEqual({});
  });
  it('queues the entries of a correctly signed notification', async () => {
    const { app, pushed } = await build();
    const body = atom();
    for (const algorithm of ['sha1', 'sha256']) {
      const response = await app.inject({ method: 'POST', url: path(), headers: { 'content-type': 'application/atom+xml', 'x-hub-signature': sign(body, CHANNEL, algorithm) }, payload: body });
      expect(response.statusCode).toBe(204);
    }
    expect(pushed).toEqual([`${CHANNEL}:${VIDEO}`, `${CHANNEL}:${VIDEO}`]);
  });
  it('rejects missing, wrong or other-channel signatures without queueing anything', async () => {
    const { app, pushed, counts } = await build();
    const body = atom(), post = (headers: Record<string, string>, payload = body) => app.inject({ method: 'POST', url: path(), headers: { 'content-type': 'application/atom+xml', ...headers }, payload });
    expect((await post({})).statusCode).toBe(403);
    expect((await post({ 'x-hub-signature': 'sha1=' + '0'.repeat(40) })).statusCode).toBe(403);
    expect((await post({ 'x-hub-signature': sign(body, OTHER) })).statusCode).toBe(403);
    expect((await post({ 'x-hub-signature': 'md5=abcd' })).statusCode).toBe(403);
    // A valid signature does not cover a different body.
    expect((await post({ 'x-hub-signature': sign(body) }, atom(CHANNEL, 'AAAAAAAAAAA'))).statusCode).toBe(403);
    expect(pushed).toEqual([]);
    expect(counts.rejected).toBe(5);
  });
  it('drops entries that belong to another channel than the signed URL', async () => {
    const { app, pushed } = await build();
    const body = atom(OTHER);
    const response = await app.inject({ method: 'POST', url: path(), headers: { 'content-type': 'application/atom+xml', 'x-hub-signature': sign(body) }, payload: body });
    expect(response.statusCode).toBe(204);
    expect(pushed).toEqual([]);
  });
  it('asks the hub to retry when Redis is unavailable', async () => {
    const app = Fastify();
    await registerWebsub(app, { env, store: { async push() { throw new Error('down'); }, async count() {}, async verified() { throw new Error('down'); } } });
    const body = atom();
    expect((await app.inject({ method: 'POST', url: path(), headers: { 'content-type': 'application/atom+xml', 'x-hub-signature': sign(body) }, payload: body })).statusCode).toBe(503);
    const query = new URLSearchParams({ 'hub.mode': 'subscribe', 'hub.topic': websubTopic(CHANNEL), 'hub.challenge': 'abc', 'hub.lease_seconds': '100' });
    expect((await app.inject({ method: 'GET', url: `${path()}?${query}` })).statusCode).toBe(503);
  });
});
