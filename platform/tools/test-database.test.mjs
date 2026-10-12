import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assertTestDatabaseUrl, isolatedTestEnv } from '../shared/test-database.ts';
test('test database target rejects preview/remote targets and alternate ports before connection', () => {
  for (const url of ['mysql://localhost:23306/youtube_board_rewrite', 'mysql://remote:23306/youtube_board_test_rewrite', 'mysql://localhost:3306/youtube_board_test_rewrite', 'mysql://localhost:23306/youtube_board_test_rewrite?host=remote'])
    assert.throws(() => assertTestDatabaseUrl(url), /isolated/);
  assert.equal(assertTestDatabaseUrl('mysql://localhost:23306/youtube_board_test_rewrite'), 'mysql://localhost:23306/youtube_board_test_rewrite');
  assert.throws(() => isolatedTestEnv({ DB_PORT: '3306' }), /isolated/);
});
