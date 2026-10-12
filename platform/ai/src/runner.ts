import {aiSourceHash} from '../../shared/ai-snapshot-hash.js';
import {workflowShutdownSignal} from '../../shared/shutdown.js';
import { canonicalHash as hash,aiBusinessKey,laravelAiLock } from '../../shared/ai-business-key.js';
import type { Connection,RowDataPacket,ResultSetHeader } from 'mysql2/promise';
import { PROMPT_VERSION,validateResult,type Input,type Plan,type Video } from './contracts.js';
import { planAi } from './planner.js';
import { RetryableProviderError,type Provider } from './provider.js';
export function sourceIdentity(plan:Plan,model:string,version=PROMPT_VERSION){return aiSourceHash(plan,model,version);}
const now=()=>new Date(Date.now()+8*3600000).toISOString().slice(0,19).replace('T',' ');
export interface RunOptions { execute:boolean; assertAuthorized:()=>void; provider:Provider; modelAlias:string; retryFailed?:boolean; scheduledRecovery?:boolean; missingOnly?:boolean; sourceCapture?:unknown; reserveCall?:()=>void }
/** Connection-owned key covers all revisions. Legacy MyISAM writes are recoverable projections:
 * persist the validated output first, then idempotently upsert the business key, then mark published.
 */
export async function runAi(db:Connection,input:Input,options:RunOptions){
  if(options.execute){workflowShutdownSignal().throwIfAborted();options.assertAuthorized();}
  let plan=await planAi(db,input);
  if(!options.execute)return {mode:'dry-run',workflow:`ai.${input.kind}`,sourceCount:plan.sourceCount,omitted:plan.omitted,blocked:plan.blocked,externalCalls:0,writes:0};
  if(options.modelAlias!=='sky-quality')throw new Error('AI model alias required');
  const businessKey=aiBusinessKey(plan.table,plan.key); const lock=laravelAiLock(plan.table,plan.key);
  const [locks]=await db.query<RowDataPacket[]>('SELECT GET_LOCK(?,0) acquired',[lock]);
  if(Number(locks[0]?.acquired)!==1)throw new Error('AI business key is locked');
  let runId:string|undefined;let attemptStarted=false;
  try{
    plan=await planAi(db,input);
    if(options.missingOnly){const complete=await existingAi(db,plan);if(complete)return {status:'unchanged',targetPk:String(complete.pk),sourceCount:plan.sourceCount,omitted:plan.omitted,reason:complete.legacyUnvalidated?'legacy_present_unvalidated':'existing_valid',scopeUnverified:!!complete.legacyUnvalidated&&input.kind==='hourly'};}
    if(plan.blocked)return {status:'blocked',reason:plan.blocked,sourceCount:plan.sourceCount,omitted:plan.omitted};
    if(input.kind==='hourly'){
      const [current]=await db.query<RowDataPacket[]>(`SELECT pk FROM urt_ai_hour WHERE ${legacyKeyPredicate(plan.key)} AND del_flag IS NULL ORDER BY pk DESC LIMIT 1`,Object.values(plan.key));
      const [scopes]=await db.query<RowDataPacket[]>("SELECT input_json FROM ts_ai_runs WHERE workflow='ai.hourly' AND (business_key_sha256=? OR target_pk=?) AND status IN ('published','validated') ORDER BY updated_at DESC LIMIT 1",[businessKey,current[0]?.pk??null]);
      if(scopes[0]){const priorInput=JSON.parse(String(scopes[0].input_json)).plan.input;if((priorInput.condition===undefined)!==(plan.input.condition===undefined))throw new Error('hourly_scope_conflict');}
    }
    const inputJson=JSON.stringify({version:PROMPT_VERSION,model:options.modelAlias,plan,sourceCapture:options.sourceCapture??null});
    const sourceHash=sourceIdentity(plan,options.modelAlias);runId=hash({businessKey,sourceHash});
    const [prior]=await db.query<RowDataPacket[]>('SELECT * FROM ts_ai_runs WHERE run_id=?',[runId]);
    let result:string|null=null, providerMeta:string|null=null;
    if(prior[0]){
      if(sourceIdentity(JSON.parse(String(prior[0].input_json)).plan,options.modelAlias)!==sourceHash)throw new Error('AI immutable input mismatch');
      if(prior[0].result_json){result=String(prior[0].result_json);providerMeta=String(prior[0].provider_json);}
      else if(!options.retryFailed&&!canRecoverScheduled(prior[0],options.scheduledRecovery))throw new Error('Previous AI attempt is incomplete; explicit retryFailed required');
    }
    if(!result){
      workflowShutdownSignal().throwIfAborted();options.assertAuthorized();options.reserveCall?.();workflowShutdownSignal().throwIfAborted();options.assertAuthorized();
      if(!prior[0])await db.execute('INSERT INTO ts_ai_runs(run_id,workflow,business_key_sha256,input_sha256,input_json,status,created_at,updated_at) VALUES(?,?,?,?,?,\'running\',?,?)',[runId,`ai.${input.kind}`,businessKey,sourceHash,inputJson,now(),now()]);
      await db.execute("UPDATE ts_ai_runs SET status='running',failure_code=NULL,provider_json=?,updated_at=? WHERE run_id=?",[JSON.stringify({generationAttempts:generationAttempts(prior[0])+1}),now(),runId]);
      attemptStarted=true;
      const completion=await options.provider.complete(plan);
      if(completion.requestedModel!==options.modelAlias)throw new Error('Provider alias differs from immutable request');
      const validated=validateResult(completion.content,plan);result=JSON.stringify(validated);
      if(Buffer.byteLength(result)>60000)throw new Error('AI projection exceeds TEXT capacity');
      providerMeta=JSON.stringify({requestedModel:completion.requestedModel,model:completion.model,usage:usageSummary(completion.usage),attempts:completion.attempts??1,generationAttempts:generationAttempts(prior[0])+1});
      await db.execute("UPDATE ts_ai_runs SET status='validated',result_json=?,provider_json=?,updated_at=? WHERE run_id=?",[result,providerMeta,now(),runId]);
    }
    options.assertAuthorized();
    const [owners]=await db.query<RowDataPacket[]>('SELECT IS_USED_LOCK(?)=CONNECTION_ID() owned',[lock]);if(Number(owners[0]?.owned)!==1)throw new Error('AI writer lock lost');
    const fresh=await verifySelectedSource(db,plan);if(sourceIdentity(fresh,options.modelAlias)!==sourceHash)throw new Error('AI source changed during generation');
    const keys=Object.keys(plan.key),values=Object.values(plan.key);
    const [existing]=await db.query<RowDataPacket[]>(`SELECT pk,result_json,ai_type FROM ${plan.table} WHERE ${legacyKeyPredicate(plan.key)} AND del_flag IS NULL ORDER BY pk DESC LIMIT 1`,values);
    const projection:Record<string,string|number>={...plan.key,mtime:now(),ai_type:options.modelAlias,result_json:result};
    if(plan.table==='urt_ai_date')projection.channel_id=JSON.stringify(Object.fromEntries((plan.source as {title:string;u_id:number}[]).map(s=>[String(s.u_id),s.title])));
    let targetPk=existing[0]?.pk;
    if(prior[0]?.status==='published'&&existing[0]?.result_json===result&&existing[0]?.ai_type===options.modelAlias)return {status:'unchanged',runId,targetPk:String(targetPk),sourceCount:plan.sourceCount,omitted:plan.omitted};
    if(targetPk)await db.execute("UPDATE ts_ai_runs SET target_pk=? WHERE run_id=?",[targetPk,runId]);
    if(targetPk){const [written]=await db.execute<ResultSetHeader>(`UPDATE ${plan.table} SET ${Object.keys(projection).map(k=>`${k}=?`).join(',')} WHERE pk=? AND del_flag IS NULL`,[...Object.values(projection),targetPk]);if(written.affectedRows!==1)throw new Error('AI projection target changed');}
    else{projection.ctime=now();const [insert]=await db.execute<ResultSetHeader>(`INSERT INTO ${plan.table}(${Object.keys(projection).join(',')}) VALUES(${Object.keys(projection).map(()=>'?').join(',')})`,Object.values(projection));targetPk=insert.insertId;}
    await db.execute("UPDATE ts_ai_runs SET status='published',target_pk=?,failure_code=NULL,updated_at=? WHERE run_id=?",[targetPk,now(),runId]);
    return {status:'published',runId,targetPk:String(targetPk),sourceCount:plan.sourceCount,omitted:plan.omitted};
  }catch(error){
    if(runId&&attemptStarted)await db.execute("UPDATE ts_ai_runs SET status=IF(result_json IS NULL,'failed','validated'),failure_code=?,updated_at=? WHERE run_id=? AND status<>'published'",[error instanceof RetryableProviderError?'provider_transient':'generation_or_projection_failed',now(),runId]).catch(()=>undefined);
    throw error;
  }finally{await db.query('SELECT RELEASE_LOCK(?)',[lock]).catch(()=>undefined);}
}

function usageSummary(raw:unknown){if(!raw||typeof raw!=='object')return null;const value=raw as Record<string,unknown>;return Object.fromEntries(['prompt_tokens','completion_tokens','total_tokens'].filter(k=>Number.isSafeInteger(value[k])&&Number(value[k])>=0).map(k=>[k,value[k]]));}

/** Scheduled catch-up may retry failed requests. A crashed in-flight request gets a five-minute cooldown. */
export function generationAttempts(prior:Record<string,unknown>|undefined):number {
 if(!prior)return 0;
 try{const meta=JSON.parse(String(prior.provider_json??'{}'));if(meta.generationAttempts===undefined)return 1;return Number.isSafeInteger(meta.generationAttempts)&&meta.generationAttempts>=1?meta.generationAttempts:3;}catch{return 3;}
}
export function canRecoverScheduled(prior:Record<string,unknown>,scheduled=false):boolean {
 if(!scheduled||prior.result_json||generationAttempts(prior)>=3)return false;
 const cooledDown=Date.now()-Date.parse(String(prior.updated_at).replace(' ','T')+'+08:00')>=300000;
 if(prior.status==='failed')return prior.failure_code==='provider_transient'||cooledDown;
 return prior.status==='running'&&cooledDown;
}

export async function existingAi(db:Connection,plan:Plan):Promise<RowDataPacket|null>{
 const keys=Object.keys(plan.key);const [rows]=await db.query<RowDataPacket[]>(`SELECT pk,result_json FROM ${plan.table} WHERE ${legacyKeyPredicate(plan.key)} AND del_flag IS NULL ORDER BY pk DESC LIMIT 1`,Object.values(plan.key));const row=rows[0];if(!row)return null;
 try{
  const [runs]=await db.query<RowDataPacket[]>("SELECT input_json,input_sha256 FROM ts_ai_runs WHERE workflow=? AND target_pk=? AND status='published' AND BINARY result_json=BINARY ? ORDER BY updated_at DESC LIMIT 1",['ai.'+plan.input.kind,row.pk,row.result_json]);
  const snapshot=runs[0]?JSON.parse(String(runs[0].input_json)):null;const sourcePlan=snapshot?snapshot.plan as Plan:plan;
  if(!snapshot){
   // Missing-only must not silently adopt and rewrite historical output under a newer contract.
   const legacy=JSON.parse(String(row.result_json)),items=Array.isArray(legacy)?legacy:legacy?.events;
   if(Array.isArray(items)&&items.length>0&&items.every(v=>v&&typeof v==='object'&&!Array.isArray(v)))return {...row,legacyUnvalidated:true} as RowDataPacket;
   return null;
  }
  if(snapshot&&sourceIdentity(sourcePlan,snapshot.model,snapshot.version)!==runs[0]!.input_sha256)return null;
  if(plan.input.kind==='hourly'&&(sourcePlan.input.condition===undefined)!==(plan.input.condition===undefined))return null;
  const raw=JSON.parse(String(row.result_json));const events=Array.isArray(raw)?raw:raw.events;if(!Array.isArray(events))return null;
  const response=sourcePlan.input.kind==='daily'?events.map(e=>({...e,媒體事件:Array.isArray(e.媒體事件)?e.媒體事件:Object.entries(e.媒體事件??{}).map(([媒體,事件])=>({媒體,事件}))})):events;
  const normalized=validateResult(JSON.stringify({events:response}),sourcePlan);if(normalized.length!==events.length)return null;return row;
 }catch{return null;}
}

/** Legacy NULL all rows are adopted on update; user tokens retain exact separation. */
export function legacyKeyPredicate(key:Record<string,string|number>){return Object.keys(key).map(k=>k==='condition_type'&&key[k]==='all'?"(condition_type=? OR condition_type IS NULL)":k==='user_token'?"BINARY user_token=BINARY ?":`${k}=?`).join(' AND ');}
/** Recheck the actual selected video text, not a changing view-ranked top-N window. */
async function verifySelectedSource(db:Connection,plan:Plan):Promise<Plan>{
 if(plan.input.kind==='daily')return planAi(db,plan.input);
 const selected=plan.source as Video[];
 const [rows]=await db.query<RowDataPacket[]>(`SELECT pk,u_id,videoId,title,publishedAt,viewCount FROM urt_video WHERE pk IN (${selected.map(()=>'?').join(',')})`,selected.map(v=>v.pk));
 const source=rows.map(row=>({pk:String(row.pk),u_id:Number(row.u_id),videoId:String(row.videoId),title:String(row.title??''),publishedAt:String(row.publishedAt),viewCount:String(row.viewCount??0)}));
 return {...plan,source};
}
