import { isolatedTestEnv } from '../../shared/test-database.js';
import { createHash, randomUUID } from 'node:crypto';
import { describe, it, expect, vi } from 'vitest';
import type { Connection, RowDataPacket } from 'mysql2/promise';
import { HttpSnapshotSource, validateManifest, validatePage, hash, type ExportManifest, type ExportTerm, type SnapshotSource } from '../src/snapshot-client.js';
import { importSnapshot } from '../src/snapshot-import.js';
import { loadVocabularySnapshot } from '../src/load-vocabulary.js';
import { connectDatabase, withWriterLock } from '../src/database.js';
import { SOURCE, termKey, aggregateTerms, type VocabularySnapshot } from '../src/vocabulary.js';
import { MysqlVocabularyStore } from '../src/mysql-vocabulary-store.js';
import { matchVocabulary } from '../src/match.js';

function sample(size: number, generatedAt = '2026-10-12T01:00:00.000Z', labelWidth = 0) {
  const entries: ExportTerm[] = Array.from({ length: size }, (_, index) => {
    const label = `完整詞彙${String(index).padStart(6, '0')}`.padEnd(labelWidth, '字');
    return { id: hash(label), label, articleCount: 3, firstPublishedAt: '2026-01-01T00:00:00.000Z', lastPublishedAt: generatedAt, origin: 'article-tags-mixed', journalistAssigned: null };
  });
  const pages: ExportTerm[][] = [];
  for (let i = 0; i < entries.length; i += 500) pages.push(entries.slice(i, i + 500));
  const manifest: ExportManifest = { schemaVersion: 1, id: randomUUID(), previousId: null, generatedAt, source: SOURCE, attribution: '新文易數 tag.observe.tw', coverage: 'all-current-indexed-article-tags', provenance: 'mixed-native-edited-and-rule-derived; per-term assignment unknown', identity: 'sha256-exact-utf8-label', total: size, pageSize: 500, pages: pages.map(p => hash(`${JSON.stringify(p)}\n`)), sha256: createHash('sha256').update(entries.map(e => `${JSON.stringify(e)}\n`).join('')).digest('hex'), changeCount: size, changePages: [] };
  const source: SnapshotSource = {
    current: vi.fn(async () => manifest),
    page: vi.fn(async (_, index) => ({ snapshot: manifest, entries: pages[index]!, cursor: String(index), nextCursor: index + 1 < pages.length ? String(index + 1) : null, sha256: manifest.pages[index]! })),
  };
  return { manifest, entries, source };
}
describe('upstream full vocabulary contract', () => {
  it('checks page integrity, fixed manifest, source attribution and total bounds', async () => {
    const { source, manifest } = sample(1);
    expect(validateManifest(manifest).coverage).toBe('all-current-indexed-article-tags');
    const page = await source.page(manifest, 0);
    expect(validatePage(page, manifest, 0).entries[0]?.journalistAssigned).toBeNull();
    expect(() => validatePage({ ...page, nextCursor: '1' }, manifest, 0)).toThrow('cursor');
    expect(() => validatePage({ ...page, entries: [{ ...page.entries[0], label: 'changed' }] }, manifest, 0)).toThrow('checksum');
    expect(() => validateManifest({ ...manifest, source: 'https://other.example' })).toThrow('manifest');
    expect(() => validateManifest({ ...manifest, total: 250001 })).toThrow('manifest');
    expect(() => validatePage({ ...page, snapshot: { ...manifest, id: randomUUID() } }, manifest, 0)).toThrow('changed');
  });
  it('keeps requests on the public tag origin and fails closed on unavailable export', async () => {
    const { manifest } = sample(1);
    const request = vi.fn<typeof fetch>(async () => new Response(JSON.stringify(manifest)));
    await new HttpSnapshotSource(request).current();
    expect(request.mock.calls[0]?.[0]).toBe('https://tag.observe.tw/api/v1/vocabulary/snapshots/current');
    const unavailable = vi.fn(async () => new Response('', { status: 503 }));
    await expect(new HttpSnapshotSource(unavailable).current()).rejects.toThrow('503');
  });
  it('compiles larger full dictionaries once and retains longest original-text matches', () => {
    const snapshot: VocabularySnapshot = { id: 'full-matcher-test', source: SOURCE, coverage: 'all-current-indexed-article-tags', window: null, publishedAt: '', upstreamSnapshotConsistent: true, terms: aggregateTerms([{ id: '1', media: 'test', publishedAt: '', tags: [...Array.from({ length: 50001 }, (_, i) => `測試詞${i}`), '台灣', '台灣大學', 'AI'] }]) };
    const text = '😀台灣大學的 AI；AIDS 測試詞50000';
    const first = matchVocabulary({ title: text }, snapshot);
    expect(first.map(e => e.term)).toEqual(['台灣大學', 'AI', '測試詞50000']);
    expect(matchVocabulary({ title: text }, snapshot)).toEqual(first);
    for (const e of first) expect(text.slice(e.start, e.end)).toBe(e.text);
  });
});
it.skipIf(process.env.JOBS_DB_TEST !== '1')('imports full snapshots atomically, retries interrupted pages, rejects mutation and retains prior versions', async () => {
  const db = await connectDatabase(isolatedTestEnv());
  const [before] = await db.query<RowDataPacket[]>('SELECT run_id FROM ts_vocabulary_current WHERE source = ?', [SOURCE]);
  const full = sample(501), older = sample(1, '2026-10-11T01:00:00.000Z'), tied = sample(1), collision = sample(1);
  const ids = [`tag-${full.manifest.id}`, `tag-${older.manifest.id}`, `window-${randomUUID()}`, `tag-${tied.manifest.id}`, `tag-${collision.manifest.id}`];
  const originalPage = full.source.page;
  try {
    await db.execute('DELETE FROM ts_vocabulary_current WHERE source = ?', [SOURCE]);
    await withWriterLock(db, 'tags.vocabulary.sync', async check => {
      full.source.page = vi.fn(async (manifest, index) => { if (index === 1) throw new Error('interrupted'); return originalPage(manifest, index); });
      await expect(importSnapshot(db, full.source, 1, check, async () => {})).rejects.toThrow('cap');
      await expect(importSnapshot(db, full.source, 2, check, async () => {})).rejects.toThrow('interrupted');
      await expect(new MysqlVocabularyStore(db).stage(ids[0]!, '1', { articles: [], nextCursor: null })).rejects.toThrow('run id');
      await expect(new MysqlVocabularyStore(db).publish(ids[0]!)).rejects.toThrow('run id');
      const [during] = await db.query<RowDataPacket[]>('SELECT run_id FROM ts_vocabulary_current WHERE source = ?', [SOURCE]);
      expect(during).toEqual([]);
      full.source.page = originalPage;
      expect((await importSnapshot(db, full.source, 2, check, async () => {})).status).toBe('published');
      const hydrated = await loadVocabularySnapshot(db, ids[0]);
      expect(hydrated.terms).toHaveLength(501);
      expect(hydrated.window).toBeNull();
      expect(hydrated.upstreamManifest).toEqual(full.manifest);
      expect(hydrated.terms.find(t => t.upstreamId === full.entries[0]?.id)?.upstream).toEqual(full.entries[0]);
      await expect(new MysqlVocabularyStore(db).begin(ids[0]!, { since: '2026-10-10T00:00:00.000Z', until: '2026-10-11T00:00:00.000Z' })).rejects.toThrow('run id');
      expect(hydrated.upstreamSnapshotId).toBe(full.manifest.id);
      await db.execute('UPDATE ts_vocabulary_terms SET payload = JSON_SET(payload, \'$.articleCount\', 999) WHERE run_id = ? AND term_key = ?', [ids[0], hydrated.terms[0]!.key]);
      await expect(loadVocabularySnapshot(db, ids[0])).rejects.toThrow('checksum');
      await db.execute('UPDATE ts_vocabulary_terms SET payload = ? WHERE run_id = ? AND term_key = ?', [JSON.stringify(hydrated.terms[0]), ids[0], hydrated.terms[0]!.key]);
      const calls = vi.mocked(originalPage).mock.calls.length;
      expect((await importSnapshot(db, full.source, 2, check, async () => {})).status).toBe('already-published');
      expect(vi.mocked(originalPage).mock.calls).toHaveLength(calls);
      expect((await importSnapshot(db, older.source, 1, check, async () => {})).becameCurrent).toBe(false);
      expect((await importSnapshot(db, tied.source, 1, check, async () => {})).becameCurrent).toBe(false);
      await db.execute('INSERT INTO ts_vocabulary_runs(id,window_since,window_until,status,snapshot) VALUES (?,?,?,?,?)', [ids[4], collision.manifest.generatedAt, collision.manifest.generatedAt, 'ready', JSON.stringify({ upstreamManifest: collision.manifest, upstreamChecksum: collision.manifest.sha256 })]);
      await expect(importSnapshot(db, collision.source, 1, check, async () => {})).rejects.toThrow('foreign run');
      const observed = new MysqlVocabularyStore(db);
      await observed.begin(ids[2]!, { since: '2026-10-15T00:00:00.000Z', until: '2026-10-16T00:00:00.000Z' });
      await observed.stage(ids[2]!, null, { articles: [], nextCursor: null });
      expect((await observed.publish(ids[2]!)).becameCurrent).toBe(false);
      full.manifest.sha256 = '0'.repeat(64);
      await expect(importSnapshot(db, full.source, 2, check, async () => {})).rejects.toThrow('changed contents');
    });
  } finally {
    if (before[0]) await db.execute('INSERT INTO ts_vocabulary_current(source,run_id) VALUES (?,?) ON DUPLICATE KEY UPDATE run_id=VALUES(run_id)', [SOURCE, before[0].run_id]);
    else for (const id of ids) await db.execute('DELETE FROM ts_vocabulary_current WHERE run_id = ?', [id]);
    for (const id of ids) {
      await db.execute('DELETE FROM ts_vocabulary_terms WHERE run_id = ?', [id]);
      await db.execute('DELETE FROM ts_vocabulary_stage WHERE run_id = ?', [id]);
      await db.execute('DELETE FROM ts_vocabulary_runs WHERE id = ?', [id]);
    }
    await db.end();
  }
});

it('preserves byte-exact term identity and rejects impossible dates and unpaired surrogates', async () => {
  expect(new Set(['AI', 'ai', 'é', 'e\u0301'].map(termKey)).size).toBe(4);
  const { manifest, source } = sample(1);
  expect(() => validateManifest({ ...manifest, generatedAt: '2026-02-30T00:00:00.000Z' })).toThrow('manifest');
  for (const change of [{ label: '\ud800' }, { firstPublishedAt: '2026-02-30T00:00:00.000Z' }, { firstPublishedAt: '2026-01-01Z' }]) {
    const page = await source.page(manifest, 0);
    const entry = { ...page.entries[0]!, ...change };
    entry.id = hash(entry.label);
    const entries = [entry];
    const sha256 = hash(`${JSON.stringify(entries)}\n`);
    const updated = { ...manifest, pages: [sha256] };
    expect(() => validatePage({ ...page, entries, sha256, snapshot: updated }, updated, 0)).toThrow('term');
  }
});
it('rejects dictionaries above the conservative trie publication budget before matching', async () => {
  const { assertVocabularyBudget, MAX_TRIE_NODES } = await import('../src/vocabulary-budget.js');
  expect(() => assertVocabularyBudget(Array.from({ length: Math.ceil(MAX_TRIE_NODES / 240) }, () => ({ term: '字'.repeat(240) })))).toThrow('budget');
});

it('oversized importer leaves staged data unpublished and never moves current', async () => {
  const large = sample(34000, '2026-10-12T01:00:00.000Z', 60);
  let published = false, currentChanged = false, writes = 0;
  const db = {
    query: async () => [[]],
    execute: async (sql: string, values: unknown[]) => {
      writes++;
      if (sql.includes('ts_vocabulary_current')) currentChanged = true;
      if (values?.[0] === 'published') published = true;
      return [{ affectedRows: 1 }];
    },
    beginTransaction: async () => {}, commit: async () => {}, rollback: async () => {},
  } as unknown as Connection;
  await expect(importSnapshot(db, large.source, 100, async () => {}, async () => {})).rejects.toThrow('budget');
  expect(writes).toBeGreaterThan(0);
  expect(published).toBe(false);
  expect(currentChanged).toBe(false);
});
