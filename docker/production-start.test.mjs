import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('./production-start.sh', import.meta.url));

function run(overrides = {}) {
  const root = mkdtempSync(path.join(tmpdir(), 'yt-startup-gate-'));
  const bin = path.join(root, 'bin');
  const log = path.join(root, 'calls');
  mkdirSync(bin);
  mkdirSync(path.join(root, 'bootstrap/cache'), { recursive: true });
  writeFileSync(log, '');

  const commands = {
    php: 'printf "%s\\n" "$*" >> "$TEST_CALL_LOG"\n'
      + 'if [ "$*" = "artisan deployment:schema-check --no-interaction" ] '
      + '&& [ "${TEST_SCHEMA_FAIL:-}" = true ]; then exit 1; fi\n',
    frankenphp: 'echo serve >> "$TEST_CALL_LOG"\n',
  };
  for (const [name, body] of Object.entries(commands)) {
    const file = path.join(bin, name);
    writeFileSync(file, '#!/bin/sh\nset -eu\n' + body);
    chmodSync(file, 0o700);
  }

  try {
    const result = spawnSync('sh', [script], {
      cwd: root,
      env: { PATH: bin + ':' + process.env.PATH, TEST_CALL_LOG: log, ...overrides },
      encoding: 'utf8',
    });
    return { ...result, calls: readFileSync(log, 'utf8').trim().split('\n').filter(Boolean) };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test('default and explicit false production startup do not execute migration writes', () => {
  for (const options of [{}, { LARAVEL_STARTUP_MIGRATIONS_ENABLED: 'false' }]) {
    const result = run(options);
    assert.equal(result.status, 0, result.stderr);
    assert.ok(!result.calls.some(c => c.startsWith('artisan migrate ')));
    assert.ok(result.calls.includes('artisan deployment:schema-check --no-interaction'));
    assert.equal(result.calls.at(-1), 'serve');
  }
});

test('only explicit true executes migrations before schema check and server startup', () => {
  const result = run({ LARAVEL_STARTUP_MIGRATIONS_ENABLED: 'true' });
  assert.equal(result.status, 0, result.stderr);
  assert.ok(result.calls.indexOf('artisan migrate --force --no-interaction')
    < result.calls.indexOf('artisan deployment:schema-check --no-interaction'));
  assert.equal(result.calls.at(-1), 'serve');
});

test('invalid gate values stop before even opening the database', () => {
  for (const value of ['1', 'yes', 'TRUE', 'unexpected']) {
    const result = run({ LARAVEL_STARTUP_MIGRATIONS_ENABLED: value });
    assert.notEqual(result.status, 0);
    assert.deepEqual(result.calls, []);
  }
});

test('schema drift refuses server startup without attempting automatic repair', () => {
  const result = run({ TEST_SCHEMA_FAIL: 'true' });
  assert.notEqual(result.status, 0);
  assert.ok(!result.calls.includes('serve'));
  assert.ok(!result.calls.some(c => c.startsWith('artisan migrate ')));
});
