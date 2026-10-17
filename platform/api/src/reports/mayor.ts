import {sql} from 'drizzle-orm';
import type {Reader,Row} from '../db/client.js';
import {publishedTagCache,cacheLineageNote,cacheWindowNotes} from './cache-lineage.js';
import {ReportReadBound} from './cache-weights.js';
import {BadQuery,NotFound,bounded,dateFilter,type Query} from './query.js';
import {text,latest,taipeiDate} from './normalize.js';
import {table,range,type Register} from './table.js';
import {cities} from './city-definitions.js';
export const MAYOR_TAGS=['3','4','5','6'] as const;
const TAGS=MAYOR_TAGS,MAX_BYTES=131072,TOTAL_BYTES=8*1024*1024;
export const MAYOR_METRICS={tags_views:'觀看引用',tags_video:'影片引用',tags_result:'重要度'} as const;
const METRICS=MAYOR_METRICS;
export type MayorMetric=keyof typeof METRICS;
type Metric=MayorMetric;
const aliases:Record<string,Metric>={tags_view:'tags_views',views:'tags_views',videos:'tags_video',result:'tags_result'};
const shift=(date:string,days:number)=>new Date(Date.parse(date)+days*86400000).toISOString().slice(0,10);
export function mayorMetric(value:unknown):Metric{
 const key=text(value)||'tags_views',normalized=Object.hasOwn(aliases,key)?aliases[key]!:key;
 if(!Object.hasOwn(METRICS,normalized))throw new BadQuery('Unknown mayor metric.');return normalized as Metric;
}
export function mayorPeriod(input:Query,clock:()=>Date,latestDate?:string){
 const q={...input};for(const key of ['from','to'])if(typeof q[key]==='string'&&!String(q[key]).trim())delete q[key];if(q.today==='')q.today='0';
 const days=bounded(q.days,30,1,366),today=bounded(q.today,0,0,3650),explicit=q.from!==undefined||q.to!==undefined||q.today!==undefined;
 const to=q.to??(q.from!==undefined||q.today!==undefined?shift(taipeiDate(clock()),-today):latestDate??shift(taipeiDate(clock()),-1));
 return {...range({...q,days:String(days),to},clock,30),explicit,days,today};
}
const selection=sql`tagid IN ('3','4','5','6') AND COALESCE(tag_or,'')='' AND COALESCE(tag_not,'')=''`;
/** Mayor's Laravel contract is a flat exact-key numeric map, not nested term envelopes. */
export function mayorWeights(payload:unknown){
 if(typeof payload!=='string'||!payload.trim()||payload.trim()==='null')return null;
 let value:unknown;try{value=JSON.parse(payload);}catch{return null;}
 if(!value||typeof value!=='object'||Array.isArray(value))return null;
 const entries=Object.entries(value);if(entries.length>20000)throw new ReportReadBound('Mayor term count exceeds read budget.');
 const words=new Map<string,number>();let numeric=0;
 for(const[key,raw]of entries){if(typeof raw!=='number'&&!(typeof raw==='string'&&/^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(raw.trim())))continue;const n=Number(raw);if(!Number.isFinite(n)||Math.abs(n)>Number.MAX_SAFE_INTEGER)throw new ReportReadBound('Mayor weight exceeds numeric precision.');if(key.length>1000)throw new ReportReadBound('Mayor term exceeds read budget.');numeric++;if(n>0)words.set(key,n);}
 return entries.length&&!numeric?null:words;
}
const lineageIdentity=(row:Row)=>JSON.stringify([row._cacheLineage??null,row._cacheWindow??null]);
export const mayorReadBudget=()=>({remaining:TOTAL_BYTES});
/** Shared city/person reader: exact date interval, newest revision and bounded verified bodies. */
export async function readMayorBuckets(reader:Reader,from:string,to:string,metric:Metric,budget=mayorReadBudget()){
 dateFilter(from);dateFilter(to);if(from>to||Date.parse(to)-Date.parse(from)>371*86400000)throw new BadQuery('Mayor source interval exceeds372days.');
 const column=sql.identifier(metric);
 // Select newest revisions and budget metadata before transferring JSON.
 const metadata=await reader.rows(sql`SELECT a.pk,a.ctime,a.mtime,a.the_date,a.tagid,OCTET_LENGTH(${column}) AS payload_bytes,SHA2(${column},256) AS payload_hash FROM urt_show_tag_date a WHERE ${selection} AND the_date BETWEEN ${from} AND ${to} AND pk=(SELECT MAX(b.pk) FROM urt_show_tag_date b WHERE b.the_date=a.the_date AND b.tagid=a.tagid AND COALESCE(b.tag_or,'')='' AND COALESCE(b.tag_not,'')='') ORDER BY the_date,tagid LIMIT 1489`);
 if(metadata.length>1488)throw new ReportReadBound('Mayor cache exceeds372days by4categories.');
 const indexed=new Map(metadata.map(r=>[text(r.the_date).slice(0,10)+'|'+text(r.tagid),r])),allDates:string[]=[];
 for(let day=from;day<=to;day=shift(day,1))allDates.push(day);
 const candidates=TAGS.map(tagid=>allDates.map(the_date=>indexed.get(the_date+'|'+tagid)??{the_date,tagid}));
 const visible=(await Promise.all(TAGS.map((tagid,i)=>publishedTagCache(reader,candidates[i]!,{tagid})))).flat(),withheld=candidates.flat().length-visible.length;
 const accepted=visible.filter(r=>r.pk!==undefined&&Number(r.payload_bytes)>0&&Number(r.payload_bytes)<=MAX_BYTES);
 const bytes=accepted.reduce((n,r)=>n+Number(r.payload_bytes),0);if(bytes>budget.remaining)throw new ReportReadBound('Mayor cache exceeds8MiB read budget.');budget.remaining-=bytes;
 const bodies=accepted.length?await reader.rows(sql`SELECT a.pk,a.ctime,a.mtime,a.the_date,a.tagid,${column} AS payload FROM urt_show_tag_date a WHERE ${selection} AND (${sql.join(accepted.map(r=>sql`(pk=${r.pk} AND a.the_date=${r.the_date} AND BINARY a.tagid=BINARY ${r.tagid} AND OCTET_LENGTH(${column})=${r.payload_bytes} AND SHA2(${column},256)=${r.payload_hash} AND mtime <=> ${r.mtime} AND ctime <=> ${r.ctime})`),sql` OR `)}) AND pk=(SELECT MAX(b.pk) FROM urt_show_tag_date b WHERE b.the_date=a.the_date AND b.tagid=a.tagid AND COALESCE(b.tag_or,'')='' AND COALESCE(b.tag_not,'')='')`):[];
 const published=(await Promise.all(TAGS.map(tagid=>publishedTagCache(reader,bodies.filter(r=>text(r.tagid)===tagid),{tagid})))).flat();
 const before=new Map(accepted.map(r=>[String(r.pk),lineageIdentity(r)])),stable=published.filter(r=>before.get(String(r.pk))===lineageIdentity(r));
 const records:Row[]=[],byDate=new Map<string,Map<string,Map<string,number>>>();let malformed=0;
 for(const r of stable){const decoded=mayorWeights(r.payload);if(decoded===null){malformed++;continue;}const date=text(r.the_date).slice(0,10),tags=byDate.get(date)??new Map();tags.set(text(r.tagid),decoded);byDate.set(date,tags);records.push(r);}
 return{records,byDate,coverage:{expectedBuckets:allDates.length*4,observedBuckets:records.length,missingBuckets:visible.filter(r=>r.pk===undefined).length,withheldBuckets:withheld+bodies.length-published.length,oversizedBuckets:visible.filter(r=>Number(r.payload_bytes)>MAX_BYTES).length,emptyPayloadBuckets:visible.filter(r=>r.pk!==undefined&&!Number(r.payload_bytes)).length,malformedBuckets:malformed,changedBuckets:accepted.length-bodies.length+published.length-stable.length}};
}
export type MayorBuckets=Awaited<ReturnType<typeof readMayorBuckets>>;
const readBuckets=(reader:Reader,period:ReturnType<typeof mayorPeriod>,metric:Metric)=>readMayorBuckets(reader,shift(period.from,-6),period.to,metric);
export function mayorObservations(dates:string[],candidates:string[],source:Pick<MayorBuckets,'byDate'>){
 return dates.map(date=>{const row:Record<string,string|number|null>={date,observedBuckets:0},buckets:Map<string,number>[]=[];for(let i=0;i<7;i++)buckets.push(...(source.byDate.get(shift(date,-i))?.values()??[]));row.observedBuckets=buckets.length;let total=0;
 for(const candidate of candidates){const value=buckets.reduce((sum,bucket)=>sum+(bucket.get(candidate)??0),0);if(!Number.isFinite(value)||value>Number.MAX_SAFE_INTEGER)throw new ReportReadBound('Mayor sum exceeds numeric precision.');row[candidate]=buckets.length?value:null;total+=value;}
 if(!Number.isFinite(total)||total>Number.MAX_SAFE_INTEGER)throw new ReportReadBound('Mayor total exceeds numeric precision.');row.total=buckets.length?total:null;
 for(const candidate of candidates)row[`${candidate}：占比`]=buckets.length?(total>0.000001?Number(row[candidate])/total*100:0):null;return row;});
}
export function registerMayor(register:Register,reader:Reader,clock:()=>Date){
 const report=async(inputKey:string,q:Query)=>{const key=inputKey.trim().toLowerCase(),city=Object.hasOwn(cities,key)?cities[key]:undefined;if(!city)throw new NotFound();
 const now=clock(),requestClock=()=>now,candidates=Object.keys(city.candidates),requestedMetric=mayorMetric(q.type);
 let period=mayorPeriod(q,requestClock),metric=requestedMetric,source=await readBuckets(reader,period,metric),rows=mayorObservations(period.dates,candidates,source),fallbackDate:string|null=null;
 const hasData=()=>rows.some(row=>candidates.some(candidate=>Number(row[candidate])>0.000001));
 if(!hasData()&&!period.explicit){const newest=(await reader.rows(sql`SELECT MAX(the_date) AS latest_date FROM urt_show_tag_date WHERE ${selection} AND ${sql.identifier(metric)} IS NOT NULL`))[0],date=text(newest?.latest_date).slice(0,10);if(/^\d{4}-\d{2}-\d{2}$/.test(date)&&date!==period.to){period=mayorPeriod(q,requestClock,date);source=await readBuckets(reader,period,metric);rows=mayorObservations(period.dates,candidates,source);fallbackDate=date;}}
 if(!hasData()&&!text(q.type)&&metric==='tags_views'){const alternative=await readBuckets(reader,period,'tags_video'),alternativeRows=mayorObservations(period.dates,candidates,alternative);if(alternativeRows.some(row=>candidates.some(candidate=>Number(row[candidate])>0.000001))){metric='tags_video';source=alternative;rows=alternativeRows;}}
 const incomplete=rows.filter(row=>Number(row.observedBuckets)<28).length;
 return{...table(city.label+'人物提及觀測',[{key:'date',label:'日期',kind:'date'},...candidates.flatMap(c=>[{key:c,label:c,kind:'number' as const},{key:`${c}：占比`,label:`${c} 占比 %`,kind:'number' as const}]),{key:'observedBuckets',label:'已觀測分類日桶',kind:'number'}],rows,q,{
 updatedAt:latest(...source.records.flatMap(r=>[r.mtime,r.ctime])),series:candidates.map(c=>({name:c,unit:METRICS[metric],points:rows.map(r=>({time:String(r.date),value:r[c] as number|null}))})),
 filters:[{key:'type',label:'觀測度量',type:'select',value:metric,options:Object.entries(METRICS).map(([value,label])=>({value,label}))},{key:'from',label:'開始日期',type:'date',value:period.from},{key:'to',label:'結束日期',type:'date',value:period.to},{key:'days',label:'預設天數',type:'number',value:String(period.days)},{key:'today',label:'回溯天數',type:'number',value:q.today===undefined?'':String(period.today)}],
 notes:[cacheLineageNote,...cacheWindowNotes(source.records),'人物名單沿用 2026-05-28 維護版本，不代表最新提名狀態。','顯示四類頻道的七日原始提及量，分類可重疊；這不是支持度、民調或不重複觀眾。占比為該人物的原始量除以名單中所有人物的原始量；沿用目前 Laravel 計算，不套用政治立場權重。',`觀測期間 ${period.from}～${period.to}；${incomplete} 個日期未具備完整 28 個分類日桶。快取缺值、無效或發布暫停均保留空缺。`,...(fallbackDate?[`預設期間無人物提及，改用最新快取日期 ${fallbackDate}。`]:[]),...(metric!==requestedMetric?['觀看引用缺少人物提及，依原報表改用影片引用；度量已同步更新。']:[])]
 }),evidenceCoverage:{...source.coverage,from:period.from,to:period.to,metric,requestedMetric,fallbackDate,partialWindowDates:incomplete,dataAvailable:hasData()}};
 };
 register('/mayor',(_p,q)=>report(text(q.city)||'taipei',q));register('/mayor/cities/:city',(p,q)=>report(p.city,q));
}
