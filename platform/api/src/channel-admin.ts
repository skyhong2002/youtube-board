import mysql, { type RowDataPacket } from 'mysql2/promise';
import type { FastifyInstance } from 'fastify';
import type { AuthRuntime } from './auth/index.js';
import { privateAuthReply } from './auth/index.js';
import { boundedLimiter } from './rate-limit.js';
import {
  CHANNEL_ADMIN_ERRORS, CHANNEL_ADMIN_KINDS, REQUEST_ID, parsePayload,
  type ChannelAdminAccepted, type ChannelAdminErrorCode, type ChannelAdminKind, type ChannelAdminPayload, type ChannelAdminRequest, type ChannelAdminRequestList, type ChannelAdminStatus,
} from '../../shared/channel-admin.js';

/** Waiting requests the worker has not applied yet; beyond this the queue says so instead of growing without bound. */
export const PENDING_LIMIT = 100;
export const LIST_LIMIT = 100;

export interface NewRequest { requestId: string; kind: ChannelAdminKind; actor: string; payload: ChannelAdminPayload }
export type Enqueued = 'created' | 'replayed' | 'conflict' | 'full';
export interface ChannelAdminStore {
  enqueue(request: NewRequest): Promise<Enqueued>;
  list(limit: number): Promise<ChannelAdminRequest[]>;
  close?(): Promise<void>;
}

/** Stored UTC wall time as an ISO instant. */
const utc = (value: unknown) => { const text = value === null || value === undefined ? '' : String(value); if (!text) return null; const at = new Date(text.includes('T') ? text : text.replace(' ', 'T') + 'Z'); return Number.isFinite(+at) ? at.toISOString() : null; };
const statuses = new Set<string>(['pending', 'done', 'failed']);
export function requestFromRow(row: RowDataPacket): ChannelAdminRequest | null {
  const kind = String(row.kind), status = String(row.status);
  let payload: ChannelAdminPayload | null = null, result: Record<string, unknown> | null = null;
  try { payload = parsePayload(kind, JSON.parse(String(row.payload))); } catch { /* shown as unreadable by dropping the row */ }
  try { const parsed = row.result === null || row.result === undefined ? null : JSON.parse(String(row.result)); result = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null; } catch { result = null; }
  const created = utc(row.created_at);
  if (!payload || !statuses.has(status) || !created) return null;
  const code = row.error_code === null || row.error_code === undefined ? null : String(row.error_code);
  return {
    id: Number(row.id), requestId: String(row.request_id), kind: payload.kind, actor: String(row.actor), payload, status: status as ChannelAdminStatus,
    errorCode: code !== null && Object.hasOwn(CHANNEL_ADMIN_ERRORS, code) ? code as ChannelAdminErrorCode : null, result, createdAt: created, appliedAt: utc(row.applied_at),
  };
}

/**
 * Own-state writer: the web principal holds SELECT and INSERT on `ts_channel_admin_requests` and nothing else there, and
 * no source-table right at all. The worker applies the rows; this only queues them and reads the history back.
 */
export function mysqlChannelAdminStore(databaseUrl: string): ChannelAdminStore {
  const pool = mysql.createPool({ uri: databaseUrl, connectionLimit: 2, queueLimit: 16, connectTimeout: 3000, dateStrings: true, timezone: 'Z', supportBigNumbers: true, bigNumberStrings: true, multipleStatements: false });
  return {
    async enqueue(request) {
      const [pending] = await pool.query<RowDataPacket[]>("SELECT COUNT(*) AS n FROM ts_channel_admin_requests WHERE status = 'pending'");
      const [known] = await pool.query<RowDataPacket[]>('SELECT actor, kind, payload FROM ts_channel_admin_requests WHERE request_id = ?', [request.requestId]);
      if (known[0]) return known[0].actor === request.actor && known[0].kind === request.kind && known[0].payload === JSON.stringify(request.payload) ? 'replayed' : 'conflict';
      if (Number(pending[0]?.n) >= PENDING_LIMIT) return 'full';
      try {
        await pool.query("INSERT INTO ts_channel_admin_requests (request_id, kind, actor, payload, status, created_at) VALUES (?, ?, ?, ?, 'pending', UTC_TIMESTAMP())", [request.requestId, request.kind, request.actor, JSON.stringify(request.payload)]);
      } catch (error) {
        // Two clicks with the same id raced: the unique key keeps one row, and the loser is a replay.
        if ((error as { code?: string })?.code === 'ER_DUP_ENTRY') return 'replayed';
        throw error;
      }
      return 'created';
    },
    async list(limit) {
      const [rows] = await pool.query<RowDataPacket[]>({ sql: 'SELECT id, request_id, kind, actor, payload, status, error_code, result, created_at, applied_at FROM ts_channel_admin_requests ORDER BY id DESC LIMIT ?', timeout: 6000 }, [limit]);
      return rows.flatMap(row => requestFromRow(row) ?? []);
    },
    async close() { await pool.end(); },
  };
}

export interface ChannelAdminOptions { stateUrl?: string; store?: ChannelAdminStore | null; clock?: () => Date }
/**
 * Administrator channel edits behind the existing Google administrator session. Reads need the session; every write also
 * needs the same-origin and CSRF checks of `requireAdmin(..., true)`. A queued request answers 202: it is applied by the
 * youtube-source worker within about a minute, and the history endpoint shows when it was.
 */
export async function registerChannelAdmin(app: FastifyInstance, auth: AuthRuntime, options: ChannelAdminOptions = {}) {
  const clock = options.clock ?? (() => new Date()), store = options.store !== undefined ? options.store : auth.enabled && options.stateUrl ? mysqlChannelAdminStore(options.stateUrl) : null;
  if (store && options.store === undefined) app.addHook('onClose', async () => { await store.close?.(); });
  const allowWrite = boundedLimiter(60, 60000, 200);
  await app.register(async routes => {
    routes.setErrorHandler((error, _request, reply) => {
      privateAuthReply(reply);
      const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
      return reply.code(['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'PROTOCOL_CONNECTION_LOST', 'ER_ACCESS_DENIED_ERROR', 'ER_TABLEACCESS_DENIED_ERROR', 'ER_NO_SUCH_TABLE', 'ER_CON_COUNT_ERROR'].includes(code) ? 503 : 500)
        .send({ error: { code: 'CHANNEL_ADMIN_UNAVAILABLE' } });
    });
    routes.get('/auth/admin/channel-requests', async (request, reply) => {
      if (!await auth.requireAdmin(request, reply)) return reply;
      if (!store) return reply.code(503).send({ error: { code: 'CHANNEL_ADMIN_UNAVAILABLE' } });
      return { requests: await store.list(LIST_LIMIT), generatedAt: clock().toISOString() } satisfies ChannelAdminRequestList;
    });
    routes.post<{ Body: { requestId?: unknown; kind?: unknown; payload?: unknown } }>('/auth/admin/channel-requests', { bodyLimit: 8192 }, async (request, reply) => {
      const user = await auth.requireAdmin(request, reply, true);
      if (!user) return reply;
      if (!store) return reply.code(503).send({ error: { code: 'CHANNEL_ADMIN_UNAVAILABLE' } });
      const body = request.body ?? {}, kind = body.kind;
      if (typeof body.requestId !== 'string' || !REQUEST_ID.test(body.requestId) || typeof kind !== 'string' || !(CHANNEL_ADMIN_KINDS as readonly string[]).includes(kind)) return reply.code(400).send({ error: { code: 'INVALID_REQUEST' } });
      const payload = parsePayload(kind, body.payload);
      if (!payload) return reply.code(400).send({ error: { code: 'INVALID_REQUEST' } });
      const actor = auth.actor(user);
      if (!allowWrite(actor, +clock())) return reply.header('Retry-After', '60').code(429).send({ error: { code: 'RATE_LIMITED' } });
      const outcome = await store.enqueue({ requestId: body.requestId, kind: payload.kind, actor, payload });
      if (outcome === 'conflict') return reply.code(409).send({ error: { code: 'REQUEST_ID_CONFLICT' } });
      if (outcome === 'full') return reply.header('Retry-After', '60').code(429).send({ error: { code: 'QUEUE_FULL' } });
      return reply.code(202).send({ requestId: body.requestId, status: 'pending' } satisfies ChannelAdminAccepted);
    });
  });
}
