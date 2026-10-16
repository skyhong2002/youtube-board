import {createHash, randomBytes} from 'node:crypto';
import mysql, {type Pool, type PoolConnection, type RowDataPacket} from 'mysql2/promise';
import {PERSONAL_API_KEYS_MAX, PERSONAL_API_KEYS_LIFETIME_MAX, PERSONAL_API_KEY_LABEL_MAX, type IssuedPersonalApiKey, type PersonalApiKey} from '../../../shared/api-key-contracts.js';

export class ApiKeyError extends Error {
  constructor(public readonly code: string, public readonly status = 400) { super(code); }
}
/** Deliberately excludes SQL, parameters, database addresses and nested causes. */
export class ApiKeyStoreUnavailable extends Error {
  constructor() { super('API_KEY_UNAVAILABLE'); }
}
/** Internal quota identity only; never include userId in public key metadata. */
export interface ApiKeyIdentity { keyId: string; userId: string }
export interface ApiKeyStore {
  ready(): Promise<boolean>;
  close(): Promise<void>;
  list(userId: string): Promise<PersonalApiKey[]>;
  issue(userId: string, label: string, at: Date): Promise<IssuedPersonalApiKey>;
  revoke(userId: string, keyId: string, at: Date): Promise<boolean>;
  /** No positive authorization cache: every well-formed token checks current DB state. */
  lookup(token: unknown, at?: Date): Promise<ApiKeyIdentity | null>;
}

export function apiKeyId(value: unknown): string {
  if (typeof value !== 'string' || !/^[1-9]\d{0,19}$/.test(value) || BigInt(value) > 18446744073709551615n)
    throw new ApiKeyError('INVALID_API_KEY_ID');
  return value;
}
export function apiKeyLabel(value: unknown): string {
  if (typeof value !== 'string'||/[\p{Cf}]/u.test(value)) throw new ApiKeyError('INVALID_API_KEY_LABEL');
  const label = value.trim();
  if (!label || label.length > PERSONAL_API_KEY_LABEL_MAX || /[\p{Cc}\p{Cf}\p{Cs}]/u.test(label))
    throw new ApiKeyError('INVALID_API_KEY_LABEL');
  return label;
}
/** 256 random bits, distinct service prefix; prefix disclosure leaves 208 secret bits. */
export function newPersonalApiKey(): string { return 'ytb_' + randomBytes(32).toString('base64url'); }
export function looksLikePersonalApiKey(value: unknown): value is string {
  return typeof value === 'string' && /^ytb_[A-Za-z0-9_-]{43}$/.test(value) &&
    Buffer.from(value.slice(4), 'base64url').toString('base64url') === value.slice(4);
}
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const utcSql = (date: Date) => {
  if (!Number.isFinite(+date)) throw new ApiKeyError('INVALID_API_KEY_TIME');
  return date.toISOString().slice(0, 23).replace('T', ' ');
};
function wireTime(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d(?:\.\d{1,3})?$/.test(value)) throw new ApiKeyStoreUnavailable();
  const date = new Date(value.replace(' ', 'T') + 'Z');
  if (!Number.isFinite(+date)) throw new ApiKeyStoreUnavailable();
  return date.toISOString();
}
const projection = 'k.id,k.prefix,k.label,k.created_at,k.last_used_at,k.revoked_at';
function keyView(row: RowDataPacket): PersonalApiKey {
  return {id: apiKeyId(String(row.id)), prefix: String(row.prefix), label: String(row.label),
    createdAt: wireTime(row.created_at), lastUsedAt: row.last_used_at === null ? null : wireTime(row.last_used_at),
    revokedAt: row.revoked_at === null ? null : wireTime(row.revoked_at)};
}
const query = async (db: PoolConnection, statement: string, params: unknown[] = []) =>
  (await db.query<RowDataPacket[]>({sql: statement, timeout: 5000}, params))[0];

/** Separate own-state pool: bounded acquisition, queue, connections and each SQL call. */
export function mysqlApiKeyStore(databaseUrl: string): ApiKeyStore {
  let pool: Pool;
  try {
    pool = mysql.createPool({uri: databaseUrl, connectionLimit: 2, queueLimit: 12, waitForConnections: true,
      connectTimeout: 5000, dateStrings: true, timezone: 'Z', supportBigNumbers: true,
      bigNumberStrings: true, multipleStatements: false});
  } catch { throw new ApiKeyStoreUnavailable(); }
  let pending = 0;
  async function acquire(): Promise<PoolConnection> {
    if (pending >= 12) throw new ApiKeyStoreUnavailable();
    pending++;
    return new Promise((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => { settled = true; reject(new ApiKeyStoreUnavailable()); }, 5000);
      pool.getConnection().then(db => {
        pending--;
        if (settled) { db.release(); return; }
        settled = true; clearTimeout(timer); resolve(db);
      }, () => {
        pending--;
        if (!settled) { settled = true; clearTimeout(timer); reject(new ApiKeyStoreUnavailable()); }
      });
    });
  }
  async function use<T>(work: (db: PoolConnection) => Promise<T>, transaction = false): Promise<T> {
    let db: PoolConnection | undefined;
    try {
      db = await acquire();
      await query(db, "SET SESSION time_zone='+00:00',innodb_lock_wait_timeout=5,max_statement_time=5");
      if (transaction) await query(db, 'START TRANSACTION');
      const result = await work(db);
      if (transaction) await query(db, 'COMMIT');
      db.release();
      return result;
    } catch (error) {
      // Closing also rolls back any open transaction; never return a failed connection.
      db?.destroy();
      if (error instanceof ApiKeyError) throw error;
      throw new ApiKeyStoreUnavailable();
    }
  }
  const owner = async (db: PoolConnection, userId: string) => {
    const rows = await query(db, 'SELECT id FROM ts_auth_users WHERE id=? AND disabled_at IS NULL FOR UPDATE', [userId]);
    if (!rows.length) throw new ApiKeyError('ACCOUNT_UNAVAILABLE', 401);
  };
  // Usage metadata only, never an authorization cache. IDs (not tokens/hashes) are keys.
  const touched = new Map<string, number>();
  function shouldTouch(id: string, at: number): boolean {
    const next = touched.get(id);
    touched.delete(id);
    if (touched.size >= 2000) touched.delete(touched.keys().next().value!);
    touched.set(id, next !== undefined && next > at ? next : at + 60000);
    return next === undefined || next <= at;
  }
  return {
    async ready() {
      try {
        return await use(async db => {
          const engines = await query(db, "SELECT COUNT(*) AS n FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name IN ('ts_auth_users','ts_reader_api_keys') AND engine='InnoDB'");
          if (Number(engines[0]?.n) !== 2) return false;
          await query(db, 'SELECT id,disabled_at FROM ts_auth_users LIMIT 0');
          await query(db, 'SELECT id,user_id,key_hash,prefix,label,created_at,last_used_at,revoked_at FROM ts_reader_api_keys LIMIT 0');
          return true;
        });
      } catch { return false; }
    },
    async close() { touched.clear(); await pool.end().catch(() => {}); },
    async list(userId) {
      apiKeyId(userId);
      return use(async db => (await query(db, 'SELECT ' + projection + ' FROM ts_reader_api_keys k JOIN ts_auth_users u ON u.id=k.user_id WHERE k.user_id=? AND k.revoked_at IS NULL AND u.disabled_at IS NULL ORDER BY k.id DESC LIMIT ?', [userId,PERSONAL_API_KEYS_MAX])).map(keyView));
    },
    async issue(userId, value, at) {
      apiKeyId(userId); const label = apiKeyLabel(value), created = utcSql(at);
      return use(async db => {
        // Serialize count+insert across every process using this owner's InnoDB row.
        await owner(db, userId);
        const active = await query(db, 'SELECT id FROM ts_reader_api_keys WHERE user_id=? AND revoked_at IS NULL LIMIT ?', [userId,PERSONAL_API_KEYS_MAX]);
        if (active.length >= PERSONAL_API_KEYS_MAX) throw new ApiKeyError('API_KEY_LIMIT', 409);
        const history = await query(db, 'SELECT id FROM ts_reader_api_keys WHERE user_id=? LIMIT ?', [userId,PERSONAL_API_KEYS_LIFETIME_MAX]);
        if (history.length >= PERSONAL_API_KEYS_LIFETIME_MAX) throw new ApiKeyError('API_KEY_LIFETIME_LIMIT', 409);
        const token = newPersonalApiKey(), prefix = token.slice(0, 12);
        await query(db, 'INSERT INTO ts_reader_api_keys(user_id,key_hash,prefix,label,created_at) VALUES(?,?,?,?,?)', [userId, hash(token), prefix, label, created]);
        const rows = await query(db, 'SELECT ' + projection + ' FROM ts_reader_api_keys k WHERE k.id=LAST_INSERT_ID()');
        if (rows.length !== 1) throw new ApiKeyStoreUnavailable();
        return {key: keyView(rows[0]!), token};
      }, true);
    },
    async revoke(userId, id, at) {
      apiKeyId(userId); apiKeyId(id); const revoked = utcSql(at);
      const result = await use(async db => {
        await owner(db, userId);
        const existing = await query(db, 'SELECT id,revoked_at FROM ts_reader_api_keys WHERE id=? AND user_id=? LIMIT 1', [id, userId]);
        if (!existing.length) return false;
        if (existing[0]!.revoked_at === null) await query(db, 'UPDATE ts_reader_api_keys SET revoked_at=? WHERE id=? AND user_id=? AND revoked_at IS NULL', [revoked, id, userId]);
        return true;
      }, true);
      touched.delete(id);
      return result;
    },
    async lookup(token, at = new Date()) {
      if (!looksLikePersonalApiKey(token)) return null;
      const stamp = utcSql(at), earlier = utcSql(new Date(+at - 60000));
      const identity = await use(async db => {
        const found = await query(db, 'SELECT k.id,k.user_id FROM ts_reader_api_keys k JOIN ts_auth_users u ON u.id=k.user_id WHERE k.key_hash=? AND k.revoked_at IS NULL AND u.disabled_at IS NULL LIMIT 1', [hash(token)]);
        return found[0] ? {keyId:apiKeyId(String(found[0].id)),userId:apiKeyId(String(found[0].user_id))} : null;
      });
      if (identity === null) return null;
      const id=identity.keyId;
      if (shouldTouch(id, +at)) {
        // The SQL predicate also bounds writes across processes or LRU eviction.
        // A metadata failure does not undo the already completed authorization read.
        await use(db => query(db, 'UPDATE ts_reader_api_keys k JOIN ts_auth_users u ON u.id=k.user_id SET k.last_used_at=? WHERE k.id=? AND k.revoked_at IS NULL AND u.disabled_at IS NULL AND (k.last_used_at IS NULL OR k.last_used_at<=?)', [stamp, id, earlier])).catch(() => {});
      }
      return identity;
    },
  };
}
