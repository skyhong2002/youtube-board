import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const script = fileURLToPath(new URL('./restore-drill.mjs', import.meta.url));
function run(args, env = {}) {
  return spawnSync(process.execPath, [script, ...args], { encoding: 'utf8', timeout: 5000, env: { PATH: process.env.PATH, ...env } });
}
test('restore defaults to a local no-write preview without consulting runtime endpoints', () => {
  const result = run([], { DATABASE_URL: 'mysql://invalid.invalid/production', DOCKER_HOST: 'tcp://invalid.invalid:2375', COMPOSE_FILE: '/missing' });
  assert.equal(result.status, 0); const preview = JSON.parse(result.stdout);
  assert.equal(preview.mode, 'preview'); assert.equal(preview.externalCalls, 0); assert.equal(preview.source, 'youtube_board_rewrite');
});
test('restore rejects production mode and arbitrary destinations before local connection', () => {
  for (const [args, env] of [[['--execute'], { APP_ENV: 'production' }], [['--execute'], { NODE_ENV: 'production' }], [['--database=production'], {}]]) {
    const result = run(args, env); assert.notEqual(result.status, 0); assert.match(result.stderr, /Restore drill only supports local/); assert.equal(result.stdout, '');
  }
});
