import { taipeiSql } from '@youtube-board/ingestion';
import { sourceTextFingerprint } from '../../shared/video-fingerprint.js';
import type { Connection, RowDataPacket } from 'mysql2/promise';
import { SOURCE, type VocabularySnapshot } from './vocabulary.js';
import { matchVocabulary, type MatchEvidence } from './match.js';
import { assertExecute, executionPolicy } from './policy.js';
import { connectDatabase, withWriterLock } from './database.js';
import { loadVocabularySnapshot } from './load-vocabulary.js';
export const VIDEO_EVIDENCE_JOB = 'tags.videos.match';
export const MATCH_RULE = 'exact-text-v1';
export interface VideoInput { pk: number; videoId: string; title: string; description: string; observedAt: string | null }
export interface StoredEvidence extends MatchEvidence { snippet: string; snippetStart: number }
export function evidenceForVideo(video: VideoInput, snapshot: VocabularySnapshot): { sourceHash: string; evidence: StoredEvidence[] } {
  if (!/^[A-Za-z0-9_-]{11}$/.test(video.videoId) || !Number.isSafeInteger(video.pk) || video.pk < 1) throw new Error('Invalid source video identity');
  const sourceHash = sourceTextFingerprint(video.title, video.description);
  const evidence = matchVocabulary(video, snapshot).map(item => {
    const text = video[item.field];
    // Retain original UTF-16 index coordinates, including for astral characters.
    const snippetStart = Math.max(0, item.start - 40);
    return { ...item, snippet: text.slice(snippetStart, item.end + 40), snippetStart };
  });
  return { sourceHash, evidence };
}
export async function storeVideoEvidence(db: Connection, video: VideoInput, snapshot: VocabularySnapshot): Promise<{ status: 'written' | 'unchanged'; count: number }> {
  const { sourceHash, evidence } = evidenceForVideo(video, snapshot);
  await db.beginTransaction();
  try {
    const [existing] = await db.query<RowDataPacket[]>('SELECT source_text_sha256, rule_version, evidence_count FROM ts_video_tag_matches WHERE video_id = ? AND vocabulary_version = ? FOR UPDATE', [video.videoId, snapshot.id]);
    if (existing[0]?.source_text_sha256 === sourceHash && existing[0]?.rule_version === MATCH_RULE) {
      await db.execute('UPDATE ts_video_tag_matches SET source_pk = ?, source_observed_at = ? WHERE video_id = ? AND vocabulary_version = ?', [video.pk, video.observedAt, video.videoId, snapshot.id]);
      await db.commit(); return { status: 'unchanged', count: existing[0].evidence_count };
    }
    await db.execute('INSERT INTO ts_video_tag_matches (video_id, vocabulary_version, source_pk, source_text_sha256, source_observed_at, rule_version, evidence_count) VALUES (?, ?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE source_pk = VALUES(source_pk), source_text_sha256 = VALUES(source_text_sha256), source_observed_at = VALUES(source_observed_at), rule_version = VALUES(rule_version), evidence_count = VALUES(evidence_count), matched_at = CURRENT_TIMESTAMP(3)', [video.videoId, snapshot.id, video.pk, sourceHash, video.observedAt, MATCH_RULE, evidence.length]);
    await db.execute('DELETE FROM ts_video_tag_evidence WHERE video_id = ? AND vocabulary_version = ?', [video.videoId, snapshot.id]);
    for (const item of evidence) await db.execute('INSERT INTO ts_video_tag_evidence (video_id, vocabulary_version, term_key, term, source, field_name, start_offset, end_offset, matched_text, snippet, snippet_start, rule_version) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [video.videoId, snapshot.id, item.termKey, item.term, item.source, item.field, item.start, item.end, item.text, item.snippet, item.snippetStart, item.method]);
    await db.commit();
    return { status: 'written', count: evidence.length };
  } catch (error) { await db.rollback().catch(() => undefined); throw error; }
}
export interface MatchBatchInput { afterPk: number; limit: number; version?: string; changedSince?: string; execute: boolean }
export async function matchVideoBatch(input: MatchBatchInput, env: NodeJS.ProcessEnv) {
  if (!Number.isSafeInteger(input.afterPk) || input.afterPk < 0 || !Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > 500) throw new Error('Matching requires nonnegative afterPk and limit 1–500');
  if (input.changedSince && (!/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(input.changedSince) || !Number.isFinite(Date.parse(input.changedSince)))) throw new Error('changedSince requires an ISO timestamp with timezone');
  const policy = executionPolicy(env, input.execute ? 'execute' : 'dry-run');
  if (input.execute) assertExecute(VIDEO_EVIDENCE_JOB, policy);
  const db = await connectDatabase(env);
  const work = async (check: () => Promise<void>) => {
    const snapshot = await loadVocabularySnapshot(db, input.version);
    const [rows] = await db.query<RowDataPacket[]>(`SELECT pk, videoId, title, description, mtime FROM urt_video WHERE pk > ?${input.changedSince ? ' AND mtime >= ?' : ''} ORDER BY pk ASC LIMIT ?`, [input.afterPk, ...(input.changedSince ? [taipeiSql(new Date(input.changedSince))] : []), input.limit + 1]);
    const results: { pk: number; videoId: string | null; status: string; count: number; reason?: string }[] = [];
    for (const row of rows.slice(0, input.limit)) {
      const video: VideoInput = { pk: Number(row.pk), videoId: row.videoId, title: row.title ?? '', description: row.description ?? '', observedAt: row.mtime ?? null };
      await check();
      let preview: ReturnType<typeof evidenceForVideo>;
      try { preview = evidenceForVideo(video, snapshot); }
      catch { results.push({ pk: video.pk, videoId: video.videoId ?? null, status: 'invalid', count: 0, reason: 'Invalid video identity or matching input exceeds cap' }); continue; }
      if (input.execute) results.push({ pk: video.pk, videoId: video.videoId, ...await storeVideoEvidence(db, video, snapshot) });
      else results.push({ pk: video.pk, videoId: video.videoId, status: 'preview', count: preview.evidence.length });
    }
    return { mode: policy.mode, vocabularyVersion: snapshot.id, coverage: snapshot.coverage, processed: results.length, nextAfterPk: rows.length > input.limit ? Number(rows[input.limit - 1]!.pk) : null, results, externalCalls: 0 };
  };
  try { return input.execute ? await withWriterLock(db, VIDEO_EVIDENCE_JOB, work) : await work(async () => {}); }
  finally { await db.end(); }
}
