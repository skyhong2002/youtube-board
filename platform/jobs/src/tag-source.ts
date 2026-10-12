import {TagHttpClient,type TagHttpOptions} from './tag-http.js';
import { SOURCE, validateWindow, type ArticlePage, type ArticleSource, type Window } from './vocabulary.js';
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
/** Fixed upstream endpoint; only public article metadata/tags are ingested. */
export class TagArticleSource implements ArticleSource {
  private readonly http:TagHttpClient;
  constructor(fetcher: typeof fetch = fetch, options:TagHttpOptions={}) { this.http=new TagHttpClient(fetcher,options); }
  async page(window: Window, cursor: string | null): Promise<ArticlePage> {
    validateWindow(window);
    if (cursor !== null && !/^\d{1,15}_\d{1,19}$/.test(cursor)) throw new Error('Invalid stored source cursor');
    const url = new URL('/api/v1/articles', SOURCE);
    url.search = new URLSearchParams({ since: window.since, until: window.until, limit: '200', ...(cursor ? { cursor } : {}) }).toString();
    const response = await this.http.get(url);
    if (!response.ok) { await response.body?.cancel().catch(()=>{}); throw new Error(`Tag source request failed (HTTP ${response.status})`); }
    if (!response.body) throw new Error('Tag source response is empty');
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    try {
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        bytes += part.value.byteLength;
        if (bytes > 4000000) throw new Error('Tag source response exceeds cap');
        chunks.push(part.value);
      }
    } catch {throw new Error('Tag source body read failed or exceeds cap');}
    finally { await reader.cancel().catch(() => undefined); }
    const text = Buffer.concat(chunks).toString('utf8');
    let data:unknown;try{data=JSON.parse(text);}catch{throw new Error('Invalid tag source JSON');}
    if (!record(data) || !Array.isArray(data.articles) || data.articles.length > 200 || !(data.nextCursor === null || typeof data.nextCursor === 'string')) throw new Error('Invalid tag source page');
    const query = data.query;
    if (!record(query) || Date.parse(String(query.since)) !== Date.parse(window.since) || Date.parse(String(query.until)) !== Date.parse(window.until)) throw new Error('Tag source changed requested window');
    const articles = data.articles.map((a: unknown) => {
      if (!record(a) || !(typeof a.id === 'number' && Number.isSafeInteger(a.id) && a.id > 0) || typeof a.media !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(a.media) || typeof a.publishedAt !== 'string' || !Array.isArray(a.tags)) throw new Error('Invalid tag source article');
      const at = Date.parse(a.publishedAt);
      if (!(at >= Date.parse(window.since) && at < Date.parse(window.until))) throw new Error('Tag article outside requested window');
      const originalTags = a.tags;
      if (originalTags.length > 500) throw new Error('Invalid tag source terms');
      const tags = originalTags.map((raw: unknown) => {
        // Bound the original input too: normalization must not bypass ingestion caps.
        if (typeof raw !== 'string' || raw.length > 240) throw new Error('Invalid tag source terms');
        // U+200B is the sole supported format-character exception. Check other
        // controls before trim(), which would otherwise silently erase tabs/BOM.
        const withoutZeroWidthSpace = raw.replaceAll('\u200B', '');
        if (/[\p{Cc}\p{Cf}]/u.test(withoutZeroWidthSpace)) throw new Error('Invalid tag source terms');
        const term = withoutZeroWidthSpace.trim();
        if (!term) throw new Error('Invalid tag source terms');
        return term;
      });
      const changed = tags.some((term, index) => term !== originalTags[index]);
      return { id: String(a.id), media: a.media, publishedAt: a.publishedAt, tags,
        ...(changed ? { sourceTags: originalTags as string[] } : {}) };
    });
    const nextCursor = data.nextCursor as string | null;
    if (nextCursor && (!/^\d{1,15}_\d{1,19}$/.test(nextCursor) || !articles.length)) throw new Error('Invalid continuation cursor');
    const position = (value: string) => {
      const [time, id] = value.split('_');
      return { time: BigInt(time!), id: BigInt(id!) };
    };
    const before = (a: ReturnType<typeof position>, b: ReturnType<typeof position>) => a.time < b.time || (a.time === b.time && a.id < b.id);
    let previous = cursor ? position(cursor) : null;
    for (const article of articles) {
      const current = { time: BigInt(Date.parse(article.publishedAt)), id: BigInt(article.id) };
      if (previous && !before(current, previous)) throw new Error('Tag source cursor order did not advance');
      previous = current;
    }
    const last = articles.at(-1);
    if (nextCursor && last && nextCursor !== `${Date.parse(last.publishedAt)}_${last.id}`) throw new Error('Tag source continuation does not match last article');
    return { articles, nextCursor };
  }
}
