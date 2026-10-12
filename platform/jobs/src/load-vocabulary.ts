import { createHash } from 'node:crypto';
import { assertVocabularyBudget } from './vocabulary-budget.js';
import type { Connection, RowDataPacket } from 'mysql2/promise';
import { SOURCE, type VocabularySnapshot } from './vocabulary.js';
export async function loadVocabularySnapshot(db: Connection, version?: string): Promise<VocabularySnapshot> {
  const [rows] = await db.query<RowDataPacket[]>(version
    ? 'SELECT snapshot FROM ts_vocabulary_runs WHERE id = ? AND status = ?'
    : 'SELECT r.snapshot FROM ts_vocabulary_current c JOIN ts_vocabulary_runs r ON r.id = c.run_id WHERE c.source = ? AND r.status = ?', [version ?? SOURCE, 'published']);
  if (!rows[0]) throw new Error('No published vocabulary available');
  const snapshot = JSON.parse(rows[0].snapshot) as VocabularySnapshot;
  if (snapshot.source !== SOURCE || !Array.isArray(snapshot.terms)) throw new Error('Invalid stored vocabulary');
  if (snapshot.termsStoredSeparately) {
    if (!Number.isSafeInteger(snapshot.termCount) || snapshot.termCount! < 0 || snapshot.termCount! > 250000) throw new Error('Stored vocabulary count exceeds cap');
    const [terms] = await db.query<RowDataPacket[]>('SELECT payload FROM ts_vocabulary_terms WHERE run_id = ? ORDER BY term_key LIMIT 250001', [snapshot.id]);
    const checksum = createHash('sha256').update(terms.map(row => JSON.stringify(JSON.parse(row.payload)) + '\n').join('')).digest('hex');
    if (!snapshot.localPayloadChecksum || checksum !== snapshot.localPayloadChecksum) throw new Error('Stored vocabulary checksum mismatch');
    snapshot.terms = terms.map(row => JSON.parse(row.payload));
    if (snapshot.terms.length !== snapshot.termCount) throw new Error('Stored vocabulary snapshot is incomplete');
  }
  assertVocabularyBudget(snapshot.terms);
  return snapshot;
}
