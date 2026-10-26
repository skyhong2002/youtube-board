import { describe, expect, it } from 'vitest';
import Fastify from 'fastify';
import { registerAuth } from '../src/auth/index.js';
import { registerChannelAdmin, requestFromRow, type ChannelAdminStore, type Enqueued, type NewRequest } from '../src/channel-admin.js';
import { authEnv, memoryAuthStore } from './auth-fixture.js';

const now = new Date('2026-10-26T20:00:00Z'), UC = 'UCabcdefghijklmnopqrstuv', ID = '3f2b8c1e-5d4a-4e6f-9a7b-1c2d3e4f5a6b';
const cookie = (headers: Record<string, any>, name: string) => { const values = headers['set-cookie']; return (Array.isArray(values) ? values : [values]).find((v: string) => v?.startsWith(name + '='))?.split(';')[0] as string; };

function memoryChannelStore(outcome: Enqueued = 'created') {
  const queued: NewRequest[] = [];
  const store: ChannelAdminStore = {
    async enqueue(request) { queued.push(request); return outcome; },
    async list() { return [{ id: 1, requestId: ID, kind: 'create-tag', actor: 'user:1', payload: { kind: 'create-tag', name: '新分類' }, status: 'done', errorCode: null, result: { tagId: 115 }, createdAt: '2026-10-26T19:59:00.000Z', appliedAt: '2026-10-26T20:00:00.000Z' }]; },
  };
  return { store, queued };
}
async function setup(store: ChannelAdminStore | null) {
  let person = { sub: 'admin', email: 'admin@example.test', name: 'Admin', picture: null as string | null };
  const data = memoryAuthStore(), app = Fastify({ logger: false });
  const auth = await registerAuth(app, { env: authEnv, store: data.store, provider: { authenticate: async () => person }, clock: () => now });
  await registerChannelAdmin(app, auth, { store, clock: () => now });
  const login = async () => {
    const start = await app.inject('/auth/google?next=/admin'), url = new URL(start.headers.location!);
    const done = await app.inject({ url: '/auth/google/callback?state=' + url.searchParams.get('state') + '&code=x', headers: { cookie: cookie(start.headers, 'yt_dev_oauth') } });
    return cookie(done.headers, 'yt_dev_session');
  };
  const admin = await login();
  person = { sub: 'reader', email: 'reader@example.test', name: 'Reader', picture: null };
  const reader = await login();
  const tokens = new Map<string, string>();
  const csrf = async (session: string) => { if (!tokens.has(session)) tokens.set(session, (await app.inject({ url: '/auth/me', headers: { cookie: session } })).json().csrfToken as string); return tokens.get(session)!; };
  const write = async (session: string | null, body: unknown, headers: Record<string, string> = {}) => app.inject({
    method: 'POST', url: '/auth/admin/channel-requests', payload: body as never,
    headers: { ...(session ? { cookie: session, 'x-csrf-token': await csrf(session) } : {}), origin: authEnv.AUTH_PUBLIC_ORIGIN, 'sec-fetch-site': 'same-origin', ...headers },
  });
  return { app, admin, reader, write };
}
const valid = { requestId: ID, kind: 'set-tags', payload: { uId: 3, add: [5], remove: [] } };

describe('channel request routes', () => {
  it('are for the signed-in administrator only', async () => {
    const { app, admin, reader, write } = await setup(memoryChannelStore().store);
    expect((await app.inject('/auth/admin/channel-requests')).statusCode).toBe(401);
    expect((await app.inject({ url: '/auth/admin/channel-requests', headers: { cookie: reader } })).statusCode).toBe(403);
    const list = await app.inject({ url: '/auth/admin/channel-requests', headers: { cookie: admin } });
    expect(list.statusCode).toBe(200);
    expect(list.headers['cache-control']).toContain('no-store');
    expect(list.json()).toMatchObject({ generatedAt: now.toISOString(), requests: [{ id: 1, status: 'done', payload: { name: '新分類' } }] });
    expect((await write(null, valid)).statusCode).toBe(401);
    expect((await write(reader, valid)).statusCode).toBe(403);
  });

  it('queues a valid request for the signed-in administrator and answers 202 without waiting for the worker', async () => {
    const { store, queued } = memoryChannelStore();
    const { admin, write } = await setup(store);
    const response = await write(admin, valid);
    expect(response.statusCode).toBe(202);
    expect(response.json()).toEqual({ requestId: ID, status: 'pending' });
    expect(queued).toEqual([{ requestId: ID, kind: 'set-tags', actor: 'user:1', payload: { kind: 'set-tags', uId: 3, add: [5], remove: [] } }]);
  });

  it('refuses a write without the CSRF token, from another origin or from a cross-site request, and queues nothing', async () => {
    const { store, queued } = memoryChannelStore();
    const { app, admin, write } = await setup(store);
    const base = { method: 'POST' as const, url: '/auth/admin/channel-requests', payload: valid as never };
    expect((await app.inject({ ...base, headers: { cookie: admin, origin: authEnv.AUTH_PUBLIC_ORIGIN } })).statusCode).toBe(403);
    expect((await write(admin, valid, { origin: 'https://evil.example' })).statusCode).toBe(403);
    expect((await write(admin, valid, { 'sec-fetch-site': 'cross-site' })).statusCode).toBe(403);
    expect((await write(admin, valid, { 'x-csrf-token': 'wrong' })).statusCode).toBe(403);
    expect(queued).toEqual([]);
  });

  it('rejects malformed requests before they reach the queue', async () => {
    const { store, queued } = memoryChannelStore();
    const { admin, write } = await setup(store);
    for (const body of [
      {}, { ...valid, requestId: 'not-a-uuid' }, { ...valid, kind: 'drop-table' }, { ...valid, payload: undefined },
      { ...valid, payload: { uId: 3 } }, { ...valid, payload: { uId: 3, add: [1], remove: [1] } }, { ...valid, payload: { uId: '3', add: [1] } },
      { requestId: ID, kind: 'add-channel', payload: { source: 'https://evil.example/channel/' + UC } }, { requestId: ID, kind: 'add-channel', payload: { source: 'https://www.youtube.com/user/x' } },
      { requestId: ID, kind: 'create-tag', payload: { name: '' } }, { requestId: ID, kind: 'create-tag', payload: { name: 'x'.repeat(33) } },
    ]) expect((await write(admin, body)).statusCode, JSON.stringify(body)).toBe(400);
    expect(queued).toEqual([]);
  });

  it('accepts the three request kinds', async () => {
    const { store, queued } = memoryChannelStore();
    const { admin, write } = await setup(store);
    for (const body of [
      { requestId: ID, kind: 'add-channel', payload: { source: `https://www.youtube.com/channel/${UC}`, tags: [1] } },
      { requestId: ID.replace('3f', '4f'), kind: 'add-channel', payload: { source: '@abc.def' } },
      { requestId: ID.replace('3f', '5f'), kind: 'create-tag', payload: { name: '新分類' } },
    ]) expect((await write(admin, body)).statusCode).toBe(202);
    expect(queued.map(request => request.payload)).toEqual([{ kind: 'add-channel', source: UC, tags: [1] }, { kind: 'add-channel', source: '@abc.def', tags: [] }, { kind: 'create-tag', name: '新分類' }]);
  });

  it('answers a repeated request id with the same 202, refuses one reused for something else, and says when the queue is full', async () => {
    const replay = await setup(memoryChannelStore('replayed').store);
    expect((await replay.write(replay.admin, valid)).statusCode).toBe(202);
    const conflict = await setup(memoryChannelStore('conflict').store);
    expect((await conflict.write(conflict.admin, valid)).json()).toEqual({ error: { code: 'REQUEST_ID_CONFLICT' } });
    const full = await setup(memoryChannelStore('full').store);
    const response = await full.write(full.admin, valid);
    expect(response.statusCode).toBe(429);
    expect(response.headers['retry-after']).toBe('60');
    expect(response.json()).toEqual({ error: { code: 'QUEUE_FULL' } });
  });

  it('limits how fast one administrator can queue requests', async () => {
    const { store } = memoryChannelStore();
    const { admin, write } = await setup(store);
    const statuses: number[] = [];
    for (let i = 0; i < 62; i++) statuses.push((await write(admin, valid)).statusCode);
    expect(statuses.filter(code => code === 202)).toHaveLength(60);
    expect(statuses.slice(60)).toEqual([429, 429]);
  });

  it('reports the service unavailable when there is no own-state database, and hides a database failure behind a fixed code', async () => {
    const none = await setup(null);
    expect((await none.write(none.admin, valid)).statusCode).toBe(503);
    expect((await none.app.inject({ url: '/auth/admin/channel-requests', headers: { cookie: none.admin } })).statusCode).toBe(503);
    const broken = await setup({ enqueue: async () => { throw Object.assign(new Error('secret host 10.0.0.5'), { code: 'ECONNREFUSED' }); }, list: async () => { throw new Error('boom'); } });
    const response = await broken.write(broken.admin, valid);
    expect(response.statusCode).toBe(503);
    expect(response.body).not.toContain('10.0.0.5');
    expect((await broken.app.inject({ url: '/auth/admin/channel-requests', headers: { cookie: broken.admin } })).statusCode).toBe(500);
  });
});

describe('request rows', () => {
  const row = { id: '4', request_id: ID, kind: 'set-tags', actor: 'user:2', payload: JSON.stringify({ kind: 'set-tags', uId: 3, add: [5], remove: [] }), status: 'failed', error_code: 'TAGS_TOO_LONG', result: null, created_at: '2026-10-26 19:00:00', applied_at: '2026-10-26 19:01:00' };
  it('turn the stored UTC wall time and codes into the wire shape', () => {
    expect(requestFromRow(row as never)).toEqual({ id: 4, requestId: ID, kind: 'set-tags', actor: 'user:2', payload: { kind: 'set-tags', uId: 3, add: [5], remove: [] }, status: 'failed', errorCode: 'TAGS_TOO_LONG', result: null, createdAt: '2026-10-26T19:00:00.000Z', appliedAt: '2026-10-26T19:01:00.000Z' });
  });
  it('drop unreadable rows and unknown error codes rather than showing them', () => {
    expect(requestFromRow({ ...row, payload: '{broken' } as never)).toBeNull();
    expect(requestFromRow({ ...row, status: 'weird' } as never)).toBeNull();
    expect(requestFromRow({ ...row, created_at: null } as never)).toBeNull();
    expect(requestFromRow({ ...row, error_code: 'SQL: secret' } as never)?.errorCode).toBeNull();
    expect(requestFromRow({ ...row, status: 'done', error_code: null, result: '[1]' } as never)?.result).toBeNull();
  });
});
