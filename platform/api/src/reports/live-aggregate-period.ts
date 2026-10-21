import {sql} from 'drizzle-orm';
import type {Reader} from '../db/client.js';
import type {ReportData} from '../report-contracts.js';
import {BadQuery,bounded,dateFilter,page,search,tagFilter,type Query} from './query.js';
import {taipeiDate,text} from './normalize.js';
import {LIVE_FIRST_DATE} from './live-period.js';
export const shiftLiveDate=(day:string,offset:number)=>new Date(Date.parse(day)+offset*86400000).toISOString().slice(0,10);
export const liveDates=(from:string,to:string)=>{const dates:string[]=[];for(let date=from;date<=to;date=shiftLiveDate(date,1))dates.push(date);return dates;};
export async function aggregatePeriod(reader:Reader,input:Query,clock:()=>Date,mode:'channels'|'hours'|'daily'){
 const q={...input};for(const key of ['date','from','to','days','today'])if(q[key]==='')delete q[key];
 if(mode!=='channels'&&q.date!==undefined)throw new BadQuery('Use from/to for this live aggregate report.');
 page(q);search(q.q);tagFilter(q);const today=taipeiDate(clock()),maxDays=mode==='hours'?31:366,days=bounded(q.days,7,1,maxDays),offset=bounded(q.today,0,0,mode==='hours'?3650:1);
 const date=dateFilter(q.date),to=dateFilter(q.to),year=mode==='daily'&&q.from==='year',from=year?undefined:dateFilter(q.from);
 for(const d of [date,to,from])if(d&&(d<LIVE_FIRST_DATE||d>today))throw new BadQuery('Live date must be between2022-11-19 and today.');
 const latest=(!to&&!date)||year?text((await reader.rows(sql`SELECT MAX(the_date) AS latest FROM urt_video_live_log`))[0]?.latest).slice(0,10):'';
 const defaultTo=latest&&latest>=LIVE_FIRST_DATE&&latest<=today?latest:today;
 const end=date??(mode==='hours'&&!from?shiftLiveDate(to??defaultTo,-offset):to??defaultTo),inferred=shiftLiveDate(end,-days),start=date??(year?end.slice(0,4)+'-01-01':from??(inferred<LIVE_FIRST_DATE?LIVE_FIRST_DATE:inferred)),startClamped=!date&&!year&&!from&&inferred<LIVE_FIRST_DATE;
 if(end<LIVE_FIRST_DATE)throw new BadQuery('Live end-date offset precedes the source beginning2022-11-19.');
 if(start>end||start<LIVE_FIRST_DATE||end>today||Date.parse(end)-Date.parse(start)>maxDays*86400000)throw new BadQuery(`Live range must be ordered and at most ${maxDays+1} inclusive dates.`);
 return {from:start,to:end,dates:liveDates(start,end),today,startClamped,includeEnd:mode!=='daily'||offset>0,q};
}
export function aggregateControls(q:Query,p:Awaited<ReturnType<typeof aggregatePeriod>>,mode:'channels'|'hours'|'daily'):Pick<ReportData,'filters'|'description'|'navigation'>{
 const base=mode==='daily'?'/live/trends/daily':`/live/${mode}`;
 const href=(date:string)=>{const params=new URLSearchParams();for(const key of ['q','tagid','or','not','limit','group','type','today'])if(typeof q[key]==='string'&&q[key])params.set(key,q[key]);params.delete('today');params.set(mode==='channels'?'date':'to',date);if(mode!=='channels')params.set('days','1');return base+'?'+params;};
 return {description:`觀測期間 ${p.from} 至 ${p.to}（含首尾 ${p.dates.length} 日）${p.startClamped?'；起日受資料起點限制':''}`,navigation:mode==='channels'?[...(p.from>LIVE_FIRST_DATE?[{label:'區間前一日',href:href(shiftLiveDate(p.from,-1))}]:[]),{label:'今日',href:href(p.today)},...(p.to<p.today?[{label:'區間後一日',href:href(shiftLiveDate(p.to,1))}]:[])]:[],filters:[...(mode==='channels'?[{key:'date',label:'單日日期（優先於起訖）',type:'date' as const,value:text(q.date)}]:[]),{key:'from',label:mode==='daily'?'起日（或 year）':'開始日期',type:mode==='daily'?'text' as const:'date' as const,value:text(q.from)},{key:'to',label:'結束日期',type:'date',value:text(q.to)},{key:'days',label:'往前日數（另含結束日；指定起日時不使用）',type:'number',value:text(q.days)||'7'},...(mode==='hours'?[{key:'today',label:'結束日往前幾天',type:'number' as const,value:text(q.today)||'0'}]:[]),...(mode!=='daily'?[{key:'q',label:'影片／頻道（搜尋時採來源觀測）',type:'text' as const,value:text(q.q)},{key:'tagid',label:'分類同時符合',type:'text' as const,value:text(q.tagid)},{key:'or',label:'分類任一符合',type:'text' as const,value:text(q.or)},{key:'not',label:'排除分類',type:'text' as const,value:text(q.not)}]:[])]};
}
