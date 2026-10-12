import {tagHttpOptions} from './tag-http.js';
import { createHash } from 'node:crypto';
import type { Connection, RowDataPacket, ResultSetHeader } from 'mysql2/promise';
import { connectDatabase, withWriterLock } from './database.js';
import { assertExecute, executionPolicy } from './policy.js';
import { SOURCE, termKey, VOCABULARY_JOB, type VocabularySnapshot } from './vocabulary.js';
import { MAX_TRIE_NODES } from './vocabulary-budget.js';
import { HttpSnapshotSource, validateManifest, validatePage, strictIso, type ExportManifest, type SnapshotSource } from './snapshot-client.js';
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
export async function importSnapshot(db: Connection, source: SnapshotSource, maxPages: number, ownership: () => Promise<void>, wait = async () => {}) {
  if (!Number.isSafeInteger(maxPages) || maxPages < 1 || maxPages > 500) throw new Error('maxPages must be 1–500');
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
        if (codeUnits > MAX_TRIE_NODES) throw new Error('Vocabulary exceeds publication matching budget');
        const label = Buffer.from(term.label);
        if (previousLabel && Buffer.compare(previousLabel, label) >= 0) throw new Error('Vocabulary terms are not uniquely UTF-8 ordered');
        previousLabel = label;
        digest.update(`${JSON.stringify(term)}\n`);
        const payload = { key: termKey(term.label), term: term.label, articleCount: term.articleCount, media: [], provenance: 'upstream-article-tag-origin-unspecified', upstreamId: term.id, upstream: term };
        await db.execute('INSERT INTO ts_vocabulary_terms(run_id, term_key, term, article_count, payload) VALUES (?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE payload = VALUES(payload), article_count = VALUES(article_count)', [id, payload.key, term.label, term.articleCount, JSON.stringify(payload)]);
        total++;
      }
      await db.execute('UPDATE ts_vocabulary_runs SET pages = ?, checkpoint_cursor = ? WHERE id = ? AND status = ?', [index + 1, page.nextCursor, id, 'scanning']);
      await db.commit();
    } catch (error) { await db.rollback().catch(() => {}); throw error; }
    if (index + 1 < manifest.pages.length) await wait();
  }
  if (total !== manifest.total || digest.digest('hex') !== manifest.sha256) throw new Error('Full vocabulary count or checksum mismatch');
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
    const [payloads] = await db.query<RowDataPacket[]>('SELECT payload FROM ts_vocabulary_terms WHERE run_id = ? ORDER BY term_key', [id]);
    const localPayloadChecksum = createHash('sha256').update(payloads.map(row => JSON.stringify(JSON.parse(row.payload)) + '\n').join('')).digest('hex');
    const snapshot: VocabularySnapshot = { id, source: SOURCE, window: null, publishedAt: new Date().toISOString(), coverage: 'all-current-indexed-article-tags', upstreamSnapshotConsistent: true, upstreamSnapshotId: manifest.id, upstreamGeneratedAt: manifest.generatedAt, upstreamChecksum: manifest.sha256, termsStoredSeparately: true, termCount: manifest.total, terms: [], becameCurrent, upstreamManifest: manifest, localPayloadChecksum };
    const [publication] = await db.execute<ResultSetHeader>('UPDATE ts_vocabulary_runs SET status = ?, snapshot = ?, published_at = CURRENT_TIMESTAMP(3), checkpoint_cursor = NULL WHERE id = ? AND status = ?', ['published', JSON.stringify(snapshot), id, 'scanning']);
    if (publication.affectedRows !== 1) throw new Error('Vocabulary publication state changed');
    if (becameCurrent) await db.execute('INSERT INTO ts_vocabulary_current(source, run_id) VALUES (?, ?) ON DUPLICATE KEY UPDATE run_id = VALUES(run_id)', [SOURCE, id]);
    await db.commit();
    return { status: 'published', version: id, total, becameCurrent };
  } catch (error) { await db.rollback().catch(() => {}); throw error; }
}
export async function executeSnapshotImport(env: NodeJS.ProcessEnv, maxPages: number) {
  assertExecute(SNAPSHOT_IMPORT_JOB, executionPolicy(env, 'execute'));
  const db = await connectDatabase(env);
  try { return await withWriterLock(db, VOCABULARY_JOB, async check => importSnapshot(db, new HttpSnapshotSource(fetch,await tagHttpOptions(env)), maxPages, check)); }
  finally { await db.end(); }
}
