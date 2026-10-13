import type {Row} from '../db/client.js';
import type {ReportCell,ReportValue} from '../report-contracts.js';
import {cacheWeights,ReportReadBound} from './cache-weights.js';
import {BadQuery} from './query.js';
import {integer,object,text} from './normalize.js';
/** Presentation-only: rows keep raw numbers; cell detail text avoids float artifacts and "-0". */
const detailFormat=new Intl.NumberFormat('zh-TW',{maximumFractionDigits:3});
export const detailNumber=(value:number)=>detailFormat.format(value).replace(/^-(0)$/,'$1');
export function diffEnabled(value:unknown){if(value===undefined)return true;if(typeof value!=='string')throw new BadQuery('Invalid diff flag');const v=value.trim().toLowerCase();if(['1','true','on','yes'].includes(v))return true;if(['0','false','off','no',''].includes(v))return false;throw new BadQuery('Invalid diff flag');}
export function dayRanking(dates:string[],byDate:Map<string,Row>,field:string,requestedDiff:boolean,stop:Set<string>,keyword:boolean,withheld:ReadonlySet<string>=new Set()){
 const decoded=new Map(dates.map(date=>[date,cacheWeights(byDate.get(date)?.[field],{positiveOnly:false,countFirst:true})])),malformedDates=dates.filter(date=>byDate.has(date)&&decoded.get(date)?.status==='malformed');
 const pairs=new Map(dates.map(date=>[date,new Map([...(decoded.get(date)?.words??[])].filter(([term])=>!stop.has(term)))])),totals=new Map<string,number>();
 const identities=new Set([...byDate.values()].map(row=>row._cacheLineage?JSON.stringify(row._cacheLineage):'legacy')),complete=[...byDate.values()].every(row=>!row._cacheLineage||['version','rule','coverage'].every(k=>!!text(object(row._cacheLineage)[k])));
 const comparable=identities.size<=1&&complete&&!malformedDates.length,diff=requestedDiff&&comparable;
 for(const values of pairs.values())for(const [term,value]of values){const sum=(totals.get(term)??0)+value;if(!Number.isFinite(sum)||Math.abs(sum)>Number.MAX_SAFE_INTEGER)throw new ReportReadBound('Daily cache aggregate exceeds numeric precision');totals.set(term,sum);}
 const rows:{date:string;rank:number;term:string;dailyValue:number;periodTotal:number|null;total:number|null;value:number}[]=[],ranked=new Map<string,typeof rows>();
 for(const date of dates){const items=[...(pairs.get(date)??[])].map(([term,dailyValue])=>({date,rank:0,term,dailyValue,periodTotal:comparable?totals.get(term)!:null,total:comparable?totals.get(term)!:null,value:diff?dailyValue-totals.get(term)!/dates.length:dailyValue})).sort((a,b)=>b.value-a.value||a.term.localeCompare(b.term)).slice(0,31).map((r,i)=>({...r,rank:i+1}));ranked.set(date,items);rows.push(...items);}
 const matrix:Record<string,ReportValue|ReportCell>[]=[];for(let rank=0;rank<31;rank++){const row:Record<string,ReportValue|ReportCell>={rank:rank+1};let present=false;for(const date of dates){const r=ranked.get(date)?.[rank];row[date]=r?{value:r.term,href:`/keywords/${encodeURIComponent(r.term)}/videos`,detail:`${diff?'差值':'當日'} ${detailNumber(r.value)} · 當日 ${detailNumber(r.dailyValue)} · 期間合計 ${r.periodTotal===null?'不相容／無法確認':detailNumber(r.periodTotal)}`}:null;present||=!!r;}if(present)matrix.push(row);}
 const metrics=dates.map(date=>{const r=byDate.get(date);return {date,channels:r?integer(r.count_channels):null,videos:r?integer(r.count_videos):null,views:r&&!keyword?integer(r.total_views):null,status:!r?(withheld.has(date)?'withheld':'unavailable'):malformedDates.includes(date)?'malformed-terms':'available'};});
 const statusLabels:Record<string,string>={available:'已有快取',unavailable:'尚無快取',withheld:'暫不提供（待發布／觀測不足）','malformed-terms':'詞彙快取無法解析'};
 return {rows,matrix,metrics:metrics.map(row=>({...row,statusLabel:byDate.get(row.date)?._derived?'來源影片即時計算':statusLabels[row.status]})),diff,comparable,malformedDates};
}
