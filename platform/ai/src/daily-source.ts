import type { Connection, RowDataPacket } from 'mysql2/promise';
import { aiBusinessKey, canonicalHash,laravelAiLock } from '../../shared/ai-business-key.js';
import { sourceIdentity } from './runner.js';
import { timestamp, type ChannelEvent, type ChannelSource, type Plan, type Condition } from './contracts.js';
export interface Topic { title:string; media:{u_id:number;channel:string;event:ChannelEvent}[] }
export interface DailySource { pk:string; date:string; from:string; to:string; condition:string; userToken:string; dataType:string; runId:string|null; result:string; channels:ChannelSource[]; topics:Topic[] }
export function day(value:string){timestamp(value+' 00:00:00');return value;}
export function condition(value='all'){if(!['all','green','blue','neutral','finance','world'].includes(value))throw new Error('Invalid daily condition');return value as Condition;}
export function token(value='CLI'){if(!/^[A-Za-z0-9_-]{1,32}$/.test(value))throw new Error('Invalid AI user token');return value;}
export function object(value:unknown):Record<string,unknown>{if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('Source object required');return value as Record<string,unknown>;}
export function text(value:unknown,max=2000){if(typeof value!=='string'||!value.trim()||value.length>max||/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value))throw new Error('Invalid source text');return value;}
export function list(value:unknown,min=0,max=200):unknown[]{if(!Array.isArray(value)||value.length<min||value.length>max)throw new Error('Invalid source list');return value;}
const videoIdPattern=/^[A-Za-z0-9_-]{11}$/;
/**
 * `repair` is only for Laravel-written channel outputs (no TS snapshot): their AI output carries truncated or
 * hallucinated video IDs, duplicates and blank fields. Repair keeps only well-formed unique IDs and drops events
 * that stay invalid; TS snapshots stay strict.
 */
function events(value:unknown,repair=false):ChannelEvent[]{
 return list(value,0,500).flatMap(raw=>{
  if(!repair)return [strictEvent(raw)];
  try{const e=object(raw);const ids=Array.isArray(e.videoId)?[...new Set(e.videoId.filter((v):v is string=>typeof v==='string'&&videoIdPattern.test(v)))]:e.videoId;return [strictEvent({...e,videoId:ids})];}catch{return [];}
 });
}
function strictEvent(raw:unknown):ChannelEvent{
 const e=object(raw);for(const key of ['事件','描述','角度','陣營','分類'])text(e[key]);for(const key of ['關鍵字','人物','地名','類型'])list(e[key],0,100).forEach(v=>text(v));const ids=list(e.videoId,1,500).map(v=>text(v));if(ids.some(v=>!videoIdPattern.test(v))||new Set(ids).size!==ids.length)throw new Error('Invalid source video IDs');return e as unknown as ChannelEvent;
}
/** A TS daily projection always resolves the exact journal, never a newer channel cache. */
export async function loadDailySource(db:Connection,date:string,filter='all',userToken='CLI'):Promise<DailySource>{
 day(date);condition(filter);token(userToken);
 const [rows]=await db.query<RowDataPacket[]>('SELECT * FROM urt_ai_date WHERE date_from=? AND date_to=? AND data_type=\'oneday\' AND (condition_type=? OR (?=\'all\' AND condition_type IS NULL)) AND BINARY user_token=BINARY ? AND del_flag IS NULL ORDER BY pk DESC LIMIT 1',[date+' 00:00:00',date+' 23:59:59',filter,filter,userToken]);
 const row=rows[0];if(row&&(typeof row.date_from!=='string'||typeof row.date_to!=='string'))throw new Error('AI connection requires dateStrings:true');if(!row)throw new Error('daily_source_missing');
 const key={date_from:row.date_from,date_to:row.date_to,data_type:row.data_type,condition_type:row.condition_type??'all',user_token:row.user_token};
 const business=aiBusinessKey('urt_ai_date',key);
 const [runs]=await db.query<RowDataPacket[]>('SELECT * FROM ts_ai_runs WHERE workflow=\'ai.daily\' AND (target_pk=? OR business_key_sha256=?) ORDER BY updated_at DESC,run_id DESC',[row.pk,business]);
 let channels:ChannelSource[],runId:string|null=null,repair=false;
 if(runs.length){
  const run=runs.find(r=>r.status==='published'&&String(r.target_pk)===String(row.pk)&&r.result_json===row.result_json);if(!run)throw new Error('daily_snapshot_unavailable');
  const snapshot=JSON.parse(String(run.input_json)),plan=snapshot.plan as Plan;
  if(plan.table!=='urt_ai_date'||canonicalHash(plan.key)!==canonicalHash(key)||sourceIdentity(plan,snapshot.model,snapshot.version)!==run.input_sha256)throw new Error('daily_snapshot_corrupt');
  channels=list(plan.source,1,200).map(v=>{const s=object(v);return {pk:text(String(s.pk),20),u_id:Number(s.u_id),title:text(s.title),events:events(s.events)};});runId=String(run.run_id);
 }else{
  repair=true;
  const map=object(JSON.parse(String(row.channel_id))),ids=Object.keys(map).map(Number);if(!ids.length||ids.length>200||ids.some(id=>!Number.isSafeInteger(id)||id<1))throw new Error('Invalid daily channel map');
  const [sources]=await db.query<RowDataPacket[]>(`SELECT a.pk,a.u_id,a.result_json FROM urt_channel_ai a WHERE a.date_from=? AND a.date_to=? AND a.data_type=? AND BINARY a.user_token=BINARY ? AND a.del_flag IS NULL AND a.ctime<=? AND (a.mtime IS NULL OR a.mtime<=?) AND a.u_id IN (${ids.map(()=>'?').join(',')}) ORDER BY a.pk DESC`,[row.date_from,row.date_to,row.data_type,userToken,row.ctime,row.ctime,...ids]);
  channels=ids.map(id=>{const s=sources.find(s=>Number(s.u_id)===id);if(!s)throw new Error('channel_source_missing');const raw=JSON.parse(String(s.result_json));return {pk:String(s.pk),u_id:id,title:text(map[String(id)]),events:events(Array.isArray(raw)?raw:object(raw).events,true)};});
 }
 const byName=new Map(channels.map(c=>[c.title,c]));if(byName.size!==channels.length||new Set(channels.map(c=>c.u_id)).size!==channels.length)throw new Error('Ambiguous channel source');
 for(const c of channels)if(!Number.isSafeInteger(c.u_id)||c.u_id<1||new Set(c.events.map(e=>e.事件)).size!==c.events.length)throw new Error('Ambiguous channel event');
 const raw=JSON.parse(String(row.result_json));const titles=new Set<string>();
 // Some Laravel rows key 媒體事件 by channel event name instead of media name; repair resolves those names against every
 // channel's events.
 const byEvent=(names:unknown)=>(Array.isArray(names)?names.slice(0,100):[]).flatMap(name=>typeof name!=='string'?[]:channels.flatMap(c=>c.events.filter(e=>e.事件===name).map(event=>({u_id:c.u_id,channel:c.title,event}))));
 // Repair (legacy rows only) keeps the first topic of a repeated title, skips references to media or events that did not
 // survive parsing, and topics left without any.
 const topics=list(Array.isArray(raw)?raw:object(raw).events,1,200).flatMap(v=>{
  const item=object(v),title=text(item.標題,128);if(titles.has(title)){if(repair)return [];throw new Error('Duplicate daily title');}titles.add(title);
  const references=object(item.媒體事件);if(!Object.keys(references).length){if(repair)return [];throw new Error('Missing daily references');}
  const media=Object.entries(references).flatMap(([name,names])=>{const channel=byName.get(name);if(!channel){if(repair)return byEvent(names);throw new Error('Unresolved daily media');}
   const refs=repair?(Array.isArray(names)?names.slice(0,100):[]):list(names,1,100);
   return refs.flatMap(name=>{const event=repair?(typeof name==='string'?channel.events.find(e=>e.事件===name):undefined):channel.events.find(e=>e.事件===text(name));if(!event){if(repair)return [];throw new Error('Unresolved daily event');}return [{u_id:channel.u_id,channel:channel.title,event}];});});
  // One media/event pair once, even when a legacy row also names it under an event-name key.
  const seen=new Set<string>(),unique=media.filter(m=>{const k=m.u_id+'\u0000'+m.event.事件;if(seen.has(k))return false;seen.add(k);return true;});
  return repair&&!unique.length?[]:[{title,media:repair?unique:media}];
 });
 return {pk:String(row.pk),date,from:String(row.date_from),to:String(row.date_to),condition:filter,userToken,dataType:String(row.data_type),runId,result:String(row.result_json),channels,topics};
}
export function dailyLock(source:DailySource){return laravelAiLock('urt_ai_date',{date_from:source.from,date_to:source.to,data_type:source.dataType,user_token:source.userToken,condition_type:source.condition});}
