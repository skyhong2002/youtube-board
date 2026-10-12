import {matchingRuleForSnapshot} from '../../../shared/youtube-match-policy.js';
import {keywordTextContains} from './keyword-alias.js';
import {sql} from 'drizzle-orm';
import {DataSourceUnavailable,type Reader,type Row} from '../db/client.js';
import {idList,tagFilter,type Query} from './query.js';
import {text,integer,latest,taipeiSql} from './normalize.js';
import {videoTextDigest} from './video-digest.js';
import {ReportReadBound} from './cache-weights.js';
import {tagMetricsFromEvidence,keywordCloudFromEvidence,keywordDayFromEvidence,type MetricVideo} from '../../../shared/cache-metrics.js';
export {tagMetricsFromEvidence,keywordCloudFromEvidence,keywordDayFromEvidence};
export const DERIVED_RULE='youtube-tag-exact-v1-title2-length';
const SOURCE='https://tag.observe.tw',MAX_VIDEOS=10000,MAX_EVIDENCE=100000,MAX_BYTES=16*1024*1024;
export interface DerivedCoverage {status:string;reason?:string;selection?:'keyword-text-prefilter'|'channel-taxonomy';version:string|null;coverage:string|null;sourceVideos:number|null;freshVideos:number;staleVideos:number;unmatchedVideos:number;unknownViewVideos:number;invalidViewVideos:number;replacedCacheDates?:string[];cacheUpdatedAt?:string|null;source:'derived-current-evidence';updatedAt:string|null}
export interface DerivedSource {videos:MetricVideo[];channelCount:number;coverage:DerivedCoverage}
export function initialDerivedCoverage(keyword?:string):DerivedCoverage{return {status:'not-synchronized',version:null,coverage:null,sourceVideos:null,freshVideos:0,staleVideos:0,unmatchedVideos:0,unknownViewVideos:0,invalidViewVideos:0,source:'derived-current-evidence',updatedAt:null,selection:keyword?'keyword-text-prefilter':'channel-taxonomy'};}
/** SELECT only: no HTTP request starts matching, ingestion or publication. Every selected
 * source must have current exact-text evidence, including zero-match source markers. */
export async function loadDerivedSource(reader:Reader,q:Query,from:string,to:string,now:Date,keyword?:string,needsViews=true):Promise<DerivedSource>{
 const coverage=initialDerivedCoverage(keyword),result:DerivedSource={videos:[],channelCount:0,coverage};
 try {
 if(!keyword&&!idList(q.tagid).length&&!idList(q.or).length){coverage.status='taxonomy-required';return result;}
 const current=()=>reader.rows(sql`SELECT r.id,JSON_EXTRACT(r.snapshot,'$.coverage') AS coverage,JSON_UNQUOTE(JSON_EXTRACT(r.snapshot,'$.matchingRule')) AS matching_rule FROM ts_vocabulary_current c JOIN ts_vocabulary_runs r ON r.id=c.run_id AND r.status='published' WHERE c.source=${SOURCE} LIMIT 1`);
 const pin=(await current())[0];if(!pin)return result;const rule=matchingRuleForSnapshot({matchingRule:pin.matching_rule??undefined});coverage.version=text(pin.id);coverage.coverage=text(pin.coverage).replace(/^"|"$/g,'');if(!['observed-article-window','all-current-indexed-article-tags'].includes(coverage.coverage)){coverage.status='invalid-vocabulary';return result;}
 const readChannels=()=>reader.rows(sql`SELECT c.u_id FROM urt_channel c LEFT JOIN urt_count n ON n.u_id=c.u_id WHERE (c.flag_del IS NULL OR c.flag_del<1) AND ${tagFilter(q)} ORDER BY c.u_id LIMIT 5001`);
 // Keyword fallback selects only potential literal matches before any payload/hash
 // budget. Unmatched unrelated videos cannot suppress every keyword on the site.
 const channels=keyword?[]:await readChannels();
 if(channels.length>5000)throw new ReportReadBound('Derived cache channel cap exceeded');result.channelCount=channels.length;
 if(!keyword&&!channels.length){coverage.status='no-source';coverage.sourceVideos=0;return result;}
 const end=to+' 23:59:59',cutoff=end<taipeiSql(now)?end:taipeiSql(now);
 const channelScope=keyword?sql`EXISTS(SELECT 1 FROM urt_channel c LEFT JOIN urt_count n ON n.u_id=c.u_id WHERE c.u_id=v.u_id AND (c.flag_del IS NULL OR c.flag_del<1) AND ${tagFilter(q)})`:sql`v.u_id IN (${sql.join(channels.map(r=>sql`${r.u_id}`),sql`,`)})`;
 // LOCATE over binary strings treats %, _ and Unicode literally; final matching
 // still requires fresh maintained-vocabulary evidence (no substring substitution).
 const keywordScope=keyword?sql`AND (${keywordTextContains(sql`v.title`,keyword)} OR ${keywordTextContains(sql`v.description`,keyword)})`:sql``;
 const where=sql`${channelScope} AND v.publishedAt>=${from+' 00:00:00'} AND v.publishedAt<=${cutoff} ${keywordScope}`;
 const size=(await reader.rows(sql`SELECT COUNT(*) AS n,COALESCE(SUM(bytes),0) AS bytes FROM (SELECT OCTET_LENGTH(COALESCE(title,''))+OCTET_LENGTH(COALESCE(description,'')) AS bytes FROM urt_video v WHERE ${where} LIMIT ${MAX_VIDEOS+1}) bounded`))[0];
 if(Number(size?.n)>MAX_VIDEOS||Number(size?.bytes)>MAX_BYTES)throw new ReportReadBound('Derived cache video budget exceeded');
 const readSources=()=>reader.rows(sql`SELECT v.pk,v.videoId,v.u_id,v.publishedAt,v.viewCount,v.mtime,v.ctime,OCTET_LENGTH(COALESCE(v.title,''))+OCTET_LENGTH(COALESCE(v.description,'')) AS source_bytes,${videoTextDigest()} AS source_hash,m.source_pk,m.source_text_sha256,m.rule_version,m.evidence_count,UNIX_TIMESTAMP(m.matched_at)*1000 AS match_epoch FROM urt_video v LEFT JOIN ts_video_tag_matches m ON m.video_id=v.videoId AND BINARY m.video_id=BINARY v.videoId AND m.vocabulary_version=${coverage.version} WHERE ${where} ORDER BY v.pk LIMIT ${MAX_VIDEOS+1}`);
 const sources=await readSources();if(sources.length>MAX_VIDEOS||sources.reduce((n,r)=>n+Number(r.source_bytes),0)>MAX_BYTES)throw new ReportReadBound('Derived cache video budget exceeded');coverage.sourceVideos=sources.length;if(keyword)result.channelCount=new Set(sources.map(r=>r.u_id)).size;if(!sources.length){coverage.status='no-source';return result;}
 const ids=new Set<string>();let evidenceCount=0;
 for(const v of sources){const id=text(v.videoId);if(!/^[A-Za-z0-9_-]{11}$/.test(id)||ids.has(id)){coverage.status='invalid-source-identity';return result;}ids.add(id);
  if(v.viewCount===null||v.viewCount===undefined)coverage.unknownViewVideos++;else if(integer(v.viewCount)===null||Number(v.viewCount)<0){coverage.invalidViewVideos++;coverage.unknownViewVideos++;if(needsViews){coverage.status='invalid-source-views';return result;}}
  if(v.source_pk===null||v.source_pk===undefined){coverage.unmatchedVideos++;continue;}
  if(Number(v.source_pk)!==Number(v.pk)||v.source_hash!==v.source_text_sha256||v.rule_version!==rule){coverage.staleVideos++;continue;}
  const count=integer(v.evidence_count);if(count===null||count<0){coverage.status='invalid-evidence';return result;}evidenceCount+=count;coverage.freshVideos++;
 }
 if(coverage.freshVideos!==sources.length){coverage.status=keyword?'unavailable':'incomplete-evidence';coverage.reason='incomplete-evidence';return result;}if(evidenceCount>MAX_EVIDENCE)throw new ReportReadBound('Derived cache evidence cap exceeded');
 const scope=sql`e.vocabulary_version=${coverage.version} AND e.video_id IN (${sql.join([...ids].map(id=>sql`${id}`),sql`,`)})`;
 const evidenceSize=(await reader.rows(sql`SELECT COUNT(*) AS n,COALESCE(SUM(bytes),0) AS bytes FROM (SELECT OCTET_LENGTH(term) AS bytes FROM ts_video_tag_evidence e WHERE ${scope} LIMIT ${MAX_EVIDENCE+1}) bounded`))[0];
 if(Number(evidenceSize?.n)>MAX_EVIDENCE||Number(evidenceSize?.bytes)>MAX_BYTES)throw new ReportReadBound('Derived cache evidence budget exceeded');
 const evidence=await reader.rows(sql`SELECT e.video_id,e.term,e.field_name,e.rule_version,e.source FROM ts_video_tag_evidence e WHERE ${scope} ORDER BY e.video_id,e.field_name,e.start_offset,e.term_key LIMIT ${MAX_EVIDENCE+1}`);
 if(evidence.length>MAX_EVIDENCE||evidence.reduce((n,r)=>n+Buffer.byteLength(text(r.term)),0)>MAX_BYTES)throw new ReportReadBound('Derived cache evidence budget exceeded');
 const groups=new Map<string,MetricVideo['matches']>();for(const e of evidence){if(e.rule_version!==rule||e.source!==SOURCE||!['title','description'].includes(text(e.field_name))||!text(e.term)||[...text(e.term)].length>240){coverage.status='invalid-evidence';return result;}const matches=groups.get(text(e.video_id))??[];matches.push({term:text(e.term),field:e.field_name as 'title'|'description'});groups.set(text(e.video_id),matches);}
 if(sources.some(v=>(groups.get(text(v.videoId))?.length??0)!==Number(v.evidence_count))){coverage.status='evidence-changed';return result;}
 const [after,sourceAfter,channelsAfter]=await Promise.all([current(),readSources(),keyword?Promise.resolve([]):readChannels()]);if(JSON.stringify(channelsAfter)!==JSON.stringify(channels)){coverage.status='taxonomy-changed';return result;}if(text(after[0]?.id)!==coverage.version||text(after[0]?.coverage)!==text(pin.coverage)||text(after[0]?.matching_rule)!==text(pin.matching_rule)){coverage.status='vocabulary-changed';return result;}if(JSON.stringify(sourceAfter)!==JSON.stringify(sources)){coverage.status='source-changed';return result;}
 coverage.updatedAt=latest(...sources.flatMap(v=>[v.mtime,v.ctime,v.match_epoch===null?null:new Date(Number(v.match_epoch)).toISOString()]));coverage.status='ready';
 result.videos=sources.map(v=>({videoId:text(v.videoId),uId:Number(v.u_id),publishedAt:text(v.publishedAt),viewCount:integer(v.viewCount)===null||Number(v.viewCount)<0?null:v.viewCount,matches:groups.get(text(v.videoId))??[]}));return result;
 } catch(error) {
  if(!(error instanceof ReportReadBound)&&!(error instanceof DataSourceUnavailable))throw error;
  result.videos=[];coverage.status='unavailable';coverage.reason=error instanceof ReportReadBound?'read-budget':'data-source-unavailable';return result;
 }
}
export function derivedNote(coverage:DerivedCoverage){return `共享詞彙即時計算：${coverage.status}${coverage.reason?'（'+coverage.reason+'）':''}；版本 ${coverage.version??'未同步'}；來源 ${coverage.sourceVideos??'未知'} 部、已比對 ${coverage.freshVideos} 部、過期 ${coverage.staleVideos} 部、未比對 ${coverage.unmatchedVideos} 部。觀看值未知 ${coverage.unknownViewVideos} 部（其中無效 ${coverage.invalidViewVideos} 部）。${coverage.selection==='keyword-text-prefilter'?'先依標題／描述的精確字串篩選候選，再驗證共享詞彙證據；':''}僅使用本機既有證據，不會啟動寫入或比對；未涵蓋影片不計為零。`;}
export function derivedRow(source:DerivedSource,from:string,to:string,now:Date,keyword?:string):{row?:Row;reason:string}{
 if(source.coverage.status!=='ready')return {reason:'unavailable'};const videos=source.videos.filter(v=>v.publishedAt.slice(0,10)>=from&&v.publishedAt.slice(0,10)<=to);if(!videos.length)return {reason:'no-source'};
 const metrics=keyword?keywordCloudFromEvidence(videos,keyword):tagMetricsFromEvidence(videos);if(keyword&&!metrics.count_videos)return {reason:'no-matching-source'};if(metrics.unknown_view_videos)return {reason:'unknown-views'};
 return {reason:'ready',row:{words:metrics.tags_result,mtime:source.coverage.updatedAt,_cacheLineage:{version:source.coverage.version,coverage:source.coverage.coverage,rule:DERIVED_RULE},_cacheWindow:{from,to,closed:to<taipeiSql(now).slice(0,10),observedUntil:source.coverage.updatedAt},_derived:true}};
}
/** A sidecar can exist before its MyISAM row. Do not mistake that pending publication
 * for an ordinary cache miss when deciding to derive an entire day window. */
export async function derivedDayGuard(reader:Reader,q:Query,dates:string[],keyword?:string){
 const {reportCacheKey}=await import('../../../shared/report-cache-key.js'),{reportSelectionKeys}=await import('./cache-lineage.js');
 const tables=await reader.rows(sql`SELECT table_name FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name IN ('ts_report_cache_lineage','ts_tag_cache_lineage')`),present=new Set(tables.map(r=>text(r.table_name))),rows:Row[]=[];
 const append=(batch:Row[])=>{if(batch.length>400)throw new ReportReadBound('Derived publication guard exceeds read budget');rows.push(...batch);};
 if(present.has('ts_report_cache_lineage')){const keys=dates.map(date=>reportCacheKey(keyword?{the_date:date,tag:keyword}:{...reportSelectionKeys(q),the_date:date}));append(await reader.rows(sql`SELECT * FROM ts_report_cache_lineage WHERE cache_table=${keyword?'urt_show_video_tag_date':'urt_show_tag_date'} AND cache_key IN (${sql.join(keys.map(k=>sql`${k}`),sql`,`)}) ORDER BY cache_key LIMIT 401`));}
 if(!keyword&&present.has('ts_tag_cache_lineage')){const key=JSON.stringify([idList(q.tagid).sort((a,b)=>a-b),idList(q.or).sort((a,b)=>a-b),idList(q.not).sort((a,b)=>a-b)]);append(await reader.rows(sql`SELECT * FROM ts_tag_cache_lineage WHERE selection_key=${key} AND the_date BETWEEN ${dates[0]} AND ${dates.at(-1)} ORDER BY the_date LIMIT 401`));}
 if(rows.length>800)throw new ReportReadBound('Derived publication guard exceeds read budget');
 return {blocked:rows.some(r=>r.status!=='published'||integer(r.unknown_view_videos)!==0),signature:JSON.stringify(rows)};
}
