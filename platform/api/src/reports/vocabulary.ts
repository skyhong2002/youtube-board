import { sourceTextFingerprint } from '../../../shared/video-fingerprint.js';
import { sql } from 'drizzle-orm';
import type { Reader } from '../db/client.js';
import type { VocabularyData, VocabularyTerm, VideoTagEvidenceData } from '../contracts.js';
import { object, list, text, integer, timestamp } from './normalize.js';
import { page, NotFound, search, type Query } from './query.js';
const source = 'https://tag.observe.tw' as const;
export async function vocabulary(reader: Reader, query: Query = {}): Promise<VocabularyData> {
    const { limit, offset } = page(query);
    search(query.q);
    const row = (await reader.rows(sql `SELECT r.id,r.snapshot FROM ts_vocabulary_current c JOIN ts_vocabulary_runs r ON r.id=c.run_id WHERE c.source=${source} AND r.status='published' LIMIT 1`))[0];
    const snapshot = object(row?.snapshot), window = object(snapshot.window);
    if (snapshot.termsStoredSeparately === true && row) {
        const pattern = search(query.q), where = sql `run_id=${text(row.id)} ${pattern ? sql `AND LOWER(term) LIKE LOWER(${pattern}) ESCAPE '='` : sql ``}`;
        const [records, count] = await Promise.all([reader.rows(sql `SELECT payload FROM ts_vocabulary_terms WHERE ${where} ORDER BY article_count DESC,term_key LIMIT ${limit} OFFSET ${offset}`), reader.rows(sql `SELECT COUNT(*) AS total FROM ts_vocabulary_terms WHERE ${where}`)]);
        if (records.some(r => { const t = object(r.payload); return typeof t.key !== 'string' || typeof t.term !== 'string'; })) throw new Error('Stored vocabulary terms are invalid');
        const rows = records.map(r => object(r.payload)).filter(t => typeof t.key === 'string' && typeof t.term === 'string').map(t => ({ key: text(t.key), term: text(t.term), articleCount: integer(t.articleCount) ?? 0, media: list(t.media).filter((v): v is string => typeof v === 'string'), provenance: 'upstream-article-tag-origin-unspecified' as const, ...(typeof t.upstreamId === 'string' ? { upstreamId: t.upstreamId } : {}) }));
        return { rows, total: integer(count[0]?.total) ?? 0, limit, offset, version: text(row.id), source, attribution: '新文易數 tag.observe.tw', window: null, publishedAt: timestamp(snapshot.publishedAt), coverage: 'all-current-indexed-article-tags', upstreamSnapshotConsistent: snapshot.upstreamSnapshotConsistent === true };
    }
    const terms = list(snapshot.terms).map(item => object(item)).filter(t => typeof t.key === 'string' && typeof t.term === 'string').map(t => ({ key: text(t.key), term: text(t.term), articleCount: integer(t.articleCount) ?? 0, media: list(t.media).filter((v): v is string => typeof v === 'string'), provenance: 'upstream-article-tag-origin-unspecified' as const }));
    const pattern = search(query.q);
    // Use the same database case mapping for full and embedded snapshots, including Unicode.
    const matches = pattern ? new Set((await reader.rows(sql `SELECT term_key FROM JSON_TABLE(${JSON.stringify(terms)}, '$[*]' COLUMNS(term_key VARCHAR(100) PATH '$.key',term VARCHAR(240) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin PATH '$.term')) t WHERE LOWER(term) LIKE LOWER(${pattern}) ESCAPE '='`)).map(r => text(r.term_key))) : null;
    const filtered = terms.filter(t => matches === null || matches.has(t.key)).sort((a, b) => b.articleCount - a.articleCount || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
    return { rows: filtered.slice(offset, offset + limit), total: filtered.length, limit, offset, version: row ? text(row.id) : null, source, attribution: '新文易數 tag.observe.tw', window: typeof window.since === 'string' && typeof window.until === 'string' ? { since: window.since, until: window.until } : null, publishedAt: timestamp(snapshot.publishedAt), coverage: snapshot.coverage === 'all-current-indexed-article-tags' ? 'all-current-indexed-article-tags' : 'observed-article-window', upstreamSnapshotConsistent: snapshot.upstreamSnapshotConsistent === true };
}
export async function videoTagEvidence(reader: Reader, videoId: string): Promise<VideoTagEvidenceData> {
    const v = (await reader.rows(sql `SELECT pk,videoId,title,description FROM urt_video WHERE videoId=${videoId} LIMIT 1`))[0];
    if (!v)
        throw new NotFound();
    const current = (await reader.rows(sql `SELECT c.run_id FROM ts_vocabulary_current c JOIN ts_vocabulary_runs r ON r.id=c.run_id WHERE c.source=${source} AND r.status='published' LIMIT 1`))[0];
    const version = current ? text(current.run_id) : null;
    const base = { videoId, version, matchedAt: null, source, rows: [], status: 'not-matched' } as VideoTagEvidenceData;
    if (!version)
        return { ...base, status: 'not-synchronized' };
    const marker = (await reader.rows(sql `SELECT UNIX_TIMESTAMP(matched_at) * 1000 AS matched_epoch,source_pk,source_text_sha256 FROM ts_video_tag_matches WHERE video_id=${videoId} AND vocabulary_version=${version} LIMIT 1`))[0];
    if (!marker)
        return { ...base, status: 'not-matched' };
    // Same ordered title/description fingerprint as the matching worker; verified by integration tests.
    const digest = sourceTextFingerprint(text(v.title), text(v.description));
    const rows = await reader.rows(sql `SELECT term_key,term,field_name,start_offset,end_offset,matched_text,snippet,snippet_start,rule_version FROM ts_video_tag_evidence WHERE video_id=${videoId} AND vocabulary_version=${version} ORDER BY field_name,start_offset,term_key`);
    return { ...base, status: integer(v.pk) !== null && integer(v.pk) === integer(marker.source_pk) && digest === text(marker.source_text_sha256) ? 'matched' : 'stale', matchedAt: marker.matched_epoch !== null && Number.isFinite(Number(marker.matched_epoch)) ? new Date(Number(marker.matched_epoch)).toISOString() : null, rows: rows.map(r => ({ key: text(r.term_key), term: text(r.term), field: text(r.field_name), start: integer(r.start_offset) ?? 0, end: integer(r.end_offset) ?? 0, text: text(r.matched_text), snippet: text(r.snippet), snippetStart: integer(r.snippet_start) ?? 0, ruleVersion: text(r.rule_version) })) };
}
