import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readdir } from 'node:fs/promises';
import mysql from 'mysql2/promise';
import { Redis } from 'ioredis';

// Deliberately never inherit runtime database/Redis destinations or API keys.
const cwd = fileURLToPath(new URL('..', import.meta.url));
const databaseUrl = 'mysql://youtube_rewrite:youtube_rewrite_local@127.0.0.1:23306/youtube_board_test_rewrite';
const env = {
  PATH: process.env.PATH, HOME: process.env.HOME, LANG: process.env.LANG,
  APP_ENV: 'test', NODE_ENV: 'test', DATASET_KIND: 'fixture',
  DB_HOST: '127.0.0.1', DB_PORT: '23306', DB_DATABASE: 'youtube_board_test_rewrite',
  DB_USERNAME: 'youtube_rewrite', DB_PASSWORD: 'youtube_rewrite_local',
  DATABASE_URL: databaseUrl, TEST_DATABASE_URL: databaseUrl,
  REDIS_URL: 'redis://127.0.0.1:26379/14',
  JOBS_DB_TEST: '1', INGESTION_DB_TEST: '1', AI_DB_TEST: '1', NOTIFICATIONS_DB_TEST: '1', REDIS_WORKFLOW_TEST: '1',
  FRONTEND_DB_TEST: '1', FRONTEND_CANONICAL_CHECK: '1', WORKER_DB_TEST: '1',
};
function run(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { cwd, env, stdio: 'inherit' });
    child.once('error', reject);
    child.once('exit', code => code === 0 ? resolve() : reject(new Error('Integration subprocess failed')));
  });
}
let lock;
try {
  lock = await mysql.createConnection({ uri: databaseUrl, connectTimeout: 3000 });
  const [identity] = await lock.query('SELECT DATABASE() AS name');
  if (identity[0]?.name !== 'youtube_board_test_rewrite') throw new Error('Incorrect integration database');
  const [rows] = await lock.query("SELECT GET_LOCK('youtube-board-test-integration-lane',0) AS acquired");
  if (Number(rows[0]?.acquired) !== 1) throw new Error('Another integration lane holds the isolated database');
  const redis = new Redis(env.REDIS_URL, { lazyConnect: true, connectTimeout: 3000, retryStrategy: null, maxRetriesPerRequest: 1 });
  redis.on('error', () => {});
  try { await redis.connect(); await redis.ping(); } finally { redis.disconnect(); }
  console.log('Integration lane: isolated youtube_board_test_rewrite + Redis /14; all DB suites enabled.');
  await run(['tools/bootstrap-db.mjs', '--execute']);
  await run(['--import', 'tsx', 'jobs/src/cli.ts', 'migrate', '--execute']);
  const npm = process.env.npm_execpath;
  if (!npm) throw new Error('Run this lane with npm run test:integration');
  await run(['--test', ...(await readdir(new URL('./', import.meta.url))).filter(name => name.endsWith('.test.mjs')).map(name => 'tools/' + name)]);
  // Shared schemas and fixtures must never race across workspace suites.
  // web uses node:test (pure route helpers, no DB access), not Vitest.
  for (const workspace of ['api', 'web', 'jobs', 'ingestion', 'ai', 'notifications'])
    await run([npm, 'run', 'test', '--workspace', workspace, ...(workspace === 'web' ? [] : ['--', '--fileParallelism=false'])]);
} catch (error) {
  // Avoid driver errors that can include connection configuration.
  console.error('Integration lane failed (no silent DB skips). Start platform Compose db/redis and initialize the dedicated test database; inspect test output for failures.');
  process.exitCode = 1;
} finally {
  if (lock) { await lock.query("SELECT RELEASE_LOCK('youtube-board-test-integration-lane')").catch(() => {}); await lock.end(); }
}
