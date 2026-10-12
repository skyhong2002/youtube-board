import { aiBusinessKey } from '../../../shared/ai-business-key.js';
import { sql } from 'drizzle-orm';
import type { Reader,Row } from '../db/client.js';
import { integer,object,text } from './normalize.js';
export interface DailyLineage { runId:string|null; state:'immutable-snapshot'|'snapshot-unavailable'; channels:Map<number,string>; sources:Map<number,Row> }
/** Once a TS projection exists, never silently reinterpret it using mutable channel caches. */
export async function dailyLineage(reader:Reader,daily:Row):Promise<DailyLineage|null>{
 const runs=await reader.rows(sql`SELECT run_id,CASE WHEN OCTET_LENGTH(input_json)<=16777216 THEN input_json ELSE NULL END AS input_json,result_json,status FROM ts_ai_runs WHERE workflow='ai.daily' AND target_pk=${daily.pk} AND status='published' AND BINARY result_json=BINARY ${daily.result_json} ORDER BY updated_at DESC,run_id DESC LIMIT 1`);
 const empty:DailyLineage={runId:null,state:'snapshot-unavailable',channels:new Map(),sources:new Map()};
 if(!runs.length){const businessKey=aiBusinessKey('urt_ai_date',{date_from:daily.date_from,date_to:daily.date_to,data_type:daily.data_type,user_token:daily.user_token,condition_type:daily.condition_type??'all'});const exists=await reader.rows(sql`SELECT run_id FROM ts_ai_runs WHERE workflow='ai.daily' AND (target_pk=${daily.pk} OR business_key_sha256=${businessKey}) LIMIT 1`);return exists.length?empty:null;}
 const run=runs.find(r=>r.status==='published'&&text(r.result_json)===text(daily.result_json));
 if(!run)return empty;
 try{
  const snapshot=object(run.input_json),plan=object(snapshot.plan),key=object(plan.key);
  if(plan.table!=='urt_ai_date'||key.date_from!==daily.date_from||key.date_to!==daily.date_to||key.data_type!==daily.data_type||key.user_token!==daily.user_token||key.condition_type!==(daily.condition_type??'all')||!Array.isArray(plan.source)||plan.source.length>1000)return empty;
  const channels=new Map<number,string>(),sources=new Map<number,Row>(),names=new Set<string>();
  for(const raw of plan.source){const source=object(raw),id=integer(source.u_id),pk=integer(source.pk),name=text(source.title);if(!id||!pk||!name||channels.has(id)||names.has(name)||!Array.isArray(source.events))return empty;
   const events=source.events.map(object);const titles=new Set<string>();
   for(const e of events){const title=text(e.事件);if(!title||titles.has(title)||!Array.isArray(e.videoId)||!e.videoId.every(v=>typeof v==='string'&&/^[A-Za-z0-9_-]{11}$/.test(v)))return empty;titles.add(title);}
   names.add(name);channels.set(id,name);sources.set(id,{pk,result_json:events,snapshot_run_id:run.run_id});
  }
  return {runId:text(run.run_id),state:'immutable-snapshot',channels,sources};
 }catch{return empty;}
}
