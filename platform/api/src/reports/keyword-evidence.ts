import {sql} from 'drizzle-orm';
import {DataSourceUnavailable,type Reader,type Row} from '../db/client.js';
import type {VideoRow} from '../contracts.js';
import type {KeywordIdentity} from './keyword-alias.js';
import {keywordIdentityPredicate} from './keyword-candidates.js';
import {videoTextDigest} from './video-digest.js';
/** Supporting snippets are optional and bounded independently from the listing.
 * Recheck current source identity so edits between listing and enrichment cannot
 * attach stale text to an otherwise current video. */
export async function enrichKeywordEvidence(reader:Reader,videos:VideoRow[],version:string,rule:string,identities:KeywordIdentity[]){
 const selected=videos.slice(0,50),ids=selected.map(v=>v.id);if(!ids.length||!identities.length)return;
 try{
 const rows=await reader.rows(sql`SELECT video_id,term,field_name,snippet,start_offset,end_offset,snippet_start FROM (
 SELECT e.video_id,e.term,e.field_name,LEFT(e.snippet,512) AS snippet,e.start_offset,e.end_offset,e.snippet_start,
 ROW_NUMBER() OVER(PARTITION BY e.video_id ORDER BY CASE e.field_name WHEN 'title' THEN 0 ELSE 1 END,e.start_offset,e.term_key) AS evidence_rank
 FROM ts_video_tag_evidence e JOIN ts_video_tag_matches m ON m.video_id=e.video_id AND BINARY m.video_id=BINARY e.video_id AND m.vocabulary_version=e.vocabulary_version
 JOIN urt_video v ON v.pk=m.source_pk AND BINARY v.videoId=BINARY e.video_id
 WHERE e.vocabulary_version=${version} AND e.rule_version=${rule} AND m.rule_version=${rule} AND e.video_id IN (${sql.join(ids.map(id=>sql`${id}`),sql`,`)}) AND ${keywordIdentityPredicate(identities)}
 AND BINARY m.source_text_sha256=BINARY ${videoTextDigest()}
 ) keyword_snippets WHERE evidence_rank<=3 LIMIT 151`);
 const grouped=boundedKeywordEvidence(rows,new Set(ids));
 for(const video of selected)video.keywordEvidence=grouped.get(video.id)??[];
 }catch(error){if(!(error instanceof DataSourceUnavailable))throw error;}
}
export function boundedKeywordEvidence(rows:Row[],ids:Set<string>){
 const result=new Map<string,NonNullable<VideoRow['keywordEvidence']>>();
 if(rows.length>150)return result;
 for(const row of rows){
  if(typeof row.video_id!=='string'||!ids.has(row.video_id)||typeof row.term!=='string'||!row.term||row.term.length>480||!['title','description','caption'].includes(String(row.field_name))||typeof row.snippet!=='string'||row.snippet.length>512)continue;
  if([row.start_offset,row.end_offset,row.snippet_start].some(v=>v===null||v===undefined))continue;
  const start=Number(row.start_offset),end=Number(row.end_offset),snippetStart=Number(row.snippet_start);
  if(![start,end,snippetStart].every(Number.isSafeInteger)||snippetStart<0||start<snippetStart||end<=start||end>snippetStart+row.snippet.length)continue;
  const entries=result.get(row.video_id)??[];if(entries.length>=3)continue;
  entries.push({term:row.term,field:row.field_name as 'title'|'description'|'caption',snippet:row.snippet,start,end,snippetStart});result.set(row.video_id,entries);
 }
 return result;
}
