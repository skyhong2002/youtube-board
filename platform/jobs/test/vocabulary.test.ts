import { describe, it, expect, vi } from 'vitest';
import { aggregateTerms, SOURCE, synchronizeVocabulary, type ArticlePage, type SyncRun, type VocabularySnapshot, type VocabularyStore, type Window, type SourceArticle, validateWindow } from '../src/vocabulary.js';
import { matchVocabulary } from '../src/match.js';
import { TagArticleSource } from '../src/tag-source.js';
import { assertExecute, executionPolicy, assertLocalDatabase } from '../src/policy.js';
const window: Window = { since: '2026-10-10T00:00:00.000Z', until: '2026-10-11T00:00:00.000Z' };
class MemoryStore implements VocabularyStore {
  run?: SyncRun; snapshot?: VocabularySnapshot; articles = new Map<string, SourceArticle>();
  async begin(id: string, w: Window) {
    if (this.run && (this.run.id !== id || JSON.stringify(this.run.window) !== JSON.stringify(w))) throw new Error('Run mismatch');
    return this.run ??= { id, window: w, cursor: null, pages: 0, status: 'scanning' };
  }
  async stage(id: string, cursor: string | null, page: ArticlePage) {
    if (!this.run || this.run.id !== id || this.run.cursor !== cursor) throw new Error('Checkpoint mismatch');
    page.articles.forEach(a => this.articles.set(a.id, a));
    return this.run = { ...this.run, cursor: page.nextCursor, pages: this.run.pages + 1, status: page.nextCursor ? 'scanning' : 'ready' };
  }
  async publish(id: string): Promise<VocabularySnapshot> {
    if (!this.run || this.run.status === 'scanning') throw new Error('Incomplete');
    this.run.status = 'published';
    return this.snapshot ??= { id, source: SOURCE, window: this.run.window, publishedAt: '2026-10-11T01:00:00.000Z', coverage: 'observed-article-window', upstreamSnapshotConsistent: false, terms: aggregateTerms([...this.articles.values()]) };
  }
}
const article = (id: string, tags: string[]) => ({ id, media: 'cna', publishedAt: '2026-10-10T01:00:00Z', tags });
const ownership = async () => {};
describe('vocabulary synchronization', () => {
  it('retains unpublished checkpoints on interruption, resumes, and skips source on published retry', async () => {
    const store = new MemoryStore();
    const page = vi.fn().mockResolvedValueOnce({ articles: [article('1', ['新聞', '新聞'])], nextCursor: '1_1' }).mockRejectedValueOnce(new Error('network interrupted')).mockResolvedValueOnce({ articles: [article('2', ['選舉'])], nextCursor: null });
    const input = { id: 'run1', window, maxPages: 20, source: { page }, store, assertOwnership: ownership };
    await expect(synchronizeVocabulary(input)).rejects.toThrow('interrupted');
    expect(store.snapshot).toBeUndefined(); expect(store.run?.cursor).toBe('1_1');
    expect((await synchronizeVocabulary(input)).status).toBe('published');
    expect(store.snapshot?.terms.find(t => t.term === '新聞')?.articleCount).toBe(1);
    await synchronizeVocabulary(input);
    expect(page).toHaveBeenCalledTimes(3); expect(page.mock.calls[2]?.[1]).toBe('1_1');
  });
  it('a page cap and repeated cursor never publish a partial vocabulary', async () => {
    const store = new MemoryStore();
    const input = { id: 'run', window, maxPages: 1, source: { page: async () => ({ articles: [article('1', ['新聞'])], nextCursor: '1_1' }) }, store, assertOwnership: ownership };
    expect((await synchronizeVocabulary(input)).status).toBe('incomplete'); expect(store.snapshot).toBeUndefined();
    await expect(synchronizeVocabulary(input)).rejects.toThrow('repeated cursor');
  });
  it('lost ownership after a source response prevents staging/publication', async () => {
    const store = new MemoryStore();
    await expect(synchronizeVocabulary({ id: 'run', window, maxPages: 1, source: { page: async () => ({ articles: [article('1', ['新聞'])], nextCursor: null }) }, store, assertOwnership: vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('lost ownership')) })).rejects.toThrow('lost ownership');
    expect(store.articles.size).toBe(0); expect(store.snapshot).toBeUndefined();
  });
  it('re-observations preserve old versions and do not label absence as deletion', async () => {
    const old = new MemoryStore(), fresh = new MemoryStore();
    const scan = (store: MemoryStore, tags: string[]) => synchronizeVocabulary({ id: 'run', window, maxPages: 1, store, source: { page: async () => ({ articles: [article('1', tags)], nextCursor: null }) }, assertOwnership: ownership });
    await scan(old, ['舊詞']); await scan(fresh, ['新詞']);
    expect(old.snapshot?.terms.map(t => t.term)).toEqual(['舊詞']); expect(fresh.snapshot?.terms.map(t => t.term)).toEqual(['新詞']);
    expect(fresh.snapshot?.coverage).toBe('observed-article-window'); expect(fresh.snapshot).not.toHaveProperty('deleted');
  });
});
it('keeps exact offsets, Latin boundaries and longest Chinese phrases', () => {
  const snapshot: VocabularySnapshot = { id: 'v1', source: SOURCE, window, publishedAt: '', coverage: 'observed-article-window', upstreamSnapshotConsistent: false, terms: aggregateTerms([article('1', ['AI', '台灣', '台灣大學'])]) };
  const title = '😀台灣大學推動 AI；AIDS 與 XAI 不應命中 ai';
  const matches = matchVocabulary({ title, description: 'AI研究' }, snapshot);
  expect(matches.map(m => m.term)).toEqual(['台灣大學', 'AI', 'AI']);
  for (const evidence of matches.filter(m => m.field === 'title')) expect(title.slice(evidence.start, evidence.end)).toBe(evidence.text);
  expect(matches[0]?.start).toBe(2); expect(matches[0]?.vocabularyVersion).toBe('v1');
});
describe('writer execution policy', () => {
  const env = { APP_ENV: 'production', TS_INGESTION_ENABLED: 'true', TS_INGESTION_PRODUCTION_ENABLED: 'true', TS_INGESTION_OWNERS: 'tags.vocabulary.sync', TS_INGESTION_WRITE_ALLOWLIST: 'tags.vocabulary.sync' };
  it('denies dry-run and shadow even with enabled execution gates', () => {
    for (const mode of ['dry-run', 'shadow'] as const) expect(() => assertExecute('tags.vocabulary.sync', executionPolicy(env, mode))).toThrow('explicit execute');
  });
  it('requires exact allowlist, ownership transfer and scheduled gate independently', () => {
    expect(() => assertExecute('tags.vocabulary.sync', executionPolicy(env, 'execute'))).not.toThrow();
    expect(() => assertExecute('tags.vocabulary.sync', executionPolicy({ ...env, TS_INGESTION_WRITE_ALLOWLIST: '*' }, 'execute'))).toThrow();
    expect(() => assertExecute('tags.vocabulary.sync', executionPolicy({ ...env, TS_INGESTION_OWNERS: '' }, 'execute'))).toThrow('ownership');
    expect(() => assertExecute('tags.vocabulary.sync', executionPolicy(env, 'execute', true))).toThrow('Scheduler');
    expect(() => executionPolicy({ APP_ENV: 'staging' }, 'execute')).toThrow();
  });
  it('rejects accidental production connections under local mode', () => {
    expect(() => assertLocalDatabase('youtube-board-db-qcja1i', 'youtube_board', 'local')).toThrow();
    expect(() => assertLocalDatabase('127.0.0.1', 'youtube_board', 'local')).toThrow();
  });
});
describe('public source contract', () => {
  it('validates the source window and does not invent manual tag attribution', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ query: window, articles: [{ ...article('1', ['台灣']), id: 1 }], nextCursor: null })));
    const page = await new TagArticleSource(fetcher, 0).page(window, null);
    expect(page.articles[0]?.id).toBe('1'); expect(String(fetcher.mock.calls[0]?.[0])).toContain('/api/v1/articles?');
    expect(aggregateTerms(page.articles)[0]?.provenance).toBe('upstream-article-tag-origin-unspecified');
  });
  it('rejects malformed ids, changed windows and upstream failures', async () => {
    const bad = vi.fn().mockResolvedValue(new Response(JSON.stringify({ query: window, articles: [{ ...article('1', ['台灣']), id: Number.MAX_SAFE_INTEGER + 1 }], nextCursor: null })));
    await expect(new TagArticleSource(bad, 0).page(window, null)).rejects.toThrow('article');
    const wrong = vi.fn().mockResolvedValue(new Response(JSON.stringify({ query: { ...window, until: '2026-10-12T00:00:00Z' }, articles: [], nextCursor: null })));
    await expect(new TagArticleSource(wrong, 0).page(window, null)).rejects.toThrow('window');
    const unavailable = vi.fn().mockResolvedValue(new Response('', { status: 429 }));
    await expect(new TagArticleSource(unavailable, 0).page(window, null)).rejects.toThrow('429');
  });
});

it('requires timezone-qualified windows rather than host-local dates', () => {
  expect(() => validateWindow({ since: '2026-10-10T00:00:00', until: '2026-10-11T00:00:00' })).toThrow('timezone');
  expect(() => validateWindow({ since: '2026-10-10T08:00:00+08:00', until: '2026-10-11T00:00:00Z' })).not.toThrow();
});
it('rejects source cursors that revisit or skip away from the actual last article', async () => {
  const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ query: window, articles: [{ ...article('1', ['台灣']), id: 1 }], nextCursor: '1791594000000_9' })));
  await expect(new TagArticleSource(fetcher, 0).page(window, null)).rejects.toThrow('continuation');
});
