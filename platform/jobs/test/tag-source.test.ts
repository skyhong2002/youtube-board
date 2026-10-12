import { describe, expect, it, vi } from 'vitest';
import type { Connection } from 'mysql2/promise';
import { TagArticleSource } from '../src/tag-source.js';
import { MysqlVocabularyStore } from '../src/mysql-vocabulary-store.js';
import { aggregateTerms, SOURCE, type Window } from '../src/vocabulary.js';

const window: Window = { since: '2026-10-10T00:00:00.000Z', until: '2026-10-11T00:00:00.000Z' };
function read(tags: unknown[], extra: Record<string, unknown> = {}) {
  const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({
    query: window,
    articles: [{ id: 51840631, media: 'test', publishedAt: '2026-10-10T01:00:00.000Z', tags, ...extra }],
    nextCursor: null,
  })));
  return new TagArticleSource(fetcher, { serviceToken: 'synthetic-test-token', intervalMs: 100, maxRetries: 0 }).page(window, null);
}

describe('bounded article-tag normalization', () => {
  it('accepts the observed two five-unit U+200B tag shape and stages exact original tags', async () => {
    // Representative text with the observed upstream article ID/tag lengths; not a canonical vocabulary fixture.
    const raw = ['台灣\u200B新聞', '國際\u200B焦點', '原樣標籤'];
    expect(raw[0]).toHaveLength(5); expect(raw[1]).toHaveLength(5);
    const page = await read(raw);
    expect(page.articles[0]).toMatchObject({ id: '51840631', tags: ['台灣新聞', '國際焦點', '原樣標籤'], sourceTags: raw });
    const run = { id: 'normalization-proof', window_since: window.since, window_until: window.until, checkpoint_cursor: null, pages: 0, status: 'scanning' };
    const db = {
      beginTransaction: vi.fn().mockResolvedValue(undefined), commit: vi.fn().mockResolvedValue(undefined), rollback: vi.fn().mockResolvedValue(undefined),
      query: vi.fn().mockResolvedValueOnce([[run]]).mockResolvedValueOnce([[{ total: 0 }]]).mockResolvedValueOnce([[{ ...run, pages: 1, status: 'ready' }]]),
      execute: vi.fn().mockResolvedValue([{}]),
    };
    await new MysqlVocabularyStore(db as unknown as Connection).stage(run.id, null, page);
    const insert = db.execute.mock.calls.find(([sql]) => String(sql).startsWith('INSERT INTO ts_vocabulary_stage'));
    expect(insert).toBeDefined();
    const payload = JSON.parse(insert![1][2]);
    expect(payload.sourceTags).toEqual(raw); expect(payload.tags).toEqual(['台灣新聞', '國際焦點', '原樣標籤']);
    expect(db.commit).toHaveBeenCalledOnce(); expect(db.rollback).not.toHaveBeenCalled();
  });

  it('trims edge spaces after removing only U+200B and preserves each upstream occurrence', async () => {
    const raw = [' \u200BAI\u200B ', 'AI', ' AI ', '台 灣', 'ＡＩ', 'Cafe\u0301'];
    const page = await read(raw);
    expect(page.articles[0]?.tags).toEqual(['AI', 'AI', 'AI', '台 灣', 'ＡＩ', 'Cafe\u0301']);
    expect(page.articles[0]?.sourceTags).toEqual(raw);
    const terms = aggregateTerms(page.articles);
    expect(terms.find(t => t.term === 'AI')?.articleCount).toBe(1);
    expect(terms.every(t => t.provenance === 'upstream-article-tag-origin-unspecified')).toBe(true);
    expect(terms.map(t => t.term)).toContain('ＡＩ'); expect(terms.map(t => t.term)).toContain('Cafe\u0301');
  });

  it('keeps unchanged tags without duplicating payload or trusting upstream provenance fields', async () => {
    const page = await read(['AI', '台灣'], { sourceTags: ['untrusted upstream override'] });
    expect(page.articles[0]?.tags).toEqual(['AI', '台灣']);
    expect(page.articles[0]).not.toHaveProperty('sourceTags');
  });

  it.each(['\tAI', 'AI\n', '\rAI', '\u0000AI', 'AI\u007F', '\u0085AI', '\u200CAI', 'AI\u200D', '\u200EAI', '\u202EAI', 'AI\u202C', '\u2066AI\u2069', '\uFEFFAI', '\u00ADAI'])('rejects non-exempt controls before trimming: %j', async raw => {
    await expect(read([raw])).rejects.toThrow('Invalid tag source terms');
    await expect(read(['\u200B' + raw + '\u200B'])).rejects.toThrow('Invalid tag source terms');
  });

  it.each(['', '   ', '\u200B', ' \u200B \u200B '])('rejects tags empty after normalization: %j', async raw => {
    await expect(read([raw])).rejects.toThrow('Invalid tag source terms');
  });

  it.each([null, 42, {}, ['AI']])('rejects non-string tags: %j', async raw => {
    await expect(read([raw])).rejects.toThrow('Invalid tag source terms');
  });

  it('retains the raw 240-unit limit even when normalization would shorten input', async () => {
    expect((await read(['a'.repeat(239) + '\u200B'])).articles[0]?.tags).toEqual(['a'.repeat(239)]);
    for (const raw of ['a'.repeat(241), 'a'.repeat(240) + '\u200B', ' '.repeat(240) + 'a', '\u200B'.repeat(240) + 'a']) {
      await expect(read([raw])).rejects.toThrow('Invalid tag source terms');
    }
  });

  it('retains the raw tag-count cap even if normalization would produce one distinct term', async () => {
    await expect(read(Array(501).fill(' \u200BAI '))).rejects.toThrow('Invalid tag source terms');
  });

  it('retains the upstream response byte budget before parsing tags', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(' '.repeat(4_000_001)));
    const source = new TagArticleSource(fetcher, { serviceToken: 'synthetic-test-token', intervalMs: 100, maxRetries: 0 });
    await expect(source.page(window, null)).rejects.toThrow('body read failed or exceeds cap');
    expect(String(fetcher.mock.calls[0]?.[0])).toContain(SOURCE);
  });
});
