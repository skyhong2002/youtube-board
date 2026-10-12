import { isolatedTestEnv } from '../../shared/test-database.js';
import { it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { connectDatabase, withWriterLock } from '../src/database.js';
import { MysqlVocabularyStore } from '../src/mysql-vocabulary-store.js';
import { synchronizeVocabulary, SOURCE } from '../src/vocabulary.js';
import type { RowDataPacket } from 'mysql2/promise';
it.skipIf(process.env.JOBS_DB_TEST !== '1')('MariaDB serializes writers, retains checkpoints and atomically publishes immutable versions', async () => {
  const env = isolatedTestEnv();
  const db = await connectDatabase(env), competitor = await connectDatabase(env);
  const id = 'test_' + randomUUID().replaceAll('-', '');
  const store = new MysqlVocabularyStore(db);
  const window = { since: '2026-10-09T00:00:00.000Z', until: '2026-10-10T00:00:00.000Z' };
  const article = { id: '1', media: 'cna', publishedAt: '2026-10-09T01:00:00Z', tags: ['TestOnlyTag'] };
  const [previous] = await db.query<RowDataPacket[]>('SELECT run_id FROM ts_vocabulary_current WHERE source = ?', [SOURCE]);
  try {
    await withWriterLock(db, 'integration-test', async check => {
      await expect(withWriterLock(competitor, 'integration-test', async () => undefined)).rejects.toThrow('Another');
      await check();
      const incomplete = await synchronizeVocabulary({ id, window, maxPages: 1, store, assertOwnership: check, source: { page: async () => ({ articles: [article], nextCursor: '1_1' }) } });
      expect(incomplete.status).toBe('incomplete');
      const [current] = await db.query<RowDataPacket[]>('SELECT run_id FROM ts_vocabulary_current WHERE source = ?', [SOURCE]);
      expect(current[0]?.run_id).toBe(previous[0]?.run_id);
      await expect(store.stage(id, null, { articles: [], nextCursor: null })).rejects.toThrow('Stale');
      await expect(store.begin(id, { ...window, since: '2026-10-08T00:00:00.000Z' })).rejects.toThrow('different window');
      const result = await synchronizeVocabulary({ id, window, maxPages: 1, store, assertOwnership: check, source: { page: async (_w, cursor) => { expect(cursor).toBe('1_1'); return { articles: [article], nextCursor: null }; } } });
      expect(result.status).toBe('published');
      if (result.status === 'published') expect(result.snapshot.terms[0]?.articleCount).toBe(1);
      const retry = await synchronizeVocabulary({ id, window, maxPages: 1, store, assertOwnership: check, source: { page: async () => { throw new Error('should not fetch'); } } });
      expect(retry).toEqual(result);
    });
    await withWriterLock(competitor, 'integration-test', async check => check());
  } finally {
    if (previous[0]) await db.execute('UPDATE ts_vocabulary_current SET run_id = ? WHERE source = ? AND run_id = ?', [previous[0].run_id, SOURCE, id]);
    else await db.execute('DELETE FROM ts_vocabulary_current WHERE run_id = ?', [id]);
    await db.execute('DELETE FROM ts_vocabulary_stage WHERE run_id = ?', [id]);
    await db.execute('DELETE FROM ts_vocabulary_runs WHERE id = ?', [id]);
    await db.end(); await competitor.end();
  }
});
