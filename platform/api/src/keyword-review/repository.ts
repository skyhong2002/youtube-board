import type {Connection,RowDataPacket} from 'mysql2/promise';
import {matchingRuleForSnapshot} from '../../../shared/youtube-match-policy.js';
import {createHash} from 'node:crypto';
import {fail,hash,type Evidence,type Review,type Plan,type Command,planReview} from './domain.js';
export interface SavedRequest {actor:string;inputHash:string;result:Result}
export interface Result {review:Review;requestId:string;applied:false;applicationStatus:'not-applied';replayed:boolean}
export interface ReviewTransaction {get(id:string):Promise<Review|null>;evidence(c:Command):Promise<Evidence|null>;request(id:string):Promise<SavedRequest|null>;save(plan:Plan,inputHash:string,at:string):Promise<Result>;serving():Promise<string|null>;effective(termKey:string):Promise<Review|null>}
export interface RankingDisplayEntry {termKey:string;term:string;reviewId:string;vocabularyVersion:string;decidedBy:string;decidedAt:string;reason:string}
export interface ReviewRepository {ready():Promise<boolean>;rankingDisplay():Promise<RankingDisplayEntry[]>;list(page:number,version?:string):Promise<{rows:Review[];page:number;limit:50;hasMore:boolean}>;detail(id:string):Promise<{review:Review;audit:unknown[]}|null>;read<T>(fn:(tx:ReviewTransaction)=>Promise<T>):Promise<T>;transaction<T>(fn:(tx:ReviewTransaction)=>Promise<T>):Promise<T>}
export async function previewReview(repo:ReviewRepository,c:Command,actor:string,at:string){return repo.read(async tx=>planReview(c,await tx.get(c.id),c.action==='submit'?await tx.evidence(c):null,actor,at));}
export async function executeReview(repo:ReviewRepository,c:Command,actor:string,previewHash:string,at:string):Promise<Result>{
 if(!/^[a-f0-9]{64}$/.test(previewHash))return fail('PREVIEW_REQUIRED');
 return repo.transaction(async tx=>{
  const inputHash=hash(c),saved=await tx.request(c.requestId);
  if(saved){if(saved.actor!==actor||saved.inputHash!==inputHash)return fail('REQUEST_ID_CONFLICT',409);return {...saved.result,replayed:true};}
  const plan=planReview(c,await tx.get(c.id),c.action==='submit'?await tx.evidence(c):null,actor,at);
  if(plan.previewHash!==previewHash)return fail('PREVIEW_CHANGED',409);
  return tx.save(plan,inputHash,at);
 });
}
export interface RankingDisplayInput {requestId:string;terms:string[];decision:'keep'|'exclude';reason:string}
const SOURCE='https://tag.observe.tw';
export const rankingTermKey=(term:string)=>createHash('sha256').update(SOURCE+'\0'+term).digest('hex');
/** Deterministic lowercase UUID (version 5 layout) so retries reuse every identity. */
const derivedId=(...parts:string[])=>{const h=hash(parts);return `${h.slice(0,8)}-${h.slice(8,12)}-5${h.slice(13,16)}-${'89ab'[parseInt(h[16]!,16)%4]}${h.slice(17,20)}-${h.slice(20,32)}`;};
export function parseRankingDisplay(raw:unknown):RankingDisplayInput{
 const r=raw&&typeof raw==='object'&&!Array.isArray(raw)?raw as Record<string,unknown>:null;
 const label=(v:unknown):v is string=>typeof v==='string'&&v.length>0&&v.length<=240&&v.trim()===v&&!/[\u0000-\u001f\u007f]/.test(v);
 if(!r||Object.keys(r).some(k=>!['requestId','terms','decision','reason'].includes(k))||typeof r.requestId!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(r.requestId)
  ||!Array.isArray(r.terms)||r.terms.length<1||r.terms.length>20||!r.terms.every(label)||new Set(r.terms).size!==r.terms.length||(r.decision!=='keep'&&r.decision!=='exclude')
  ||(r.reason!==undefined&&(typeof r.reason!=='string'||r.reason.length>2000||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(r.reason))))return fail('INVALID_RANKING_DECISION');
 const reason=typeof r.reason==='string'&&r.reason.trim()?r.reason.trim():r.decision==='exclude'?'管理員從排行一鍵排除':'管理員恢復排行顯示';
 return {requestId:r.requestId,terms:r.terms as string[],decision:r.decision,reason};
}
/** One administrator action: for every exact label of a ranking row, submit and approve a
 * youtube-ranking-display decision in one transaction, with both audit rows. A label whose
 * latest approved decision already matches is left unchanged. Exclusion needs the label in
 * the serving vocabulary; restoring falls back to the version of the decision it reverses. */
export async function decideRankingDisplay(repo:ReviewRepository,input:RankingDisplayInput,actor:string,at:string){
 return repo.transaction(async tx=>{
  const serving=await tx.serving(),results:{term:string;termKey:string;status:'decided'|'unchanged'|'replayed';review:Review}[]=[];
  for(const term of input.terms){
   const termKey=rankingTermKey(term),id=derivedId(input.requestId,termKey,'review'),submitId=derivedId(input.requestId,termKey,'submit'),approveId=derivedId(input.requestId,termKey,'approve');
   const replay=await tx.request(approveId);
   if(replay){if(replay.actor!==actor)return fail('REQUEST_ID_CONFLICT',409);results.push({term,termKey,status:'replayed',review:replay.result.review});continue;}
   const current=await tx.effective(termKey);
   if(current&&current.decision===input.decision){results.push({term,termKey,status:'unchanged',review:current});continue;}
   if(!current&&input.decision==='keep')return fail('NOTHING_TO_RESTORE',409);
   const lookup=async(version:string|null)=>version?tx.evidence({requestId:submitId,id,action:'submit',reason:input.reason,vocabularyVersion:version,termKey}):null;
   const evidence=await lookup(serving)??(input.decision==='keep'?await lookup(current!.evidence.vocabularyVersion):null);
   if(!evidence)return fail('TERM_NOT_IN_VOCABULARY',409);
   const submit:Command={requestId:submitId,id,action:'submit',reason:input.reason,vocabularyVersion:evidence.vocabularyVersion,termKey,ruleVersion:evidence.ruleVersion,context:'youtube-ranking-display',decision:input.decision};
   const submitted=planReview(submit,await tx.get(id),evidence,actor,at);await tx.save(submitted,hash(submit),at);
   const approve:Command={requestId:approveId,id,action:'approve',reason:input.reason,expectedRevision:1};
   const approved=planReview(approve,submitted.after,null,actor,at);const saved=await tx.save(approved,hash(approve),at);
   results.push({term,termKey,status:'decided',review:saved.review});
  }
  return {decision:input.decision,results,changed:results.some(r=>r.status==='decided')};
 });
}
const MAX_STATE_BYTES=128*1024;
const json=<T>(value:unknown):T=>{if(typeof value!=='string'||Buffer.byteLength(value)>MAX_STATE_BYTES)return fail('REVIEW_STORED_STATE_INVALID',503);return JSON.parse(value) as T;};
const bounded=(v:unknown)=>{const s=JSON.stringify(v);if(Buffer.byteLength(s)>MAX_STATE_BYTES)return fail('REVIEW_EVIDENCE_TOO_LARGE',409);return s;};
const sqlTime=(at:string)=>new Date(at).toISOString().slice(0,23).replace('T',' ');
/** Inject a dedicated own-schema connection. No URL/env inference and no source grants. */
export function mysqlReviewRepository(connect:()=>Promise<Connection>,expectedSchema:string):ReviewRepository {
 if(!/^[a-z][a-z0-9_]{0,63}$/.test(expectedSchema)||['youtube_board','mysql','sys','information_schema','performance_schema'].includes(expectedSchema))return fail('REVIEW_STATE_SCHEMA_REQUIRED',503);
 const use=async<T>(fn:(db:Connection)=>Promise<T>)=>{const db=await connect();try{const [r]=await db.query<RowDataPacket[]>('SELECT DATABASE() AS name');if(r[0]?.name!==expectedSchema)return fail('REVIEW_STATE_SCHEMA_MISMATCH',503);return await fn(db);}finally{await db.end();}};
 const txOf=(db:Connection,locking=false):ReviewTransaction=>({
  async get(id){const[r]=await db.execute<RowDataPacket[]>('SELECT CASE WHEN OCTET_LENGTH(state_json)<=131072 THEN state_json ELSE NULL END AS state_json FROM ts_keyword_reviews WHERE id=?'+(locking?' FOR UPDATE':''),[id]);return r[0]?json<Review>(r[0].state_json):null;},
  async request(id){const[r]=await db.execute<RowDataPacket[]>('SELECT actor,input_sha256,CASE WHEN OCTET_LENGTH(result_json)<=131072 THEN result_json ELSE NULL END AS result_json FROM ts_keyword_review_requests WHERE request_id=?'+(locking?' FOR UPDATE':''),[id]);return r[0]?{actor:String(r[0].actor),inputHash:String(r[0].input_sha256),result:json<Result>(r[0].result_json)}:null;},
  async evidence(c){
   const[r]=await db.execute<RowDataPacket[]>('SELECT CASE WHEN OCTET_LENGTH(snapshot)<=8388608 THEN snapshot ELSE NULL END AS snapshot FROM ts_vocabulary_runs WHERE id=? AND status=? LIMIT 1',[c.vocabularyVersion!,'published']);
   if(!r[0]||typeof r[0].snapshot!=='string')return null;
   const snapshot=JSON.parse(r[0].snapshot);if(snapshot.id!==c.vocabularyVersion||snapshot.source!=='https://tag.observe.tw')return fail('REVIEW_SOURCE_INVALID',503);const ruleVersion=matchingRuleForSnapshot(snapshot);
   let payload:unknown;
   if(snapshot.termsStoredSeparately===true){const[t]=await db.execute<RowDataPacket[]>('SELECT CASE WHEN OCTET_LENGTH(payload)<=131072 THEN payload ELSE NULL END AS payload FROM ts_vocabulary_terms WHERE run_id=? AND term_key=? LIMIT 1',[c.vocabularyVersion!,c.termKey!]);payload=t[0]?.payload?json(t[0].payload):null;}
   else payload=Array.isArray(snapshot.terms)?snapshot.terms.find((t:{key?:unknown})=>t?.key===c.termKey):null;
   if(!payload||typeof payload!=='object'||(payload as {key?:unknown}).key!==c.termKey||typeof (payload as {term?:unknown}).term!=='string')return null;
   bounded(payload);
   const evidence={vocabularyVersion:c.vocabularyVersion!,termKey:c.termKey!,rawTerm:(payload as {term:string}).term,ruleVersion,payload,source:'https://tag.observe.tw' as const};
   return {...evidence,sha256:hash(evidence)};
  },
  async serving(){const[r]=await db.execute<RowDataPacket[]>("SELECT c.run_id FROM ts_vocabulary_current c JOIN ts_vocabulary_runs r ON r.id=c.run_id AND r.status='published' WHERE c.source=? LIMIT 1",[SOURCE]);return r[0]?String(r[0].run_id):null;},
  async effective(termKey){const[r]=await db.execute<RowDataPacket[]>("SELECT CASE WHEN OCTET_LENGTH(state_json)<=131072 THEN state_json ELSE NULL END AS state_json FROM ts_keyword_reviews WHERE term_key=? AND context='youtube-ranking-display' AND status='approved' ORDER BY updated_at DESC,created_at DESC,id DESC LIMIT 1"+(locking?' FOR UPDATE':''),[termKey]);return r[0]?json<Review>(r[0].state_json):null;},
  async save(plan,inputHash,at){const r=plan.after,body=bounded(r),time=sqlTime(at);
   if(plan.before){const[changed]=await db.execute<import('mysql2').ResultSetHeader>('UPDATE ts_keyword_reviews SET revision=?,status=?,state_json=?,updated_at=? WHERE id=? AND revision=?',[r.revision,r.status,body,time,r.id,plan.before.revision]);if(changed.affectedRows!==1)return fail('REVISION_CONFLICT',409);}
   else await db.execute('INSERT INTO ts_keyword_reviews(id,revision,status,vocabulary_version,term_key,rule_version,context,state_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)',[r.id,r.revision,r.status,r.evidence.vocabularyVersion,r.evidence.termKey,r.evidence.ruleVersion,r.context,body,time,time]);
   const result:Result={review:r,requestId:plan.command.requestId,applied:false,applicationStatus:'not-applied',replayed:false};
   await db.execute('INSERT INTO ts_keyword_review_audit(request_id,review_id,actor,action,reason,before_json,after_json,created_at) VALUES(?,?,?,?,?,?,?,?)',[plan.command.requestId,r.id,plan.actor,plan.command.action,plan.command.reason,bounded(plan.before),body,time]);
   await db.execute('INSERT INTO ts_keyword_review_requests(request_id,actor,input_sha256,result_json,created_at) VALUES(?,?,?,?,?)',[plan.command.requestId,plan.actor,inputHash,bounded(result),time]);return result;
  }
 });
 return {
  async ready(){try{return await use(async db=>{const[t]=await db.execute<RowDataPacket[]>("SELECT COUNT(*) AS n FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name IN ('ts_keyword_reviews','ts_keyword_review_audit','ts_keyword_review_requests') AND engine='InnoDB'");const[g]=await db.execute<RowDataPacket[]>("SELECT COUNT(*) AS n FROM information_schema.triggers WHERE trigger_schema=DATABASE() AND ((trigger_name='ts_keyword_review_audit_no_update' AND event_object_table='ts_keyword_review_audit' AND event_manipulation='UPDATE') OR (trigger_name='ts_keyword_review_audit_no_delete' AND event_object_table='ts_keyword_review_audit' AND event_manipulation='DELETE') OR (trigger_name='ts_keyword_review_requests_no_update' AND event_object_table='ts_keyword_review_requests' AND event_manipulation='UPDATE') OR (trigger_name='ts_keyword_review_requests_no_delete' AND event_object_table='ts_keyword_review_requests' AND event_manipulation='DELETE'))");if(Number(t[0]?.n)!==3||Number(g[0]?.n)!==4)return false;await db.execute('SELECT id,revision,status,vocabulary_version,term_key,rule_version,context,state_json,created_at,updated_at FROM ts_keyword_reviews LIMIT 0');await db.execute('SELECT sequence,request_id,review_id,actor,action,reason,before_json,after_json,created_at FROM ts_keyword_review_audit LIMIT 0');await db.execute('SELECT request_id,actor,input_sha256,result_json,created_at FROM ts_keyword_review_requests LIMIT 0');return true;});}catch{return false;}},
  async rankingDisplay(){return use(async db=>{const[r]=await db.execute<RowDataPacket[]>("SELECT CASE WHEN OCTET_LENGTH(state_json)<=131072 THEN state_json ELSE NULL END AS state_json FROM ts_keyword_reviews WHERE context='youtube-ranking-display' AND status='approved' ORDER BY updated_at,created_at,id LIMIT 20001");
   const latest=new Map<string,Review>();for(const row of r.slice(0,20000)){const review=json<Review>(row.state_json);latest.set(review.evidence.termKey,review);}
   return [...latest.values()].filter(v=>v.decision==='exclude').sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt)).map(v=>({termKey:v.evidence.termKey,term:v.evidence.rawTerm,reviewId:v.id,vocabularyVersion:v.evidence.vocabularyVersion,decidedBy:v.submittedBy,decidedAt:v.updatedAt,reason:v.reason}));});},
  async list(page,version){return use(async db=>{const[r]=await db.execute<RowDataPacket[]>('SELECT CASE WHEN OCTET_LENGTH(state_json)<=131072 THEN state_json ELSE NULL END AS state_json FROM ts_keyword_reviews'+(version?' WHERE vocabulary_version=?':'')+' ORDER BY updated_at DESC,id LIMIT 51 OFFSET ?',[...(version?[version]:[]),(page-1)*50]);return {rows:r.slice(0,50).map(v=>json<Review>(v.state_json)),page,limit:50,hasMore:r.length>50};});},
  async detail(id){return use(async db=>{const review=await txOf(db).get(id);if(!review)return null;const[a]=await db.execute<RowDataPacket[]>('SELECT sequence,request_id,actor,action,reason,CASE WHEN OCTET_LENGTH(before_json)<=131072 THEN before_json ELSE NULL END AS before_json,CASE WHEN OCTET_LENGTH(after_json)<=131072 THEN after_json ELSE NULL END AS after_json,created_at FROM ts_keyword_review_audit WHERE review_id=? ORDER BY sequence LIMIT 100',[id]);return {review,audit:a.map(row=>({...row,before:json(row.before_json),after:json(row.after_json),before_json:undefined,after_json:undefined}))};});},
  read:fn=>use(db=>fn(txOf(db))),
  transaction:fn=>use(async db=>{const[l]=await db.execute<RowDataPacket[]>('SELECT GET_LOCK(?,5) AS acquired',[hash({namespace:'ts-keyword-review',schema:expectedSchema})]);if(Number(l[0]?.acquired)!==1)return fail('REVIEW_WRITER_BUSY',409);try{await db.beginTransaction();try{const result=await fn(txOf(db,true));await db.commit();return result;}catch(e){await db.rollback();throw e;}}finally{await db.execute('SELECT RELEASE_LOCK(?)',[hash({namespace:'ts-keyword-review',schema:expectedSchema})]);}})
 };
}
