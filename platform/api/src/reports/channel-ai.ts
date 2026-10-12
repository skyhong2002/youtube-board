import {readChannelIdentity,type ChannelIdentity} from './channel-identity.js';
import {createHash} from 'node:crypto';
import {sql} from 'drizzle-orm';
import {DataQueryFailed,DataSourceUnavailable,type Reader,type Row} from '../db/client.js';
import type {ReportData,ReportColumn,ReportCell,ReportValue} from '../report-contracts.js';
import {aiBusinessKey} from '../../../shared/ai-business-key.js';
import {BadQuery,NotFound,bounded,dateFilter,page,positiveId,type Query} from './query.js';
import {text,latest} from './normalize.js';
import {table,link} from './table.js';
import {channelText,channelTopics,overviewItems,overviewAspects,storedNumber,decodedAnalysis,excludedChannelPeople,type ChannelTopic} from './channel-ai-shapes.js';
export class ChannelAiBoundError extends BadQuery {}
export class MissingChannelAiSidecar extends DataSourceUnavailable {}
type Cells=Record<string,ReportValue|ReportCell>;
type Section=NonNullable<ReportData['sections']>[number];
const dailyTypes=sql`('oneday','todate')`, maxRows=400;
const fields=sql`a.pk,a.u_id,a.date_from,a.date_to,a.data_type,a.user_token,a.ai_type,a.ctime,a.mtime,a.result_json`;
const notes=['本頁只讀取既有 AI 分析，不會因瀏覽而呼叫模型。分析描述與分數是模型輸出，並非已驗證的客觀立場。','影片連結依結果引用與目前本地影片所屬頻道核對；不是對生成當時輸入快照的完整性認證。歷史來源可能缺漏；若內容與曾發布的 TypeScript 紀錄不符，會另列 divergedSources 並暫不顯示，不能重新假定為 Laravel 來源。'];
function input(q:Query){page(q);dateFilter(q.date);if(q.pk!==undefined&&((q.date!==undefined)||(q.days!==undefined)||(q.type!==undefined)))throw new BadQuery('Select a source ID or period/type filters, not both.');return {pk:q.pk===undefined?null:positiveId(q.pk),date:dateFilter(q.date),days:bounded(q.days,1,1,90)};}
function sourceLink(id:number,row:Row){return `/channels/${id}/ai${['topic','people','aspect'].includes(text(row.data_type))?'':'/days'}?pk=${row.pk}`;}
function sourceSection(id:number,rows:Row[]):Section{return {key:'sources',title:'分析來源紀錄',columns:[{key:'source',label:'紀錄'},{key:'type',label:'類型'},{key:'from',label:'開始',kind:'datetime'},{key:'to',label:'結束',kind:'datetime'},{key:'model',label:'模型紀錄'},{key:'publication',label:'發布來源'},{key:'revision',label:'修訂狀態'}],rows:rows.map(r=>({source:link(`urt_channel_ai #${r.pk}`,sourceLink(id,r)),type:text(r.data_type),from:text(r.date_from)||null,to:text(r.date_to)||null,model:text(r.ai_type)||null,publication:r.tsPublished?'TypeScript 已發布紀錄':'無 TypeScript 發布紀錄',revision:r.superseded?'已有較新紀錄':r.superseded===false?'該範圍最新紀錄':'依本次篩選選取'}))};}
/** Check current output publication with indexed EXISTS, without fetching unbounded run history. */
export async function publishedChannelAi(reader:Reader,rows:Row[]){
 if(rows.length>maxRows)throw new ChannelAiBoundError('Channel analysis exceeds the 400-source review bound.');
 if(rows.reduce((n,r)=>n+Buffer.byteLength(text(r.result_json)),0)>16*1024*1024)throw new ChannelAiBoundError('Channel analysis exceeds the 16 MiB review bound.');
 const withheldDates:string[]=[],divergedDates:string[]=[],malformedDates:string[]=[];
 if(!rows.length)return {rows,withheld:0,diverged:0,malformed:0,withheldDates,divergedDates,malformedDates};
 let checks:Row[];try{checks=await reader.rows(sql.join(rows.map(row=>{
  const key=aiBusinessKey('urt_channel_ai',{date_from:row.date_from,date_to:row.date_to,data_type:row.data_type,user_token:row.user_token,u_id:Number(row.u_id)}),digest=createHash('sha256').update(text(row.result_json)).digest('hex');
  return sql`SELECT ${row.pk} AS pk,
   EXISTS(SELECT 1 FROM ts_ai_runs r WHERE r.business_key_sha256=${key} AND r.workflow='ai.channel' AND r.target_pk=${row.pk} AND r.status='published' AND SHA2(CONVERT(r.result_json USING utf8mb4),256)=${digest}) AS published,
   EXISTS(SELECT 1 FROM ts_ai_runs r WHERE r.business_key_sha256=${key} AND r.workflow='ai.channel' AND (r.target_pk=${row.pk} OR r.target_pk IS NULL) AND r.status<>'published' AND SHA2(CONVERT(r.result_json USING utf8mb4),256)=${digest}) AS pending,
   EXISTS(SELECT 1 FROM ts_ai_runs r WHERE r.workflow='ai.channel' AND r.target_pk=${row.pk} AND r.status='published') AS published_before`;
 }),sql` UNION ALL `));}catch(error){if(error instanceof DataQueryFailed&&error.driverCode==='ER_NO_SUCH_TABLE')throw new MissingChannelAiSidecar();throw error;}
 const byPk=new Map(checks.map(r=>[Number(r.pk),r]));let withheld=0,diverged=0,malformed=0;
 const visible=rows.filter(row=>{
  const state=byPk.get(Number(row.pk));if(!state)throw new Error('Missing channel publication observation');
  const date=text(row.date_from).slice(0,10),match=Boolean(Number(state.published));
  if(!match&&Number(state.pending)){withheld++;withheldDates.push(date);return false;}
  if(!match&&Number(state.published_before)){diverged++;divergedDates.push(date);return false;}
  if(!decodedAnalysis(row.result_json)){malformed++;malformedDates.push(date);return false;}
  row.tsPublished=match;return true;
 });
 return {rows:visible,withheld,diverged,malformed,withheldDates,divergedDates,malformedDates};
}
async function markCitation(reader:Reader,row:Row,overview=false){
 const newer=(await reader.rows(sql`SELECT MAX(pk) AS pk FROM urt_channel_ai WHERE u_id=${row.u_id} AND del_flag IS NULL AND ${overview?sql`data_type=${row.data_type} AND LENGTH(result_json)>10`:row.data_type==='week'?sql`data_type='week'`:sql`data_type IN ${dailyTypes} AND date_from=${row.date_from}`}`))[0];row.superseded=Number(newer?.pk)>Number(row.pk);
}
async function selectedDaily(reader:Reader,id:number,q:Query,people=false){
 const v=input(q),days=bounded(q.days,people?28:1,1,90),type=q.type===undefined?'oneday':text(q.type);
 if(!['oneday','week'].includes(type)||(people&&(q.type!==undefined||v.pk)))throw new BadQuery('Unsupported channel analysis selection.');
 if(type==='week'&&(q.days!==undefined||v.date))throw new BadQuery('Weekly analysis uses a stored period; select its source ID for an exact record.');
 if(v.pk){const raw=await reader.rows(sql`SELECT ${fields} FROM urt_channel_ai a WHERE a.pk=${v.pk} AND a.u_id=${id} AND (a.data_type IS NULL OR a.data_type IN('oneday','todate','week')) AND a.del_flag IS NULL LIMIT 1`);if(!raw.length)throw new NotFound();await markCitation(reader,raw[0]!);return {...await publishedChannelAi(reader,raw),from:text(raw[0]!.date_from).slice(0,10),to:text(raw[0]!.date_to).slice(0,10),dates:[text(raw[0]!.date_from).slice(0,10)]};}
 if(type==='week'){const raw=await reader.rows(sql`SELECT ${fields} FROM urt_channel_ai a WHERE a.u_id=${id} AND a.data_type='week' AND a.del_flag IS NULL ORDER BY a.pk DESC LIMIT 1`);return {...await publishedChannelAi(reader,raw),from:text(raw[0]?.date_from).slice(0,10)||null,to:text(raw[0]?.date_to).slice(0,10)||null,dates:raw.length?[text(raw[0]!.date_from).slice(0,10)]:[]};}
 let date=v.date,newerUnavailableSources=0,anchorSearchTruncated=false;
 if(!date){
  const candidates=await reader.rows(sql`SELECT ${fields} FROM urt_channel_ai a WHERE a.pk IN(SELECT MAX(pk) FROM urt_channel_ai WHERE u_id=${id} AND ${people?sql`data_type='oneday'`:sql`data_type IN ${dailyTypes} AND TIME(date_from)='00:00:00'`} AND del_flag IS NULL GROUP BY ${people?sql`date_from,date_to`:sql`date_from`}) ORDER BY a.date_from DESC,a.pk DESC LIMIT 91`);
  anchorSearchTruncated=candidates.length>90;const searched=candidates.slice(0,90),visible=await publishedChannelAi(reader,searched);
  date=text(visible.rows[0]?.date_from).slice(0,10)||null;
  newerUnavailableSources=searched.filter(r=>!date||text(r.date_from).slice(0,10)>date).length;
  if(!date)return {...visible,rows:[],from:null,to:null,dates:[],newerUnavailableSources,anchorSearchTruncated};
 }
 dateFilter(date);
 const from=new Date(Date.parse(date)-(days-1)*86400000).toISOString().slice(0,10),dates=Array.from({length:days},(_,i)=>new Date(Date.parse(date)-i*86400000).toISOString().slice(0,10));
 const raw=await reader.rows(sql`SELECT ${fields} FROM urt_channel_ai a WHERE a.pk IN(SELECT MAX(pk) FROM urt_channel_ai WHERE u_id=${id} AND ${people?sql`data_type='oneday'`:sql`data_type IN ${dailyTypes}`} AND del_flag IS NULL AND date_from>=${from+' 00:00:00'} AND date_from<=${date+' 23:59:59'} ${people?sql``:sql`AND TIME(date_from)='00:00:00'`} GROUP BY ${people?sql`date_from,date_to`:sql`date_from`}) ORDER BY a.date_from DESC,a.pk DESC LIMIT ${maxRows+1}`);
 return {...await publishedChannelAi(reader,raw),from,to:date,dates,newerUnavailableSources,anchorSearchTruncated};
}
interface TopicSource{source:Row;topic:ChannelTopic;index:number}
async function references(reader:Reader,id:number,topics:TopicSource[]){
 const ids=[...new Set(topics.flatMap(t=>t.topic.videos))];if(ids.length>5000||topics.length>10000||topics.reduce((n,t)=>n+t.topic.videos.length,0)>20000)throw new ChannelAiBoundError('Channel analysis reference bound exceeded.');
 const videos=ids.length?await reader.rows(sql`SELECT videoId,title,u_id FROM urt_video WHERE videoId IN(${sql.join(ids.map(v=>sql`${v}`),sql`, `)}) AND BINARY videoId IN(${sql.join(ids.map(v=>sql`BINARY ${v}`),sql`, `)}) LIMIT 5001`):[];
 if(videos.length>5000)throw new ChannelAiBoundError('Channel analysis source-video bound exceeded.');
 const requested=new Set(ids),exact=videos.filter(v=>requested.has(text(v.videoId)));
 const occurrences=new Map<string,number>();for(const video of exact)occurrences.set(text(video.videoId),(occurrences.get(text(video.videoId))??0)+1);
 const ambiguous=new Set([...occurrences].filter(([,n])=>n>1).map(([id])=>id));
 const byId=new Map(exact.filter(v=>Number(v.u_id)===id&&!ambiguous.has(text(v.videoId))).map(v=>[text(v.videoId),v])),cross=new Set(exact.filter(v=>Number(v.u_id)!==id).map(v=>text(v.videoId)));
 const rows:Cells[]=topics.flatMap(t=>t.topic.videos.map(video=>({source:link(`#${t.source.pk}`,sourceLink(id,t.source)),topic:t.topic.title||'未命名分析項目',video:byId.has(video)?link(text(byId.get(video)?.title)||video,`/videos/${video}`):video,status:byId.has(video)?'本地同頻道影片':ambiguous.has(video)?'本地影片識別重複':cross.has(video)?'所屬頻道不符':'本地來源缺漏'})));
 return {rows,unique:ids.length,resolved:byId.size,unresolved:ids.length-byId.size,invalid:topics.reduce((n,t)=>n+t.topic.invalidReferences,0)};
}
const refSection=(rows:Cells[]):Section=>({key:'references',title:'結果中的影片引用',columns:[{key:'source',label:'分析來源'},{key:'topic',label:'議題'},{key:'video',label:'引用影片'},{key:'status',label:'核對狀態'}],rows});
function coverage(source:{rows:Row[];withheld:number;diverged:number;malformed:number;withheldDates:string[];divergedDates:string[];malformedDates:string[];newerUnavailableSources?:number;anchorSearchTruncated?:boolean},dates:string[],ref:{unique:number;resolved:number;unresolved:number;invalid:number}){return {status:'available',reason:null,sourceRows:source.rows.length,withheldSources:source.withheld,divergedSources:source.diverged,malformedSources:source.malformed,unavailableDays:new Set([...source.withheldDates,...source.divergedDates,...source.malformedDates]).size,newerUnavailableSources:source.newerUnavailableSources??0,anchorSearchTruncated:source.anchorSearchTruncated??false,requestedDays:dates.length,observedDays:new Set(source.rows.map(r=>text(r.date_from).slice(0,10))).size,referencedVideos:ref.unique,resolvedVideos:ref.resolved,unresolvedVideos:ref.unresolved,invalidReferences:ref.invalid,referenceScope:'current-local-channel-video-membership'};}
export async function channelAiDays(reader:Reader,id:number,q:Query={},identity?:ChannelIdentity){
 const c=identity??await readChannelIdentity(reader,id),source=await selectedDaily(reader,id,q),topics=source.rows.flatMap(r=>channelTopics(r.result_json).map((topic,index)=>({source:r,topic,index}))).filter(t=>t.topic.title),refs=await references(reader,id,topics);
 const columns:ReportColumn[]=[{key:'date',label:'日期',kind:'date'},{key:'title',label:'議題'},{key:'description',label:'描述'},{key:'category',label:'分類'},{key:'angle',label:'角度'},{key:'camp',label:'陣營描述'},{key:'people',label:'人物'},{key:'keywords',label:'關鍵字'},{key:'places',label:'地名'},{key:'videos',label:'影片引用',kind:'number'},{key:'source',label:'來源'}];
 return {...table(text(c.title)+' AI 重點整理',columns,topics.map(t=>({date:text(t.source.date_from).slice(0,10),title:t.topic.title,description:t.topic.description,category:t.topic.category,angle:t.topic.angle,camp:t.topic.camp,people:t.topic.people.join('、'),keywords:t.topic.keywords.join('、'),places:t.topic.places.join('、'),videos:t.topic.videos.length,source:link(`#${t.source.pk}`,sourceLink(id,t.source))})),q,{updatedAt:latest(...source.rows.flatMap(r=>[r.mtime,r.ctime])),sections:[sourceSection(id,source.rows),refSection(refs.rows)],metrics:[{label:'已觀測分析日期',value:new Set(source.rows.map(r=>text(r.date_from).slice(0,10))).size,unit:'天'},{label:'來源缺漏引用',value:refs.unresolved,unit:'部'},{label:'暫不呈現分析',value:source.withheld+source.diverged+source.malformed,unit:'筆'}],notes:[...notes,'每日預設在最近 90 筆候選期間內尋找最近可呈現的分析日期，略過尚未發布或無法解析的結果；搜尋是否截斷見 coverage。oneday 與 todate 同日起點取最新紀錄；days 可展開最多 90 天。週報取最新儲存的 week 紀錄，不把日報推算成週報。']}),period:{from:source.from,to:source.to},evidenceCoverage:coverage(source,source.dates,refs)};
}
export async function channelAiOverview(reader:Reader,id:number,q:Query={},identity?:ChannelIdentity){
 const v=input(q);if(q.date!==undefined||q.days!==undefined||q.type!==undefined)return channelAiDays(reader,id,q,identity);
 const c=identity??await readChannelIdentity(reader,id),raw=v.pk?await reader.rows(sql`SELECT ${fields} FROM urt_channel_ai a WHERE a.pk=${v.pk} AND a.u_id=${id} AND a.data_type IN('topic','people','aspect') AND a.del_flag IS NULL LIMIT 1`):await reader.rows(sql`SELECT ${fields} FROM urt_channel_ai a WHERE a.pk IN(SELECT MAX(pk) FROM urt_channel_ai WHERE u_id=${id} AND data_type IN('topic','people','aspect') AND del_flag IS NULL AND LENGTH(result_json)>10 GROUP BY data_type) ORDER BY a.data_type`);
 if(v.pk&&!raw.length)throw new NotFound();if(v.pk)await markCitation(reader,raw[0]!,true);const source=await publishedChannelAi(reader,raw),topicRows:Cells[]=[],peopleRows:Cells[]=[],aspectRows:Cells[]=[];
 for(const r of source.rows){const cite=link(`#${r.pk}`,sourceLink(id,r));
  if(r.data_type==='topic')for(const row of overviewItems(r.result_json,['topics','discussion_topics','討論主題','events','事件'])){const title=channelText(row,['標題','事件','議題','topic','title']);if(title)topicRows.push({title,description:channelText(row,['內容','描述','content','description']),strength:channelText(row,['強弱','strength','intensity']),source:cite});}
  if(r.data_type==='people')for(const row of overviewItems(r.result_json,['persons','figures','people','personalities','人物'])){const name=channelText(row,['人名','name']),number=storedNumber(row['分數']??row.score);if(name)peopleRows.push({name,role:channelText(row,['角色','role']),description:channelText(row,['內容','content']),evaluation:channelText(row,['評價','正負面評價','evaluation','sentiment']),score:number,source:cite});}
  if(r.data_type==='aspect')for(const row of overviewAspects(r.result_json))aspectRows.push({...row,source:cite});
 }
 const have=new Set(source.rows.map(r=>r.data_type));
 return {...table(text(c.title)+' AI 分析總覽',[{key:'title',label:'議題'},{key:'description',label:'內容'},{key:'strength',label:'強弱描述'},{key:'source',label:'來源'}],topicRows,q,{updatedAt:latest(...source.rows.flatMap(r=>[r.mtime,r.ctime])),sections:[{key:'people',title:'既有人物分析',columns:[{key:'name',label:'人物'},{key:'role',label:'角色'},{key:'description',label:'內容'},{key:'evaluation',label:'評價描述'},{key:'score',label:'模型分數',kind:'number'},{key:'source',label:'來源'}],rows:peopleRows},{key:'aspects',title:'既有觀點描述',columns:[{key:'group',label:'面向'},{key:'item',label:'項目'},{key:'description',label:'描述'},{key:'preference',label:'模型偏好分數',kind:'number'},{key:'source',label:'來源'}],rows:aspectRows},sourceSection(id,source.rows),{key:'reports',title:'延伸報表',columns:[{key:'report',label:'報表'}],rows:[{report:link('每日重點整理',`/channels/${id}/ai/days`)},{report:link('人物逐日分布',`/channels/${id}/people`)},{report:link('唯讀提示預覽',`/channels/${id}/prompt`)}]}],metrics:[{label:'議題分析',value:have.has('topic')?1:0,unit:'筆'},{label:'人物分析',value:have.has('people')?1:0,unit:'筆'},{label:'觀點分析',value:have.has('aspect')?1:0,unit:'筆'},{label:'暫不呈現分析',value:source.withheld+source.diverged+source.malformed,unit:'筆'}],notes:[...notes,'各面向獨立選取最新非刪除、結果長度大於 10 位元組的儲存紀錄，分析期間可能不同；最新紀錄未發布、與已發布內容不同或無法解析時會註記，且不退回舊修訂版。空表表示沒有可呈現的既有輸出，不會以日報冒充總覽分析。']}),evidenceCoverage:{status:'available',reason:null,sourceRows:source.rows.length,withheldSources:source.withheld,divergedSources:source.diverged,malformedSources:source.malformed,topicAvailable:have.has('topic'),peopleAvailable:have.has('people'),aspectAvailable:have.has('aspect'),topicItems:topicRows.length,peopleItems:peopleRows.length,aspectItems:aspectRows.length}};
}
export async function channelPeople(reader:Reader,id:number,q:Query={},identity?:ChannelIdentity){
 const c=identity??await readChannelIdentity(reader,id),limit=bounded(q.limit,10,1,30),source=await selectedDaily(reader,id,q,true),topics=source.rows.flatMap(r=>channelTopics(r.result_json).map((topic,index)=>({source:r,topic,index}))),refs=await references(reader,id,topics);
 const people=new Map<string,{name:string;topics:number;videos:number;unreferencedTopics:number;dates:Map<string,number>;topicDates:Map<string,number>}>();
 for(const t of topics)for(const name of t.topic.people){if(excludedChannelPeople.has(name))continue;const person=people.get(name)??{name,topics:0,videos:0,unreferencedTopics:0,dates:new Map(),topicDates:new Map()},date=text(t.source.date_from).slice(0,10);person.topics++;person.videos+=t.topic.videos.length;if(!t.topic.videos.length)person.unreferencedTopics++;person.dates.set(date,(person.dates.get(date)??0)+t.topic.videos.length);person.topicDates.set(date,(person.topicDates.get(date)??0)+1);people.set(name,person);}
 const ranked=[...people.values()].sort((a,b)=>b.topics-a.topics||b.videos-a.videos||a.name.localeCompare(b.name)),offset=page(q).offset,selected=ranked.slice(offset,offset+limit),observed=new Set(source.rows.map(r=>text(r.date_from).slice(0,10)));
 const reasonLabels={pending:'分析尚未發布',diverged:'分析與已發布紀錄不同',malformed:'既有分析格式無法解析'},reasons=(date:string)=>(['pending','diverged','malformed'] as const).filter(code=>(code==='pending'?source.withheldDates:code==='diverged'?source.divergedDates:source.malformedDates).includes(date));
 const unavailable=(date:string)=>reasons(date).map(code=>reasonLabels[code]).join('；')||null;
 const sourceAvailability=source.dates.map(date=>({date,status:observed.has(date)?reasons(date).length?'partial':'observed':reasons(date)[0]??'missing',reasons:reasons(date),label:unavailable(date)??(observed.has(date)?'有分析':'沒有分析紀錄')}));
 const matrix:Section={key:'people-matrix',title:'人物逐日影片引用矩陣',columns:[{key:'date',label:'日期',kind:'date'},...selected.map((p,i)=>({key:'person_'+i,label:p.name,kind:'number' as const}))],rows:source.dates.map(date=>({date,...Object.fromEntries(selected.map((p,i)=>['person_'+i,observed.has(date)?{value:p.dates.get(date)??0,detail:`${p.topicDates.get(date)??0} 個議題提及；${p.dates.get(date)??0} 部影片引用${unavailable(date)?'；部分'+unavailable(date):''}`}:(unavailable(date)?{value:null,detail:unavailable(date)!}:null)]))}))};
 return {...table(text(c.title)+' 人物提及排行',[{key:'name',label:'人物'},{key:'topics',label:'議題引用',kind:'number'},{key:'videos',label:'影片引用',kind:'number'},{key:'unreferencedTopics',label:'未附影片的議題',kind:'number'}],ranked.map(({dates,topicDates,...r})=>r),{...q,limit:String(limit)},{updatedAt:latest(...source.rows.flatMap(r=>[r.mtime,r.ctime])),sections:[matrix,sourceSection(id,source.rows),refSection(refs.rows)],words:selected.map(p=>({term:p.name,weight:p.topics})),metrics:[{label:'有分析日期',value:observed.size,unit:'天'},{label:'沒有可顯示分析日期',value:source.dates.length-observed.size,unit:'天'},{label:'來源缺漏引用',value:refs.unresolved,unit:'部'},{label:'暫不呈現分析',value:source.withheld+source.diverged+source.malformed,unit:'筆'}],notes:[...notes,'沿用原報表的 31 項主持人、來賓與泛稱排除名單；僅統計 oneday，每個完整起訖期間取最新非刪除紀錄。','同部影片跨議題可重複引用；無影片引用的議題計入議題數，但不憑空補一部影片。缺少分析的日期顯示空值，0 表示當日有分析但沒有該人物的影片引用，仍可能有未附影片的議題提及；每格另列議題數。']}),period:{from:source.from,to:source.to},sourceAvailability,evidenceCoverage:coverage(source,source.dates,refs)};
}

/** Profile enrichment failures must not erase the independently usable channel/video core. */
export async function optionalChannelAi(reader:Reader,id:number,kind:'overview'|'daily'){
 try{return await (kind==='overview'?channelAiOverview(reader,id):channelAiDays(reader,id));}
 catch(error){
  if(!(error instanceof ChannelAiBoundError)&&!(error instanceof MissingChannelAiSidecar))throw error;
  const status=error instanceof ChannelAiBoundError?'bounded':'unavailable';
  return {...table(kind==='overview'?'AI 分析總覽':'AI 重點整理',[],[],{}, {notes:[status==='bounded'?'AI 區塊超過本次可呈現範圍；頻道基本資料與影片仍可瀏覽。':'AI 發布紀錄尚未配置，暫不呈現此區塊；頻道基本資料與影片仍可瀏覽。']}),evidenceCoverage:{status,reason:status==='bounded'?'channel-ai-read-bound':'missing-publication-sidecar',sourceRows:null,withheldSources:null,divergedSources:null,malformedSources:null,...(kind==='overview'?{topicAvailable:null,peopleAvailable:null,aspectAvailable:null,topicItems:null,peopleItems:null,aspectItems:null}:{unavailableDays:null,newerUnavailableSources:null,anchorSearchTruncated:null,requestedDays:null,observedDays:null,referencedVideos:null,resolvedVideos:null,unresolvedVideos:null,invalidReferences:null,referenceScope:'current-local-channel-video-membership'})}};
 }
}
