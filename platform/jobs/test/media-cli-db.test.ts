import { it, expect } from 'vitest';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { connectDatabase } from '../src/database.js';
import { executeMediaWorkflow, MEDIA_AVATAR_COMMAND, MEDIA_AVATAR_JOB } from '../src/media-cli.js';

it.skipIf(!process.env.JOBS_DB_TEST)('persists a bounded automatic sweep without source writes and records invalid identity instead of stalling', async () => {
  const root = await mkdtemp(join(tmpdir(), 'youtube-avatar-sweep-'));
  const env = { ...process.env, APP_ENV: 'test', MEDIA_CACHE_ROOT: root, TS_INGESTION_ENABLED: 'true', TS_INGESTION_OWNERS: MEDIA_AVATAR_JOB };
  const db = await connectDatabase(env), first = 19990001, second = 19990002, runs: string[] = [];
  try {
    for (const id of [first, second]) await db.execute('INSERT INTO urt_channel(u_id,ctime,youtube_id,title,thumbnails) VALUES(?,NOW(),?,?,?)', [id, 'legacy-invalid-' + id, 'Synthetic avatar cursor', '']);
    await writeFile(join(root, 'refresh-cursor.json'), JSON.stringify({ version: 1, afterId: first - 1 }));
    const before = JSON.stringify((await db.query('SELECT * FROM urt_channel WHERE u_id IN (?,?) ORDER BY u_id', [first, second]))[0]);
    const result = await executeMediaWorkflow([MEDIA_AVATAR_COMMAND, '--execute', '--limit=1'], env);
    if (!('executionKey' in result)) throw new Error('Expected execute result'); runs.push(result.executionKey);
    expect(result.lastProcessedId).toBe(first);
    expect(result.results).toEqual([{ id: first, status: 'failed', code: 'INVALID_CHANNEL_ID' }]);
    expect(JSON.parse(await readFile(join(root, 'refresh-cursor.json'), 'utf8')).afterId).toBe(first);
    const final = await executeMediaWorkflow([MEDIA_AVATAR_COMMAND, '--execute', '--limit=1'], env);
    if (!('executionKey' in final)) throw new Error('Expected execute result'); runs.push(final.executionKey);
    expect(final.lastProcessedId).toBe(second);
    expect(JSON.parse(await readFile(join(root, 'refresh-cursor.json'), 'utf8')).afterId).toBe(0);
    expect(JSON.stringify((await db.query('SELECT * FROM urt_channel WHERE u_id IN (?,?) ORDER BY u_id', [first, second]))[0])).toBe(before);
    const [ledger] = await db.query<import('mysql2/promise').RowDataPacket[]>('SELECT status,result FROM ts_job_runs WHERE execution_key=?', [result.executionKey]);
    expect(ledger[0]?.status).toBe('incomplete'); expect(ledger[0]?.result).not.toContain('https://');
  } finally {
    await db.execute('DELETE FROM urt_channel WHERE u_id IN (?,?)', [first, second]);
    for (const key of runs) await db.execute('DELETE FROM ts_job_runs WHERE job_key=? AND execution_key=?', [MEDIA_AVATAR_JOB, key]);
    await db.end(); await rm(root, { recursive: true, force: true });
  }
});
