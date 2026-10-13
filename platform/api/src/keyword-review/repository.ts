import type {Connection,RowDataPacket} from 'mysql2/promise';
import {matchingRuleForSnapshot} from '../../../shared/youtube-match-policy.js';
import {fail,hash,type Evidence,type Review,type Plan,type Command,planReview} from './domain.js';
export interface SavedRequest {actor:string;inputHash:string;result:Result}
export interface Result {review:Review;requestId:string;applied:false;applicationStatus:'not-applied';replayed:boolean}
export interface ReviewTransaction {get(id:string):Promise<Review|null>;evidence(c:Command):Promise<Evidence|null>;request(id:string):Promise<SavedRequest|null>;save(plan:Plan,inputHash:string,at:string):Promise<Result>}
export interface ReviewRepository {ready():Promise<boolean>;list(page:number,version?:string):Promise<{rows:Review[];page:number;limit:50;hasMore:boolean}>;detail(id:string):Promise<{review:Review;audit:unknown[]}|null>;read<T>(fn:(tx:ReviewTransaction)=>Promise<T>):Promise<T>;transaction<T>(fn:(tx:ReviewTransaction)=>Promise<T>):Promise<T>}
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
  async list(page,version){return use(async db=>{const[r]=await db.execute<RowDataPacket[]>('SELECT CASE WHEN OCTET_LENGTH(state_json)<=131072 THEN state_json ELSE NULL END AS state_json FROM ts_keyword_reviews'+(version?' WHERE vocabulary_version=?':'')+' ORDER BY updated_at DESC,id LIMIT 51 OFFSET ?',[...(version?[version]:[]),(page-1)*50]);return {rows:r.slice(0,50).map(v=>json<Review>(v.state_json)),page,limit:50,hasMore:r.length>50};});},
  async detail(id){return use(async db=>{const review=await txOf(db).get(id);if(!review)return null;const[a]=await db.execute<RowDataPacket[]>('SELECT sequence,request_id,actor,action,reason,CASE WHEN OCTET_LENGTH(before_json)<=131072 THEN before_json ELSE NULL END AS before_json,CASE WHEN OCTET_LENGTH(after_json)<=131072 THEN after_json ELSE NULL END AS after_json,created_at FROM ts_keyword_review_audit WHERE review_id=? ORDER BY sequence LIMIT 100',[id]);return {review,audit:a.map(row=>({...row,before:json(row.before_json),after:json(row.after_json),before_json:undefined,after_json:undefined}))};});},
  read:fn=>use(db=>fn(txOf(db))),
  transaction:fn=>use(async db=>{const[l]=await db.execute<RowDataPacket[]>('SELECT GET_LOCK(?,5) AS acquired',[hash({namespace:'ts-keyword-review',schema:expectedSchema})]);if(Number(l[0]?.acquired)!==1)return fail('REVIEW_WRITER_BUSY',409);try{await db.beginTransaction();try{const result=await fn(txOf(db,true));await db.commit();return result;}catch(e){await db.rollback();throw e;}}finally{await db.execute('SELECT RELEASE_LOCK(?)',[hash({namespace:'ts-keyword-review',schema:expectedSchema})]);}})
 };
}
