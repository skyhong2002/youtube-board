import {createHash} from 'node:crypto';
import {sql} from 'drizzle-orm';
import {aiBusinessKey,canonicalHash} from '../../../shared/ai-business-key.js';
import {aiSourceHash,aiDerivedHash} from '../../../shared/ai-snapshot-hash.js';
import {DataQueryFailed,type Reader,type Row} from '../db/client.js';
import {object,text} from './normalize.js';

type Workflow='ai.hourly'|'ai.daily'|'ai.mayor_person';
export type PublicationState='legacy-unrecorded'|'immutable-snapshot'|'unpublished'|'diverged'|'snapshot-unavailable'|'oversized'|'journal-unavailable'|'budget-exhausted'|'history-unverified';
export interface Publication {state:PublicationState;runId:string|null}
export const publicationVisible=(p:Publication)=>p.state==='legacy-unrecorded'||p.state==='immutable-snapshot';
export const publicationNote='AI 只呈現未有 TypeScript 接管紀錄的歷史資料，或與已發布不可變快照一致的輸出；尚未發布、發布後被改寫或快照缺漏的資料暫不呈現。曾嘗試接管但歸屬未明的歷史列也會暫緩顯示，須先核對紀錄。';
export const aiOutputFields=sql`CASE WHEN OCTET_LENGTH(result_json)<=131072 THEN result_json ELSE NULL END AS result_json,OCTET_LENGTH(result_json) AS result_bytes`;
export const topicOutputFields=sql`CASE WHEN OCTET_LENGTH(data_json)<=131072 THEN data_json ELSE NULL END AS data_json,OCTET_LENGTH(data_json) AS data_bytes`;
const tables={ 'ai.hourly':'urt_ai_hour','ai.daily':'urt_ai_date','ai.mayor_person':'urt_mayor_person_ai'};
const digest=(v:unknown)=>createHash('sha256').update(text(v)).digest('hex');
export const publicationKey=(workflow:Workflow,row:Row):Record<string,unknown>=>workflow==='ai.mayor_person'?{city_key:row.city_key,person:row.person,the_date:row.the_date,user_token:row.user_token}:{date_from:row.date_from,date_to:row.date_to,data_type:row.data_type,user_token:row.user_token,condition_type:row.condition_type??'all'};
export const publicationBudget=()=>({remaining:16*1024*1024});
/** Exact output can stay visible while another revision is pending. No mutable source is read. */
export async function aiPublication(reader:Reader,workflow:Workflow,row:Row,budget=publicationBudget()):Promise<Publication>{
 try{return await inspectAiPublication(reader,workflow,row,budget);}catch(error){if(error instanceof DataQueryFailed&&error.driverCode==='ER_NO_SUCH_TABLE')return {state:'journal-unavailable',runId:null};throw error;}
}
async function inspectAiPublication(reader:Reader,workflow:Workflow,row:Row,budget:ReturnType<typeof publicationBudget>):Promise<Publication>{
 const result=(state:PublicationState,runId:string|null=null):Publication=>({state,runId});
 if(Number(row.result_bytes)>131072)return result('oversized');
 const key=publicationKey(workflow,row),business=aiBusinessKey(tables[workflow],key),max=Math.min(budget.remaining,2*1024*1024);
 const run=(await reader.rows(sql`SELECT run_id,input_sha256,OCTET_LENGTH(input_json) AS input_bytes,CASE WHEN OCTET_LENGTH(input_json)<=${max} THEN input_json ELSE NULL END AS input_json FROM ts_ai_runs WHERE workflow=${workflow} AND target_pk=${row.pk} AND business_key_sha256=${business} AND status='published' AND SHA2(CONVERT(result_json USING utf8mb4),256)=${digest(row.result_json)} ORDER BY updated_at DESC,run_id DESC LIMIT 1`))[0];
 if(!run){
  const state=(await reader.rows(sql`SELECT EXISTS(SELECT 1 FROM ts_ai_runs WHERE workflow=${workflow} AND (target_pk=${row.pk} OR (target_pk IS NULL AND business_key_sha256=${business}))) AS claimed,EXISTS(SELECT 1 FROM ts_ai_runs WHERE workflow=${workflow} AND target_pk=${row.pk} AND status='published') AS published_before`))[0];
  return result(Number(state?.claimed)?Number(state?.published_before)?'diverged':'unpublished':'legacy-unrecorded');
 }
 if(Number(run.input_bytes)>2*1024*1024)return result('oversized');
 if(Number(run.input_bytes)>max)return result('budget-exhausted');
 if(!run.input_json)return result('snapshot-unavailable');
 budget.remaining-=Number(run.input_bytes);
 try{
  const snapshot=object(run.input_json),plan=object(snapshot.plan),input=object(plan.input);
  if(plan.table!==tables[workflow]||canonicalHash(plan.key)!==canonicalHash(key))return result('snapshot-unavailable');
  let hash:string,runId:string;
  if(workflow==='ai.mayor_person'){
   if(snapshot.version!=='yt-ai-derived-v1'||plan.workflow!==workflow)return result('snapshot-unavailable');
   hash=aiDerivedHash(plan as unknown as Parameters<typeof aiDerivedHash>[0]);runId=canonicalHash({business,inputHash:hash});
  }else{
   if(snapshot.version!=='yt-ai-v2'||snapshot.model!=='sky-quality'||input.kind!==workflow.slice(3)||!Array.isArray(plan.source)||plan.source.length>5000)return result('snapshot-unavailable');
   hash=aiSourceHash(plan as unknown as Parameters<typeof aiSourceHash>[0],snapshot.model,snapshot.version);runId=canonicalHash({businessKey:business,sourceHash:hash});
  }
  if(hash!==run.input_sha256||runId!==run.run_id)return result('snapshot-unavailable');
  const output=JSON.parse(text(row.result_json));if(!output||typeof output!=='object')return result('snapshot-unavailable');
  return result('immutable-snapshot',text(run.run_id));
 }catch{return result('snapshot-unavailable');}
}
/** Topic projection has a distinct journal; a published daily output alone does not publish its cache. */
export async function topicPublication(reader:Reader,row:Row,daily:Publication,budget=publicationBudget()):Promise<Publication>{
 try{return await inspectTopicPublication(reader,row,daily,budget);}catch(error){if(error instanceof DataQueryFailed&&error.driverCode==='ER_NO_SUCH_TABLE')return {state:'journal-unavailable',runId:null};throw error;}
}
async function inspectTopicPublication(reader:Reader,row:Row,daily:Publication,budget:ReturnType<typeof publicationBudget>):Promise<Publication>{
 const result=(state:PublicationState,runId:string|null=null):Publication=>({state,runId});
 if(Number(row.data_bytes)>131072)return result('oversized');
 const workflow='reports.ai_topic.build',business=canonicalHash({workflow,pk:String(row.pk)}),max=Math.min(budget.remaining,8*1024*1024);
 const input=sql`IF(JSON_VALID(input_json),input_json,'{}')`;
 const run=(await reader.rows(sql`SELECT run_id,input_sha256,OCTET_LENGTH(input_json)+OCTET_LENGTH(result_json) AS input_bytes,CASE WHEN OCTET_LENGTH(input_json)+OCTET_LENGTH(result_json)<=${max} THEN input_json ELSE NULL END AS input_json,CASE WHEN OCTET_LENGTH(input_json)+OCTET_LENGTH(result_json)<=${max} THEN result_json ELSE NULL END AS result_json FROM (SELECT run_id,input_sha256,input_json,result_json,updated_at FROM ts_ai_runs WHERE workflow=${workflow} AND target_pk=${row.pk} AND business_key_sha256=${business} AND status='published' ORDER BY updated_at DESC,run_id DESC LIMIT 8) candidates WHERE BINARY JSON_UNQUOTE(JSON_EXTRACT(${input},'$.dataJson'))=BINARY ${row.data_json} AND BINARY JSON_UNQUOTE(JSON_EXTRACT(${input},'$.source.result'))=BINARY ${row.result_json} ORDER BY updated_at DESC,run_id DESC LIMIT 1`))[0];
 if(!run){const state=(await reader.rows(sql`SELECT EXISTS(SELECT 1 FROM ts_ai_runs WHERE workflow=${workflow} AND (target_pk=${row.pk} OR (target_pk IS NULL AND business_key_sha256=${business}))) AS claimed,EXISTS(SELECT 1 FROM ts_ai_runs WHERE workflow=${workflow} AND target_pk=${row.pk} AND status='published') AS published_before,((SELECT COUNT(*) FROM (SELECT 1 FROM ts_ai_runs WHERE workflow=${workflow} AND target_pk=${row.pk} AND business_key_sha256=${business} AND status='published' LIMIT 9) history_candidates)>8) AS history_bounded`))[0];if(Number(state?.history_bounded))return result('history-unverified');return result(Number(state?.claimed)?Number(state?.published_before)?'diverged':'unpublished':daily.state==='legacy-unrecorded'?'legacy-unrecorded':'snapshot-unavailable');}
 if(Number(run.input_bytes)>8*1024*1024)return result('oversized');
 if(Number(run.input_bytes)>max)return result('budget-exhausted');
 if(!run.input_json||!run.result_json)return result('snapshot-unavailable');budget.remaining-=Number(run.input_bytes);
 try{
  const snapshot=object(run.input_json),source=object(snapshot.source),hash=canonicalHash(snapshot);
  if(hash!==run.input_sha256||canonicalHash({business,inputHash:hash})!==run.run_id||String(source.pk)!==String(row.pk)||source.from!==row.date_from||source.to!==row.date_to||source.condition!==(row.condition_type??'all')||source.userToken!==row.user_token||source.dataType!==row.data_type||source.result!==row.result_json||source.runId!==daily.runId||snapshot.dataJson!==row.data_json||JSON.stringify(snapshot.topics)!==snapshot.dataJson||JSON.stringify(snapshot.videos)!==snapshot.videoJson||JSON.stringify({topics:snapshot.topics,videos:snapshot.videos})!==run.result_json)return result('snapshot-unavailable');
  return result('immutable-snapshot',text(run.run_id));
 }catch{return result('snapshot-unavailable');}
}
export function publicationCoverage(states:Publication[]){return {sourceRows:states.length,visibleSources:states.filter(publicationVisible).length,legacySources:states.filter(p=>p.state==='legacy-unrecorded').length,publishedSources:states.filter(p=>p.state==='immutable-snapshot').length,withheldSources:states.filter(p=>p.state==='unpublished').length,divergedSources:states.filter(p=>p.state==='diverged').length,unavailableSnapshots:states.filter(p=>p.state==='snapshot-unavailable').length,oversizedSources:states.filter(p=>p.state==='oversized').length,unavailableJournals:states.filter(p=>p.state==='journal-unavailable').length,budgetExhaustedSources:states.filter(p=>p.state==='budget-exhausted').length,unverifiedHistorySources:states.filter(p=>p.state==='history-unverified').length};}
