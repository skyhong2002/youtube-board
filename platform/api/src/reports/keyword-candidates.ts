import {sql} from 'drizzle-orm';
import type {KeywordIdentity} from './keyword-alias.js';
export function keywordIdentityPredicate(identities:KeywordIdentity[]){return identities.length?sql`(${sql.join(identities.map(({key,term})=>sql`(e.term_key=${key} AND BINARY e.term=BINARY ${term})`),sql` OR `)})`:sql`FALSE`;}


/** Start at the maintained term's indexed evidence range, not the full video
 * publication index. DISTINCT materializes one ID per video across field/offset
 * occurrences; it is intentionally not LIMITed, which would lose older matches.
 * Convert the small candidate side to the legacy index's charset/collation. The
 * indexed v.videoId stays bare, with a second byte-exact equality for identity. */
export function keywordCandidateSource(version:string,termKey:string,term:string,identities?:KeywordIdentity[]){
    return sql`FROM (SELECT DISTINCT e.video_id FROM ts_video_tag_evidence e WHERE e.vocabulary_version=${version} AND ${identities?keywordIdentityPredicate(identities):sql`e.term_key=${termKey} AND BINARY e.term=BINARY ${term}`}) keyword_candidates
        STRAIGHT_JOIN urt_video v ON v.videoId=CONVERT(keyword_candidates.video_id USING utf8mb4) COLLATE utf8mb4_bin AND BINARY v.videoId=BINARY keyword_candidates.video_id
        LEFT JOIN urt_count n ON n.u_id=v.u_id`;
}
/** A match marker for an older duplicate must never resurrect an obsolete video. */
export function latestKeywordVideo(){
    return sql`NOT EXISTS (SELECT 1 FROM urt_video newer WHERE newer.videoId=v.videoId AND BINARY newer.videoId=BINARY v.videoId AND newer.pk>v.pk)`;
}
