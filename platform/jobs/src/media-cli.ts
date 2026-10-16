import { randomUUID } from 'node:crypto';
import { open, rename, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import type { RowDataPacket } from 'mysql2/promise';
import { connectDatabase, withWriterLock } from './database.js';
import { assertExecute, executionPolicy } from './policy.js';
import { workflowShutdownSignal } from '../../shared/shutdown.js';
import { checkedRoot, readBoundedFile } from '../../shared/media-cache/store.js';
import { refreshChannelAvatars } from './media-avatars.js';

export const MEDIA_AVATAR_JOB = 'channels.avatars.refresh';
export const MEDIA_AVATAR_COMMAND = 'channels:avatars:refresh';
export function validateMediaArguments(args: string[]) {
  if (args[0] !== MEDIA_AVATAR_COMMAND || args.length > 8) throw new Error('Invalid media refresh command');
  const options = new Map<string, string>(); let execute = false, resolveMissing = false;
  for (const arg of args.slice(1)) {
    if (arg === '--execute' && !execute) { execute = true; continue; }
    if (arg === '--resolve-missing' && !resolveMissing) { resolveMissing = true; continue; }
    const match = /^--(u_id|after-id|limit|max-age-days)=(\d+)$/.exec(arg);
    if (!match || options.has(match[1]!)) throw new Error('Invalid media refresh option');
    options.set(match[1]!, match[2]!);
  }
  const number = (key: string, fallback: number, min: number, max: number) => {
    const value = Number(options.get(key) ?? fallback);
    if (!Number.isSafeInteger(value) || value < min || value > max) throw new Error('Invalid media refresh bound');
    return value;
  };
  if (options.has('u_id') && options.has('after-id')) throw new Error('Choose channel or cursor');
  return { execute, resolveMissing, limit: number('limit', 100, 1, 500), maxAgeDays: number('max-age-days', 7, 1, 90),
    id: options.has('u_id') ? number('u_id', 0, 1, Number.MAX_SAFE_INTEGER) : undefined,
    afterId: options.has('after-id') ? number('after-id', 0, 0, Number.MAX_SAFE_INTEGER) : undefined };
}
async function readCursor(root: string): Promise<number> {
  try { const value = JSON.parse((await readBoundedFile(join(root, 'refresh-cursor.json'), 256)).toString());
    if (value?.version !== 1 || !Number.isSafeInteger(value.afterId) || value.afterId < 0) throw new Error('Invalid media cursor');
    return value.afterId;
  } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 0; throw error; }
}
async function writeCursor(root: string, afterId: number) {
  const target = join(root, 'refresh-cursor.json'), temp = target + '.' + randomUUID() + '.tmp';
  try { const file = await open(temp, 'wx', 0o640); try { await file.writeFile(JSON.stringify({ version: 1, afterId })); await file.sync(); } finally { await file.close(); } await rename(temp, target); const directory = await open(root, 'r'); try { await directory.sync(); } finally { await directory.close(); } }
  finally { await unlink(temp).catch(() => {}); }
}
export async function executeMediaWorkflow(args: string[], env: NodeJS.ProcessEnv, scheduled = false) {
  const input = validateMediaArguments(args);
  // A dry run does not connect, download, create cache files or advance the sweep.
  if (!input.execute) return { mode: 'dry-run', workflow: MEDIA_AVATAR_JOB, ...input, externalCalls: 0, sourceWrites: 0, cacheWrites: 0 };
  assertExecute(MEDIA_AVATAR_JOB, executionPolicy(env, 'execute', scheduled));
  if (!env.MEDIA_CACHE_ROOT) throw new Error('MEDIA_CACHE_ROOT is required');
  const root = await checkedRoot(env.MEDIA_CACHE_ROOT, true), db = await connectDatabase(env);
  try { return await withWriterLock(db, MEDIA_AVATAR_JOB, async assertOwnership => {
    const automatic = input.id === undefined && input.afterId === undefined;
    const afterId = input.afterId ?? (automatic ? await readCursor(root) : 0);
    const [rows] = await db.query<RowDataPacket[]>(`SELECT u_id,youtube_id,thumbnails FROM urt_channel WHERE (flag_del IS NULL OR flag_del<1) AND ${input.id === undefined ? 'u_id>?' : 'u_id=?'} ORDER BY u_id LIMIT ?`, [input.id ?? afterId, input.limit + 1]);
    const channels = rows.slice(0, input.limit).map(row => ({ id: Number(row.u_id), channelId: String(row.youtube_id ?? ''), sourceUrl: String(row.thumbnails ?? '') }));
    const executionKey = randomUUID();
    await assertOwnership();
    await db.execute('INSERT INTO ts_job_runs(job_key,execution_key,status) VALUES(?,?,?)', [MEDIA_AVATAR_JOB, executionKey, 'running']);
    try {
      const result = await refreshChannelAvatars({ root, channels, execute: true, limit: input.limit, maxAgeDays: input.maxAgeDays, resolveMissing: input.resolveMissing, signal: workflowShutdownSignal(), assertOwnership });
      await assertOwnership();
      if (automatic) await writeCursor(root, rows.length <= input.limit && !result.truncated ? 0 : result.lastProcessedId ?? afterId);
      await db.execute('UPDATE ts_job_runs SET status=?,result=? WHERE job_key=? AND execution_key=?', [result.truncated || result.results.some(item => item.status === 'failed') ? 'incomplete' : 'completed', JSON.stringify(result), MEDIA_AVATAR_JOB, executionKey]);
      return { ...result, executionKey };
    } catch (error) {
      await db.execute('UPDATE ts_job_runs SET status=?,result=? WHERE job_key=? AND execution_key=?', ['failed', JSON.stringify({ error: 'media-refresh-failed', previousAssetsRetained: true }), MEDIA_AVATAR_JOB, executionKey]).catch(() => {});
      throw error;
    }
  }); } finally { await db.end(); }
}
export async function handleMediaCli(args: string[], env: NodeJS.ProcessEnv) {
  if (args[0] !== MEDIA_AVATAR_COMMAND) return false;
  console.log(JSON.stringify(await executeMediaWorkflow(args, env))); return true;
}
