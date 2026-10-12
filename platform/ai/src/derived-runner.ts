import {aiDerivedHash} from '../../shared/ai-snapshot-hash.js';
import {workflowShutdownSignal} from '../../shared/shutdown.js';
import type { Connection, RowDataPacket, ResultSetHeader } from 'mysql2/promise';
import { aiBusinessKey, canonicalHash as hash,laravelAiLock } from '../../shared/ai-business-key.js';
import {RetryableProviderError,type ProviderRequest } from './provider.js';
import {canRecoverScheduled,generationAttempts,type RunOptions} from './runner.js';
export interface DerivedPlan extends ProviderRequest {
 workflow:'ai.event'|'ai.period'|'ai.mayor_person'; table:'urt_ai_event'|'urt_ai_period'|'urt_mayor_person_ai'; key:Record<string,string|number>;
 columns:Record<string,string|number>; source:unknown; locks:string[]; sourceCount:number;
}
const now=()=>new Date(Date.now()+8*3600000).toISOString().slice(0,19).replace('T',' ');
export const derivedHash=(p:DerivedPlan)=>aiDerivedHash(p);
/** Journal first; legacy MyISAM projection second. Replays validate saved output and repair only their own business key. */
export async function runDerived(db:Connection,planner:(phase?:'preview'|'locked'|'verify')=>Promise<DerivedPlan>,validate:(content:string,p:DerivedPlan)=>unknown,options:RunOptions,replay:(result:unknown)=>unknown=v=>v){
 if(options.execute){workflowShutdownSignal().throwIfAborted();options.assertAuthorized();}
 let plan=await planner('preview');if(!options.execute)return {status:'dry-run',workflow:plan.workflow,sourceCount:plan.sourceCount,externalCalls:0,writes:0};
 if(options.modelAlias!=='sky-quality')throw new Error('AI model alias required');
 const business=aiBusinessKey(plan.table,plan.key);
 const locks=[...new Set([...plan.locks,derivedBusinessLock(plan)])].sort(),held:string[]=[];
 let runId:string|undefined;let attemptStarted=false;
 try{
  for(const lock of locks){const [rows]=await db.query<RowDataPacket[]>('SELECT GET_LOCK(?,0) acquired',[lock]);if(Number(rows[0]?.acquired)!==1)throw new Error('AI business key is locked');held.push(lock);}
  plan=await planner('locked');if(aiBusinessKey(plan.table,plan.key)!==business||plan.locks.some(l=>!held.includes(l)))throw new Error('AI source identity changed');
  const inputHash=derivedHash(plan);runId=hash({business,inputHash});
  const [priorRows]=await db.query<RowDataPacket[]>('SELECT * FROM ts_ai_runs WHERE run_id=?',[runId]);const prior=priorRows[0];let result:string|undefined;
  if(prior){const saved=JSON.parse(String(prior.input_json));if(prior.input_sha256!==inputHash||derivedHash(saved.plan)!==inputHash||prior.business_key_sha256!==business)throw new Error('AI immutable input mismatch');if(plan.workflow==='ai.mayor_person')plan=saved.plan;if(prior.result_json){result=JSON.stringify(validate(JSON.stringify(replay(JSON.parse(String(prior.result_json)))),plan));if(result!==prior.result_json)throw new Error('AI saved output mismatch');}else if(!options.retryFailed&&!canRecoverScheduled(prior,options.scheduledRecovery))throw new Error('Previous AI attempt incomplete; explicit retryFailed required');}
  if(!result){
   workflowShutdownSignal().throwIfAborted();options.assertAuthorized();options.reserveCall?.();workflowShutdownSignal().throwIfAborted();options.assertAuthorized();
   if(!prior)await db.execute("INSERT INTO ts_ai_runs(run_id,workflow,business_key_sha256,input_sha256,input_json,status,created_at,updated_at) VALUES(?,?,?,?,?,'running',?,?)",[runId,plan.workflow,business,inputHash,JSON.stringify({version:'yt-ai-derived-v1',plan}),now(),now()]);
   await db.execute("UPDATE ts_ai_runs SET status='running',failure_code=NULL,provider_json=?,updated_at=? WHERE run_id=?",[JSON.stringify({generationAttempts:generationAttempts(prior)+1}),now(),runId]);
   attemptStarted=true;
   const response=await options.provider.complete(plan);if(response.requestedModel!=='sky-quality')throw new Error('Provider alias mismatch');
   result=JSON.stringify(validate(response.content,plan));if(Buffer.byteLength(result)>60000)throw new Error('AI projection exceeds TEXT budget');
   const usage=response.usage&&typeof response.usage==='object'?Object.fromEntries(Object.entries(response.usage).filter(([k,v])=>['prompt_tokens','completion_tokens','total_tokens'].includes(k)&&Number.isSafeInteger(v)&&Number(v)>=0)):null;
   await db.execute("UPDATE ts_ai_runs SET status='validated',result_json=?,provider_json=?,updated_at=? WHERE run_id=?",[result,JSON.stringify({requestedModel:response.requestedModel,model:response.model,usage,attempts:response.attempts??1,generationAttempts:generationAttempts(prior)+1}),now(),runId]);
  }
  options.assertAuthorized();
  for(const lock of held){const [rows]=await db.query<RowDataPacket[]>('SELECT IS_USED_LOCK(?)=CONNECTION_ID() owned',[lock]);if(Number(rows[0]?.owned)!==1)throw new Error('AI writer lock lost');}
  if(derivedHash(await planner('verify'))!==inputHash)throw new Error('AI source changed during generation');
  const keys=Object.keys(plan.key),params=Object.values(plan.key);
  const [rows]=await db.query<RowDataPacket[]>(`SELECT * FROM ${plan.table} WHERE ${keys.map(k=>`BINARY ${k}=BINARY ?`).join(' AND ')} AND del_flag IS NULL ORDER BY pk DESC LIMIT 1`,params);
  const projection={...plan.key,...plan.columns,ai_type:'sky-quality',result_json:result};
  let pk=rows[0]?.pk;
  if(prior?.status==='published'&&rows[0]&&Object.entries(projection).every(([k,v])=>String(rows[0]![k])===String(v)))return {status:'unchanged',runId,targetPk:String(pk),sourceCount:plan.sourceCount};
  if(pk){await db.execute('UPDATE ts_ai_runs SET target_pk=? WHERE run_id=?',[pk,runId]);const [written]=await db.execute<ResultSetHeader>(`UPDATE ${plan.table} SET ${Object.keys(projection).map(k=>`${k}=?`).join(',')},mtime=? WHERE pk=? AND del_flag IS NULL`,[...Object.values(projection),now(),pk]);if(written.affectedRows!==1)throw new Error('AI projection target changed');}
  else{const [insert]=await db.execute<ResultSetHeader>(`INSERT INTO ${plan.table}(${Object.keys(projection).join(',')},ctime,mtime) VALUES(${Object.keys(projection).map(()=>'?').join(',')},?,?)`,[...Object.values(projection),now(),now()]);pk=insert.insertId;}
  await db.execute("UPDATE ts_ai_runs SET status='published',target_pk=?,failure_code=NULL,updated_at=? WHERE run_id=?",[pk,now(),runId]);
  return {status:'published',runId,targetPk:String(pk),sourceCount:plan.sourceCount};
 }catch(error){if(runId&&attemptStarted)await db.execute("UPDATE ts_ai_runs SET status=IF(result_json IS NULL,'failed','validated'),failure_code=?,updated_at=? WHERE run_id=? AND status<>'published'",[error instanceof RetryableProviderError?'provider_transient':'generation_or_projection_failed',now(),runId]).catch(()=>undefined);throw error;}
 finally{for(const lock of held.reverse())await db.query('SELECT RELEASE_LOCK(?)',[lock]).catch(()=>undefined);}
}

export function derivedBusinessLock(plan:Pick<DerivedPlan,'table'|'key'>){
 const identity=Object.fromEntries(Object.entries(plan.key).filter(([k])=>plan.table==='urt_mayor_person_ai'||k!=='user_token'));
 if(plan.table==='urt_ai_period'){identity.date_from=String(identity.date_from)+' 00:00:00';identity.date_to=String(identity.date_to)+' 23:59:59';}
 return laravelAiLock(plan.table,identity);
}
