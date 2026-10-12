import {TagHttpClient,type TagHttpOptions} from './tag-http.js';
import { createHash } from 'node:crypto';
import { SOURCE } from './vocabulary.js';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SHA = /^[0-9a-f]{64}$/;
export const hash = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');
export interface ExportTerm {
  id: string; label: string; articleCount: number; firstPublishedAt: string;
  lastPublishedAt: string; origin: 'article-tags-mixed'; journalistAssigned: null;
}
export interface ExportManifest {
  schemaVersion: 1; id: string; previousId: string | null; generatedAt: string;
  source: typeof SOURCE; attribution: string; coverage: 'all-current-indexed-article-tags';
  provenance: string; identity: 'sha256-exact-utf8-label'; total: number; pageSize: 500;
  pages: string[]; sha256: string; changeCount: number; changePages: string[];
}
export interface ExportPage { snapshot: ExportManifest; entries: ExportTerm[]; cursor: string; nextCursor: string | null; sha256: string }
export interface SnapshotSource { current(): Promise<ExportManifest>; page(manifest: ExportManifest, index: number): Promise<ExportPage> }
const isObject = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
export const strictIso = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
export function validateManifest(raw: unknown): ExportManifest {
  if (!isObject(raw) || raw.schemaVersion !== 1 || typeof raw.id !== 'string' || !UUID.test(raw.id)
      || !(raw.previousId === null || typeof raw.previousId === 'string' && UUID.test(raw.previousId))
      || raw.source !== SOURCE || raw.coverage !== 'all-current-indexed-article-tags'
      || raw.identity !== 'sha256-exact-utf8-label' || typeof raw.generatedAt !== 'string'
      || !strictIso(raw.generatedAt)
      || typeof raw.attribution !== 'string' || !raw.attribution.trim() || raw.attribution.length > 2000
      || typeof raw.provenance !== 'string' || !raw.provenance.trim() || raw.provenance.length > 2000
      || !Number.isSafeInteger(raw.changeCount) || Number(raw.changeCount) < 0 || Number(raw.changeCount) > 500000
      || !Array.isArray(raw.changePages) || raw.changePages.length > 1000 || raw.changePages.some(p => typeof p !== 'string' || !SHA.test(p))
      || !Number.isSafeInteger(raw.total) || Number(raw.total) < 0 || Number(raw.total) > 250000
      || raw.pageSize !== 500 || !Array.isArray(raw.pages) || raw.pages.length !== Math.ceil(Number(raw.total) / 500)
      || raw.pages.some(p => typeof p !== 'string' || !SHA.test(p))
      || typeof raw.sha256 !== 'string' || !SHA.test(raw.sha256)) throw new Error('Invalid upstream vocabulary manifest');
  return raw as unknown as ExportManifest;
}
export function validatePage(raw: unknown, manifest: ExportManifest, index: number): ExportPage {
  if (!isObject(raw)) throw new Error('Invalid vocabulary page');
  const pageManifest = validateManifest(raw.snapshot);
  if (JSON.stringify(pageManifest) !== JSON.stringify(manifest)) throw new Error('Vocabulary snapshot changed while paging');
  const expectedCount = Math.min(500, manifest.total - index * 500);
  if (raw.cursor !== String(index) || raw.nextCursor !== (index + 1 < manifest.pages.length ? String(index + 1) : null)
      || !Array.isArray(raw.entries) || raw.entries.length !== expectedCount
      || raw.sha256 !== manifest.pages[index] || hash(`${JSON.stringify(raw.entries)}\n`) !== raw.sha256) throw new Error('Vocabulary page checksum, count or cursor mismatch');
  for (const entry of raw.entries) {
    if (!isObject(entry) || typeof entry.label !== 'string' || !entry.label.trim() || /[\uD800-\uDFFF]/u.test(entry.label) || [...entry.label].length > 60
        || entry.id !== hash(entry.label) || !Number.isSafeInteger(entry.articleCount) || Number(entry.articleCount) < 1
        || entry.origin !== 'article-tags-mixed' || entry.journalistAssigned !== null
        || typeof entry.firstPublishedAt !== 'string' || typeof entry.lastPublishedAt !== 'string'
        || !strictIso(entry.firstPublishedAt) || !strictIso(entry.lastPublishedAt)
        || Date.parse(entry.firstPublishedAt) > Date.parse(entry.lastPublishedAt)) throw new Error('Invalid upstream vocabulary term');
  }
  return raw as unknown as ExportPage;
}
export class HttpSnapshotSource implements SnapshotSource {
  private readonly http:TagHttpClient;
  constructor(request: typeof fetch = fetch,options:TagHttpOptions={}) {this.http=new TagHttpClient(request,options);}
  private async json(path: string): Promise<unknown> {
    const response = await this.http.get(`${SOURCE}/api/v1/vocabulary/${path}`,20000);
    if (!response.ok) {await response.body?.cancel().catch(()=>{});throw new Error(`Vocabulary export HTTP ${response.status}; published local version retained`);}
    if (!response.body) throw new Error('Vocabulary export returned an empty body');
    const chunks: Uint8Array[] = []; let bytes = 0;
    const reader = response.body.getReader();
    try {
      while (true) {
        const part = await reader.read(); if (part.done) break;
        bytes += part.value.byteLength;
        if (bytes > 2_000_000) { await reader.cancel(); throw new Error('Vocabulary page exceeds byte cap'); }
        chunks.push(part.value);
      }
    } catch {throw new Error('Vocabulary body read failed or exceeds byte cap');}
    finally { await reader.cancel().catch(()=>{}); reader.releaseLock(); }
    try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
    catch { throw new Error('Invalid vocabulary export JSON'); }
  }
  async current() { return validateManifest(await this.json('snapshots/current')); }
  async page(manifest: ExportManifest, index: number) {
    return validatePage(await this.json(`snapshots/${manifest.id}?cursor=${index}`), manifest, index);
  }
}
