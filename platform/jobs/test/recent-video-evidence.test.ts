import { expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { Connection, RowDataPacket } from 'mysql2/promise';
import { isolatedTestEnv } from '../../shared/test-database.js';
import { connectDatabase, withWriterLock } from '../src/database.js';
import { SOURCE, aggregateTerms, type VocabularySnapshot } from '../src/vocabulary.js';
import { VIDEO_EVIDENCE_JOB } from '../src/video-evidence.js';
import { RECENT_VIDEO_EVIDENCE_JOB, RECENT_CHECKPOINT, validateRecentArguments, validateRecentInput, planRecentWindow, parseRecentCheckpoint, continueRecentMatching, matchRecentVideoBatch } from '../src/recent-video-evidence.js';
import { validateWorkflowInput } from '../src/workflow-registry.js';
import { planSchedules, type ScheduleConfig } from '../src/scheduler.js';
const now = new Date('2090-01-10T04:00:00.000Z');
const input = { limit: 2, dailyLimit: 20, execute: true };
it('bounds CLI and queue arguments and refuses an operator-pinned version/window bypass', () => {
  expect(validateRecentArguments(['videos:match:recent'])).toEqual({ limit: 100, dailyLimit: 5000, execute: false });
  expect(validateRecentArguments(['videos:match:recent', '--limit=500', '--daily-limit=20000', '--execute'])).toEqual({ limit: 500, dailyLimit: 20000, execute: true });
  for (const args of [['--limit=501'], ['--limit=0'], ['--daily-limit=50001'], ['--version=old'], ['--after-pk=0'], ['--execute', '--dry-run'], ['--limit=1', '--limit=2']]) expect(() => validateRecentArguments(['videos:match:recent', ...args])).toThrow();
  expect(() => validateRecentInput({ ...input, execute: 'true' as unknown as boolean })).toThrow();
  expect(() => validateWorkflowInput(RECENT_VIDEO_EVIDENCE_JOB, { options: { limit: 501 } })).toThrow();
  expect(() => validateWorkflowInput(VIDEO_EVIDENCE_JOB, { options: { limit: 501 } })).toThrow();
  expect(() => validateWorkflowInput(RECENT_VIDEO_EVIDENCE_JOB, { options: { version: 'old' } })).toThrow();
});
it('pins a Taipei seven-day window, resumes it, and resets only for new vocabulary or refresh trigger', () => {
  const first = planRecentWindow(null, 'v1', now);
  expect(first.checkpoint).toMatchObject({ windowFrom: '2090-01-03 12:00:00', windowUntil: '2090-01-10 12:00:00', cursor: null });
  expect(planRecentWindow(first.checkpoint, 'v1', new Date(+now + 3_600_000))).toEqual({ checkpoint: first.checkpoint, action: 'resume' });
  const complete = { ...first.checkpoint, completedAt: now.toISOString() };
  expect(planRecentWindow(complete, 'v1', new Date(+now + 6 * 3_600_000 - 1)).action).toBe('up-to-date');
  expect(planRecentWindow(complete, 'v1', new Date(+now + 6 * 3_600_000)).action).toBe('new-window');
  expect(planRecentWindow(complete, 'v2', new Date(+now + 1)).action).toBe('new-vocabulary');
  const nearMidnight = planRecentWindow(null, 'v1', new Date('2090-01-10T15:59:00.000Z')).checkpoint;
  nearMidnight.completedAt = nearMidnight.startedAt;
  expect(planRecentWindow(nearMidnight, 'v1', new Date('2090-01-10T16:00:00.000Z')).action).toBe('new-window');
  nearMidnight.completedAt = '2090-01-10T16:01:00.000Z';
  expect(planRecentWindow(nearMidnight, 'v1', new Date('2090-01-10T16:02:00.000Z')).action).toBe('up-to-date');
  expect(() => planRecentWindow(complete, 'v1', new Date(+now - 1))).toThrow('backwards');
});
it('rejects corrupt or widened durable checkpoint bounds', () => {
  const state = planRecentWindow(null, 'v1', now).checkpoint;
  expect(parseRecentCheckpoint(JSON.stringify(state))).toEqual(state);
  for (const patch of [{ windowFrom: '2080-01-01 00:00:00' }, { processed: 1 }, { cursor: { publishedAt: '2090-01-10 12:00:00', pk: 3 } }, { completedAt: '2000-01-01T00:00:00.000Z' }, { generation: 'bad' }]) expect(() => parseRecentCheckpoint(JSON.stringify({ ...state, ...patch }))).toThrow();
});
it('schedules the continuation without stale static date or pk parameters', () => {
  const config: ScheduleConfig = { version: 1, timezone: 'Asia/Taipei', schedules: [{ id: 'recent-evidence', workflow: RECENT_VIDEO_EVIDENCE_JOB, cron: '*/5 * * * *', options: { limit: 100, 'daily-limit': 20000 } }] };
  expect(planSchedules(config, now, 1)[0]?.input.options).toEqual({ 'daily-limit': 20000, limit: 100 });
  expect(() => planSchedules({ ...config, schedules: [{ ...config.schedules[0]!, window: 'previous-day' }] }, now, 1)).toThrow();
});
it('refuses execute before connecting when ownership gates are absent', async () => {
  await expect(matchRecentVideoBatch(input, { APP_ENV: 'test' })).rejects.toThrow('disabled');
});
interface Fixture { db: Connection; version: string; base: number; publish: (id: string) => Promise<void>; add: (offset: number, publishedAt: string, videoId?: string) => Promise<void>; run: (patch?: Partial<typeof input>, at?: Date, connection?: Connection, clock?: () => Date) => Promise<Awaited<ReturnType<typeof continueRecentMatching>>> }
async function fixture(work: (value: Fixture) => Promise<void>) {
  const db = await connectDatabase(isolatedTestEnv());
  const version = 'recent_' + randomUUID().replaceAll('-', ''), base = 2000000000 + Math.floor(Math.random() * 1000000), versions: string[] = [];
  const [previous] = await db.query<RowDataPacket[]>('SELECT run_id FROM ts_vocabulary_current WHERE source=?', [SOURCE]);
  const [saved] = await db.query<RowDataPacket[]>('SELECT execution_key,status,result FROM ts_job_runs WHERE job_key=?', [RECENT_VIDEO_EVIDENCE_JOB]);
  await db.execute('DELETE FROM ts_job_runs WHERE job_key=?', [RECENT_VIDEO_EVIDENCE_JOB]);
  const publish = async (id: string) => {
    versions.push(id);
    const snapshot: VocabularySnapshot = { id, source: SOURCE, window: { since: '2090-01-08T16:00:00.000Z', until: '2090-01-09T16:00:00.000Z' }, publishedAt: now.toISOString(), coverage: 'observed-article-window', upstreamSnapshotConsistent: false, terms: aggregateTerms([{ id: '1', media: 'cna', publishedAt: '2090-01-09T00:00:00.000Z', tags: ['台灣'] }]) };
    await db.execute('INSERT INTO ts_vocabulary_runs(id,window_since,window_until,status,snapshot) VALUES(?,?,?,?,?)', [id, snapshot.window!.since, snapshot.window!.until, 'published', JSON.stringify(snapshot)]);
    await db.execute('INSERT INTO ts_vocabulary_current(source,run_id) VALUES(?,?) ON DUPLICATE KEY UPDATE run_id=VALUES(run_id)', [SOURCE, id]);
  };
  const add = async (offset: number, publishedAt: string, videoId = 'Recent' + String(offset).padStart(5, '0')) => {
    await db.execute('INSERT INTO urt_video(pk,ctime,mtime,u_id,id,publishedAt,channelId,title,thumbnails,channelTitle,playlistId,position,videoId,description) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)', [base + offset, '2000-01-01 00:00:00', '2000-01-01 00:00:00', 1, videoId, publishedAt, 'UC-test', '台灣新聞', '', 'test', '', 0, videoId, '']);
  };
  const run: Fixture['run'] = (patch = {}, at = now, connection = db, clock) => withWriterLock(connection, VIDEO_EVIDENCE_JOB, check => continueRecentMatching(connection, { ...input, ...patch }, at, check, clock));
  try { await publish(version); await work({ db, version, base, publish, add, run }); }
  finally {
    await db.execute('DELETE FROM urt_video WHERE pk>=? AND pk<?', [base, base + 100]);
    for (const id of versions) await db.execute('DELETE FROM ts_video_tag_matches WHERE vocabulary_version=?', [id]);
    if (previous[0]) await db.execute('UPDATE ts_vocabulary_current SET run_id=? WHERE source=?', [previous[0].run_id, SOURCE]);
    else await db.execute('DELETE FROM ts_vocabulary_current WHERE source=?', [SOURCE]);
    for (const id of versions) await db.execute('DELETE FROM ts_vocabulary_runs WHERE id=?', [id]);
    await db.execute('DELETE FROM ts_job_runs WHERE job_key=?', [RECENT_VIDEO_EVIDENCE_JOB]);
    for (const row of saved) await db.execute('INSERT INTO ts_job_runs(job_key,execution_key,status,result) VALUES(?,?,?,?)', [RECENT_VIDEO_EVIDENCE_JOB, row.execution_key, row.status, row.result]);
    await db.end();
  }
}
const dbIt = it.skipIf(process.env.JOBS_DB_TEST !== '1');
dbIt('persists publication/tie cursors across batches, bounds Taipei timestamps and ignores old mtime', async () => fixture(async ({ db, add, run, base }) => {
  await add(1, '2090-01-03 12:00:00'); await add(2, '2090-01-09 10:00:00'); await add(3, '2090-01-09 10:00:00');
  await add(4, '2090-01-03 11:59:59'); await add(5, '2090-01-10 12:00:00');
  const preview = await run({ execute: false });
  expect(preview.results?.map(r => r.pk)).toEqual([base + 3, base + 2]);
  const [journals] = await db.query<RowDataPacket[]>('SELECT * FROM ts_job_runs WHERE job_key=?', [RECENT_VIDEO_EVIDENCE_JOB]); expect(journals).toHaveLength(0);
  const first = await run(); expect(first.status).toBe('incomplete'); expect(first.checkpoint?.cursor).toEqual({ publishedAt: '2090-01-09 10:00:00', pk: base + 2 });
  const second = await run({}, new Date(+now + 60000)); expect(second.status).toBe('complete'); expect(second.results?.map(r => r.pk)).toEqual([base + 1]); expect(second.window).toEqual(first.window); expect(second.budget?.reserved).toBe(3);
  const idle = await run({}, new Date(+now + 120000)); expect(idle.status).toBe('up-to-date'); expect(idle.processed).toBe(0); expect(idle.budget?.reserved).toBe(3);
}));
dbIt('new published vocabulary restarts the full window and shares an immutable daily budget', async () => fixture(async ({ add, run, publish, version, base }) => {
  await add(1, '2090-01-09 10:00:00'); await add(2, '2090-01-09 11:00:00'); await add(3, '2090-01-09 12:00:00');
  const first = await run({ limit: 1, dailyLimit: 3 }); expect(first.results?.[0]?.pk).toBe(base + 3);
  await publish(version + '_new');
  const second = await run({ limit: 1, dailyLimit: 20000 }); expect(second.action).toBe('new-vocabulary'); expect(second.results?.[0]?.pk).toBe(base + 3); expect(second.budget?.limit).toBe(3);
  const third = await run({ limit: 1, dailyLimit: 20000 }); expect(third.status).toBe('daily-budget-exhausted'); expect(third.results?.[0]?.pk).toBe(base + 2);
  const blocked = await run({ dailyLimit: 20000 }); expect(blocked.status).toBe('daily-budget-exhausted'); expect(blocked.processed).toBe(0);
  const nextDay = await run({ dailyLimit: 20000 }, new Date('2090-01-10T16:00:00.000Z')); expect(nextDay.status).toBe('complete'); expect(nextDay.window).toEqual(second.window); expect(nextDay.budget?.reserved).toBe(1); expect(nextDay.results?.[0]?.pk).toBe(base + 1);
}));
dbIt('does not let older duplicate source copies overwrite current evidence and preserves byte-exact IDs', async () => fixture(async ({ db, add, run, version, base }) => {
  // Source clones may contain duplicate identities; this connection-local table
  // models them without changing the shared fixture's unique source index.
  const [definition] = await db.query<RowDataPacket[]>('SHOW CREATE TABLE urt_video');
  await db.query(String(definition[0]!['Create Table']).replace('CREATE TABLE', 'CREATE TEMPORARY TABLE'));
  await db.query('ALTER TABLE urt_video DROP INDEX videoId');
  await add(1, '2090-01-09 10:00:00', 'DuPlic00001'); await add(2, '2090-01-09 10:00:00', 'DuPlic00001'); await add(3, '2090-01-09 10:00:00', 'duplic00001');
  const result = await run({ limit: 10 }); expect(result.results?.map(r => r.pk)).toEqual([base + 3, base + 2]);
  const [rows] = await db.query<RowDataPacket[]>('SELECT video_id,source_pk FROM ts_video_tag_matches WHERE vocabulary_version=? ORDER BY BINARY video_id', [version]); expect(rows.map(r => [r.video_id, Number(r.source_pk)])).toEqual([['DuPlic00001', base + 2], ['duplic00001', base + 3]]);
}));
dbIt('resumes after an evidence failure without skipping rows or refunding reserved work', async () => fixture(async ({ db, add, run, base }) => {
  await add(1, '2090-01-09 10:00:00'); await add(2, '2090-01-09 11:00:00'); await add(3, '2090-01-09 12:00:00');
  let failed = false;
  const faulty = new Proxy(db, { get(target, key) { if (key === 'execute') return async (sql: string, params: unknown[]) => { if (!failed && sql.startsWith('INSERT INTO ts_video_tag_matches') && params[2] === base + 2) { failed = true; throw new Error('injected evidence failure'); } return target.execute(sql, params as never); }; const value = Reflect.get(target, key); return typeof value === 'function' ? value.bind(target) : value; } });
  await expect(run({}, now, faulty)).rejects.toThrow('injected');
  const [rows] = await db.query<RowDataPacket[]>('SELECT result FROM ts_job_runs WHERE job_key=? AND execution_key=?', [RECENT_VIDEO_EVIDENCE_JOB, RECENT_CHECKPOINT]); const state = parseRecentCheckpoint(rows[0]!.result); expect(state.cursor?.pk).toBe(base + 3);
  const retry = await run(); expect(retry.results?.map(r => r.pk)).toEqual([base + 2, base + 1]); expect(retry.budget?.reserved).toBe(4); expect(retry.status).toBe('complete');
}));
dbIt('does not continue charged work across Taipei midnight and advances malformed identities safely', async () => fixture(async ({ add, run, base }) => {
  await add(1, '2090-01-09 10:00:00'); await add(2, '2090-01-09 11:00:00', 'invalid-id');
  const at = new Date('2090-01-10T15:59:59.000Z'); let calls = 0;
  const first = await run({}, at, undefined, () => ++calls === 1 ? at : new Date('2090-01-10T16:00:00.000Z'));
  expect(first.status).toBe('day-boundary'); expect(first.results).toEqual([{ pk: base + 2, status: 'invalid', count: 0 }]); expect(first.budget?.reserved).toBe(2);
  const second = await run({}, new Date('2090-01-10T16:00:00.000Z')); expect(second.results?.[0]?.pk).toBe(base + 1); expect(second.budget?.reserved).toBe(1); expect(second.checkpoint?.invalid).toBe(1);
}));
dbIt('retains a no-vocabulary waiting state without creating journals or false completion', async () => fixture(async ({ db, run }) => {
  await db.execute('DELETE FROM ts_vocabulary_current WHERE source=?', [SOURCE]); const result = await run(); expect(result.status).toBe('awaiting-vocabulary'); const [rows] = await db.query<RowDataPacket[]>('SELECT * FROM ts_job_runs WHERE job_key=?', [RECENT_VIDEO_EVIDENCE_JOB]); expect(rows).toHaveLength(0);
}));
dbIt('records empty-window completion and refreshes only at a later eligible sweep', async () => fixture(async ({ add, run }) => {
  const empty = await run(); expect(empty.status).toBe('complete'); expect(empty.processed).toBe(0); expect(empty.budget?.reserved).toBe(0);
  await add(1, '2090-01-10 12:01:00');
  expect((await run({}, new Date(+now + 60000))).status).toBe('up-to-date');
  const refreshed = await run({}, new Date(+now + 6 * 3600000)); expect(refreshed.action).toBe('new-window'); expect(refreshed.processed).toBe(1);
}));
dbIt('fails closed on corrupt journals without changing evidence or the daily reservation', async () => fixture(async ({ db, add, run }) => {
  await add(1, '2090-01-09 10:00:00'); await run();
  for (const key of [RECENT_CHECKPOINT, 'recent-budget-2090-01-10']) {
    const [before] = await db.query<RowDataPacket[]>('SELECT result FROM ts_job_runs WHERE job_key=? AND execution_key=?', [RECENT_VIDEO_EVIDENCE_JOB, key]);
    await db.execute('UPDATE ts_job_runs SET result=? WHERE job_key=? AND execution_key=?', ['{}', RECENT_VIDEO_EVIDENCE_JOB, key]);
    await expect(run()).rejects.toThrow('Invalid recent matching');
    await db.execute('UPDATE ts_job_runs SET result=? WHERE job_key=? AND execution_key=?', [before[0]!.result, RECENT_VIDEO_EVIDENCE_JOB, key]);
  }
  expect((await run()).budget?.reserved).toBe(1);
}));
dbIt('shares the one-off writer lock so both matchers cannot publish concurrently', async () => fixture(async ({ db, run }) => {
  const contender = await connectDatabase(isolatedTestEnv());
  try {
    await withWriterLock(db, VIDEO_EVIDENCE_JOB, async () => {
      await expect(run({}, now, contender)).rejects.toThrow('Another TypeScript writer');
    });
    expect((await run({}, now, contender)).status).toBe('complete');
  } finally { await contender.end(); }
}));
