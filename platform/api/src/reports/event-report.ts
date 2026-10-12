import {channelSource,sourceForLabel} from './channel-sources.js';
import {sql} from 'drizzle-orm';
import {aiBusinessKey,canonicalHash} from '../../../shared/ai-business-key.js';
import type {Reader,Row} from '../db/client.js';
import type {AiDaysData,AiEventData,EventAnalysis} from '../contracts.js';
import {BadQuery,NotFound,type Query} from './query.js';
import {ReportReadBound} from './cache-weights.js';
import {text,integer,latest,object,video} from './normalize.js';
import {eventPresentation,presentationCitations,resolveEventAlias} from './event-shapes.js';
const fields=sql`pk,aipk,event_name,prompt_type,condition_type,user_token,date_from,date_to,data_type,ctime,mtime,CASE WHEN OCTET_LENGTH(result_json)<=2097152 THEN result_json ELSE NULL END AS result_json,OCTET_LENGTH(result_json) AS result_bytes`;
const key=(r:Row)=>({aipk:Number(r.aipk),event_name:text(r.event_name),prompt_type:text(r.prompt_type),condition_type:r.condition_type??'all',user_token:r.user_token});
function snapshot(run:Row,r:Row,daily:Row):EventAnalysis['lineage']|null{
 try{const input=object(run.input_json),plan=object(input.plan),source=object(plan.source),origin=object(source.daily),topic=object(source.topic),business=aiBusinessKey('urt_ai_event',key(r)),inputHash=canonicalHash({version:'yt-ai-derived-v1',model:'sky-quality',plan});
  if(plan.workflow!=='ai.event'||plan.table!=='urt_ai_event'||canonicalHash(plan.key)!==canonicalHash(key(r))||inputHash!==run.input_sha256||canonicalHash({business,inputHash})!==run.run_id||source.promptType!==r.prompt_type||topic.title!==r.event_name||String(origin.pk)!==String(r.aipk)||origin.from!==r.date_from||origin.to!==r.date_to||origin.condition!==(r.condition_type??'all')||origin.userToken!==r.user_token||typeof origin.resultSha256!=='string'||!/^[a-f0-9]{64}$/.test(origin.resultSha256))return null;
  if(!Array.isArray(source.videos)||source.videos.length>1000||!Array.isArray(topic.media)||topic.media.length>1000)return null;
  const sourceVideos:NonNullable<EventAnalysis['lineage']>['sourceVideos']=[],seen=new Set<string>();
  for(const value of source.videos){const v=object(value),id=text(v.videoId),channelId=integer(v.u_id);if(!/^[A-Za-z0-9_-]{11}$/.test(id)||!channelId||seen.has(id))return null;seen.add(id);
   const media=new Set(topic.media.map(object).filter(m=>integer(m.u_id)===channelId&&Array.isArray(object(m.event).videoId)&&(object(m.event).videoId as unknown[]).includes(id)).map(m=>text(m.channel)));
   if(media.size!==1||!media.values().next().value)return null;sourceVideos.push({id,title:text(v.title),channelId,media:[...media][0]!});
  }
  return {state:'immutable-snapshot',runId:text(run.run_id),dailyResultSha256:origin.resultSha256,sourceChanged:canonicalHash(text(daily.result_json))!==origin.resultSha256||origin.from!==daily.date_from||origin.to!==daily.date_to||origin.condition!==(daily.condition_type??'all')||origin.userToken!==daily.user_token,sourceVideos};
 }catch{return null;}
}
async function analysis(reader:Reader,r:Row,daily:Row,historical=false):Promise<{value?:EventAnalysis;status:'visible'|'unpublished'|'diverged'|'snapshot-unavailable'|'malformed'}>{
 if(Number(r.result_bytes)>2097152)throw new ReportReadBound('Event output exceeds read budget.');
 const business=aiBusinessKey('urt_ai_event',key(r)),run=(await reader.rows(sql`SELECT run_id,input_sha256,CASE WHEN OCTET_LENGTH(input_json)<=2097152 THEN input_json ELSE NULL END AS input_json FROM ts_ai_runs WHERE workflow='ai.event' AND target_pk=${r.pk} AND business_key_sha256=${business} AND status='published' AND BINARY result_json=BINARY ${r.result_json} ORDER BY updated_at DESC,run_id DESC LIMIT 1`))[0];
 let lineage:EventAnalysis['lineage'];
 if(run){const checked=snapshot(run,r,daily);if(!checked)return {status:'snapshot-unavailable'};lineage=checked;}
 else{const state=(await reader.rows(sql`SELECT EXISTS(SELECT 1 FROM ts_ai_runs WHERE workflow='ai.event' AND (target_pk=${r.pk} OR (${historical?0:1}=1 AND target_pk IS NULL AND business_key_sha256=${business}))) AS claimed,EXISTS(SELECT 1 FROM ts_ai_runs WHERE workflow='ai.event' AND target_pk=${r.pk} AND status='published') AS published_before`))[0];if(Number(state?.claimed))return {status:Number(state?.published_before)?'diverged':'unpublished'};lineage={state:'legacy-unrecorded',runId:null,dailyResultSha256:null,sourceChanged:false,sourceVideos:[]};}
 let result:unknown;try{result=JSON.parse(text(r.result_json));if(!result||typeof result!=='object')return {status:'malformed'};}catch{return {status:'malformed'};}
 return {status:'visible',value:{id:Number(r.pk),type:text(r.prompt_type),result,updatedAt:latest(r.mtime,r.ctime),lineage}};
}
export async function eventReport(reader:Reader,aiDays:(q?:Query)=>Promise<AiDaysData>,id:number,event?:string):Promise<AiEventData>{
 event=event?.trim()||undefined;if(event&&event.length>256)throw new BadQuery('Invalid event name.');
 const direct=event?undefined:(await reader.rows(sql`SELECT ${fields} FROM urt_ai_event WHERE pk=${id} AND del_flag IS NULL LIMIT 1`))[0];if(!event&&!direct)throw new NotFound();
 const dailyId=direct?integer(direct.aipk)??0:id,requestedTitle=event??text(direct?.event_name);if(dailyId<1||!requestedTitle.trim())throw new NotFound();
 const daily=(await reader.rows(sql`SELECT pk,date_from,date_to,condition_type,user_token,CASE WHEN OCTET_LENGTH(result_json)<=16777216 THEN result_json ELSE NULL END AS result_json,OCTET_LENGTH(result_json) AS result_bytes FROM urt_ai_date WHERE pk=${dailyId} AND del_flag IS NULL LIMIT 1`))[0];if(!daily)throw new NotFound();if(Number(daily.result_bytes)>16777216)throw new ReportReadBound('Daily source exceeds event read budget.');
 const dailyData=await aiDays({pk:String(dailyId)});if(dailyData.dailyId!==dailyId)throw new NotFound();
 const scope=direct??daily,sourceScopeMismatch=!!direct&&(direct.user_token!==daily.user_token||(direct.condition_type??'all')!==(daily.condition_type??'all')||direct.date_from!==daily.date_from||direct.date_to!==daily.date_to);
 const load=async(title:string)=>{const selected=await reader.rows(sql`SELECT pk,prompt_type,OCTET_LENGTH(result_json) AS result_bytes FROM urt_ai_event WHERE pk IN(SELECT MAX(pk) FROM urt_ai_event WHERE aipk=${dailyId} AND BINARY event_name=BINARY ${title} AND BINARY COALESCE(condition_type,'all')=BINARY ${scope.condition_type??'all'} AND BINARY user_token <=> BINARY ${scope.user_token} AND date_from=${scope.date_from} AND date_to=${scope.date_to} AND del_flag IS NULL GROUP BY BINARY prompt_type) ORDER BY pk DESC LIMIT 33`);
  if(selected.length>32||selected.some(r=>Number(r.result_bytes)>2097152)||selected.reduce((n,r)=>n+Number(r.result_bytes??0),0)>8388608)throw new ReportReadBound('Event outputs exceed read budget.');
  return selected.length?reader.rows(sql`SELECT ${fields} FROM urt_ai_event WHERE pk IN(${sql.join(selected.map(r=>sql`${r.pk}`),sql`,`)}) AND del_flag IS NULL ORDER BY pk DESC LIMIT 33`):[];
 };
 let title=requestedTitle,rows=await load(title),resolution:AiEventData['resolution']={requestedTitle,canonicalTitle:title,kind:'exact',sourceDailyId:dailyId,topicIds:[]};
 let topics=dailyData.rows.filter(t=>t.title===title);
 if(!direct&&!rows.length&&!topics.length&&dailyData.lineage?.state!=='snapshot-unavailable'){const alias=resolveEventAlias(dailyData.rows,title);title=alias.title;topics=alias.topics;resolution={...resolution,canonicalTitle:title,kind:alias.kind};if(alias.kind!=='exact')rows=await load(title);}
 const historical=!!direct&&rows.some(r=>r.prompt_type===direct.prompt_type&&Number(r.pk)>Number(direct.pk));
 if(direct){rows=rows.filter(r=>r.prompt_type!==direct.prompt_type);rows.unshift(direct);}
 if(rows.reduce((n,r)=>n+Number(r.result_bytes??0),0)>8*1024*1024)throw new ReportReadBound('Event outputs exceed aggregate read budget.');
 if(rows.length>32)throw new ReportReadBound('Event analysis type capacity exceeded.');if(!topics.length&&!rows.length)throw new NotFound();
 const checked:Awaited<ReturnType<typeof analysis>>[]=[];for(let i=0;i<rows.length;i+=6)checked.push(...await Promise.all(rows.slice(i,i+6).map(r=>analysis(reader,r,daily,!!direct&&r.pk===direct.pk&&historical))));let analyses=checked.flatMap(r=>r.value?[r.value]:[]);
 const primary=analyses.find(a=>direct&&a.id===Number(direct.pk))??analyses.find(a=>a.type==='summary')??analyses[0],sourceHash=primary?.lineage?.dailyResultSha256;
 // A pinned unavailable analysis must not be replaced by a different prompt or newer revision.
 const pinnedUnavailable=!!direct&&!analyses.some(a=>a.id===Number(direct.pk));
 let incompatibleSources=0;if(pinnedUnavailable){incompatibleSources=analyses.length;analyses=[];topics=[];}
 else if(sourceHash){const before=analyses.length;analyses=analyses.filter(a=>a.lineage?.dailyResultSha256===sourceHash||(!primary?.lineage?.sourceChanged&&a.lineage?.state==='legacy-unrecorded'));incompatibleSources=before-analyses.length;if(primary?.lineage?.sourceChanged)topics=[];}
 else {const before=analyses.length;analyses=analyses.filter(a=>!a.lineage?.sourceChanged);incompatibleSources=before-analyses.length;}
 if(resolution.kind==='same-day-source-alias'&&primary?.lineage?.sourceChanged)throw Object.assign(new Error('The alias belongs to a different daily source revision.'),{statusCode:409});
 if(sourceScopeMismatch)topics=[];
 resolution.topicIds=topics.map(t=>t.id);
 const presentation=eventPresentation(analyses);const citations=presentationCitations(presentation),ids=[...new Set([...topics.flatMap(t=>t.evidence.flatMap(e=>e.videoIds)),...analyses.flatMap(a=>a.lineage?.sourceVideos.map(v=>v.id)??[]),...citations.filter(c=>c.href).flatMap(c=>c.id?[c.id]:[])].filter(id=>/^[A-Za-z0-9_-]{11}$/.test(id)))];if(ids.length>5000)throw new ReportReadBound('Event source video capacity exceeded.');
 const rawVideos=ids.length?await reader.rows(sql`SELECT pk,videoId,u_id,LEFT(channelId,128) AS channelId,LEFT(channelTitle,256) AS channelTitle,LEFT(title,512) AS title,LEFT(thumbnails,2048) AS thumbnails,publishedAt,viewCount,likeCount,commentCount,mtime,ctime FROM urt_video WHERE videoId IN(${sql.join(ids.map(id=>sql`${id}`),sql`,`)}) AND BINARY videoId IN(${sql.join(ids.map(id=>sql`BINARY ${id}`),sql`,`)}) ORDER BY publishedAt DESC,pk DESC LIMIT 5001`):[];if(rawVideos.length>5000)throw new ReportReadBound('Event source video rows exceed capacity.');
 const wanted=new Set(ids),counts=new Map<string,number>();for(const row of rawVideos)if(wanted.has(text(row.videoId)))counts.set(text(row.videoId),(counts.get(text(row.videoId))??0)+1);const videos=rawVideos.filter(r=>wanted.has(text(r.videoId))&&counts.get(text(r.videoId))===1).map(video);
 const videoSources=new Map(videos.map(v=>[v.id,channelSource({u_id:v.channelId,channelTitle:v.channelTitle,youtubeChannelId:v.youtubeChannelId})]));
 for(const citation of citations){const source=citation.id?videoSources.get(citation.id):undefined;if(citation.verification==='stored-reference'&&source)citation.sourceChannel=sourceForLabel(citation.media,[source]);}
 return {id,dailyId,title,date:dailyData.date,topic:topics.length===1?topics[0]!:null,topics,idKind:event?'daily':'event',analyses,videos,resolution,presentation,evidenceCoverage:{sourceDailyId:dailyId,alias:resolution.kind,analysisRows:rows.length,visibleAnalyses:analyses.length,unpublishedAnalyses:checked.filter(r=>r.status==='unpublished').length,divergedAnalyses:checked.filter(r=>r.status==='diverged').length,snapshotUnavailableAnalyses:checked.filter(r=>r.status==='snapshot-unavailable').length,malformedAnalyses:checked.filter(r=>r.status==='malformed').length,incompatibleSources,pinnedUnavailable,sourceScopeMismatch,sourceChanged:analyses.some(a=>a.lineage?.sourceChanged),referencedVideos:ids.length,resolvedVideos:videos.length,unresolvedVideos:ids.length-videos.length,invalidCitations:citations.filter(c=>c.verification==='invalid').length,outsideSnapshotCitations:citations.filter(c=>c.verification==='outside-snapshot').length,missingCitations:citations.filter(c=>c.verification==='missing').length}};
}
