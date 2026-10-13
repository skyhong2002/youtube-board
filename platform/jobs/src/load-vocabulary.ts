import { createHash } from 'node:crypto';
import { assertVocabularyBudget } from './vocabulary-budget.js';
import type { Connection, RowDataPacket } from 'mysql2/promise';
import { SOURCE, termKey, type VocabularySnapshot, type VocabularyTerm } from './vocabulary.js';
import { MAX_EXPORT_TERMS, validateManifest, validateTerm, type ExportActiveSubset } from './snapshot-client.js';

export const STORED_PAGE_SIZE = 500;
export const MAX_ACTIVE_TERMS = 100_000;
export const MAX_ACTIVE_BYTES = 64 * 1024 * 1024;
export const MAX_STORED_SNAPSHOT_BYTES = 16 * 1024 * 1024;
export interface StoredMatchingSubset {
  kind: 'upstream-active-v1'; keys: string[]; source: ExportActiveSubset; localPayloadChecksum: string;
}
export type StoredVocabularySnapshot = VocabularySnapshot & { matchingSubset?: StoredMatchingSubset };
const SHA = /^[0-9a-f]{64}$/;

function validateStoredSourcePayload(payload: VocabularyTerm, key: unknown) {
  if (typeof key !== 'string' || payload.key !== key || payload.key !== termKey(payload.term)
      || payload.provenance !== 'upstream-article-tag-origin-unspecified' || !payload.upstream) throw new Error('Stored vocabulary identity mismatch');
  const upstream = validateTerm(payload.upstream);
  if (payload.upstreamId !== upstream.id || payload.term !== upstream.label || payload.articleCount !== upstream.articleCount) throw new Error('Stored vocabulary evidence mismatch');
  return upstream;
}

/** Bounded keyset scan; the canonical checksum remains JSON parse/stringify + LF,
 * ordered by local term_key, exactly as before. Never buffer the entire pool. */
export async function scanStoredVocabulary(db: Connection, id: string, visit: (payload: VocabularyTerm, encoded: string) => void, ownership = async () => {}, wait = async () => {}) {
  let after = '', total = 0;
  for (;;) {
    await ownership();
    const [rows] = await db.query<RowDataPacket[]>('SELECT term_key, payload FROM ts_vocabulary_terms WHERE run_id = ? AND term_key > ? ORDER BY term_key LIMIT 500', [id, after]);
    if (rows.length > STORED_PAGE_SIZE) throw new Error('Stored vocabulary page exceeds cap');
    for (const row of rows) {
      if (typeof row.term_key !== 'string' || !SHA.test(row.term_key) || row.term_key <= after) throw new Error('Stored vocabulary keys are not uniquely ordered');
      after = row.term_key;
      const payload = JSON.parse(row.payload) as VocabularyTerm;
      validateStoredSourcePayload(payload, row.term_key);
      visit(payload, JSON.stringify(payload) + '\n');
      if (++total > MAX_EXPORT_TERMS) throw new Error('Stored vocabulary count exceeds cap');
    }
    if (rows.length < STORED_PAGE_SIZE) return total;
    await wait();
  }
}

/** Read only the pinned active keys, in bounded queries and checksum order.
 * This intentionally does not re-scan the full pool on each matching job. */
export async function readStoredActiveVocabulary(db: Connection, id: string, keys: string[], visit: (payload: VocabularyTerm, encoded: string) => void, ownership = async () => {}, wait = async () => {}) {
  if (keys.length > MAX_ACTIVE_TERMS || keys.some((key, index) => typeof key !== 'string' || !SHA.test(key) || index > 0 && key <= keys[index - 1]!)) throw new Error('Invalid stored active vocabulary keys');
  for (let index = 0; index < keys.length; index += STORED_PAGE_SIZE) {
    await ownership();
    const batch = keys.slice(index, index + STORED_PAGE_SIZE);
    const [rows] = await db.query<RowDataPacket[]>(`SELECT term_key, payload FROM ts_vocabulary_terms WHERE run_id = ? AND term_key IN (${batch.map(() => '?').join(',')}) ORDER BY term_key`, [id, ...batch]);
    if (rows.length !== batch.length) throw new Error('Stored active vocabulary snapshot is incomplete');
    for (let offset = 0; offset < rows.length; offset++) {
      const row = rows[offset]!;
      const payload = JSON.parse(row.payload) as VocabularyTerm;
      if (row.term_key !== batch[offset]) throw new Error('Stored active vocabulary identity mismatch');
      const upstream = validateStoredSourcePayload(payload, row.term_key);
      if (upstream.noise === true || [...upstream.label].length < 2) throw new Error('Stored active vocabulary evidence mismatch');
      visit(payload, JSON.stringify(payload) + '\n');
    }
    if (index + STORED_PAGE_SIZE < keys.length) await wait();
  }
}

export async function loadVocabularySnapshot(db: Connection, version?: string): Promise<StoredVocabularySnapshot> {
  const [rows] = await db.query<RowDataPacket[]>(version
    ? 'SELECT snapshot FROM ts_vocabulary_runs WHERE id = ? AND status = ?'
    : 'SELECT r.snapshot FROM ts_vocabulary_current c JOIN ts_vocabulary_runs r ON r.id = c.run_id WHERE c.source = ? AND r.status = ?', [version ?? SOURCE, 'published']);
  if (!rows[0]) throw new Error('No published vocabulary available');
  if (typeof rows[0].snapshot !== 'string' || Buffer.byteLength(rows[0].snapshot) > MAX_STORED_SNAPSHOT_BYTES) throw new Error('Stored vocabulary metadata exceeds byte cap');
  const snapshot = JSON.parse(rows[0].snapshot) as StoredVocabularySnapshot;
  if (snapshot.source !== SOURCE || !Array.isArray(snapshot.terms) || version !== undefined && snapshot.id !== version) throw new Error('Invalid stored vocabulary');
  if (snapshot.termsStoredSeparately) {
    if (!Number.isSafeInteger(snapshot.termCount) || snapshot.termCount! < 0 || snapshot.termCount! > MAX_EXPORT_TERMS) throw new Error('Stored vocabulary count exceeds cap');
    const digest = createHash('sha256'); snapshot.terms = []; let bytes = 0, units = 1;
    const collect = (payload: VocabularyTerm, encoded: string) => {
      bytes += Buffer.byteLength(encoded); units += payload.term.length;
      if (bytes > MAX_ACTIVE_BYTES || snapshot.terms.length >= (snapshot.matchingSubset ? MAX_ACTIVE_TERMS : 250000) || units > 2_000_000) throw new Error('Stored vocabulary exceeds matching capacity');
      digest.update(encoded); snapshot.terms.push(payload);
    };
    if (snapshot.matchingSubset) {
      const subset = snapshot.matchingSubset;
      const manifest = validateManifest(snapshot.upstreamManifest);
      if (snapshot.coverage !== manifest.coverage || snapshot.window !== null || snapshot.upstreamSnapshotId !== manifest.id
          || snapshot.upstreamGeneratedAt !== manifest.generatedAt || snapshot.upstreamChecksum !== manifest.sha256 || snapshot.termCount !== manifest.total
          || subset.kind !== 'upstream-active-v1' || !Array.isArray(subset.keys) || !manifest.active
          || JSON.stringify(subset.source) !== JSON.stringify(manifest.active) || subset.keys.length !== manifest.active.total
          || !SHA.test(subset.localPayloadChecksum) || !snapshot.localPayloadChecksum || !SHA.test(snapshot.localPayloadChecksum)) throw new Error('Invalid stored active vocabulary metadata');
      await readStoredActiveVocabulary(db, snapshot.id, subset.keys, collect);
      if (digest.digest('hex') !== subset.localPayloadChecksum) throw new Error('Stored active vocabulary checksum mismatch');
    } else {
      // Compatibility only: old small full exports have no pinned active subset.
      if (snapshot.termCount! > 250000) throw new Error('Stored vocabulary requires an active matching subset');
      const total = await scanStoredVocabulary(db, snapshot.id, collect);
      if (!snapshot.localPayloadChecksum || digest.digest('hex') !== snapshot.localPayloadChecksum) throw new Error('Stored vocabulary checksum mismatch');
      if (total !== snapshot.termCount) throw new Error('Stored vocabulary snapshot is incomplete');
    }
  }
  assertVocabularyBudget(snapshot.terms);
  return snapshot;
}
