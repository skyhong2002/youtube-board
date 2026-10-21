import {BadQuery,bounded,dateFilter,type Query} from './query.js';
import {taipeiDate,text} from './normalize.js';
import type {ReportData} from '../report-contracts.js';
const shift=(date:string,days:number)=>new Date(Date.parse(date)+days*86400000).toISOString().slice(0,10);
/** GroupMetricReport excludes the start; TagTrendReport includes it and defaults to yesterday. */
export function metricPeriod(q:Query,clock:()=>Date,kind:'group'|'tag',rolling=true){
 const clean=(value:unknown)=>value===''?undefined:value;
 const daysValue=clean(q.days),fromValue=clean(q.from),toValue=clean(q.to),offset=bounded(clean(q.today),kind==='tag'?1:0,0,3650);
 if(daysValue!==undefined&&daysValue!=='year')bounded(daysValue,7,1,366);
 const year=daysValue==='year'||fromValue==='year',days=year?'year':bounded(daysValue,7,1,366),fallbackTo=shift(taipeiDate(clock()),-offset);
 // Legacy explicit-to-only requests still derive the missing from boundary from shifted today.
 let to=dateFilter(toValue)??fallbackTo,from=year?to.slice(0,4)+'-01-01':dateFilter(fromValue)??shift(fallbackTo,-Number(days));
 if(year&&fromValue!==undefined&&fromValue!=='year')dateFilter(fromValue);
 if(from>to)[from,to]=[to,from];
 if((Date.parse(to)-Date.parse(from))/86400000>366)throw new BadQuery('Metric period must span at most 366 days.');
 const dates:string[]=[];for(let d=kind==='group'?shift(from,1):from;d<=to;d=shift(d,1))dates.push(d);if(!dates.length)dates.push(to);
 return {from,to,dates,cacheFrom:rolling?shift(from,-6):from,days,today:offset,startBoundary:kind==='group'?'exclusive':'inclusive'};
}
export type MetricPeriod=ReturnType<typeof metricPeriod>;
export function metricType(value:unknown,kind:'group'|'tag'){
 if(value===undefined||value==='')return 'total_views';if(typeof value!=='string')throw new BadQuery('Invalid metric type.');
 const aliases:Record<string,string>=kind==='group'?{tags_views:'total_views',tags_video:'count_videos',views:'total_views',videos:'count_videos'}:{views_video:'average'};
 const type=Object.hasOwn(aliases,value)?aliases[value]!:value;
 if(!(kind==='group'?['total_views','count_videos']:['total_views','count_videos','average']).includes(type))throw new BadQuery('Invalid metric type.');return type;
}
export function metricFilters(q:Query,p:MetricPeriod,type?:string):NonNullable<ReportData['filters']>{return [
 {key:'days',label:'期間',type:'select',value:String(p.days),options:[...new Set([1,3,7,10,30,90,366,'year',p.days])].map(v=>({value:String(v),label:v==='year'?'今年起':String(v)+'天'}))},
 {key:'today',label:'結束日往前幾天',type:'number',value:String(p.today)},
 {key:'from',label:p.startBoundary==='exclusive'?'開始日期（不含當天）':'開始日期（含）',type:'date',value:q.from==='year'?'':text(q.from)},
 {key:'to',label:'結束日期（含）',type:'date',value:text(q.to)},
 ...(type?[{key:'type',label:'度量',type:'select' as const,value:type,options:[{value:'total_views',label:'累計觀看'},{value:'count_videos',label:'影片數'},...(p.startBoundary==='inclusive'?[{value:'average',label:'每影片觀看'}]:[])]}]:[]),
 ];}
export const metricPeriodNote=(p:MetricPeriod)=>`期間邊界 ${p.from} ～ ${p.to}；填了開始或結束日期時以日期為準，不看「期間」選單；「結束日往前幾天」把預設結束日往前移。${p.startBoundary==='exclusive'?'沿用群組報表排除起點；起訖同日時仍顯示該日。':'分類趨勢包含起訖兩日，預設結束日為昨天。'}實際呈現 ${p.dates.length} 日。${p.startBoundary==='exclusive'?'year 沿用當年一月一日起點，因此群組通常從一月二日顯示。':'year 包含當年一月一日起點。'}`;
