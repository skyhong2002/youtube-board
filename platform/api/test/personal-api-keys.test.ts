import {afterEach, expect, it, vi} from 'vitest';
import Fastify from 'fastify';
import mysql, {type Pool, type PoolConnection} from 'mysql2/promise';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {registerAuth} from '../src/auth/index.js';
import {authEnv, memoryAuthStore} from './auth-fixture.js';
import {registerPersonalApiKeys} from '../src/reader/api-keys.js';
import {apiKeyId, apiKeyLabel, ApiKeyStoreUnavailable, looksLikePersonalApiKey, mysqlApiKeyStore, newPersonalApiKey, type ApiKeyStore} from '../src/reader/api-key-store.js';
import type {PersonalApiKey} from '../../shared/api-key-contracts.js';

const at = new Date('2032-08-08T04:00:00.123Z'), clock = () => at;
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });
const sample: PersonalApiKey = {id: '9007199254740993', prefix: 'ytb_fixture1', label: 'Local script', createdAt: at.toISOString(), lastUsedAt: null, revokedAt: null};
function fixtureStore() {
  const token = newPersonalApiKey();
  const store: ApiKeyStore = {ready: vi.fn(async () => true), close: vi.fn(async () => {}),
    list: vi.fn(async id => id === '1' ? [sample] : []),
    issue: vi.fn(async () => ({key: sample, token})), revoke: vi.fn(async id => id === '1'), lookup: vi.fn(async () => null)};
  return {store, token};
}
const cookie = (headers: Record<string, unknown>, name: string) => {
  const list = headers['set-cookie'];
  return (Array.isArray(list) ? list : [list]).find((value: unknown) => typeof value === 'string' && value.startsWith(name + '='))?.split(';')[0] as string;
};

it('tokens have 256 random bits and canonical service syntax; labels and BIGINT IDs stay bounded', () => {
  const tokens = new Set(Array.from({length: 100}, newPersonalApiKey));
  expect(tokens.size).toBe(100);
  for (const token of tokens) { expect(looksLikePersonalApiKey(token)).toBe(true); expect(Buffer.from(token.slice(4), 'base64url')).toHaveLength(32); }
  for (const value of [null, [], 'tag_' + 'A'.repeat(43), 'ytb_' + 'A'.repeat(42) + 'B', 'ytb_' + 'A'.repeat(44), 'ytb_' + 'A'.repeat(43) + '\n'])
    expect(looksLikePersonalApiKey(value)).toBe(false);
  expect(apiKeyId('18446744073709551615')).toBe('18446744073709551615');
  expect(apiKeyId('9007199254740993')).toBe('9007199254740993');
  for (const id of ['0', '01', '-1', '1e3', '18446744073709551616', '9'.repeat(21), 1]) expect(() => apiKeyId(id)).toThrow();
  expect(apiKeyLabel('  測試腳本  ')).toBe('測試腳本');
  for (const label of ['', ' ', 'a'.repeat(65), '\u0000x', 'line\nbreak', '\uD800', '\u202Ename', 'x\u200Dy', '\uFEFFname', null]) expect(() => apiKeyLabel(label)).toThrow();
});

it('real session+CSRF protects key management; key headers cannot grant login/admin rights', async () => {
  const authData = memoryAuthStore(), {store, token} = fixtureStore(), app = Fastify({logger: false});
  let sub = 'key-reader-1';
  const auth = await registerAuth(app, {env: authEnv, store: authData.store, clock, provider: {authenticate: async () => ({sub, email: sub + '@example.test', name: null, picture: null})}});
  await registerPersonalApiKeys(app, auth, {store, clock});
  const login = async () => {
    const start = await app.inject('/auth/google'), state = new URL(start.headers.location!).searchParams.get('state');
    const done = await app.inject({url: '/auth/google/callback?state=' + state + '&code=fixture', headers: {cookie: cookie(start.headers, 'yt_dev_oauth')}});
    const session = cookie(done.headers, 'yt_dev_session'), me = await app.inject({url: '/auth/me', headers: {cookie: session}});
    return {cookie: session, origin: authEnv.AUTH_PUBLIC_ORIGIN, 'x-csrf-token': String(me.json().csrfToken)};
  };
  try {
    const anonymous = await app.inject({url: '/auth/me/api-keys', headers: {'x-api-key': token}});
    expect(anonymous.statusCode).toBe(401);
    expect((await app.inject({url: '/auth/users', headers: {'x-api-key': token}})).statusCode).toBe(401);
    const first = await login();
    expect((await app.inject({method: 'POST', url: '/auth/me/api-keys', headers: {cookie: first.cookie}, payload: {label: 'x'}})).statusCode).toBe(403);
    expect((await app.inject({method: 'POST', url: '/auth/me/api-keys', headers: {...first, origin: 'https://attacker.invalid'}, payload: {label: 'x'}})).statusCode).toBe(403);
    expect((await app.inject({url: '/auth/me/api-keys', headers: {...first, authorization: 'Bearer ' + token}})).statusCode).toBe(401);
    const issued = await app.inject({method: 'POST', url: '/auth/me/api-keys', headers: first, payload: {label: '  script  '}});
    expect(issued.statusCode).toBe(201); expect(issued.json()).toEqual({key: sample, token});
    expect(store.issue).toHaveBeenCalledWith('1', 'script', at);
    const listed = await app.inject({url: '/auth/me/api-keys', headers: first});
    expect(listed.json()).toEqual({keys: [sample]}); expect(listed.body).not.toContain(token); expect(listed.body).not.toContain('hash');
    sub = 'key-reader-2'; const second = await login();
    expect((await app.inject({url: '/auth/me/api-keys', headers: second})).json()).toEqual({keys: []});
    expect((await app.inject({method: 'DELETE', url: '/auth/me/api-keys/' + sample.id, headers: second})).statusCode).toBe(404);
    const revoked = await app.inject({method: 'DELETE', url: '/auth/me/api-keys/' + sample.id, headers: first});
    expect(revoked.json()).toEqual({revoked: true}); expect(store.revoke).toHaveBeenLastCalledWith('1', sample.id, at);
    for (const response of [anonymous, issued, listed, revoked]) {
      expect(response.headers['cache-control']).toBe('private, no-store');
      expect(response.headers['referrer-policy']).toBe('no-referrer'); expect(response.headers['x-robots-tag']).toBe('noindex');
    }
    expect(store.lookup).not.toHaveBeenCalled();
  } finally { await app.close(); }
  expect(store.close).not.toHaveBeenCalled(); // Shared quota store belongs to runtime.
});

async function simpleApp(store: ApiKeyStore) {
  const app = Fastify({logger: false});
  const auth = {enabled: true, origin: 'https://fixture.invalid', currentUser: async () => null,
    requireReader: async () => ({id: 1, email: 'fixture@example.test', name: null, picture: null, role: 'reader' as const, adminSource: null}),
    requireAdmin: async () => null, actor: () => 'user:1'};
  await registerPersonalApiKeys(app, auth, {store, clock});
  return app;
}
it('rejects extra/oversized input, malformed IDs and returns sanitized no-store errors', async () => {
  const {store, token} = fixtureStore(), app = await simpleApp(store);
  try {
    for (const payload of [{label: ''}, {label: 'a'.repeat(65)}, {label: 'x', key: token}, {}, []]) {
      const result = await app.inject({method: 'POST', url: '/auth/me/api-keys', payload});
      expect(result.statusCode).toBe(400); expect(result.headers['cache-control']).toContain('no-store');
    }
    expect((await app.inject({method: 'POST', url: '/auth/me/api-keys', payload: {label: 'a'.repeat(2048)}})).statusCode).toBe(413);
    expect((await app.inject({method: 'DELETE', url: '/auth/me/api-keys/01'})).statusCode).toBe(400);
    store.list = async () => { throw new ApiKeyStoreUnavailable(); };
    expect((await app.inject('/auth/me/api-keys')).json()).toEqual({error: {code: 'API_KEY_UNAVAILABLE'}});
    store.list = async () => { throw new Error('SELECT private-password ' + token); };
    const failed = await app.inject('/auth/me/api-keys');
    expect(failed.statusCode).toBe(500); expect(failed.body).not.toMatch(/SELECT|private-password|ytb_/);
  } finally { await app.close(); }
});
it('private mutation rate is bounded', async () => {
  const {store} = fixtureStore(), app = await simpleApp(store);
  try {
    for (let i = 0; i < 12; i++) expect((await app.inject({method: 'DELETE', url: '/auth/me/api-keys/1'})).statusCode).toBe(200);
    const limit = await app.inject({method: 'DELETE', url: '/auth/me/api-keys/1'});
    expect(limit.statusCode).toBe(429); expect(limit.headers['retry-after']).toBe('60'); expect(limit.headers['cache-control']).toContain('no-store');
  } finally { await app.close(); }
});
it('network limit rejects anonymous churn before session lookup', async () => {
  const {store} = fixtureStore(), app = Fastify({logger: false});
  const requireReader = vi.fn(async (_request, reply) => { reply.code(401).send({error: {code: 'SIGN_IN_REQUIRED'}}); return null; });
  await registerPersonalApiKeys(app, {enabled: true, origin: 'https://fixture.invalid', currentUser: async () => null,
    requireReader, requireAdmin: async () => null, actor: () => 'unused'}, {store, clock});
  try {
    for (let i = 0; i < 120; i++) expect((await app.inject('/auth/me/api-keys')).statusCode).toBe(401);
    const limited = await app.inject('/auth/me/api-keys'); expect(limited.statusCode).toBe(429);
    expect(requireReader).toHaveBeenCalledTimes(120); expect(store.list).not.toHaveBeenCalled();
    expect(limited.headers['cache-control']).toBe('private, no-store');
  } finally { await app.close(); }
});
it('missing key schema disables only its private surface', async () => {
  const {store} = fixtureStore(); store.ready = async () => false;
  const app = await simpleApp(store); app.get('/public', async () => ({ok: true}));
  try { expect((await app.inject('/auth/me/api-keys')).statusCode).toBe(503); expect((await app.inject('/public')).statusCode).toBe(200); }
  finally { await app.close(); }
});

it('uses a separate 2-connection/12-queue pool, rejects malformed tokens without SQL and sanitizes DB failures', async () => {
  const db = {query: vi.fn(async () => { throw new Error('mysql password/token/full sql'); }), destroy: vi.fn(), release: vi.fn()} as unknown as PoolConnection;
  const pool = {getConnection: vi.fn(async () => db), end: vi.fn(async () => {})} as unknown as Pool;
  const create = vi.spyOn(mysql, 'createPool').mockReturnValue(pool);
  const store = mysqlApiKeyStore('mysql://fixture.invalid/state');
  expect(create).toHaveBeenCalledWith(expect.objectContaining({connectionLimit: 2, queueLimit: 12, connectTimeout: 5000, bigNumberStrings: true, multipleStatements: false}));
  expect(await store.lookup('bad')).toBeNull(); expect(pool.getConnection).not.toHaveBeenCalled();
  await expect(store.lookup(newPersonalApiKey())).rejects.toEqual(new ApiKeyStoreUnavailable());
  expect(db.destroy).toHaveBeenCalledOnce();
  await store.close();
});
it('acquisition expires at 5s, caps pending work and releases late connections without exposing tokens', async () => {
  vi.useFakeTimers();
  const resolves: ((db: PoolConnection) => void)[] = [];
  const pool = {getConnection: vi.fn(() => new Promise<PoolConnection>(resolve => resolves.push(resolve))), end: vi.fn(async () => {})} as unknown as Pool;
  vi.spyOn(mysql, 'createPool').mockReturnValue(pool);
  const store = mysqlApiKeyStore('mysql://fixture.invalid/state');
  const pending = Array.from({length: 12}, () => store.list('1').catch(error => error));
  await expect(store.list('1')).rejects.toEqual(new ApiKeyStoreUnavailable());
  expect(pool.getConnection).toHaveBeenCalledTimes(12);
  await vi.advanceTimersByTimeAsync(5000);
  expect((await Promise.all(pending)).every(error => error instanceof ApiKeyStoreUnavailable)).toBe(true);
  const late = {release: vi.fn()} as unknown as PoolConnection;
  for (const resolve of resolves) resolve(late);
  await Promise.resolve(); expect(late.release).toHaveBeenCalledTimes(12);
  await store.close();
});
it('usage LRU is bounded to2000 IDs while every valid-token request rechecks authorization', async () => {
  const tokens = Array.from({length: 2001}, newPersonalApiKey), identity = new Map(tokens.map((token, i) => [createHash('sha256').update(token).digest('hex'), String(i + 1)]));
  let reads = 0, touches = 0;
  const db = {query: vi.fn(async (options: {sql: string; timeout: number}, args: unknown[] = []) => {
    expect(options.timeout).toBe(5000);
    expect(args.some(value => typeof value === 'string' && value.startsWith('ytb_'))).toBe(false);
    if (options.sql.startsWith('SELECT k.id')) { reads++; return [[{id: identity.get(String(args[0])),user_id:'9007199254740993'}], []]; }
    if (options.sql.startsWith('UPDATE ts_reader_api_keys')) touches++;
    return [[], []];
  }), release: vi.fn(), destroy: vi.fn()} as unknown as PoolConnection;
  vi.spyOn(mysql, 'createPool').mockReturnValue({getConnection: async () => db, end: async () => {}} as unknown as Pool);
  const store = mysqlApiKeyStore('mysql://fixture.invalid/state');
  for (const token of tokens) await store.lookup(token, at);
  expect(reads).toBe(2001); expect(touches).toBe(2001);
  await store.lookup(tokens[2000], new Date(+at + 1000)); expect(reads).toBe(2002); expect(touches).toBe(2001);
  // First ID was evicted, proving bounded bookkeeping. SQL's timestamp predicate
  // still prevents a real second write inside60s after an eviction/process restart.
  await store.lookup(tokens[0], new Date(+at + 1000)); expect(reads).toBe(2003); expect(touches).toBe(2002);
  await store.close();
});
it('fresh bootstrap contains the exact additive key DDL once', async () => {
  const ddl = await readFile(new URL('../../jobs/migrations/016_reader_api_keys.sql', import.meta.url), 'utf8');
  const fresh = await readFile(new URL('../../migrations/002-frontend-state.sql', import.meta.url), 'utf8');
  expect(fresh).toContain(ddl); expect(fresh.match(/CREATE TABLE IF NOT EXISTS ts_reader_api_keys/g)).toHaveLength(1);
  expect(ddl).not.toMatch(/(?:ALTER|DROP|INSERT|UPDATE)\s+(?:TABLE\s+)?urt_/i);
});

it('parameterizes active limits and refuses issuance at retained-history cap under the owner lock',async()=>{
 const {PERSONAL_API_KEYS_MAX,PERSONAL_API_KEYS_LIFETIME_MAX}=await import('../../shared/api-key-contracts.js');
 const observed:{sql:string;args:unknown[]}[]=[];
 const db={query:vi.fn(async(options:{sql:string},args:unknown[]=[])=>{
  observed.push({sql:options.sql,args});
  if(options.sql.includes('FROM ts_auth_users WHERE'))return [[{id:'1'}],[]];
  if(options.sql==='SELECT id FROM ts_reader_api_keys WHERE user_id=? LIMIT ?')return [Array.from({length:PERSONAL_API_KEYS_LIFETIME_MAX},(_,i)=>({id:String(i+1)})),[]];
  return [[],[]];
 }),release:vi.fn(),destroy:vi.fn()} as unknown as PoolConnection;
 vi.spyOn(mysql,'createPool').mockReturnValue({getConnection:async()=>db,end:async()=>{}} as unknown as Pool);
 const store=mysqlApiKeyStore('mysql://fixture.invalid/state');
 try{
  await store.list('1');await expect(store.issue('1','script',at)).rejects.toMatchObject({code:'API_KEY_LIFETIME_LIMIT',status:409});
  expect(observed.find(q=>q.sql.includes('ORDER BY k.id DESC'))).toMatchObject({args:['1',PERSONAL_API_KEYS_MAX]});
  expect(observed.find(q=>q.sql==='SELECT id FROM ts_reader_api_keys WHERE user_id=? AND revoked_at IS NULL LIMIT ?')).toMatchObject({args:['1',PERSONAL_API_KEYS_MAX]});
  const ownerAt=observed.findIndex(q=>q.sql.includes('FOR UPDATE')),historyAt=observed.findIndex(q=>q.sql==='SELECT id FROM ts_reader_api_keys WHERE user_id=? LIMIT ?');
  expect(ownerAt).toBeGreaterThan(-1);expect(historyAt).toBeGreaterThan(ownerAt);
  expect(observed[historyAt]!.args).toEqual(['1',PERSONAL_API_KEYS_LIFETIME_MAX]);
  expect(observed.some(q=>/INSERT|DELETE/.test(q.sql))).toBe(false);expect(db.destroy).toHaveBeenCalled();
 }finally{await store.close();}
});
it('exposes lifetime cap as sanitized409 from the private management route',async()=>{
 const {ApiKeyError}=await import('../src/reader/api-key-store.js'),{store}=fixtureStore();
 store.issue=async()=>{throw new ApiKeyError('API_KEY_LIFETIME_LIMIT',409);};
 const app=await simpleApp(store);
 try{const response=await app.inject({method:'POST',url:'/auth/me/api-keys',payload:{label:'script'}});expect(response.statusCode).toBe(409);expect(response.json()).toEqual({error:{code:'API_KEY_LIFETIME_LIMIT'}});expect(response.headers['cache-control']).toBe('private, no-store');}
 finally{await app.close();}
});
