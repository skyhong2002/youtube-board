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

function publicationDb(current?: string) {
  const id = 'quality-policy-refresh', until = '2026-10-13T00:00:00.000Z';
  const run = {id, window_since: '2026-10-12T00:00:00.000Z', window_until: until, checkpoint_cursor: null, pages: 1, status: 'ready'};
  const db = {
    beginTransaction: vi.fn().mockResolvedValue(undefined), commit: vi.fn().mockResolvedValue(undefined), rollback: vi.fn().mockResolvedValue(undefined),
    query: vi.fn().mockResolvedValueOnce([[run]]).mockResolvedValueOnce([[{payload: JSON.stringify(articles[0])}]]).mockResolvedValueOnce([current === undefined ? [] : [{window_until: '2026-10-11T00:00:00.000Z', snapshot: current}]]),
    execute: vi.fn().mockResolvedValue([{}]),
  };
  return {id, db};
}
it('a later article window is retained as a published backup without replacing the active quality policy', async () => {
  const current = {id: 'quality-serving', coverage: 'observed-article-window', matchingRule: 'youtube-quality-v2'};
  const {id, db} = publicationDb(JSON.stringify(current));
  const snapshot = await new MysqlVocabularyStore(db as unknown as Connection).publish(id);
  expect(snapshot.becameCurrent).toBe(false);
  expect(snapshot.coverage).toBe('observed-article-window');
  expect(snapshot.terms).toHaveLength(1);
  expect(db.execute.mock.calls.some(([sql]) => String(sql).startsWith('UPDATE ts_vocabulary_runs'))).toBe(true);
  expect(db.execute.mock.calls.some(([sql]) => String(sql).includes('ts_vocabulary_current'))).toBe(false);
  expect(db.query.mock.calls.at(-1)?.[0]).toContain('FOR UPDATE');
  expect(db.commit).toHaveBeenCalledOnce();
});
it.each([undefined, 'exact-text-v1'])('legacy current policy %s still permits newer window promotion', async rule => {
  const {id, db} = publicationDb(JSON.stringify({coverage: 'observed-article-window', ...(rule ? {matchingRule: rule} : {})}));
  const snapshot = await new MysqlVocabularyStore(db as unknown as Connection).publish(id);
  expect(snapshot.becameCurrent).toBe(true);
  expect(db.execute.mock.calls.some(([sql]) => String(sql).includes('ts_vocabulary_current'))).toBe(true);
});
it.each(['null', '[]', '42', '{"matchingRule":"future-policy"}'])('invalid or unknown serving metadata %s cannot be replaced', async current => {
  const {id, db} = publicationDb(current);
  await expect(new MysqlVocabularyStore(db as unknown as Connection).publish(id)).rejects.toThrow(/Invalid serving|Unknown vocabulary/);
  expect(db.execute).not.toHaveBeenCalled();
  expect(db.commit).not.toHaveBeenCalled();
  expect(db.rollback).toHaveBeenCalledOnce();
});
