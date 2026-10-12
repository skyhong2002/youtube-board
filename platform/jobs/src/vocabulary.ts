import type { ExportManifest, ExportTerm } from './snapshot-client.js';
import { createHash } from 'node:crypto';
export const SOURCE = 'https://tag.observe.tw';
export const VOCABULARY_JOB = 'tags.vocabulary.sync';
export interface Window { since: string; until: string }
export interface SourceArticle {
  id: string; media: string; publishedAt: string; tags: string[];
  /** Exact upstream array retained in staging when U+200B/edge-space normalization changes a tag. */
  sourceTags?: string[];
}
export interface ArticlePage { articles: SourceArticle[]; nextCursor: string | null }
export interface VocabularyTerm { key: string; term: string; articleCount: number; media: string[]; provenance: 'upstream-article-tag-origin-unspecified'; upstreamId?: string; upstream?: ExportTerm }
export interface VocabularySnapshot {
  id: string; source: typeof SOURCE; window: Window | null; publishedAt: string;
  coverage: 'observed-article-window' | 'all-current-indexed-article-tags'; upstreamSnapshotConsistent: boolean; becameCurrent?: boolean;
  upstreamSnapshotId?: string; upstreamGeneratedAt?: string; upstreamChecksum?: string;
  termsStoredSeparately?: boolean; termCount?: number; upstreamManifest?: ExportManifest; localPayloadChecksum?: string;
  terms: VocabularyTerm[];
}
export interface SyncRun { id: string; window: Window; cursor: string | null; pages: number; status: 'scanning' | 'ready' | 'published' }
export interface VocabularyStore {
  begin(id: string, window: Window): Promise<SyncRun>;
  stage(id: string, expectedCursor: string | null, page: ArticlePage): Promise<SyncRun>;
  publish(id: string): Promise<VocabularySnapshot>;
}
export interface ArticleSource { page(window: Window, cursor: string | null): Promise<ArticlePage> }
export const termKey = (term: string) => createHash('sha256').update(SOURCE + '\0' + term).digest('hex');
export function validateWindow(window: Window): void {
  const iso = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/;
  if (!iso.test(window.since) || !iso.test(window.until)) throw new Error('Tag window timestamps require ISO-8601 with an explicit timezone');
  const duration = Date.parse(window.until) - Date.parse(window.since);
  if (!Number.isFinite(duration) || duration <= 0 || duration > 31 * 86400000) throw new Error('Tag article window must be between 0 and 31 days');
}
export function aggregateTerms(articles: SourceArticle[]): VocabularyTerm[] {
  const terms = new Map<string, { count: number; media: Set<string> }>();
  for (const article of articles) for (const term of new Set(article.tags)) {
    const entry = terms.get(term) ?? { count: 0, media: new Set<string>() };
    entry.count++; entry.media.add(article.media); terms.set(term, entry);
  }
  return [...terms.entries()].map(([term, v]) => ({ key: termKey(term), term, articleCount: v.count, media: [...v.media].sort(), provenance: 'upstream-article-tag-origin-unspecified' as const })).sort((a, b) => a.key.localeCompare(b.key));
}
/** No publication on failure/cap. Call again with the same id/window to resume. */
export async function synchronizeVocabulary(input: { id: string; window: Window; maxPages: number; source: ArticleSource; store: VocabularyStore; assertOwnership: () => Promise<void> }): Promise<{ status: 'incomplete'; run: SyncRun } | { status: 'published'; snapshot: VocabularySnapshot }> {
  validateWindow(input.window);
  if (!Number.isSafeInteger(input.maxPages) || input.maxPages < 1 || input.maxPages > 10000) throw new Error('maxPages must be 1–10000');
  const window = { since: new Date(input.window.since).toISOString(), until: new Date(input.window.until).toISOString() };
  let run = await input.store.begin(input.id, window);
  const seen = new Set<string>();
  for (let count = 0; run.status === 'scanning' && count < input.maxPages; count++) {
    if (run.pages >= 1000) throw new Error('Vocabulary total page cap reached; use a smaller observation window');
    await input.assertOwnership();
    const page = await input.source.page(window, run.cursor);
    if (page.nextCursor && (page.nextCursor === run.cursor || seen.has(page.nextCursor))) throw new Error('Source returned a repeated cursor');
    if (page.nextCursor) seen.add(page.nextCursor);
    await input.assertOwnership();
    run = await input.store.stage(run.id, run.cursor, page);
  }
  if (run.status === 'scanning') return { status: 'incomplete', run };
  await input.assertOwnership();
  return { status: 'published', snapshot: await input.store.publish(run.id) };
}
