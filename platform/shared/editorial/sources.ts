import type {Connection,RowDataPacket} from 'mysql2/promise';
import {canonical,decode,fail,hash,object,sqlTime,type SourceInput} from './contracts.js';
export interface ResolvedSource {kind:SourceInput['kind'];sourceId:string;identity:string;headline:string;url:string|null;publishedAt:string|null;observedAt:string;sourceHash:string;provenance:Record<string,unknown>;snapshot:unknown}
const localTime=(v:unknown)=>{if(typeof v!=='string'||!Number.isFinite(Date.parse(v.replace(' ','T')+'+08:00')))return null;return sqlTime(new Date(v.replace(' ','T')+'+08:00'));};
const firstTitle=(v:unknown)=>object(v)?['事件','議題','標題','event','topic','title'].map(k=>v[k]).find(t=>typeof t==='string'&&t.trim()):null;
export async function resolveSource(db:Connection,input:SourceInput):Promise<ResolvedSource>{
 let snapshot:unknown,headline:unknown,url:string|null=null,publishedAt:string|null=null,observedAt:string|null=null,provenance:Record<string,unknown>;
 if(input.kind==='article'){
  const[rows]=await db.query<RowDataPacket[]>("SELECT s.payload,UNIX_TIMESTAMP(r.published_at) AS observed_epoch FROM ts_vocabulary_stage s JOIN ts_vocabulary_runs r ON r.id=s.run_id WHERE BINARY s.run_id=BINARY ? AND BINARY s.article_id=BINARY ? AND r.status='published'",[input.sourceVersion,input.sourceId]);
  if(rows.length!==1)return fail('ARTICLE_SNAPSHOT_NOT_FOUND',404);const article=decode(rows[0]!.payload);if(!object(article)||article.id!==input.sourceId||typeof article.media!=='string'||typeof article.publishedAt!=='string'||!Array.isArray(article.tags))return fail('ARTICLE_SNAPSHOT_INVALID',409);
  const stamp=Date.parse(article.publishedAt);if(!Number.isFinite(stamp))return fail('ARTICLE_SNAPSHOT_INVALID',409);
  snapshot=article;headline=input.headline;url=input.url!;publishedAt=sqlTime(new Date(stamp));observedAt=rows[0]!.observed_epoch!==null&&Number.isFinite(Number(rows[0]!.observed_epoch))?sqlTime(new Date(Number(rows[0]!.observed_epoch)*1000)):null;
  provenance={source:'https://tag.observe.tw',sourceVersion:input.sourceVersion,publisher:article.media,headlineEvidence:'operator-transcribed',urlEvidence:'operator-transcribed',referenceEvidence:'exact-maintained-source-snapshot',tags:article.tags,vocabularyCoverage:'observed-article-window'};
 }else if(input.kind==='video'){
  const[rows]=await db.query<RowDataPacket[]>('SELECT videoId,title,description,channelId,channelTitle,publishedAt,ctime FROM urt_video WHERE BINARY videoId=BINARY ? LIMIT 2',[input.sourceId]);
  if(rows.length!==1)return fail('SOURCE_NOT_FOUND_OR_AMBIGUOUS',404);snapshot=rows[0];headline=rows[0]!.title;url='https://www.youtube.com/watch?v='+input.sourceId;publishedAt=localTime(rows[0]!.publishedAt);observedAt=localTime(rows[0]!.ctime);provenance={source:'youtube',table:'urt_video',channelId:rows[0]!.channelId,headlineEvidence:'captured-source-title'};
 }else if(input.kind==='daily'){
  const[pk,index]=input.sourceId.split(':');const[rows]=await db.query<RowDataPacket[]>('SELECT pk,ctime,date_from,date_to,result_json FROM urt_ai_date WHERE pk=? AND del_flag IS NULL',[pk]);if(rows.length!==1)return fail('SOURCE_NOT_FOUND',404);
  const payload=decode(rows[0]!.result_json),events=Array.isArray(payload)?payload:object(payload)?payload.events:null;if(!Array.isArray(events)||!object(events[Number(index)]))return fail('DAILY_EVENT_NOT_FOUND',404);
  const event=events[Number(index)];snapshot={pk:rows[0]!.pk,index:Number(index),dateFrom:rows[0]!.date_from,dateTo:rows[0]!.date_to,event};headline=firstTitle(event);const ambiguous=events.filter(e=>firstTitle(e)===headline).length!==1;url=ambiguous?null:'/ai/events/'+pk+'?event='+encodeURIComponent(String(headline));publishedAt=localTime(rows[0]!.date_from);observedAt=localTime(rows[0]!.ctime);provenance={source:'youtube-board',table:'urt_ai_date',rowSha256:hash(String(rows[0]!.result_json)),eventIndex:Number(index),linkAmbiguous:ambiguous,headlineEvidence:'generated-analysis'};
 }else if(input.kind==='event'){
  const[rows]=await db.query<RowDataPacket[]>('SELECT pk,aipk,event_name,ctime,date_from,date_to,result_json FROM urt_ai_event WHERE pk=? AND del_flag IS NULL',[input.sourceId]);if(rows.length!==1)return fail('SOURCE_NOT_FOUND',404);snapshot=rows[0];headline=rows[0]!.event_name;url='/ai/events/'+input.sourceId;publishedAt=localTime(rows[0]!.date_from);observedAt=localTime(rows[0]!.ctime);provenance={source:'youtube-board',table:'urt_ai_event',headlineEvidence:'generated-analysis'};
 }else{
  const[rows]=await db.query<RowDataPacket[]>('SELECT id,story_key,canonical_title,first_seen_at FROM telegram_digest_stories WHERE id=?',[input.sourceId]);if(rows.length!==1)return fail('SOURCE_NOT_FOUND',404);snapshot=rows[0];headline=rows[0]!.canonical_title;publishedAt=typeof rows[0]!.first_seen_at==='string'?rows[0]!.first_seen_at:null;observedAt=publishedAt;provenance={source:'youtube-board',table:'telegram_digest_stories',storyKey:rows[0]!.story_key,headlineEvidence:'notification-story',identityClaim:'reference-only',observationMeaning:'first-seen',snapshotScope:'stable-story-reference'};
 }
 if(typeof headline!=='string'||!headline.trim()||headline.length>1000||!observedAt)return fail('SOURCE_METADATA_INVALID',409);
 if(Buffer.byteLength(canonical(snapshot))>262144)return fail('SOURCE_SNAPSHOT_TOO_LARGE',413);
 return {kind:input.kind,sourceId:input.sourceId,identity:hash(input.kind+':'+input.sourceId),headline,url,publishedAt,observedAt,sourceHash:hash(canonical({snapshot,headline,url,provenance})),provenance,snapshot};
}
