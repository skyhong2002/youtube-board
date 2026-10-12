import {sql} from 'drizzle-orm';
import {DataQueryFailed,type Reader,type Row} from '../db/client.js';
import type {ReportData} from '../report-contracts.js';
import {BadQuery,bounded,dateFilter,page,search,tagFilter,type Query} from './query.js';
import {latest,taipeiDate,taipeiSql,text,timestamp} from './normalize.js';
import {LIVE_FIRST_DATE} from './live-period.js';
import {observedCount,visibleLiveTags} from './live-observations.js';
import {link,type Register} from './table.js';
import {liveDisplayColumns,liveDisplayJoins,liveRowIdentity,liveSearch,liveTaxonomyNames,liveTotal} from './live-taxonomy-videos.js';
const shift=(date:string,days:number)=>new Date(Date.parse(date)+days*86400000).toISOString().slice(0,10);
export async function continuousPeriod(reader:Reader,q:Query,clock:()=>Date){
 const today=taipeiDate(clock()),from=dateFilter(q.from),to=dateFilter(q.to),date=dateFilter(q.date),days=bounded(q.days,7,1,90),offset=bounded(q.today,0,0,3650);
 if(to&&date&&to!==date)throw new BadQuery('Conflicting continuous live endpoints.');
 for(const d of [from,to,date])if(d&&(d<LIVE_FIRST_DATE||d>today))throw new BadQuery('Live dates must be within the source window.');
 if(from&&(to??date)&&from>(to??date)!)throw new BadQuery('Live period must be ordered.');
 let anchor:string|null=null;
 if(!to&&!date){const rows=await reader.rows(sql`SELECT MAX(the_date) AS latest FROM urt_video_live_log`),raw=rows[0]?.latest;if(raw!==null&&raw!==undefined&&raw!==''){try{anchor=dateFilter(text(raw).slice(0,10));}catch{throw new DataQueryFailed('LIVE_ANCHOR_DATE_INVALID');}if(anchor&&(anchor<LIVE_FIRST_DATE||anchor>today))throw new DataQueryFailed('LIVE_ANCHOR_DATE_INVALID');}}
 const end=to??date??shift(anchor??today,-offset),start=from??shift(end,1-days);
 if(start>end||start<LIVE_FIRST_DATE||end>today||Date.parse(end)-Date.parse(start)>89*86400000)throw new BadQuery('Continuous live period must be ordered, at most 90 days, and within source dates.');
 const dates:string[]=[];for(let at=start;at<=end;at=shift(at,1))dates.push(at);
 return {from:start,to:end,dates,days,offset,anchor,anchorSource:to||date?'explicit-endpoint':anchor?'latest-log-date':'taipei-today-no-log',today};
}
export function continuousStats(rows:Row[],end:string){
 const known=rows.map(r=>observedCount(r.peak)).filter((n):n is number=>n!==null),sum=known.reduce((n,v)=>n+BigInt(v),0n),sourceRows=rows.reduce((n,r)=>{const value=observedCount(r.source_rows);if(value===null||!Number.isSafeInteger(n+value))throw new DataQueryFailed('LIVE_HISTORY_COUNT_INVALID');return n+value;},0);
 return {todayPeak:observedCount(rows.find(r=>text(r.the_date).slice(0,10)===end)?.peak),periodAverage:known.length?Number((sum+BigInt(Math.floor(known.length/2)))/BigInt(known.length)):null,periodPeak:known.length?Math.max(...known):null,observedDays:known.length,sourceLogRows:sourceRows};
}
export function registerLiveContinuous(register:Register,reader:Reader,clock:()=>Date){
 register('/live/continuous',async(_p,query)=>{
  const q={...query};for(const key of ['date','from','to','days','today','hours'])if(q[key]==='')delete q[key];
  const now=clock(),{limit,offset}=page(q),hours=bounded(q.hours,24,1,168),term=search(q.q),scope=tagFilter(q),period=await continuousPeriod(reader,q,()=>now);
  const where=sql`l.actualEndTime IS NULL AND l.concurrentViewers>0 AND l.mtime>=${taipeiSql(new Date(+now-3600000))} AND(l.actualStartTime IS NULL OR l.actualStartTime<${taipeiSql(new Date(+now-hours*3600000))}) AND ${scope} ${liveSearch(term)}`;
  const [active,count]=await Promise.all([reader.rows(sql`SELECT l.pk,l.videoId,l.u_id,l.ctime,l.mtime,l.actualStartTime,l.concurrentViewers,l.max_current,${liveDisplayColumns} FROM urt_video_live l ${liveDisplayJoins} WHERE ${where} ORDER BY l.concurrentViewers DESC,l.pk LIMIT ${limit} OFFSET ${offset}`),reader.rows(sql`SELECT COUNT(*) AS total FROM urt_video_live l ${term?liveDisplayJoins:sql`JOIN urt_count n ON n.u_id=l.u_id`} WHERE ${where}`)]);
  if(active.length>limit)throw new DataQueryFailed('LIVE_CONTINUOUS_PAGE_BOUND');
  const identities=active.map(liveRowIdentity),ids=[...new Set(identities.map(row=>row.id))],historyCap=ids.length*period.dates.length;
  const [logs,names]=await Promise.all([ids.length?reader.rows(sql`SELECT MIN(videoId) AS videoId,the_date,MAX(CASE WHEN max_current>=0 THEN max_current ELSE NULL END) AS peak,COUNT(*) AS source_rows,MAX(mtime) AS updated FROM urt_video_live_log WHERE videoId IN (${sql.join(ids.map(id=>sql`${id}`),sql`,`)}) AND BINARY videoId IN (${sql.join(ids.map(id=>sql`${id}`),sql`,`)}) AND the_date BETWEEN ${period.from} AND ${period.to} GROUP BY BINARY videoId,the_date ORDER BY BINARY videoId,the_date LIMIT ${historyCap+1}`):Promise.resolve([]),active.length?liveTaxonomyNames(reader):Promise.resolve(new Map<number,string>())]);
  if(logs.length>historyCap)throw new DataQueryFailed('LIVE_CONTINUOUS_HISTORY_BOUND');
  const byId=new Map<string,Row[]>(),seen=new Set<string>();
  for(const row of logs){const id=text(row.videoId),date=text(row.the_date).slice(0,10),key=id+'|'+date;if(!ids.includes(id)||!period.dates.includes(date)||seen.has(key))throw new DataQueryFailed('LIVE_CONTINUOUS_HISTORY_SCOPE');seen.add(key);const list=byId.get(id)??[];list.push(row);byId.set(id,list);}
  const rows=active.map((row,i)=>{const {id,channel}=identities[i]!;return {video:link(text(row.title)||id,`/live/videos/${encodeURIComponent(id)}/trend`),channel:link(text(row.channel_title)||'頻道名稱待補',`/channels/${channel}`),tags:visibleLiveTags(row.tags,names).map(t=>t.name).join(' · '),publishedAt:timestamp(row.published_at),startedAt:timestamp(row.actualStartTime),current:observedCount(row.concurrentViewers),allTimePeak:observedCount(row.max_current),...continuousStats(byId.get(id)??[],period.to)};});
  return {title:`持續超過 ${hours} 小時的直播`,description:`目前直播：最近一小時有觀測；歷史比較期間 ${period.from} 至 ${period.to}`,columns:[{key:'video',label:'影片'},{key:'channel',label:'頻道'},{key:'tags',label:'頻道分類'},{key:'startedAt',label:'開始時間',kind:'datetime'},{key:'current',label:'最新在線',kind:'number'},{key:'todayPeak',label:'期間末日峰值',kind:'number'},{key:'periodAverage',label:'有觀測日的峰值平均',kind:'number'},{key:'periodPeak',label:'期間峰值',kind:'number'},{key:'allTimePeak',label:'來源歷史最高',kind:'number'},{key:'observedDays',label:'有值觀測日數',kind:'number'},{key:'sourceLogRows',label:'期間來源日誌列數',kind:'number'}],rows,total:liveTotal(count),limit,offset,updatedAt:latest(...active.flatMap(row=>[row.mtime,row.ctime])),filters:[{key:'hours',label:'持續超過幾小時（1–168）',type:'number',value:String(hours)},{key:'days',label:'歷史日數（未填起日，1–90）',type:'number',value:String(period.days)},{key:'today',label:'往前幾日（未填迄日）',type:'number',value:String(period.offset)},{key:'from',label:'歷史開始日期',type:'date',value:text(q.from)},{key:'to',label:'歷史結束日期',type:'date',value:text(q.to)},{key:'date',label:'結束日期別名（與迄日須一致）',type:'date',value:text(q.date)},{key:'q',label:'影片／頻道',type:'text',value:text(q.q)},{key:'tagid',label:'分類同時符合',type:'text',value:text(q.tagid)},{key:'or',label:'分類任一符合',type:'text',value:text(q.or)},{key:'not',label:'排除分類',type:'text',value:text(q.not)}],notes:['預設歷史終點為最新來源日誌日期，沒有日誌時才用台北今日；明確起訖優先，最多 90 日。','歷史先按影片的精確 ID／日期合併重複日誌為該日 max_current 最大值，再對有非負值的日期取平均；分母是有值觀測日數，不是日誌列數或完整區間日數。真實零值保留，缺日／缺峰值不補零，也不以目前在線代填。','目前直播只含最近一小時有觀測、未結束、正值在線且開始早於指定小時數者；開始時間未知沿用舊版納入規則，不能據此證明已持續指定時間。','每頁預設 50／最多 200 列，只對目前頁面的影片讀取歷史聚合；標題優先使用保留的展示資料，頻道分類不等於內容詞彙。'],evidenceCoverage:{from:period.from,to:period.to,anchor:period.anchor,anchorSource:period.anchorSource,maxHistoryDays:90,historyObservationUnit:'per-video-per-date-maximum',historicalAggregation:'known-nonnegative-daily-peaks-only',selectedVideos:ids.length,selectedHistoryRows:logs.length,historyRowCap:historyCap,totalSnapshot:'independent-read',oversizedTaxonomyRows:active.filter(row=>(observedCount(row.tags_bytes)??0)>4096).length}} satisfies ReportData&{evidenceCoverage:unknown};
 });
}
