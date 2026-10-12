import {TagHttpClient,type TagHttpOptions} from './tag-http.js';
import { createHash } from 'node:crypto';
import { SOURCE } from './vocabulary.js';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SHA = /^[0-9a-f]{64}$/;
export const MAX_EXPORT_TERMS = 10_000_000;
export const MAX_EXPORT_PAGES = 20_000;
const CURSOR = /^(0|[1-9]\d{0,5})$/;
export const hash = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');
export interface ExportTerm {
  id: string; label: string; articleCount: number; firstPublishedAt: string;
  lastPublishedAt: string; origin: 'article-tags-mixed'; journalistAssigned: null;
  noise?: boolean; noEqual?: boolean; noiseReasons?: string[];
  recentArticleCount?: number; recentArticleCounts?: { '30': number; '90': number; '180': number }; recentCountsAsOf?: string;
}
export interface ExportActiveSubset {
  total: number; pages: string[]; sha256: string;
  days: 30 | 180; minArticleCount?: number; minRecentArticleCount?: number;
  policy?: string; minLength: 2; excludeNoise: true;
}
export interface ExportManifest {
  schemaVersion: 1; id: string; previousId: string | null; generatedAt: string;
  source: typeof SOURCE; attribution: string; coverage: 'all-current-indexed-article-tags';
  provenance: string; identity: 'sha256-exact-utf8-label'; total: number; pageSize: 500;
  pages: string[]; sha256: string; changeCount: number; changePages: string[];
  active?: ExportActiveSubset; noisePolicyVersion?: string;
}
export interface ExportPage { snapshot: ExportManifest; entries: ExportTerm[]; cursor: string; nextCursor: string | null; sha256: string }
export interface ExportActivePage {
  snapshot: Pick<ExportManifest, 'id'|'generatedAt'|'total'|'pageSize'|'sha256'>;
  subset: Pick<ExportActiveSubset, 'total'|'sha256'>;
  entries: ExportTerm[]; cursor: string; nextCursor: string|null; sha256: string;
}
export interface ExportDeltaGeneration {
  schemaVersion: 1; kind: 'delta'; id: string; previousId: string; baseSnapshotId: string;
  generatedAt: string; source: typeof SOURCE; total: number; pageSize: 500;
  changeCount: number; changePages: string[]; noisePolicyVersion: string;
}
export type ExportGeneration = ExportManifest | ExportDeltaGeneration;
export type ExportChange = { action: 'upsert'; term: ExportTerm; active?: boolean }
  | { action: 'absent-from-index'; id: string; label: string; active?: boolean };
export interface ChangePage { snapshot: ExportGeneration; entries: ExportChange[]; cursor: string; nextCursor: string|null; sha256: string }
export class SnapshotResnapshotRequired extends Error {
  readonly code = 'resnapshot-required';
  constructor() { super('Vocabulary HTTP 409: full resnapshot required; local checkpoint retained'); this.name = 'SnapshotResnapshotRequired'; }
}
export interface SnapshotSource { current(): Promise<ExportManifest>; page(manifest: ExportManifest, index: number): Promise<ExportPage> }
const isObject = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
export const strictIso = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
const integer = (value: unknown, maximum: number): value is number => Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) <= maximum;
const catalog = (value: unknown, count: number, maximum: number): value is string[] => Array.isArray(value) && value.length <= maximum && value.length === Math.ceil(count / 500) && value.every(p => typeof p === 'string' && SHA.test(p));
function validateIdentity(value: Record<string,unknown>) {
  if (typeof value.label !== 'string' || !value.label.trim() || /[\uD800-\uDFFF]/u.test(value.label) || [...value.label].length > 60 || value.id !== hash(value.label)) throw new Error('Invalid upstream vocabulary term identity');
}
export function validateTerm(entry: unknown): ExportTerm {
  if (!isObject(entry)) throw new Error('Invalid upstream vocabulary term');
  validateIdentity(entry);
  if (!Number.isSafeInteger(entry.articleCount) || Number(entry.articleCount) < 1
      || entry.origin !== 'article-tags-mixed' || entry.journalistAssigned !== null
      || !strictIso(entry.firstPublishedAt) || !strictIso(entry.lastPublishedAt)
      || Date.parse(entry.firstPublishedAt) > Date.parse(entry.lastPublishedAt)
      || (entry.noise !== undefined && typeof entry.noise !== 'boolean')
      || (entry.noEqual !== undefined && typeof entry.noEqual !== 'boolean')
      || (entry.noiseReasons !== undefined && (!Array.isArray(entry.noiseReasons) || entry.noiseReasons.length > 100 || entry.noiseReasons.some(v => typeof v !== 'string' || v.length > 100)))) throw new Error('Invalid upstream vocabulary term');
  if (entry.recentArticleCounts !== undefined) {
    const counts = entry.recentArticleCounts;
    if (!isObject(counts) || !['30','90','180'].every(k => integer(counts[k], Number(entry.articleCount)))
        || Number(counts['30']) > Number(counts['90']) || Number(counts['90']) > Number(counts['180'])
        || entry.recentArticleCount !== counts['180'] || !strictIso(entry.recentCountsAsOf)) throw new Error('Invalid upstream vocabulary term recent counts');
  } else if (entry.recentArticleCount !== undefined || entry.recentCountsAsOf !== undefined) throw new Error('Invalid upstream vocabulary term recent counts');
  return entry as unknown as ExportTerm;
}
export function validateManifest(raw: unknown): ExportManifest {
  if (!isObject(raw) || raw.schemaVersion !== 1 || typeof raw.id !== 'string' || !UUID.test(raw.id)
      || !(raw.previousId === null || typeof raw.previousId === 'string' && UUID.test(raw.previousId))
      || raw.source !== SOURCE || raw.coverage !== 'all-current-indexed-article-tags'
      || raw.identity !== 'sha256-exact-utf8-label' || typeof raw.generatedAt !== 'string'
      || !strictIso(raw.generatedAt)
      || typeof raw.attribution !== 'string' || !raw.attribution.trim() || raw.attribution.length > 2000
      || typeof raw.provenance !== 'string' || !raw.provenance.trim() || raw.provenance.length > 2000
      || !Number.isSafeInteger(raw.changeCount) || Number(raw.changeCount) < 0 || Number(raw.changeCount) > MAX_EXPORT_TERMS * 2
      || !Array.isArray(raw.changePages) || raw.changePages.length > MAX_EXPORT_PAGES * 2 || raw.changePages.some(p => typeof p !== 'string' || !SHA.test(p))
      || !Number.isSafeInteger(raw.total) || Number(raw.total) < 0 || Number(raw.total) > MAX_EXPORT_TERMS
      || raw.pageSize !== 500 || !Array.isArray(raw.pages) || raw.pages.length !== Math.ceil(Number(raw.total) / 500)
      || raw.pages.some(p => typeof p !== 'string' || !SHA.test(p))
      || typeof raw.sha256 !== 'string' || !SHA.test(raw.sha256)) throw new Error('Invalid upstream vocabulary manifest');
  if (raw.noisePolicyVersion !== undefined && (typeof raw.noisePolicyVersion !== 'string' || !SHA.test(raw.noisePolicyVersion))) throw new Error('Invalid upstream noise policy');
  if (raw.active !== undefined) {
    const active = raw.active;
    if (!isObject(active) || !integer(active.total, Number(raw.total)) || !catalog(active.pages, Number(active.total), MAX_EXPORT_PAGES)
        || typeof active.sha256 !== 'string' || !SHA.test(active.sha256) || (active.days !== 30 && active.days !== 180)
        || active.minLength !== 2 || active.excludeNoise !== true
        || (active.minArticleCount !== undefined && !integer(active.minArticleCount, Number.MAX_SAFE_INTEGER))
        || (active.minRecentArticleCount !== undefined && !integer(active.minRecentArticleCount, Number.MAX_SAFE_INTEGER))
        || (active.policy !== undefined && (typeof active.policy !== 'string' || active.policy.length > 100))) throw new Error('Invalid upstream active subset');
  }
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
  for (const entry of raw.entries) validateTerm(entry);
  return raw as unknown as ExportPage;
}
export function validateActivePage(raw: unknown, manifest: ExportManifest, index: number): ExportActivePage {
  const active = manifest.active;
  if (!active || !Number.isSafeInteger(index) || index < 0 || index >= Math.max(1, active.pages.length) || !isObject(raw) || !isObject(raw.snapshot) || !isObject(raw.subset)) throw new Error('Invalid active vocabulary page');
  for (const field of ['id','generatedAt','total','pageSize','sha256'] as const)
    if (raw.snapshot[field] !== manifest[field]) throw new Error('Active vocabulary snapshot changed while paging');
  if (raw.subset.total !== active.total || raw.subset.sha256 !== active.sha256) throw new Error('Active vocabulary subset changed while paging');
  const checksum = hash(`${JSON.stringify(raw.entries)}\n`);
  if (!Array.isArray(raw.entries) || raw.entries.length !== Math.min(500, Math.max(0, active.total - index * 500))
      || raw.cursor !== String(index) || raw.nextCursor !== (index + 1 < active.pages.length ? String(index + 1) : null)
      || raw.sha256 !== checksum || (active.pages.length > 0 && raw.sha256 !== active.pages[index])) throw new Error('Active vocabulary checksum, count or cursor mismatch');
  for (const entry of raw.entries) validateTerm(entry);
  return raw as unknown as ExportActivePage;
}
export function validateGeneration(raw: unknown): ExportGeneration {
  if (!isObject(raw)) throw new Error('Invalid vocabulary generation');
  if (raw.kind !== 'delta') {
    if (raw.kind !== undefined && raw.kind !== 'full') throw new Error('Invalid vocabulary generation kind');
    const manifest = validateManifest(raw);
    if (!catalog(manifest.changePages, manifest.changeCount, MAX_EXPORT_PAGES * 2)) throw new Error('Invalid vocabulary generation change catalog');
    return manifest;
  }
  if (raw.schemaVersion !== 1 || typeof raw.id !== 'string' || !UUID.test(raw.id)
      || typeof raw.previousId !== 'string' || !UUID.test(raw.previousId) || typeof raw.baseSnapshotId !== 'string' || !UUID.test(raw.baseSnapshotId)
      || !strictIso(raw.generatedAt) || raw.source !== SOURCE || raw.pageSize !== 500
      || !integer(raw.total, MAX_EXPORT_TERMS) || !integer(raw.changeCount, MAX_EXPORT_TERMS * 2)
      || !catalog(raw.changePages, Number(raw.changeCount), MAX_EXPORT_PAGES * 2)
      || typeof raw.noisePolicyVersion !== 'string' || !SHA.test(raw.noisePolicyVersion)) throw new Error('Invalid vocabulary delta generation');
  return raw as unknown as ExportDeltaGeneration;
}
export function validateChangePage(raw: unknown, target?: string, cursor = '0'): ChangePage {
  if (!CURSOR.test(cursor) || (target !== undefined && !UUID.test(target)) || !isObject(raw)) throw new Error('Invalid vocabulary changes request/page');
  const snapshot = validateGeneration(raw.snapshot);
  if (target !== undefined && snapshot.id !== target) throw new Error('Vocabulary changes target changed while paging');
  if (raw.cursor !== cursor || !(raw.nextCursor === null || raw.nextCursor === String(Number(cursor) + 1) && CURSOR.test(raw.nextCursor))
      || !Array.isArray(raw.entries) || raw.entries.length > 500 || (raw.entries.length === 0 && (cursor !== '0' || raw.nextCursor !== null))
      || typeof raw.sha256 !== 'string' || !SHA.test(raw.sha256) || hash(`${JSON.stringify(raw.entries)}\n`) !== raw.sha256) throw new Error('Vocabulary changes checksum, count or cursor mismatch');
  // A cumulative page can belong to an older generation, so its hash must NOT
  // be compared with the target generation's per-generation changePages catalog.
  for (const entry of raw.entries) {
    if (!isObject(entry) || (entry.active !== undefined && typeof entry.active !== 'boolean')) throw new Error('Invalid vocabulary change');
    if (entry.action === 'upsert') validateTerm(entry.term);
    else if (entry.action === 'absent-from-index') validateIdentity(entry);
    else throw new Error('Invalid vocabulary change action');
  }
  return raw as unknown as ChangePage;
}
export class HttpSnapshotSource implements SnapshotSource {
  private readonly http:TagHttpClient;
  constructor(request: typeof fetch = fetch,options:TagHttpOptions={},signal?:AbortSignal) {this.http=new TagHttpClient(request,options,signal);}
  private async json(path: string): Promise<unknown> {
    const response = await this.http.get(`${SOURCE}/api/v1/vocabulary/${path}`,20000);
    if (!response.ok) {await response.body?.cancel().catch(()=>{});if(response.status===409)throw new SnapshotResnapshotRequired();throw new Error(`Vocabulary export HTTP ${response.status}; published local version retained`);}
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
  async activePage(manifest: ExportManifest, index: number): Promise<ExportActivePage> {
    validateManifest(manifest);
    if (!manifest.active || !Number.isSafeInteger(index) || index < 0 || index >= Math.max(1,manifest.active.pages.length)) throw new Error('Invalid active vocabulary page index');
    return validateActivePage(await this.json(`snapshots/${manifest.id}/active?cursor=${index}&compact=1&limit=500`), manifest, index);
  }
  async changes(after: string, target?: string, cursor = '0'): Promise<ChangePage> {
    if (!UUID.test(after) || !CURSOR.test(cursor) || (target !== undefined && !UUID.test(target)) || (cursor !== '0' && target === undefined)) throw new Error('Invalid vocabulary changes request; later pages require a pinned target');
    const query = new URLSearchParams({after,...(target === undefined ? {} : {target}),cursor});
    return validateChangePage(await this.json(`changes?${query}`),target,cursor);
  }
  async page(manifest: ExportManifest, index: number) {
    return validatePage(await this.json(`snapshots/${manifest.id}?cursor=${index}`), manifest, index);
  }
}
