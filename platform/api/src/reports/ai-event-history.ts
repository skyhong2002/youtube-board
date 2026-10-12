import { dailyTopicTitle } from '../../../shared/daily-topic-title.js';
import {sql} from 'drizzle-orm';
import type {Reader,Row} from '../db/client.js';
import type {ReportCell,ReportValue} from '../report-contracts.js';
import {BadQuery,NotFound,positiveId,page} from './query.js';
import {aiItems,object,list,text,integer,latest} from './normalize.js';
import {table,link,type Register} from './table.js';
const day=(v:unknown)=>text(v).slice(0,10),previous=(d:string)=>new Date(Date.parse(d)-86400000).toISOString().slice(0,10);
const condition=(r:Row)=>text(r.condition_type)||'all';
const titles=(r:Row)=>aiItems(r.result_json).map(dailyTopicTitle);
const names=(v:unknown)=>[...new Set((Array.isArray(v)?v:Object.values(object(v))).filter((x):x is string=>typeof x==='string'&&x.trim()!==''&&x.length<=256))];
export function periodSourceIds(r:Row){const raw=list(r.data_json),ids=raw.map(integer);return raw.length===2&&ids.every((n):n is number=>n!==null&&n>0)?ids:[];}
export function periodPairs(value:unknown){let decoded=value;if(typeof value==='string'){try{decoded=JSON.parse(value);}catch{return [];}}const root=object(decoded);return (Array.isArray(decoded)?decoded:Array.isArray(root.matches)?root.matches:Object.values(root)).map(object).slice(0,200);}
export function tracePeriodChain(anchor:Row,event:string|string[],periods:Row[],sources:Row[]){
 const byId=new Map(sources.map(r=>[integer(r.pk),r])),rows:Record<string,ReportValue|ReportCell>[]=[],used:Row[]=[];
 let current=anchor,last=typeof event==='string'?[event]:event,stop='no-period';
 const append=(date:string,names:string[],dailyId:number,periodId:number|null)=>{for(const name of names)rows.push({date,event:link(name,`/ai/days/${dailyId}/events?event=${encodeURIComponent(name)}`),dailyId,periodId,association:periodId===null?'起始來源':'已儲存 AI 跨日對應'});};
 const initialId=integer(anchor.pk)??0;append(day(anchor.date_to),last,initialId,null);
 if(day(anchor.date_from)!==day(anchor.date_to))return {rows,used,stop:'multi-day-anchor'};
 for(let i=0;i<60;i++){
  const to=day(current.date_to),from=previous(to),period=periods.find(r=>day(r.date_from)===from&&day(r.date_to)===to&&periodSourceIds(r).includes(integer(current.pk)!))??periods.find(r=>day(r.date_from)===from&&day(r.date_to)===to);
  if(!period)break;
  const ids=periodSourceIds(period),currentId=integer(current.pk);
  if(ids.length!==2||new Set(ids).size!==2||!ids.includes(currentId!)){stop='source-mismatch';break;}
  const prior=byId.get(ids.find(id=>id!==currentId)!);
  if(!prior||day(prior.date_from)!==from||day(prior.date_to)!==from||condition(prior)!==condition(anchor)||text(prior.user_token)!==text(anchor.user_token)){stop='source-mismatch';break;}
  const found=[...new Set(periodPairs(period.result_json).flatMap(pair=>names(pair[to]).some(name=>last.includes(name))?names(pair[from]):[]))];
  if(!found.length){stop='no-match';break;}
  if(found.length>200||found.some(name=>titles(prior).filter(t=>t===name).length!==1)||last.some(name=>titles(current).filter(t=>t===name).length!==1)){stop='ambiguous-source';break;}
  append(from,found,integer(prior.pk)!,integer(period.pk));used.push(period);current=prior;last=found;stop=i===59?'day-cap':'no-period';
 }
 return {rows,used,stop};
}
export function registerAiEventHistory(register:Register,reader:Reader){
 const handler=(dailyRoute:boolean)=>async(p:Record<string,string>,q:Record<string,unknown>)=>{
 page(q);if(q.event!==undefined&&(typeof q.event!=='string'||q.event.length>256))throw new BadQuery('Invalid event name.');
 const id=positiveId(p.id),requested=text(q.event).trim();
 if((dailyRoute&&!requested)||(!dailyRoute&&q.event!==undefined))throw new BadQuery('Use the explicit daily history route for an event name.');
 const direct=dailyRoute?undefined:(await reader.rows(sql`SELECT pk,aipk,event_name FROM urt_ai_event WHERE pk=${id} AND del_flag IS NULL LIMIT 1`))[0];
 if(!dailyRoute&&!direct)throw new NotFound();
 const dailyId=direct?integer(direct.aipk):id,title=requested||text(direct?.event_name);if(!dailyId||!title)throw new NotFound();
 const anchor=(await reader.rows(sql`SELECT pk,ctime,mtime,date_from,date_to,condition_type,user_token,result_json FROM urt_ai_date WHERE pk=${dailyId} AND del_flag IS NULL LIMIT 1`))[0];if(!anchor)throw new NotFound();
 const analyses=await reader.rows(sql`SELECT MAX(pk) AS pk FROM urt_ai_event WHERE aipk=${dailyId} AND BINARY event_name=BINARY ${title} AND del_flag IS NULL GROUP BY prompt_type ORDER BY pk DESC LIMIT 32`);
 if(!titles(anchor).includes(title)&&!analyses.length)throw new NotFound();
 const to=day(anchor.date_to);if(!/^\d{4}-\d{2}-\d{2}$/.test(to)||!Number.isFinite(Date.parse(to)))throw new Error('Invalid stored AI source date');
 const c=condition(anchor),token=text(anchor.user_token);let current=anchor,last=[title];
 const chain=tracePeriodChain(anchor,title,[],[]);
 for(let step=0;step<60&&chain.stop!=='multi-day-anchor';step++){
  const to=day(current.date_to),from=previous(to),currentId=integer(current.pk)!;
  const period=(await reader.rows(sql`SELECT pk,ctime,mtime,date_from,date_to,result_json,data_json FROM urt_ai_period WHERE del_flag IS NULL AND date_from=${from} AND date_to=${to} AND (condition_type=${c} OR (${c}='all' AND condition_type IS NULL)) AND BINARY user_token=BINARY ${token} AND (JSON_CONTAINS(CASE WHEN JSON_VALID(data_json) THEN data_json ELSE '[]' END,${String(currentId)}) OR JSON_CONTAINS(CASE WHEN JSON_VALID(data_json) THEN data_json ELSE '[]' END,${JSON.stringify(String(currentId))})) ORDER BY pk DESC LIMIT 1`))[0];
  if(!period)break;
  // An invalid latest source-specific period stops the chain; older conflicting claims are not silently substituted.
  const previousId=periodSourceIds(period).find(id=>id!==currentId),prior=previousId?(await reader.rows(sql`SELECT pk,date_from,date_to,condition_type,user_token,result_json FROM urt_ai_date WHERE pk=${previousId} AND del_flag IS NULL LIMIT 1`))[0]:undefined;
  const hop=tracePeriodChain(current,last,[period],prior?[prior]:[]);if(!hop.used.length){chain.stop=hop.stop;break;}
  const added=hop.rows.slice(last.length);chain.rows.push(...added);chain.used.push(period);last=added.map(r=>text((r.event as ReportCell).value));current=prior!;if(step===59)chain.stop='day-cap';
 }
 const analysisIds=[...new Set([...analyses.map(a=>String(a.pk)),...(direct?[String(direct.pk)]:[])])];
 const reviewed=analysisIds.length?await reader.rows(sql`SELECT DISTINCT e.id,e.title,s.source_id,s.observed_at FROM ts_editorial_links l JOIN ts_editorial_sources s ON s.id=l.source_id JOIN ts_editorial_events e ON e.id=l.event_id WHERE l.active=1 AND e.merged_into IS NULL AND s.kind='event' AND s.source_id IN(${sql.join(analysisIds.map(id=>sql`${id}`),sql`,`)}) ORDER BY e.id,s.source_id LIMIT 50`):[];
 const reasons:Record<string,string>={'no-period':'尚無下一段已儲存的連續跨日對應。','no-match':'下一段跨日分析沒有對應到目前議題。','source-mismatch':'跨日對應的來源編號或來源範圍無法驗證，已停止追溯。','ambiguous-source':'來源議題已改變或名稱不唯一，已停止追溯。','day-cap':'已達 60 天追溯上限。','multi-day-anchor':'起始分析涵蓋多天，無法套用逐日追溯。'};
 const result=table(title+'：跨日來源脈絡',[{key:'date',label:'日期',kind:'date'},{key:'event',label:'來源議題'},{key:'association',label:'對應性質'},{key:'dailyId',label:'每日來源編號',kind:'number'},{key:'periodId',label:'跨日分析編號',kind:'number'}],chain.rows,q,{updatedAt:latest(anchor.mtime,anchor.ctime,...chain.used.flatMap(r=>[r.mtime,r.ctime])),notes:['只沿用既有跨日分析中的明確對應，最多回溯 60 天；同名、共同人物或關鍵字均不自行建立事件關係。','跨日對應是 AI 分析，不是編輯認定的事件身分。每一段須能驗證來源每日編號、日期與範圍；資料不足時停止。',reasons[chain.stop]??chain.stop],sections:[{title:'編輯已審核的事件關聯',columns:[{key:'event',label:'編輯事件'},{key:'sourceId',label:'已關聯分析編號',kind:'number'}],rows:reviewed.map(r=>({event:link(text(r.title),`/events/${text(r.id)}`),sourceId:integer(r.source_id)}))}]});
 return {...result,evidenceCoverage:{association:'stored-ai-period',days:chain.used.length,dayCap:60,stopReason:chain.stop,reviewedAssociations:reviewed.length}};
 };
 register('/ai/events/:id/history',handler(false));
 register('/ai/days/:id/events/history',handler(true));
}
