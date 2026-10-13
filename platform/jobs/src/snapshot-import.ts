import {tagHttpOptions} from './tag-http.js';
import { createHash } from 'node:crypto';
import type { Connection, RowDataPacket, ResultSetHeader } from 'mysql2/promise';
import { connectDatabase, withWriterLock } from './database.js';
import { assertExecute, executionPolicy } from './policy.js';
import { SOURCE, termKey, VOCABULARY_JOB, type VocabularySnapshot } from './vocabulary.js';
import { MAX_TRIE_NODES } from './vocabulary-budget.js';
import { scanStoredVocabulary, readStoredActiveVocabulary, MAX_ACTIVE_TERMS, MAX_ACTIVE_BYTES, MAX_STORED_SNAPSHOT_BYTES, type StoredVocabularySnapshot, type StoredMatchingSubset } from './load-vocabulary.js';
import { HttpSnapshotSource, validateManifest, validatePage, validateActivePage, MAX_EXPORT_PAGES, hash, strictIso, type ExportManifest, type SnapshotSource, type ExportActivePage } from './snapshot-client.js';
export const SNAPSHOT_IMPORT_JOB = 'tags.vocabulary.import';

function verifyRun(row: RowDataPacket, manifest: ExportManifest) {
  const saved = row.snapshot ? JSON.parse(row.snapshot) : null;
  if (!saved || !['scanning', 'published'].includes(row.status)
      || row.window_since !== manifest.generatedAt || row.window_until !== manifest.generatedAt
      || saved.upstreamChecksum !== manifest.sha256 || JSON.stringify(saved.upstreamManifest) !== JSON.stringify(manifest))
    throw new Error('Upstream snapshot identity was reused with changed contents or foreign run state');
  if (row.status === 'published' && (saved.coverage !== manifest.coverage || saved.window !== null)) throw new Error('Invalid full vocabulary publication');
}
/** Each page is staged durably, but only a fully verified snapshot is public.
 * A retry re-downloads pinned pages (bounded by maxPages); insert is idempotent.
 * No source changes or production writes are inferred by constructing this helper.
 */
export async function importSnapshot(db: Connection, source: SnapshotSource & { activePage?: (manifest: ExportManifest, index: number) => Promise<ExportActivePage> }, maxPages: number, ownership: () => Promise<void>, wait = async () => {}) {
  if (!Number.isSafeInteger(maxPages) || maxPages < 1 || maxPages > MAX_EXPORT_PAGES) throw new Error(`maxPages must be 1–${MAX_EXPORT_PAGES}`);
  await ownership();
  const manifest = validateManifest(await source.current());
  if (manifest.pages.length > maxPages) throw new Error('Full snapshot exceeds this run page cap; increase the explicit cap to cover the manifest');
  const id = `tag-${manifest.id}`;
  const [existing] = await db.query<RowDataPacket[]>('SELECT * FROM ts_vocabulary_runs WHERE id = ?', [id]);
  if (existing[0]) verifyRun(existing[0], manifest);
  if (existing[0]?.status === 'published') {
    const snapshot = JSON.parse(existing[0].snapshot) as VocabularySnapshot;
    if (snapshot.upstreamChecksum !== manifest.sha256) throw new Error('Published upstream snapshot changed');
    return { status: 'already-published', version: id, total: manifest.total };
  }
  // Active membership is pinned separately from the complete stored pool. Keep
  // only keys + fingerprints in memory; raw originals remain in term payloads.
  const activeFingerprints = new Map<string, string>();
  if (manifest.active) {
    if (!source.activePage || manifest.active.total > MAX_ACTIVE_TERMS) throw new Error('Active vocabulary exceeds matching capacity or API unavailable');
    const activeDigest = createHash('sha256'); let bytes = 0, units = 1;
    for (let index = 0; index < manifest.active.pages.length; index++) {
      await ownership();
      const page = validateActivePage(await source.activePage(manifest, index), manifest, index);
      await ownership();
      for (const term of page.entries) {
        const encoded = JSON.stringify(term) + '\n', key = termKey(term.label);
        bytes += Buffer.byteLength(encoded); units += term.label.length;
        if (bytes > MAX_ACTIVE_BYTES || units > MAX_TRIE_NODES) throw new Error('Active vocabulary exceeds matching capacity');
        if (term.noise === true || [...term.label].length < 2 || activeFingerprints.has(key)) throw new Error('Invalid or duplicate active vocabulary term');
        activeDigest.update(encoded); activeFingerprints.set(key, hash(encoded));
      }
      if (index + 1 < manifest.active.pages.length) await wait();
    }
    if (activeFingerprints.size !== manifest.active.total || activeDigest.digest('hex') !== manifest.active.sha256) throw new Error('Active vocabulary count or checksum mismatch');
  }
  const activeKeys = [...activeFingerprints.keys()].sort();
  const expectedActivePayloads = new Map<string, string>();
  await db.execute('INSERT INTO ts_vocabulary_runs(id, window_since, window_until, snapshot) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE id = id', [id, manifest.generatedAt, manifest.generatedAt, JSON.stringify({ upstreamChecksum: manifest.sha256, upstreamManifest: manifest })]);
  const digest = createHash('sha256'); let previousLabel: Buffer | null = null; let total = 0; let codeUnits = 1;
  for (let index = 0; index < manifest.pages.length; index++) {
    await ownership();
    const page = validatePage(await source.page(manifest, index), manifest, index);
    await ownership();
    await db.beginTransaction();
    try {
      for (const term of page.entries) {
        codeUnits += term.label.length;
        if (!manifest.active && (total >= 250000 || codeUnits > MAX_TRIE_NODES)) throw new Error('Vocabulary exceeds publication matching budget; active subset required');
        const label = Buffer.from(term.label);
        if (previousLabel && Buffer.compare(previousLabel, label) >= 0) throw new Error('Vocabulary terms are not uniquely UTF-8 ordered');
        previousLabel = label;
        digest.update(`${JSON.stringify(term)}\n`);
        const payload = { key: termKey(term.label), term: term.label, articleCount: term.articleCount, media: [], provenance: 'upstream-article-tag-origin-unspecified', upstreamId: term.id, upstream: term };
        const activeFingerprint = activeFingerprints.get(payload.key);
        if (activeFingerprint !== undefined) {
          if (activeFingerprint !== hash(JSON.stringify(term) + '\n')) throw new Error('Active vocabulary differs from full-pool evidence');
          activeFingerprints.delete(payload.key);
          expectedActivePayloads.set(payload.key, hash(JSON.stringify(payload) + '\n'));
        }
        await db.execute('INSERT INTO ts_vocabulary_terms(run_id, term_key, term, article_count, payload) VALUES (?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE payload = VALUES(payload), article_count = VALUES(article_count)', [id, payload.key, term.label, term.articleCount, JSON.stringify(payload)]);
        total++;
      }
      await db.execute('UPDATE ts_vocabulary_runs SET pages = ?, checkpoint_cursor = ? WHERE id = ? AND status = ?', [index + 1, page.nextCursor, id, 'scanning']);
      await db.commit();
    } catch (error) { await db.rollback().catch(() => {}); throw error; }
    if (index + 1 < manifest.pages.length) await wait();
  }
  if (total !== manifest.total || digest.digest('hex') !== manifest.sha256) throw new Error('Full vocabulary count or checksum mismatch');
  if (activeFingerprints.size) throw new Error('Active vocabulary missing from full pool');
  // Verify the pool under writer ownership before acquiring publication locks.
  const localDigest = createHash('sha256');
  const scanned = await scanStoredVocabulary(db, id, (_payload, encoded) => localDigest.update(encoded), ownership, wait);
  if (scanned !== manifest.total) throw new Error('Staged vocabulary count mismatch');
  const localPayloadChecksum = localDigest.digest('hex');
  let matchingSubset: StoredMatchingSubset | undefined;
  if (manifest.active) {
    const activeDigest = createHash('sha256'); let activeBytes = 0;
    await readStoredActiveVocabulary(db, id, activeKeys, (payload, encoded) => {
      activeBytes += Buffer.byteLength(encoded);
      if (activeBytes > MAX_ACTIVE_BYTES) throw new Error('Active vocabulary exceeds stored byte capacity');
      if (hash(encoded) !== expectedActivePayloads.get(payload.key)) throw new Error('Staged active vocabulary evidence changed');
      activeDigest.update(encoded);
    }, ownership, wait);
    matchingSubset = { kind: 'upstream-active-v1', keys: activeKeys, source: manifest.active, localPayloadChecksum: activeDigest.digest('hex') };
  }

  await ownership();
  await db.beginTransaction();
  try {
    const [locked] = await db.query<RowDataPacket[]>('SELECT * FROM ts_vocabulary_runs WHERE id = ? FOR UPDATE', [id]);
    if (!locked[0] || locked[0].status !== 'scanning') throw new Error('Vocabulary publication lost scanning state');
    verifyRun(locked[0], manifest);
    const [counts] = await db.query<RowDataPacket[]>('SELECT COUNT(*) AS total FROM ts_vocabulary_terms WHERE run_id = ?', [id]);
    if (Number(counts[0]?.total) !== manifest.total) throw new Error('Staged vocabulary count mismatch');
    const [current] = await db.query<RowDataPacket[]>('SELECT r.snapshot FROM ts_vocabulary_current c JOIN ts_vocabulary_runs r ON r.id=c.run_id WHERE c.source = ? FOR UPDATE', [SOURCE]);
    const old = current[0] ? JSON.parse(current[0].snapshot) as VocabularySnapshot : null;
    if (old?.coverage === 'all-current-indexed-article-tags' && !strictIso(old.upstreamGeneratedAt)) throw new Error('Current full vocabulary has invalid publication metadata');
    // Equal timestamps keep the existing current version; only a newer export replaces it.
    const becameCurrent = !old || old.coverage !== 'all-current-indexed-article-tags' || Date.parse(old.upstreamGeneratedAt!) < Date.parse(manifest.generatedAt);
    const snapshot: StoredVocabularySnapshot = { id, source: SOURCE, window: null, publishedAt: new Date().toISOString(), coverage: 'all-current-indexed-article-tags', upstreamSnapshotConsistent: true, upstreamSnapshotId: manifest.id, upstreamGeneratedAt: manifest.generatedAt, upstreamChecksum: manifest.sha256, termsStoredSeparately: true, termCount: manifest.total, terms: [], becameCurrent, upstreamManifest: manifest, localPayloadChecksum, ...(matchingSubset ? {matchingSubset} : {}) };
    const encodedSnapshot = JSON.stringify(snapshot);
    if (Buffer.byteLength(encodedSnapshot) > MAX_STORED_SNAPSHOT_BYTES) throw new Error('Stored vocabulary metadata exceeds byte cap');
    await ownership();
    const [publication] = await db.execute<ResultSetHeader>('UPDATE ts_vocabulary_runs SET status = ?, snapshot = ?, published_at = CURRENT_TIMESTAMP(3), checkpoint_cursor = NULL WHERE id = ? AND status = ?', ['published', encodedSnapshot, id, 'scanning']);
    if (publication.affectedRows !== 1) throw new Error('Vocabulary publication state changed');
    if (becameCurrent) await db.execute('INSERT INTO ts_vocabulary_current(source, run_id) VALUES (?, ?) ON DUPLICATE KEY UPDATE run_id = VALUES(run_id)', [SOURCE, id]);
    await db.commit();
    return { status: 'published', version: id, total, becameCurrent };
  } catch (error) { await db.rollback().catch(() => {}); throw error; }
}
export async function executeSnapshotImport(env: NodeJS.ProcessEnv, maxPages: number) {
  assertExecute(SNAPSHOT_IMPORT_JOB, executionPolicy(env, 'execute'));
  const db = await connectDatabase(env);
  try { return await withWriterLock(db, VOCABULARY_JOB, async check => importSnapshot(db, new HttpSnapshotSource(fetch,await tagHttpOptions(env)), maxPages, check, () => new Promise(resolve => setTimeout(resolve, 100)))); }
  finally { await db.end(); }
}
