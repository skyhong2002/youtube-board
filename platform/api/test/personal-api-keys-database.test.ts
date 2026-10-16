import {afterAll, beforeAll, describe, expect, it} from 'vitest';
import mysql, {type Connection, type RowDataPacket} from 'mysql2/promise';
import {createHash, randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {assertTestDatabaseUrl} from '../../shared/test-database.js';
import {mysqlApiKeyStore, newPersonalApiKey, type ApiKeyStore} from '../src/reader/api-key-store.js';
import {PERSONAL_API_KEYS_LIFETIME_MAX} from '../../shared/api-key-contracts.js';

const url = process.env.TEST_DATABASE_URL ? assertTestDatabaseUrl(process.env.TEST_DATABASE_URL) : undefined;
describe.skipIf(!url)('personal API keys in isolated own-state MariaDB', () => {
  let db: Connection, store: ApiKeyStore, otherProcess: ApiKeyStore;
  const users: string[] = [], prefix = 'api_key_fixture_' + randomUUID(), at = new Date('2032-08-08T04:00:00.123Z');
  const hash = (token: string) => createHash('sha256').update(token).digest('hex');
  async function user() {
    const sub = prefix + '_' + users.length;
    await db.execute('INSERT INTO ts_auth_users(google_sub,email,created_at,last_login_at) VALUES(?,?,?,?)', [sub, sub + '@example.test', '2032-08-08 04:00:00.123', '2032-08-08 04:00:00.123']);
    const [rows] = await db.query<RowDataPacket[]>('SELECT CAST(LAST_INSERT_ID() AS CHAR) AS id');
    const id = String(rows[0]!.id); users.push(id); return id;
  }
  beforeAll(async () => {
    db = await mysql.createConnection({uri: url!, dateStrings: true, timezone: 'Z', supportBigNumbers: true, bigNumberStrings: true});
    for (const name of ['012_accounts.sql', '016_reader_api_keys.sql']) {
      const ddl = await readFile(new URL('../../jobs/migrations/' + name, import.meta.url), 'utf8');
      for (const statement of ddl.split(';').map(s => s.trim()).filter(Boolean)) await db.query(statement);
    }
    store = mysqlApiKeyStore(url!); otherProcess = mysqlApiKeyStore(url!);
    expect(await store.ready()).toBe(true);
  });
  afterAll(async () => {
    await store?.close(); await otherProcess?.close();
    if (db) {
      for (const id of users) {
        await db.execute('DELETE FROM ts_reader_api_keys WHERE user_id=?', [id]);
        await db.execute('DELETE FROM ts_auth_users WHERE id=?', [id]);
      }
      await db.end();
    }
  });
  it('stores only SHA256+display prefix and lists safe UTC metadata', async () => {
    const id = await user(), issued = await store.issue(id, '我的腳本', at);
    expect(issued.token).toMatch(/^ytb_[A-Za-z0-9_-]{43}$/);
    expect(issued.key.createdAt).toBe(at.toISOString()); expect(issued.key.id).toMatch(/^[1-9]\d*$/);
    expect(issued.key.prefix).toBe(issued.token.slice(0, 12));
    const [rows] = await db.query<RowDataPacket[]>('SELECT * FROM ts_reader_api_keys WHERE id=?', [issued.key.id]);
    expect(rows[0]!.key_hash).toBe(hash(issued.token)); expect(JSON.stringify(rows)).not.toContain(issued.token);
    const list = await store.list(id);
    expect(list).toEqual([issued.key]); expect(JSON.stringify(list)).not.toMatch(/key_hash|user_id|token/);
  });
  it('two independent pools serialize concurrent count+insert at max3 per owner', async () => {
    const id = await user();
    const result = await Promise.allSettled(Array.from({length: 6}, (_, index) => (index % 2 ? otherProcess : store).issue(id, 'concurrent-' + index, at)));
    expect(result.filter(r => r.status === 'fulfilled')).toHaveLength(3);
    for (const r of result) if (r.status === 'rejected') expect(r.reason).toMatchObject({code: 'API_KEY_LIMIT', status: 409});
    const [rows] = await db.query<RowDataPacket[]>('SELECT COUNT(*) AS n FROM ts_reader_api_keys WHERE user_id=? AND revoked_at IS NULL', [id]);
    expect(Number(rows[0]!.n)).toBe(3);
    const issued = (result.find(r => r.status === 'fulfilled') as PromiseFulfilledResult<Awaited<ReturnType<ApiKeyStore['issue']>>>).value;
    expect(await store.revoke(id, issued.key.id, at)).toBe(true);
    await expect(otherProcess.issue(id, 'replacement', at)).resolves.toHaveProperty('token');
  });
  it('revocation is owner-only/idempotent and invalidates a previously positive lookup across stores', async () => {
    const a = await user(), b = await user(), issued = await store.issue(a, 'revocation', at);
    expect(await otherProcess.lookup(issued.token, at)).toEqual({keyId: issued.key.id,userId:a});
    expect(await otherProcess.revoke(b, issued.key.id, at)).toBe(false);
    expect(await otherProcess.lookup(issued.token, at)).toEqual({keyId: issued.key.id,userId:a});
    expect(await store.revoke(a, issued.key.id, at)).toBe(true);
    expect(await store.revoke(a, issued.key.id, new Date(+at + 1000))).toBe(true);
    expect(await otherProcess.lookup(issued.token, at)).toBeNull(); expect(await store.list(a)).toEqual([]);
    const [rows] = await db.query<RowDataPacket[]>('SELECT revoked_at FROM ts_reader_api_keys WHERE id=?', [issued.key.id]);
    expect(rows[0]!.revoked_at).toBe('2032-08-08 04:00:00.123');
  });
  it('disabled owners immediately lose key lookup and cannot issue/revoke through the store', async () => {
    const id = await user(), issued = await store.issue(id, 'disabled', at);
    expect(await otherProcess.lookup(issued.token, at)).toEqual({keyId: issued.key.id,userId:id});
    await db.execute('UPDATE ts_auth_users SET disabled_at=? WHERE id=?', ['2032-08-08 04:00:00.123', id]);
    expect(await otherProcess.lookup(issued.token, at)).toBeNull(); expect(await store.list(id)).toEqual([]);
    await expect(store.issue(id, 'no', at)).rejects.toMatchObject({code: 'ACCOUNT_UNAVAILABLE', status: 401});
    await expect(store.revoke(id, issued.key.id, at)).rejects.toMatchObject({code: 'ACCOUNT_UNAVAILABLE', status: 401});
  });
  it('last-used writes are throttled for60s even from another process', async () => {
    const id = await user(), issued = await store.issue(id, 'usage', at);
    const lastUsed = async () => (await store.list(id))[0]!.lastUsedAt;
    await store.lookup(issued.token, at); expect(await lastUsed()).toBe(at.toISOString());
    await otherProcess.lookup(issued.token, new Date(+at + 30000)); expect(await lastUsed()).toBe(at.toISOString());
    await store.lookup(issued.token, new Date(+at + 60000)); expect(await lastUsed()).toBe(new Date(+at + 60000).toISOString());
  });
  it('BIGINT key IDs remain exact through lookup, list and owner revocation', async () => {
    const owner = await user(), token = newPersonalApiKey(), id = '9007199254740993';
    // Existing table uses a string-safe AUTO_INCREMENT path; explicit high IDs
    // deliberately test mysql2 decoding beyond Number.MAX_SAFE_INTEGER.
    await db.execute('INSERT INTO ts_reader_api_keys(id,user_id,key_hash,prefix,label,created_at) VALUES(?,?,?,?,?,?)', [id, owner, hash(token), token.slice(0, 12), 'precision', '2032-08-08 04:00:00.123']);
    expect(await store.lookup(token, at)).toEqual({keyId: id,userId:owner}); expect((await store.list(owner))[0]!.id).toBe(id);
    expect(await store.revoke(owner, id, at)).toBe(true);
    const generated = await store.issue(owner, 'next precision', at);
    expect(BigInt(generated.key.id)).toBeGreaterThan(BigInt(id));
    expect(await otherProcess.lookup(generated.token, at)).toEqual({keyId: generated.key.id,userId:owner});
  });
  it('retains revoked history and serializes issuance at the100-row lifetime cap across pools',async()=>{
    const owner=await user(),stamp='2032-08-08 04:00:00.123';
    const history=Array.from({length:PERSONAL_API_KEYS_LIFETIME_MAX-1},()=>{
      const token=newPersonalApiKey();return [owner,hash(token),token.slice(0,12),'revoked fixture',stamp,stamp];
    });
    await db.query('INSERT INTO ts_reader_api_keys(user_id,key_hash,prefix,label,created_at,revoked_at) VALUES ?',[history]);
    const attempts=await Promise.allSettled([store.issue(owner,'last slot',at),otherProcess.issue(owner,'competing slot',at)]);
    expect(attempts.filter(result=>result.status==='fulfilled')).toHaveLength(1);
    expect((attempts.find(result=>result.status==='rejected') as PromiseRejectedResult).reason).toMatchObject({code:'API_KEY_LIFETIME_LIMIT',status:409});
    const issued=(attempts.find(result=>result.status==='fulfilled') as PromiseFulfilledResult<Awaited<ReturnType<ApiKeyStore['issue']>>>).value;
    await store.revoke(owner,issued.key.id,at);
    await expect(otherProcess.issue(owner,'cannot discard audit',at)).rejects.toMatchObject({code:'API_KEY_LIFETIME_LIMIT',status:409});
    const [rows]=await db.query<RowDataPacket[]>('SELECT COUNT(*) AS n,SUM(revoked_at IS NOT NULL) AS revoked FROM ts_reader_api_keys WHERE user_id=?',[owner]);
    expect(Number(rows[0]!.n)).toBe(PERSONAL_API_KEYS_LIFETIME_MAX);expect(Number(rows[0]!.revoked)).toBe(PERSONAL_API_KEYS_LIFETIME_MAX);
  });
});
