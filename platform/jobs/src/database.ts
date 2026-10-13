import {verifyWorkerGrants} from '../../shared/worker-grants.js';
import {workerSchema,assertWorkerEndpoint} from '../../shared/worker-schema.js';
import {bindFacadeTables} from '../../shared/physical-tables.js';
import mysql, { type Connection, type RowDataPacket } from 'mysql2/promise';
import { createHash } from 'node:crypto';
import { assertLocalDatabase } from './policy.js';
import { workflowShutdownSignal } from '../../shared/shutdown.js';
export async function connectDatabase(env: NodeJS.ProcessEnv): Promise<Connection> {
  const host = env.DB_HOST ?? '127.0.0.1';
  const database = env.DB_DATABASE ?? 'youtube_board_rewrite';
  const facade=workerSchema(env);
  if(database.startsWith('youtube_board_ts_worker')&&!facade)throw new Error('Worker facade requires explicit schema mapping mode');
  if(facade)assertWorkerEndpoint(env,host);
  if(facade&&env.APP_ENV!=='production'){if(!['127.0.0.1','localhost','db','mariadb'].includes(host)||!database.endsWith('_rewrite'))throw new Error('Local worker facade requires isolated loopback *_rewrite schema');}
  else assertLocalDatabase(host, database, env.APP_ENV ?? '');
  const db = await mysql.createConnection({ host, database, port: Number(env.DB_PORT ?? 23306), user: env.DB_USERNAME ?? 'youtube_rewrite', password: env.DB_PASSWORD, charset: 'utf8mb4_bin', timezone: 'Z', dateStrings: true, supportBigNumbers: true, bigNumberStrings: true, multipleStatements: false });
  try { await db.query("SET SESSION sql_mode = CONCAT_WS(',', NULLIF(@@sql_mode,''), 'STRICT_ALL_TABLES')"); if(facade){await verifyWorkerGrants(db,facade,env.DB_USERNAME??'youtube_rewrite');await bindFacadeTables(db,facade.facade,facade.mapping);} return db; }
  catch (error) { await db.end(); throw error; }
}
/** All job writes use this connection: losing ownership also invalidates the writer connection. */
export async function withWriterLock<T>(db: Connection, job: string, work: (assertOwnership: () => Promise<void>) => Promise<T>,waitSeconds=0): Promise<T> {
  if(!Number.isSafeInteger(waitSeconds)||waitSeconds<0||waitSeconds>30)throw Error('Invalid writer lock wait');
  const key = 'yt-ts-' + createHash('sha256').update(job).digest('hex').slice(0, 48);
  const [rows] = await db.query<RowDataPacket[]>(`SELECT GET_LOCK(?, ${waitSeconds}) AS acquired`, [key]);
  if (Number(rows[0]?.acquired) !== 1) throw new Error('Another TypeScript writer holds this workflow');
  const assertOwnership = async () => {
    workflowShutdownSignal().throwIfAborted();
    const [owners] = await db.query<RowDataPacket[]>('SELECT IS_USED_LOCK(?) = CONNECTION_ID() AS owned', [key]);
    if (Number(owners[0]?.owned) !== 1) throw new Error('Writer ownership lost');
  };
  try { return await work(assertOwnership); }
  finally { await db.query('SELECT RELEASE_LOCK(?)', [key]).catch(() => undefined); }
}
