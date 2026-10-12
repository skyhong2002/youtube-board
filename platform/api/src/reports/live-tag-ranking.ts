import {sql} from 'drizzle-orm';
import {DataQueryFailed,type Reader,type Row} from '../db/client.js';
import {BadQuery,bounded,dateFilter,idList,page,type Query} from './query.js';
import {integer,latest,taipeiDate,text} from './normalize.js';
import {cacheFilters,link,type Register} from './table.js';
import {publishedLiveTagCache,cacheLineageNote,cacheWindowNotes} from './cache-lineage.js';
import {ReportReadBound} from './cache-weights.js';
import {reportStopwords,stopwordNote} from './stopwords.js';

const DAY=86400000;
export const LIVE_TAG_LIMITS={dates:91,dayBytes:1024*1024,totalBytes:16*1024*1024,termsPerDay:5000,termDays:200000,distinctTerms:10000,termBytes:1024,hoursPerTerm:48} as const;
type Metric='tags_result'|'tags_views'|'tags_video';
type State='missing'|'withheld'|'malformed'|'oversized'|'budget-exhausted'|'changed'|'term-budget-exhausted'|'observed';
const shift=(date:string,days:number)=>new Date(Date.parse(date)+days*DAY).toISOString().slice(0,10);
const dict=(value:unknown):value is Record<string,unknown>=>value!==null&&typeof value==='object'&&!Array.isArray(value);
function optionalScalar(value:unknown,label:string){if(value===undefined||value==='')return undefined;if(typeof value!=='string')throw new BadQuery('Invalid '+label);return value;}
export function liveTagOptions(query:Query){
 const q={...query};
 for(const key of Object.keys(q))if(!['tagid','or','not','type','from','to','days','today','limit','offset'].includes(key))throw new BadQuery('Unsupported live tag query.');
 for(const key of ['type','from','to','days','today','limit','offset'])q[key]=optionalScalar(q[key],key);
 for(const key of ['tagid','or','not'])q[key]=idList(q[key]).sort((a,b)=>a-b).join(',');
 const type=q.type??'tags_result';if(!['tags_result','tags_views','tags_video'].includes(type as string))throw new BadQuery('Unknown live metric.');
 const days=bounded(q.days,7,1,90),today=bounded(q.today,0,0,365),paging=page({...q,limit:q.limit??'100'});
 const from=dateFilter(q.from),to=dateFilter(q.to);
 if(from&&to&&(from>to||Date.parse(to)-Date.parse(from)>90*DAY))throw new BadQuery('Live tag dates must be ordered and at most 91 dates.');
 return {q,type:type as Metric,metric:type==='tags_video'?'tags_video':'tags_views',days,today,from,to,...paging};
}
export function liveTagPeriod(options:ReturnType<typeof liveTagOptions>,clock:()=>Date,sourceDate?:string){
 const anchor=sourceDate??taipeiDate(clock()),defaultTo=shift(anchor,-options.today),to=options.to??defaultTo,from=options.from??shift(to,-options.days);
 if(from>to||Date.parse(to)-Date.parse(from)>90*DAY)throw new BadQuery('Live tag dates must be ordered and at most 91 dates.');
 const dates:string[]=[];for(let at=Date.parse(from);at<=Date.parse(to);at+=DAY)dates.push(new Date(at).toISOString().slice(0,10));
 return {from,to,dates,anchor,anchorSource:sourceDate?'latest-scoped-cache':'taipei-clock',offset:options.today,explicitFrom:options.from!==null,explicitTo:options.to!==null,dayOffset:options.days};
}

/** Legacy wrappers are accepted without confusing a literal word named views/data with an envelope. */
export function decodeLiveTagDay(payload:unknown){
 let raw:unknown=payload;if(typeof raw==='string'){try{raw=JSON.parse(raw);}catch{return {status:'malformed' as const};}}
 if(Array.isArray(raw)&&raw.length===0)raw={};
 if(!dict(raw))return {status:'malformed' as const};
 for(const key of ['tags_views','tags_video','views','videos','result','data','hour']){
  const nested=raw[key];if((dict(nested)||Array.isArray(nested)&&nested.length===0)&&(Object.values(nested).some(v=>v!==null&&typeof v==='object')||(Object.keys(raw).length===1&&!Object.keys(nested).length))){raw=nested;break;}
 }
 const entries=Object.entries(raw as Record<string,unknown>);
 if(entries.length>LIVE_TAG_LIMITS.termsPerDay)return {status:'term-budget-exhausted' as const};
 const values=new Map<string,number|null>();let malformedTerms=0;
 for(const [rawTerm,hours]of entries){
  if(Buffer.byteLength(rawTerm)>LIVE_TAG_LIMITS.termBytes)return {status:'term-budget-exhausted' as const};
  const term=rawTerm.trim();if(!term)continue;
  const samples=Array.isArray(hours)?hours:dict(hours)?Object.values(hours):null;
  let peak:number|null=null;
  if(samples?.length&&samples.length<=LIVE_TAG_LIMITS.hoursPerTerm){
   const parsed=samples.map(value=>(typeof value==='number'||typeof value==='string'&&/^\d+$/.test(value))?integer(value):null);
   if(parsed.every((value):value is number=>value!==null&&value>=0))peak=Math.max(...parsed);
  }
  // Two stored spellings which collapse after Laravel's trim are ambiguous, not two observations.
  if(values.has(term)){values.set(term,null);malformedTerms++;}else{values.set(term,peak);if(peak===null)malformedTerms++;}
 }
 return {status:'observed' as const,values,rawTerms:entries.length,malformedTerms};
}
interface Day {date:string;state:State;row?:Row;values?:Map<string,number|null>;malformedTerms:number}
function identity(row:Row){return JSON.stringify([row._cacheLineage??null,row._cacheWindow??null]);}
function pk(row:Row){const value=integer(row.pk);if(value===null||value<1)throw new DataQueryFailed('LIVE_TAG_ID');return value;}
function counter(value:unknown){const n=integer(value);return n!==null&&n>=0?n:null;}

async function liveTagSources(reader:Reader,q:Query,metric:string,period:ReturnType<typeof liveTagPeriod>){
 const column=sql.identifier(metric),metadata=await reader.rows(sql`SELECT pk,ctime,mtime,the_date,count_videos,count_tags,total_views,OCTET_LENGTH(${column}) AS payload_bytes FROM urt_show_live_tag_date WHERE pk IN(SELECT MAX(pk) FROM urt_show_live_tag_date WHERE ${cacheFilters(q)} AND the_date BETWEEN ${period.from} AND ${period.to} GROUP BY the_date) ORDER BY the_date DESC,pk DESC LIMIT 92`);
 if(metadata.length>LIVE_TAG_LIMITS.dates)throw new ReportReadBound('Live tag source date limit');
 const byDate=new Map<string,Row>();for(const row of metadata){const date=text(row.the_date).slice(0,10);pk(row);if(!period.dates.includes(date)||byDate.has(date))throw new DataQueryFailed('LIVE_TAG_DATE_IDENTITY');byDate.set(date,row);}
 // Include missing-row dates so a pending sidecar is not mislabeled as an ordinary cache miss.
 const candidates=period.dates.map(the_date=>byDate.get(the_date)??{the_date}),eligible=await publishedLiveTagCache(reader,candidates,q),visible=new Map(eligible.map(row=>[text(row.the_date).slice(0,10),row]));
 const days=new Map<string,Day>(period.dates.map(date=>[date,{date,state:visible.has(date)?'missing':'withheld',malformedTerms:0}]));
 let remaining=LIVE_TAG_LIMITS.totalBytes;const approved:Row[]=[];
 for(const original of metadata){const date=text(original.the_date).slice(0,10),row=visible.get(date);if(!row)continue;const day=days.get(date)!,bytes=integer(row.payload_bytes);
  if(bytes===null||bytes<1){day.state='malformed';continue;}if(bytes>LIVE_TAG_LIMITS.dayBytes){day.state='oversized';continue;}if(bytes>remaining){day.state='budget-exhausted';continue;}
  remaining-=bytes;approved.push(row);
 }
 if(!approved.length)return {days,metadata,bytesAllocated:LIVE_TAG_LIMITS.totalBytes-remaining};
 const currentRow=(r:Row)=>sql`pk=${r.pk} AND mtime <=> ${r.mtime} AND ctime <=> ${r.ctime} AND count_videos <=> ${r.count_videos} AND count_tags <=> ${r.count_tags} AND total_views <=> ${r.total_views} AND OCTET_LENGTH(${column})=${r.payload_bytes} AND pk=(SELECT MAX(newest.pk) FROM urt_show_live_tag_date newest WHERE ${cacheFilters(q)} AND newest.the_date=${r.the_date})`;
 // Only already-budgeted bodies are hashed, and each subsequent body still has to be the latest revision.
 const hashes=await reader.rows(sql`SELECT pk,SHA2(CAST(${column} AS BINARY),256) AS payload_hash FROM urt_show_live_tag_date WHERE ${sql.join(approved.map(r=>sql`(${currentRow(r)})`),sql` OR `)} LIMIT 92`);
 if(hashes.length>approved.length)throw new DataQueryFailed('LIVE_TAG_HASH_BOUND');
 const byHash=new Map(hashes.map(row=>[pk(row),text(row.payload_hash)]));
 const hashed=approved.filter(row=>/^[a-f0-9]{64}$/.test(byHash.get(pk(row))??''));
 const bodyPredicate=sql.join(hashed.map(r=>sql`(${currentRow(r)} AND SHA2(CAST(${column} AS BINARY),256)=${byHash.get(pk(r))})`),sql` OR `);
 const bodies=hashed.length?await reader.rows(sql`SELECT pk,${column} AS payload FROM urt_show_live_tag_date WHERE ${bodyPredicate} LIMIT 92`):[];
 if(bodies.length>hashed.length)throw new DataQueryFailed('LIVE_TAG_BODY_BOUND');
 const byPk=new Map(bodies.map(row=>[pk(row),row]));
 const after=hashed.length?await reader.rows(sql`SELECT pk FROM urt_show_live_tag_date WHERE ${bodyPredicate} LIMIT 92`):[],unchanged=new Set(after.map(pk));
 // Publication can change while immutable bytes are being transferred.
 const rechecked=await publishedLiveTagCache(reader,approved,q),published=new Map(rechecked.map(row=>[pk(row),row]));
 let termDays=0;const names=new Set<string>();
 for(const row of approved){const day=days.get(text(row.the_date).slice(0,10))!,body=byPk.get(pk(row)),current=published.get(pk(row));
  if(!current){day.state='withheld';continue;}
  if(!body||!unchanged.has(pk(row))||identity(row)!==identity(current)){day.state='changed';continue;}
  if(typeof body.payload!=='string'||Buffer.byteLength(body.payload)!==Number(row.payload_bytes)){day.state='changed';continue;}
  const decoded=decodeLiveTagDay(body.payload);if(decoded.status!=='observed'){day.state=decoded.status;continue;}
  const newNames=[...decoded.values.keys()].filter(term=>!names.has(term));
  if(termDays+decoded.rawTerms>LIVE_TAG_LIMITS.termDays||names.size+newNames.length>LIVE_TAG_LIMITS.distinctTerms){day.state='term-budget-exhausted';continue;}
  termDays+=decoded.rawTerms;for(const term of newNames)names.add(term);day.state='observed';day.values=decoded.values;day.row=current;day.malformedTerms=decoded.malformedTerms;
 }
 return {days,metadata,bytesAllocated:LIVE_TAG_LIMITS.totalBytes-remaining};
}

export function registerLiveTagRanking(register:Register,reader:Reader,clock:()=>Date){
 register('/live/tags',async(_params,query)=>{
  const options=liveTagOptions(query);
  const source=(await reader.rows(sql`SELECT MAX(the_date) AS latest FROM urt_show_live_tag_date WHERE ${cacheFilters(options.q)}`))[0],rawDate=text(source?.latest).slice(0,10);
  if(rawDate)try{dateFilter(rawDate);}catch{throw new DataQueryFailed('LIVE_TAG_ANCHOR');}
  const period=liveTagPeriod(options,clock,rawDate||undefined),stopwords=await reportStopwords(reader),sources=await liveTagSources(reader,options.q,options.metric,period),days=[...sources.days.values()];
  const terms=new Set(days.flatMap(day=>day.values?[...day.values].filter(([term,value])=>value!==null&&value>0&&!stopwords.has(term)).map(([term])=>term):[]));
  let unsafeTotals=0;
  const ranked=[...terms].map(term=>{
   let total=0,score=0,observedDays=0,unsafe=false;
   for(const day of days){if(!day.values)continue;const value=day.values.has(term)?day.values.get(term)!:0;if(value===null)continue;observedDays++;total+=value;if(!Number.isSafeInteger(total))unsafe=true;if(value>0)score+=options.type==='tags_result'?Math.log(value)*100:value;}
   if(!Number.isFinite(score)||Math.abs(score)>Number.MAX_SAFE_INTEGER)unsafe=true;if(unsafe)unsafeTotals++;
   return {term,total:unsafe?null:total,score:unsafe?null:options.type==='tags_result'?Math.round(score*10)/10:score,observedDays};
  }).sort((a,b)=>(b.score??-Infinity)-(a.score??-Infinity)||a.term.localeCompare(b.term));
  const rows=ranked.slice(options.offset,options.offset+options.limit).map(row=>({term:row.term.length<=240?link(row.term,`/keywords/${encodeURIComponent(row.term)}/live/trends`):row.term,score:row.score,total:row.total,observedDays:row.observedDays,...Object.fromEntries(days.map(day=>[day.date,day.values?(day.values.has(row.term)?day.values.get(row.term)!:0):null]))}));
  const stateCounts=Object.fromEntries((['missing','withheld','malformed','oversized','budget-exhausted','changed','term-budget-exhausted','observed']as const).map(state=>[state,days.filter(day=>day.state===state).length]));
  const coverage={requestedDates:days.length,selectedDays:sources.metadata.length,observedDays:stateCounts.observed,missingDays:stateCounts.missing,withheldDays:stateCounts.withheld,malformedDays:stateCounts.malformed,oversizedDays:stateCounts.oversized,budgetExceededDays:stateCounts['budget-exhausted'],changedDays:stateCounts.changed,termBudgetExceededDays:stateCounts['term-budget-exhausted'],partiallyMalformedDays:days.filter(day=>day.malformedTerms>0).length,malformedTermDays:days.reduce((sum,day)=>sum+day.malformedTerms,0),unsafeTotals,bytesAllocated:sources.bytesAllocated,limits:LIVE_TAG_LIMITS,stopwordSource:'Laravel fixed list + local tags.no_tag; external file unavailable',anchorSource:period.anchorSource};
  const scope=Object.fromEntries(['tagid','or','not'].flatMap(key=>options.q[key]?[[key,String(options.q[key])]]:[])),href=(from:string,to:string)=>'/live/tags?'+new URLSearchParams({...scope,from,to,type:options.type,limit:String(options.limit)});
  return {
   title:'直播詞彙熱度',description:`${period.from} 至 ${period.to}，共 ${days.length} 個日期；${options.type==='tags_result'?'自然對數重要度':options.type==='tags_video'?'影片引用峰值':'觀看引用峰值'}。`,
   columns:[{key:'term',label:'詞彙'},{key:'score',label:options.type==='tags_result'?'對數重要度':'已觀測日峰值總和',kind:'number' as const},{key:'total',label:'已觀測日峰值總和',kind:'number' as const},{key:'observedDays',label:'已觀測日數',kind:'number' as const},...days.map(day=>({key:day.date,label:day.date,kind:'number' as const}))],rows,total:ranked.length,limit:options.limit,offset:options.offset,
   sections:[{key:'daily-source-totals',title:'每日來源與覆蓋',columns:[{key:'date',label:'日期',kind:'date' as const},{key:'state',label:'來源狀態'},{key:'countVideos',label:'來源影片數',kind:'number' as const},{key:'countTags',label:'來源詞彙數',kind:'number' as const},{key:'totalViews',label:'來源觀看引用',kind:'number' as const},{key:'malformedTerms',label:'無法解讀詞彙數',kind:'number' as const}],rows:days.map(day=>({date:day.date,state:({missing:'無來源',withheld:'尚未發布或含未知值',malformed:'資料無法解讀',oversized:'單日資料超過上限','budget-exhausted':'讀取總量超過上限',changed:'讀取期間已變更','term-budget-exhausted':'詞彙數量超過上限',observed:'已觀測'})[day.state],countVideos:day.row?counter(day.row.count_videos):null,countTags:day.row?counter(day.row.count_tags):null,totalViews:day.row?counter(day.row.total_views):null,malformedTerms:day.state==='observed'?day.malformedTerms:null}))}],
   filters:[{key:'from',label:'開始日期',type:'date' as const,value:period.from},{key:'to',label:'結束日期',type:'date' as const,value:period.to},...([['tagid','同時符合分類'],['or','符合任一分類'],['not','排除分類']]as const).map(([key,label])=>({key,label,type:'text' as const,value:String(options.q[key])})),{key:'type',label:'觀測度量',type:'select' as const,value:options.type,options:[{value:'tags_result',label:'自然對數重要度'},{value:'tags_views',label:'觀看引用峰值'},{value:'tags_video',label:'影片引用峰值'}]},{key:'limit',label:'顯示筆數（1–200）',type:'number' as const,value:String(options.limit)}],
   navigation:[{label:'前一日窗口',href:href(shift(period.from,-1),shift(period.to,-1))},{label:'後一日窗口',href:href(shift(period.from,1),shift(period.to,1))},{label:'最新來源窗口',href:'/live/tags?'+new URLSearchParams({...scope,type:options.type,days:String(options.days),limit:String(options.limit)})}],
   period:{...period,type:options.type},updatedAt:latest(...days.flatMap(day=>day.row?[day.row.mtime,day.row.ctime]:[])),evidenceCoverage:coverage,
   notes:[cacheLineageNote,stopwordNote,`未指定起日時，days=${options.days} 沿用起點往前 ${options.days} 天再含兩端的規則；today 位移以相同分類的最新快取日期 ${period.anchor} 為基準。${period.anchorSource==='taipei-clock'?'此分類沒有快取，改以台北今天作為空窗口基準。':''}`,'各日取每個詞彙的小時峰值再加總；不是同一時刻在線人數、不重複觀眾或累計觀看。自然對數重要度只對正峰值計算 ln(value) ×100。','總和只計入已觀測日期；來源缺漏或詞彙資料無法解讀時保留缺值，已觀測空字典或未出現的詞彙才為零。歷史快取不是目前共享詞彙的精確比對證據。',...cacheWindowNotes(days.flatMap(day=>day.row?[day.row]:[]))],
  };
 });
}
