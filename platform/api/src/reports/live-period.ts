import type {ReportData} from '../report-contracts.js';
import {BadQuery,dateFilter,bounded,type Query} from './query.js';
import {taipeiDate,text} from './normalize.js';
export const LIVE_FIRST_DATE='2022-11-19';
const shift=(date:string,days:number)=>new Date(Date.parse(date)+days*86400000).toISOString().slice(0,10);
export function livePeriod(query:Query,clock:()=>Date,pathDate?:string){
 const q={...query};for(const key of ['date','from','to','days'])if(q[key]==='')delete q[key];
 const today=taipeiDate(clock()),queryDate=dateFilter(q.date),date=pathDate?dateFilter(pathDate):queryDate,from=dateFilter(q.from),to=dateFilter(q.to),days=bounded(q.days,1,1,90);
 if(to&&!from)throw new BadQuery('Live range end requires an explicit start date.');
 const end=to??(from?today:date??today),start=from??(date&&!to?date:shift(end,1-days));
 if(start>end||start<LIVE_FIRST_DATE||end>today||Date.parse(end)-Date.parse(start)>89*86400000)throw new BadQuery('Live period must be ordered, at most90days, and between2022-11-19 and today.');
 const dates:string[]=[];for(let at=start;at<=end;at=shift(at,1))dates.push(at);
 return {from:start,to:end,dates,today};
}
export function livePeriodControls(q:Query,p:ReturnType<typeof livePeriod>,path='/live/periods'):Pick<ReportData,'filters'|'navigation'|'description'>{
 const href=(day:string)=>{const params=new URLSearchParams();for(const key of ['q','tagid','or','not','limit'])if(typeof q[key]==='string'&&q[key])params.set(key,q[key]);params.set('date',day);return path+'?'+params.toString();};
 return {description:p.from===p.to?`觀測日期 ${p.to}`:`觀測期間 ${p.from} 至 ${p.to}`,navigation:[...(p.from>LIVE_FIRST_DATE?[{label:p.from===p.to?'上一日':'區間前一日',href:href(shift(p.from,-1))}]:[]),{label:'今日',href:href(p.today)},...(p.to<p.today?[{label:p.from===p.to?'下一日':'區間後一日',href:href(shift(p.to,1))}]:[])],filters:[{key:'date',label:'單日日期（切換單日請清空起訖）',type:'date',value:p.from===p.to?p.to:''},{key:'from',label:'開始日期',type:'date',value:text(q.from)},{key:'to',label:'結束日期',type:'date',value:text(q.to)},{key:'q',label:'影片／頻道',type:'text',value:text(q.q)},{key:'tagid',label:'分類同時符合',type:'text',value:text(q.tagid)},{key:'or',label:'分類任一符合',type:'text',value:text(q.or)},{key:'not',label:'排除分類',type:'text',value:text(q.not)}]};
}
