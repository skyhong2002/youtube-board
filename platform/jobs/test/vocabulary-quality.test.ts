import { expect, it, vi } from 'vitest';
import type { Connection } from 'mysql2/promise';
import { aggregateSourceQuality, SOURCE, type SourceArticle } from '../src/vocabulary.js';
import { MysqlVocabularyStore } from '../src/mysql-vocabulary-store.js';
import { loadVocabularySnapshot } from '../src/load-vocabulary.js';
import { matchVocabulary } from '../src/match.js';
const base = { media: 'fixture', publishedAt: '2026-10-10T01:00:00.000Z' };
const articles: SourceArticle[] = [
  { ...base, id: '1', tags: ['舊頁正常標籤'] },
  { ...base, id: '2', tags: ['AI', '台灣'], sourceTags: [' A\u200BI ', '台灣'] },
  { ...base, id: '3', tags: ['安全'], sourceTags: ['惡\u001E意', ' 安全 ', '\u200B惡\u202E意'], rejectedTags: [{ raw: '惡\u001E意', reason: 'unsupported-control-character' }, { raw: '\u200B惡\u202E意', reason: 'unsupported-control-character' }] },
  { ...base, id: '4', tags: [], sourceTags: ['\u0000'], rejectedTags: [{ raw: '\u0000', reason: 'unsupported-control-character' }] },
];
it('aggregates old strict pages, prior normalization-only pages, and new quarantined occurrences', () => {
  expect(aggregateSourceQuality(articles)).toEqual({ normalizedTags: 2, rejectedTags: 3, articlesWithRejectedTags: 2 });
  expect(aggregateSourceQuality([articles[0]!])).toEqual({ normalizedTags: 0, rejectedTags: 0, articlesWithRejectedTags: 0 });
});
it('publishes quality from staged payloads atomically and keeps published version usable by matching', async () => {
  const id = 'quality-window', run = { id, window_since: '2026-10-10T00:00:00.000Z', window_until: '2026-10-11T00:00:00.000Z', checkpoint_cursor: null, pages: 51, status: 'ready' };
  const db = {
    beginTransaction: vi.fn().mockResolvedValue(undefined), commit: vi.fn().mockResolvedValue(undefined), rollback: vi.fn().mockResolvedValue(undefined),
    query: vi.fn().mockResolvedValueOnce([[run]]).mockResolvedValueOnce([articles.map(article => ({ payload: JSON.stringify(article) }))]).mockResolvedValueOnce([[]]),
    execute: vi.fn().mockResolvedValue([{}]),
  };
  const snapshot = await new MysqlVocabularyStore(db as unknown as Connection).publish(id);
  expect(snapshot).toMatchObject({ id, source: SOURCE, coverage: 'observed-article-window', upstreamSnapshotConsistent: false, sourceQuality: { normalizedTags: 2, rejectedTags: 3, articlesWithRejectedTags: 2 } });
  expect(snapshot.terms.some(t => /[\p{Cc}\p{Cf}]/u.test(t.term))).toBe(false);
  const stored = JSON.parse(db.execute.mock.calls.find(([sql]) => String(sql).startsWith('UPDATE ts_vocabulary_runs'))![1][1]);
  expect(stored.sourceQuality).toEqual(snapshot.sourceQuality); expect(db.commit).toHaveBeenCalledOnce();
  const publishedDb = { query: vi.fn().mockResolvedValue([[{ snapshot: JSON.stringify(snapshot) }]]) };
  const loaded = await loadVocabularySnapshot(publishedDb as unknown as Connection, id);
  expect(publishedDb.query.mock.calls[0]?.[1]).toEqual([id, 'published']);
  expect(matchVocabulary({ title: '安全 AI 惡\u001E意', description: '' }, loaded).map(e => e.term).sort()).toEqual(['AI', '安全'].sort());
});
it('legacy published snapshots without quality still load without inventing quality counts', async () => {
  const snapshot = { id: 'legacy', source: SOURCE, coverage: 'observed-article-window', terms: [] };
  const db = { query: vi.fn().mockResolvedValue([[{ snapshot: JSON.stringify(snapshot) }]]) };
  expect(await loadVocabularySnapshot(db as unknown as Connection, 'legacy')).not.toHaveProperty('sourceQuality');
});
