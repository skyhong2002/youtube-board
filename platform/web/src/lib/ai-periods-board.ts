import type {ReportCell,ReportValue} from './report-contract';
import {cellNumber,cellText} from './ai-hours-board';

type Cells=Record<string,ReportValue|ReportCell>;
export interface PeriodTopic {date:string;event:string;href:string|null;channels:number|null;videos:number|null;keywordCount:number|null;topPerson:string;topPersonCount:number|null;topKeyword:string;topKeywordCount:number|null;stored:boolean}
export interface PeriodRange {from:string;to:string;month:string|null}

export function aiPeriodsTitle({from,to,month}:PeriodRange,condition:string){
 if(month)return `${month.slice(0,4)}年${month.slice(5,7)}月 的所有事件`;
 const span=`${from} - ${to}`;
 return ({green:`泛綠媒體在 ${span} 主要報導`,blue:`泛藍媒體在 ${span} 主要報導`,neutral:`較無偏媒體在 ${span} 主要報導`,world:`${span} 國際新聞報導`,finance:`${span} 財經新聞報導`} as Record<string,string>)[condition]??`${span} 主要事件與各媒體報導`;
}
/** Laravel's month switcher: this Taipei month and the one before it. */
export function recentMonths(now=new Date()):[string,string]{
 const d=new Date(+now+8*3600000),current=d.toISOString().slice(0,7);
 d.setUTCDate(1);d.setUTCMonth(d.getUTCMonth()-1);return [current,d.toISOString().slice(0,7)];
}
/** The API's 期間表 (legacy*) fields carry the numbers Laravel's period table showed for every event,
 * including events that only have raw daily topics. */
export function periodTopics(rows:Cells[]):PeriodTopic[]{
 return rows.flatMap(row=>{
  const event=cellText(row.event);if(!event)return [];
  const cell=row.event!==null&&typeof row.event==='object'?row.event:null;
  return [{date:cellText(row.date),event,href:cell?.href?.startsWith('/')?cell.href:null,channels:cellNumber(row.legacyMediaCount),videos:cellNumber(row.legacyVideoCount),keywordCount:cellNumber(row.legacyKeywordCount),
   topPerson:cellText(row.legacyTopPerson),topPersonCount:cellNumber(row.legacyTopPersonCount),topKeyword:cellText(row.legacyTopKeyword),topKeywordCount:cellNumber(row.legacyTopKeywordCount),stored:cellText(row.metricSource)==='已儲存彙整統計'}];
 });
}
export const rangeDays=(from:string,to:string)=>{const d=(Date.parse(to)-Date.parse(from))/86400000;return Number.isFinite(d)&&d>=0?Math.round(d)+1:0;};
export function periodStats(topics:PeriodTopic[]){
 return {dates:new Set(topics.map(t=>t.date)).size,stored:topics.filter(t=>t.stored).length};
}
