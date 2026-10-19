import {sql,type SQL} from 'drizzle-orm';
import type {Reader,Row} from '../db/client.js';
import type {AiDaysData,TopicRow} from '../contracts.js';
import {BadQuery,dateFilter,positiveId,type Query} from './query.js';
import {integer,text,object,latest,timestamp,aiItems} from './normalize.js';
import {dailyLineage} from './ai-lineage.js';
import {publishedChannelAi} from './channel-ai.js';
import {channelTopics} from './channel-ai-shapes.js';
import {buildTopics} from './topics.js';
import {summarizeTopics,sourceStats,channelTagIds,rankByNetworks} from './daily-summary.js';
import {DailyBoundError,DAILY_BOUNDS,needsDailyRegroup,preferDailyRegroup,regroupDaily} from './daily-grouping.js';
function bound(message:string):never{throw new DailyBoundError(message);}
const active=sql`(c.flag_del IS NULL OR c.flag_del<1)`;
const dailyType=sql`(a.data_type IS NULL OR a.data_type IN('oneday','todate'))`;
function conditionScope(condition:string):SQL{
 const tag=({green:4,blue:3,finance:31,world:41} as Record<string,number>)[condition];
 return tag?sql`COALESCE(n.tags,'') LIKE ${'%['+tag+']%'}`:condition==='neutral'?sql.join([3,4,5,6,31,41].map(id=>sql`COALESCE(n.tags,'') NOT LIKE ${'%['+id+']%'}`),sql` AND `):sql`1=1`;
}
function checkJson(payload:unknown){
 let value:unknown;try{value=typeof payload==='string'?JSON.parse(payload):payload;}catch{return;}
 const stack:{value:unknown;depth:number}[]=[{value,depth:0}];let nodes=0;
 while(stack.length){const {value,depth}=stack.pop()!;if(++nodes>100000||depth>32)bound('Daily JSON structure exceeds the report capacity.');if(value&&typeof value==='object')for(const item of Object.values(value))stack.push({value:item,depth:depth+1});}
}
async function channelSources(reader:Reader,date:string,condition:string,ids?:number[],period?:{from:string;to:string}){
 if(ids&&ids.length>DAILY_BOUNDS.sources)bound('Daily channel map exceeds 400 sources.');
 if(ids&&!ids.length)return {rows:[],withheld:0,diverged:0,malformed:0,withheldDates:[],divergedDates:[],malformedDates:[]};
 const rows=await reader.rows(sql`SELECT a.pk,a.u_id,a.date_from,a.date_to,a.data_type,a.user_token,a.ctime,a.mtime,c.title,
 OCTET_LENGTH(a.result_json) AS payload_bytes,CASE WHEN OCTET_LENGTH(a.result_json)<=${DAILY_BOUNDS.sourceBytes} AND SUM(COALESCE(OCTET_LENGTH(a.result_json),0)) OVER(ORDER BY a.pk DESC ROWS UNBOUNDED PRECEDING)<=${DAILY_BOUNDS.totalBytes} THEN a.result_json ELSE NULL END AS result_json
 FROM urt_channel_ai a JOIN urt_channel c ON c.u_id=a.u_id 
 WHERE a.pk IN(SELECT MAX(a.pk) FROM urt_channel_ai a WHERE a.del_flag IS NULL AND ${period?sql`1=1`:dailyType} AND a.date_from=${period?.from??date+' 00:00:00'} AND a.date_to=${period?.to??date+' 23:59:59'} ${ids?sql`AND a.u_id IN(${sql.join(ids.map(id=>sql`${id}`),sql`,`)})`:sql``} GROUP BY a.u_id)
 AND ${active} AND ${ids||!['green','blue','finance','world','neutral'].includes(condition)?sql`1=1`:condition==='neutral'?sql`NOT EXISTS(SELECT 1 FROM urt_count n WHERE n.u_id=a.u_id AND NOT(${conditionScope(condition)}))`:sql`EXISTS(SELECT 1 FROM urt_count n WHERE n.u_id=a.u_id AND ${conditionScope(condition)})`} ORDER BY a.pk DESC LIMIT ${DAILY_BOUNDS.sources+1}`);
 if(rows.length>DAILY_BOUNDS.sources||rows.some(r=>Number(r.payload_bytes)>DAILY_BOUNDS.sourceBytes)||rows.reduce((n,r)=>n+Number(r.payload_bytes??0),0)>DAILY_BOUNDS.totalBytes)bound('Daily source payload exceeds the bounded report capacity.');
 for(const row of rows)checkJson(row.result_json);
 return publishedChannelAi(reader,rows);
}
async function resolveReferences(reader:Reader,topics:TopicRow[],snapshot=false):Promise<Record<string,string|number|null>>{
 const evidence=topics.flatMap(t=>t.evidence),ids=[...new Set(evidence.flatMap(e=>e.videoIds))];
 if(ids.length>DAILY_BOUNDS.videos||evidence.reduce((n,e)=>n+e.videoIds.length,0)>DAILY_BOUNDS.references){
  const refs=evidence.reduce((n,e)=>n+e.videoIds.length,0);for(const e of evidence){e.withheldVideoReferenceCount=e.videoIds.length;e.videoIds=[];e.resolvedVideoIds=[];}
  return {referenceScope:'reference-capacity-exceeded',referencedVideos:ids.length,resolvedVideoReferences:null,unresolvedVideoReferences:null,withheldVideoReferences:refs};
 }
 // Immutable snapshots retain the original evidence even if the current video cache changes.
 if(snapshot)return {referenceScope:'immutable-generation-snapshot',referencedVideos:ids.length,resolvedVideoReferences:null,unresolvedVideoReferences:null};
 const valid=ids.filter(id=>/^[A-Za-z0-9_-]{11}$/.test(id));
 const rows=valid.length?await reader.rows(sql`SELECT videoId,u_id FROM urt_video WHERE videoId IN(${sql.join(valid.map(id=>sql`${id}`),sql`,`)}) AND BINARY videoId IN(${sql.join(valid.map(id=>sql`BINARY ${id}`),sql`,`)}) LIMIT ${DAILY_BOUNDS.videos+1}`):[];
 if(rows.length>DAILY_BOUNDS.videos){for(const e of evidence)e.resolvedVideoIds=[];return {referenceScope:'reference-capacity-exceeded',referencedVideos:ids.length,resolvedVideoReferences:null,unresolvedVideoReferences:null,withheldVideoReferences:evidence.reduce((n,e)=>n+e.videoIds.length,0)};}
 const by=new Map<string,Row[]>();for(const row of rows){const id=text(row.videoId);by.set(id,[...by.get(id)??[],row]);}
 let resolved=0;for(const e of evidence)e.resolvedVideoIds=e.videoIds.filter(id=>{const r=by.get(id);const match=r?.length===1&&integer(r[0]?.u_id)===e.channelId;if(match)resolved++;return match;});
 return {referenceScope:'current-local-channel-video-membership',referencedVideos:ids.length,resolvedVideoReferences:resolved,unresolvedVideoReferences:evidence.reduce((n,e)=>n+e.videoIds.length,0)-resolved};
}
export async function readAiDaily(reader:Reader,q:Query={}):Promise<AiDaysData>{
 const date=dateFilter(q.date===''?undefined:q.date),condition=q.condition===undefined||q.condition===''?'all':q.condition;
 if(typeof condition!=='string'||!/^[a-zA-Z0-9_-]{1,40}$/.test(condition))throw new BadQuery('Unsupported AI condition.');
 const pk=q.pk===undefined?null:positiveId(q.pk),type=q.type===undefined||q.type===''?null:q.type;
 if(type!==null&&(typeof type!=='string'||!/^[a-zA-Z0-9_-]{1,40}$/.test(type)))throw new BadQuery('Unsupported AI data type.');
 let row:Row|null=(await reader.rows(sql`SELECT pk,ctime,mtime,date_from,date_to,data_type,user_token,condition_type,
 OCTET_LENGTH(channel_id) AS map_bytes,OCTET_LENGTH(result_json) AS payload_bytes,
 CASE WHEN OCTET_LENGTH(channel_id)<=131072 THEN channel_id ELSE NULL END AS channel_id,
 CASE WHEN OCTET_LENGTH(result_json)<=2097152 THEN result_json ELSE NULL END AS result_json
 FROM urt_ai_date WHERE del_flag IS NULL ${pk?sql`AND pk=${pk}`:sql`AND (condition_type=${condition} OR (${condition}='all' AND condition_type IS NULL)) AND TIME(date_from)='00:00:00' AND TIME(date_to)='23:59:59' AND DATE(date_from)=DATE(date_to) ${date?sql`AND date_from=${date+' 00:00:00'}`:sql``} ${type?sql`AND data_type=${type}`:sql``}`}
 ORDER BY date_from DESC,pk DESC LIMIT 1`))[0]??null;
 if(Number(row?.map_bytes)>131072||Number(row?.payload_bytes)>2097152)bound('Daily summary payload exceeds the bounded report capacity.');
 if(row){checkJson(row.result_json);if(aiItems(row.result_json).length>DAILY_BOUNDS.topics)bound('Daily topic capacity exceeded.');}
 let selectedDate=date??(text(row?.date_from).slice(0,10)||null);
 let newerSourceDate:string|null=null,newerSourceReason:string|null=null,anchorSearchTruncated=false;
 let prefetched:{loaded:Awaited<ReturnType<typeof channelSources>>;candidate:TopicRow[]}|null=null;
 if(!pk&&!date&&condition==='all'&&!type){
  const candidates=await reader.rows(sql`SELECT a.date_from,a.date_to FROM urt_channel_ai a JOIN urt_channel c ON c.u_id=a.u_id WHERE a.del_flag IS NULL AND ${dailyType} AND ${active} ${selectedDate?sql`AND a.date_from>=${selectedDate+' 00:00:00'}`:sql``} AND a.result_json IS NOT NULL AND a.result_json<>'' ORDER BY a.date_from DESC,a.pk DESC LIMIT 91`);
  anchorSearchTruncated=candidates.length>90;
  const newest=candidates.slice(0,90).find(r=>text(r.date_from).endsWith(' 00:00:00')&&text(r.date_to)===text(r.date_from).slice(0,10)+' 23:59:59'),channelDate=text(newest?.date_from).slice(0,10);
  if(channelDate&&(!selectedDate||channelDate>selectedDate)){
   newerSourceDate=channelDate;
   try{const loaded=await channelSources(reader,channelDate,condition),candidate=regroupDaily(loaded.rows,channelDate,condition);
    if(candidate.length||!row){selectedDate=channelDate;row=null;prefetched={loaded,candidate};}else newerSourceReason='newer-source-unavailable';
   }catch(error){if(!(error instanceof DailyBoundError)||!row)throw error;newerSourceReason='newer-source-capacity-exceeded';}
  }
 }
 const resolvedCondition=text(row?.condition_type)||condition,from=text(row?.date_from)|| (selectedDate?selectedDate+' 00:00:00':null),to=text(row?.date_to)||(selectedDate?selectedDate+' 23:59:59':null);
 const lineage=row?await dailyLineage(reader,row):null;let channels=new Map<number,string>(),sources=new Map<number,Row>(),topics:TopicRow[]=[],source:AiDaysData['source']='none';
 let withheld=0,diverged=0,malformed=0,regroupReason:string|null=null,sourceCapacityExceeded=false;
 if(row){
  if(lineage?.state==='immutable-snapshot'){channels=lineage.channels;sources=lineage.sources;}
  else{for(const [key,value]of Object.entries(object(row.channel_id))){const id=integer(key);if(id&&typeof value==='string')channels.set(id,value);}
   if(channels.size>DAILY_BOUNDS.sources){sourceCapacityExceeded=true;regroupReason='source-capacity-exceeded';}
   if(!lineage&&!sourceCapacityExceeded&&selectedDate){try{const loaded=await channelSources(reader,selectedDate,resolvedCondition,[...channels.keys()],{from:text(row.date_from),to:text(row.date_to)});sources=new Map(loaded.rows.map(r=>[Number(r.u_id),r]));withheld=loaded.withheld;diverged=loaded.diverged;malformed=loaded.malformed;}catch(error){if(!(error instanceof DailyBoundError))throw error;sourceCapacityExceeded=true;regroupReason='source-capacity-exceeded';}}
  }
  topics=buildTopics(integer(row.pk)??0,row.result_json,channels,sources);source='daily-cache';
 }
 // Exact IDs and every TS lineage state are stable citations: never reinterpret them on read.
 if(!pk&&!type&&!lineage&&!sourceCapacityExceeded&&selectedDate&&(!row||needsDailyRegroup(topics,resolvedCondition))){
  try{
   const loaded=prefetched?.loaded??await channelSources(reader,selectedDate,resolvedCondition),candidate=prefetched?.candidate??regroupDaily(loaded.rows,selectedDate,resolvedCondition);
   if(!row||preferDailyRegroup(topics,candidate,resolvedCondition)){
    topics=candidate;channels=new Map(loaded.rows.map(r=>[Number(r.u_id),text(r.title)||`Channel ${r.u_id}`]));sources=new Map(loaded.rows.map(r=>[Number(r.u_id),r]));withheld=loaded.withheld;diverged=loaded.diverged;malformed=loaded.malformed;source=loaded.rows.length?'channel-summaries':'none';regroupReason=row?'improved-source-grouping':'missing-daily-cache';
   }
  }catch(error){if(!(error instanceof DailyBoundError)||!row)throw error;regroupReason='fallback-capacity-exceeded';}
 }
 const tagged=[...new Set(topics.flatMap(t=>t.evidence.map(e=>e.channelId)))],tagRows=tagged.length?await reader.rows(sql`SELECT u_id,tags FROM urt_count WHERE u_id IN(${sql.join(tagged.map(id=>sql`${id}`),sql`,`)})`):[];
 // Before resolveReferences: it may withhold references past the capacity bound.
 const channelTags=new Map(tagRows.map(r=>[Number(r.u_id),channelTagIds(r.tags)]));
 summarizeTopics(topics,sources,channelTags);
 topics=rankByNetworks(topics,channelTags);
 const refs=await resolveReferences(reader,topics,lineage?.state==='immutable-snapshot');
 const ids=[...channels.keys()],raw=!sourceCapacityExceeded&&lineage?.state!=='immutable-snapshot'&&from&&to&&ids.length?(await reader.rows(sql`SELECT COUNT(*) AS total FROM urt_video WHERE u_id IN(${sql.join(ids.map(id=>sql`${id}`),sql`,`)}) AND publishedAt>=${from} AND publishedAt<=${to}`))[0]:null;
 return {date:row&&text(row.date_from).slice(0,10)!==text(row.date_to).slice(0,10)?null:selectedDate,dateFrom:timestamp(from),dateTo:timestamp(to),dailyId:source==='channel-summaries'?null:integer(row?.pk),dataType:source==='channel-summaries'?null:text(row?.data_type)||null,condition:resolvedCondition,rows:topics,channels:channels.size,source,updatedAt:latest(...(source==='daily-cache'?[row?.mtime,row?.ctime]:[]),...[...sources.values()].flatMap(r=>[r.mtime,r.ctime])),rawVideoRows:lineage?.state==='immutable-snapshot'?null:ids.length?integer(raw?.total):null,sourceChannels:sources.size,sourceStats:sourceStats(sources,resolvedCondition),
 ...(lineage?{lineage:{state:lineage.state,runId:lineage.runId}}:{}),evidenceCoverage:{composition:source,regroupReason,replacedDailyId:source==='channel-summaries'?integer(row?.pk):null,newerSourceDate,newerSourceReason,anchorSearchTruncated,sourceCapacityExceeded,withheldSources:withheld,divergedSources:diverged,malformedSources:malformed,sourceChannels:sources.size,invalidVideoReferences:[...sources.values()].reduce((n,r)=>n+channelTopics(r.result_json).reduce((m,t)=>m+t.invalidReferences,0),0),rawVideoScope:lineage?.state==='immutable-snapshot'?'not-counted-for-snapshot':'current-table-selected-summary-channels',...refs}};
}
