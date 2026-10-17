import {readVideoChannels,sourceLabelLookup} from './channel-sources.js';
import {aiOutputFields,topicOutputFields,aiPublication,topicPublication,publicationVisible,publicationBudget,publicationCoverage,publicationNote,type Publication} from './ai-publication.js';
import { dailyTopicTitle } from '../../../shared/daily-topic-title.js';
import { sql } from 'drizzle-orm';
import type { Reader, Row } from '../db/client.js';
import type { ReportData, ReportCell, ReportValue } from '../report-contracts.js';
import { BadQuery, dateFilter, page, type Query } from './query.js';
import { aiItems, object, pickText, pickStrings, text, integer, latest, timestamp, taipeiDate } from './normalize.js';
import { table, range, link, type Register } from './table.js';
import {decodeHourlyTopics} from './hourly-json.js';
type Cells=Record<string,ReportValue|ReportCell>;
const TOPICS=200,REFS=10000;
function filter(value:unknown,fallback:string){if(value===undefined||value==='')return fallback;if(typeof value!=='string'||!/^[A-Za-z0-9_-]{1,40}$/.test(value))throw new BadQuery('Invalid AI report filter.');return value;}
function options(q:Query){page(q);return {condition:filter(q.condition,'all'),type:filter(q.type,'')};}
const baseFilters=(c:string,type:string):NonNullable<ReportData['filters']>=>[{key:'condition',label:'來源範圍',type:'text',value:c},{key:'type',label:'分析資料類型',type:'text',value:type}];
const title=(r:Row)=>pickText(r,['事件','議題','標題','event','topic','title']);
const mediaCount=(v:unknown)=>v&&typeof v==='object'?Object.keys(v).length:null;
const count=(v:unknown)=>{const n=integer(v);return n!==null&&n>=0?n:null;};
function ranked(value:unknown,exclude:Set<string>=new Set()){return Object.entries(object(value)).map(([key,v])=>[key,count(v)] as const).filter((entry):entry is readonly[string,number]=>entry[1]!==null&&!exclude.has(entry[0])).sort((a,b)=>b[1]-a[1]);}
export function hourlyTopics(value:unknown):Row[]{
 return decodeHourlyTopics(value,true).topics;
}
// Laravel AiPeriodReport (tag pre-ts-cutover-2026-10-11) values for its 期間事件 table: PHP (int)
// casts, numericMap() keeps is_numeric values under string keys (PHP turns "123" keys into ints),
// arsort() is stable, missing statistics become 0 / ''.
const phpInt=(v:unknown):number=>{const n=typeof v==='boolean'?+v:typeof v==='number'?v:typeof v==='string'?Number(/^\s*[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/.exec(v)?.[0]??0):v&&typeof v==='object'?+(Object.keys(v).length>0):0,t=Math.trunc(n);return Number.isSafeInteger(t)?t:0;};
const phpNumeric=(v:unknown)=>typeof v==='number'?Number.isFinite(v):typeof v==='string'&&/^\s*[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?\s*$/.test(v);
const phpIntKey=(k:string)=>/^(?:0|-?[1-9]\d{0,18})$/.test(k)&&BigInt(k)<=9223372036854775807n&&BigInt(k)>=-9223372036854775808n;
const numericMap=(v:unknown)=>new Map(v&&typeof v==='object'&&!Array.isArray(v)?Object.entries(v).filter(([k,n])=>!phpIntKey(k)&&phpNumeric(n)).map(([k,n])=>[k,phpInt(n)] as const):[]);
const top=(m:Map<string,number>)=>[...m].sort((a,b)=>b[1]-a[1])[0];
const sum=(values:Iterable<number>)=>{let n=0;for(const v of values)n+=v;return Number.isSafeInteger(n)?n:0;};
export function legacyPeriodStats(s:Row){
 const people=numericMap(s['人物']);people.delete('無');const keywords=numericMap(s['關鍵字']);for(const name of people.keys())keywords.delete(name);
 const person=top(people),keyword=top(keywords);
 return {legacyMediaCount:phpInt(s['媒體數']),legacyVideoCount:phpInt(s['影片數']),legacyKeywordCount:sum(numericMap(s['關鍵字次數']).values()),legacyTopPerson:person?.[0]??'',legacyTopPersonCount:person?.[1]??0,legacyTopKeyword:keyword?.[0]??'',legacyTopKeywordCount:keyword?.[1]??0};
}
/** Raw daily topic without a summary: Laravel counted the 媒體事件 channel entries and summed their event lists as 影片數. */
export function legacyRawStats(t:Row){
 const media=t['媒體事件']??t.media_events??t.mediaEvents,lists=media&&typeof media==='object'?Object.values(media):[];
 return {legacyMediaCount:lists.length,legacyVideoCount:sum(lists.map(v=>v&&typeof v==='object'?Object.keys(v).length:0)),legacyKeywordCount:0,legacyTopPerson:'',legacyTopPersonCount:0,legacyTopKeyword:'',legacyTopKeywordCount:0};
}
export function periodTopics(record:Row):Cells[]{
 const cached=object(record.data_json),date=text(record.date_from).slice(0,10),sourceId=integer(record.pk);
 const values=Object.keys(cached).length?Object.entries(cached).slice(0,TOPICS).map(([name,raw])=>{
  const s=object(raw),people=ranked(s['人物'],new Set(['無'])),keywords=ranked(s['關鍵字'],new Set(people.map(([name])=>name))),counts=ranked(s['關鍵字次數']);
  const sum=counts.reduce((n,[,v])=>n+v,0);
  return {name,channels:count(s['媒體數']),videos:count(s['影片數']),keywordCount:counts.length&&Number.isSafeInteger(sum)?sum:null,topPerson:people[0]?.[0]??null,topPersonCount:people[0]?.[1]??null,topKeyword:keywords[0]?.[0]??null,topKeywordCount:keywords[0]?.[1]??null,metricSource:'已儲存彙整統計',...legacyPeriodStats(s)};
 }):aiItems(record.result_json).slice(0,TOPICS).map(object).map(t=>({name:dailyTopicTitle(t),channels:mediaCount(t['媒體事件']??t.media_events??t.mediaEvents),videos:null,keywordCount:null,topPerson:null,topPersonCount:null,topKeyword:null,topKeywordCount:null,metricSource:'原始每日議題；未取得彙整統計',...legacyRawStats(t)}));
 return values.filter(v=>v.name.trim()).map(({name,...v})=>({date,event:sourceId?link(name,`/ai/days/${sourceId}/events?event=${encodeURIComponent(name)}`):name,...v,sourceId,dataType:text(record.data_type)}));
}
export function registerAiHistory(register:Register,reader:Reader,clock:()=>Date){
 register('/ai/hours',async(_p,q)=>{
  const {condition:c,type}=options(q),typeSql=type?sql`AND data_type=${type}`:sql``;
  const date=dateFilter(q.date)??text((await reader.rows(sql`SELECT MAX(date_from) AS at FROM urt_ai_hour WHERE del_flag IS NULL AND (condition_type=${c} OR (${c}='all' AND condition_type IS NULL)) ${typeSql}`))[0]?.at).slice(0,10);
  const records=date?await reader.rows(sql`SELECT pk,ctime,mtime,date_from,date_to,data_type,user_token,condition_type,${aiOutputFields} FROM urt_ai_hour WHERE pk IN(SELECT MAX(pk) FROM urt_ai_hour WHERE del_flag IS NULL AND date_from BETWEEN ${date+' 00:00:00'} AND ${date+' 23:59:59'} AND (condition_type=${c} OR (${c}='all' AND condition_type IS NULL)) ${typeSql} GROUP BY date_from,date_to,data_type) ORDER BY date_from DESC,pk DESC LIMIT 49`):[];
  const budget=publicationBudget(),checks:Publication[]=[],visible:Row[]=[];for(const r of records.slice(0,48)){const check=await aiPublication(reader,'ai.hourly',r,budget);checks.push(check);if(publicationVisible(check))visible.push(r);}
  const refsByTopic=new Map<string,Cells[]>(),namesByTopic=new Map<string,string[]>(),rows:Cells[]=[];let omittedTopics=0;
  const decoding={sourceRows:0,decodedSources:0,emptySources:0,malformedSources:0,unsupportedSources:0,oversizedSources:0,boundedSources:0,extractedLegacySources:0,invalidItems:0};
  const legacyIds=new Set(records.slice(0,48).filter((_r,index)=>checks[index]?.state==='legacy-unrecorded').map(r=>r.pk));
  for(const r of visible){const decoded=decodeHourlyTopics(r.result_json,legacyIds.has(r.pk));decoding.sourceRows++;decoding[`${decoded.state}Sources`]++;decoding.invalidItems+=decoded.invalidItems;if(decoded.extracted)decoding.extractedLegacySources++;
   const all=decoded.topics;omittedTopics+=Math.max(0,all.length-TOPICS);for(const [topicIndex,t]of all.slice(0,TOPICS).entries()){
   const name=title(t);if(!name)continue;const ids=pickStrings(t,['videoId','video_id','video_ids','videos']).filter(id=>/^[A-Za-z0-9_-]{11}$/.test(id)),sourceId=integer(r.pk),time=timestamp(r.date_from);
   rows.push({topicIndex,time,until:timestamp(r.date_to),event:name,summary:pickText(t,['描述','說明','description','content','摘要','summary']),channels:pickStrings(t,['媒體','media','channels']).join('、'),videos:ids.length,sourceId,dataType:text(r.data_type),category:pickText(t,['分類','類型','category','type']),angle:pickText(t,['角度','angle']),camp:pickText(t,['陣營','camp','stance']),keywords:pickStrings(t,['關鍵字','keywords']).join('、'),people:pickStrings(t,['人物','people']).join('、'),places:pickStrings(t,['地名','places']).join('、')});
   namesByTopic.set(`${sourceId}:${topicIndex}`,pickStrings(t,['媒體','media','channels']));
   refsByTopic.set(`${sourceId}:${topicIndex}`,ids.map(id=>({topicIndex,time,event:name,video:link(id,`/videos/${encodeURIComponent(id)}`),sourceId})));
  }}
  const result=table('每小時 AI 議題',[{key:'time',label:'開始',kind:'datetime'},{key:'until',label:'結束',kind:'datetime'},{key:'event',label:'議題'},{key:'summary',label:'摘要'},{key:'category',label:'分類'},{key:'angle',label:'角度'},{key:'camp',label:'AI 陣營標記'},{key:'keywords',label:'關鍵字'},{key:'people',label:'人物'},{key:'places',label:'地名'},{key:'channels',label:'頻道'},{key:'videos',label:'影片引用',kind:'number'},{key:'sourceId',label:'分析編號',kind:'number'},{key:'dataType',label:'資料類型'}],rows,q,{updatedAt:latest(...visible.flatMap(r=>[r.mtime,r.ctime])),filters:[{key:'date',label:'日期',type:'date',value:date},...baseFilters(c,type)],notes:[publicationNote,'每個時段／資料類型保留最新有效分析；缺少的時段不補資料。','分類、角度、陣營、人物與摘要均為儲存的 AI 判讀，請搭配來源影片驗證。',`最多讀取 48 個時段，每時段 ${TOPICS} 個議題；${records.length>48?'另有更多時段未顯示。':''}另有 ${omittedTopics} 個超限議題未顯示。`]});
  const references=result.rows.flatMap(r=>refsByTopic.get(`${r.sourceId}:${r.topicIndex}`)??[]);const displayReferences=references.slice(0,REFS),sourceIds=displayReferences.map(r=>String((r.video as ReportCell).href??'').split('/').at(-1)!),sourceChannels=await readVideoChannels(reader,sourceIds).catch(()=>new Map());
  for(const r of result.rows){const refs=refsByTopic.get(`${r.sourceId}:${r.topicIndex}`)??[],explicit=refs.flatMap(ref=>{const id=String((ref.video as ReportCell).href??'').split('/').at(-1)!,source=sourceChannels.get(id);return source?[source]:[];}),names=namesByTopic.get(`${r.sourceId}:${r.topicIndex}`)??[],sourceByLabel=sourceLabelLookup(explicit);r.channels={value:typeof r.channels==='string'?r.channels:'',sources:names.map(name=>sourceByLabel(name))};}
  for(const ref of displayReferences){const source=sourceChannels.get(String((ref.video as ReportCell).href??'').split('/').at(-1)!);ref.channel=source?{value:source.channelTitle,sources:[source]}:null;}
  result.notes!.push(`本頁最多顯示 ${REFS} 筆影片引用，另有 ${Math.max(0,references.length-REFS)} 筆未顯示。`,`歷史內容解析：${decoding.emptySources} 筆明確空議題、${decoding.malformedSources} 筆無法解析、${decoding.unsupportedSources} 筆不支援格式、${decoding.boundedSources+decoding.oversizedSources} 筆超出解析上限；${decoding.extractedLegacySources} 筆從舊版文字擷取 JSON。`);result.sections=[{title:'本頁議題的來源影片',columns:[{key:'time',label:'時段',kind:'datetime'},{key:'event',label:'議題'},{key:'video',label:'影片'},{key:'channel',label:'來源頻道'},{key:'sourceId',label:'分析編號',kind:'number'}],rows:displayReferences}];return {...result,evidenceCoverage:{...publicationCoverage(checks),decoding}};
 });
 register('/ai/periods',async(_p,q)=>{
  const {condition:c,type}=options(q);let query=q;const month=q.month;
  if(month!==undefined&&month!==''){if(typeof month!=='string'||!/^\d{4}-(?:0[1-9]|1[0-2])$/.test(month)||!dateFilter(month+'-01'))throw new BadQuery('Invalid month.');const d=new Date(month+'-01T00:00:00Z');d.setUTCMonth(d.getUTCMonth()+1);d.setUTCDate(0);query={...q,from:month+'-01',to:d.toISOString().slice(0,10)};}
  else if(q.to===undefined)query={...q,to:taipeiDate(new Date(+clock()-86400000))};
  const period=range(query,clock,8,62),typeSql=type?sql`AND data_type=${type}`:sql``;
  const records=await reader.rows(sql`SELECT pk,ctime,mtime,date_from,date_to,data_type,user_token,condition_type,${aiOutputFields},${topicOutputFields} FROM urt_ai_date WHERE pk IN(SELECT pk FROM (SELECT pk,ROW_NUMBER() OVER(PARTITION BY DATE(date_from) ORDER BY date_from DESC,pk DESC) AS row_rank FROM urt_ai_date WHERE del_flag IS NULL AND date_from BETWEEN ${period.from+' 00:00:00'} AND ${period.to+' 00:00:00'} AND (condition_type=${c} OR (${c}='all' AND condition_type IS NULL)) ${typeSql}) ranked_daily WHERE row_rank=1) ORDER BY date_from DESC,pk DESC LIMIT 62`);
  const budget=publicationBudget(),checks:Publication[]=[],cacheChecks:Publication[]=[],visible:Row[]=[];
  // Verify core daily outputs first so optional large topic snapshots cannot starve later days.
  for(const r of records)checks.push(await aiPublication(reader,'ai.daily',r,budget));
  for(const [index,r] of records.entries()){const check=checks[index]!;if(!publicationVisible(check))continue;const cache=await topicPublication(reader,r,check,budget);cacheChecks.push(cache);visible.push(publicationVisible(cache)?r:{...r,data_json:null});}
  const rows=visible.flatMap(periodTopics);
  const result=table('AI 議題期間彙整',[{key:'date',label:'日期',kind:'date'},{key:'event',label:'議題'},{key:'channels',label:'頻道數',kind:'number'},{key:'videos',label:'來源彙整影片數',kind:'number'},{key:'keywordCount',label:'關鍵字次數',kind:'number'},{key:'topPerson',label:'最多提及人物'},{key:'topPersonCount',label:'人物記錄數',kind:'number'},{key:'topKeyword',label:'最多提及關鍵字'},{key:'topKeywordCount',label:'關鍵字記錄數',kind:'number'},{key:'metricSource',label:'數據來源'},{key:'sourceId',label:'每日資料編號',kind:'number'},{key:'dataType',label:'資料類型'},{key:'legacyMediaCount',label:'期間表媒體事件數',kind:'number'},{key:'legacyVideoCount',label:'期間表影片數',kind:'number'},{key:'legacyKeywordCount',label:'期間表關鍵字數',kind:'number'},{key:'legacyTopPerson',label:'期間表最重要人'},{key:'legacyTopPersonCount',label:'期間表最重要人次數',kind:'number'},{key:'legacyTopKeyword',label:'期間表最重要事'},{key:'legacyTopKeywordCount',label:'期間表最重要事次數',kind:'number'}],rows,q,{updatedAt:latest(...visible.flatMap(r=>[r.mtime,r.ctime])),filters:[{key:'from',label:'起日',type:'date',value:period.from},{key:'to',label:'迄日',type:'date',value:period.to},{key:'month',label:'整月（YYYY-MM，優先於日期）',type:'text',value:text(month)},...baseFilters(c,type)],notes:[publicationNote,'快照總讀取預算為 16 MiB，彙整只核對最近 8 次發布；超出時無法判定現有內容是否匹配更早修訂或已經被改寫。讀取上限與預算不足另列 coverage。','每日議題與彙整統計分別核對發布紀錄；彙整尚未發布或不符來源時，保留原始議題並將缺漏統計留空。','每一天保留篩選條件下最新的有效彙整；跨日同名事件不推定為相同事件。','最多提及人物與關鍵字等統計欄只讀取已儲存的彙整結果；沒有來源統計時留空，不推算成零（「期間表」欄位例外，見下）。','來源彙整影片數是當時彙整所記錄的數值，來源事件引用數不冒充不重複影片數。原始議題的頻道數計算來源列出的頻道項目，可能包含尚無事件內容的項目。','「期間表」欄位重現舊版期間報表的顯示值：有彙整統計時取彙整數值，缺值記 0；只有原始每日議題時，媒體事件數是列出的頻道項目數，影片數是各頻道媒體事件筆數的加總（事件引用數，不是不重複影片數），關鍵字數與次數記 0、人物與關鍵字名稱留空。',`日期範圍 ${period.from} 至 ${period.to}，最多 62 天，每日最多 ${TOPICS} 個議題。`]});
  return {...result,evidenceCoverage:{...publicationCoverage(checks),topicCache:publicationCoverage(cacheChecks)}};
 });
}
