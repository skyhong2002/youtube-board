import type {Connection,RowDataPacket} from 'mysql2/promise';
import {withWriterLock} from '../../jobs/src/database.js';
import {canonical,decode,EditorialError,fail,hash,parseCommand,sqlTime,uuid,type Command} from './contracts.js';
import {resolveSource,type ResolvedSource} from './sources.js';
export interface EventState {id:string;title:string;version:number;mergedInto:string|null;sources:string[]}
export interface CandidateState {id:string;channelId:string;proposedName:string;reason:string;status:string;version:number;adoptedUId:number|null}
interface Plan {command:Command;before:{events:EventState[];candidate:CandidateState|null};after:{events:EventState[];candidate:CandidateState|null};resolved:ResolvedSource[];warnings:string[];previewHash:string}
const sourceUuid=(s:ResolvedSource)=>{const h=hash(s.identity+':'+s.sourceHash);return `${h.slice(0,8)}-${h.slice(8,12)}-4${h.slice(13,16)}-8${h.slice(17,20)}-${h.slice(20,32)}`;};
export async function eventState(db:Connection,id:string):Promise<EventState|null>{const[r]=await db.query<RowDataPacket[]>('SELECT id,title,version,merged_into FROM ts_editorial_events WHERE id=?',[id]);if(!r[0])return null;const[links]=await db.query<RowDataPacket[]>('SELECT source_id FROM ts_editorial_links WHERE event_id=? AND active=1 ORDER BY source_id LIMIT 501',[id]);if(links.length>500)return fail('EVENT_SOURCE_CAP',409);return {id:r[0].id,title:r[0].title,version:Number(r[0].version),mergedInto:r[0].merged_into,sources:links.map(l=>String(l.source_id))};}
async function sourceIdentities(db:Connection,ids:string[]){if(!ids.length)return [];const[rows]=await db.query<RowDataPacket[]>('SELECT id,identity_sha256 FROM ts_editorial_sources WHERE id IN ('+ids.map(()=>'?').join(',')+')',ids);if(rows.length!==ids.length)return fail('SOURCE_REFERENCE_MISSING',409);return rows;}
export async function candidateState(db:Connection,id:string):Promise<CandidateState|null>{const[r]=await db.query<RowDataPacket[]>('SELECT * FROM ts_editorial_candidates WHERE id=?',[id]);return r[0]?{id:r[0].id,channelId:r[0].channel_id,proposedName:r[0].proposed_name,reason:r[0].reason,status:r[0].status,version:Number(r[0].version),adoptedUId:r[0].adopted_u_id===null?null:Number(r[0].adopted_u_id)}:null;}
export async function planEditorial(db:Connection,raw:unknown,previewActor?:string):Promise<Plan>{
 const command=parseCommand(raw),c=command,before:Plan['before']={events:[],candidate:null},after:Plan['after']={events:[],candidate:null},resolved:ResolvedSource[]=[];
 if(c.action.startsWith('candidate.')){
  const current=await candidateState(db,c.id);before.candidate=current;
  if(c.action==='candidate.submit'){
   const[existing]=await db.query<RowDataPacket[]>('SELECT id FROM ts_editorial_candidates WHERE BINARY channel_id=BINARY ?',[c.channelId]);if(current||existing.length)return fail('CANDIDATE_EXISTS',409);
   after.candidate={id:c.id,channelId:c.channelId!,proposedName:c.proposedName!,reason:c.reason,status:'pending',version:1,adoptedUId:null};
  }else{if(!current)return fail('CANDIDATE_NOT_FOUND',404);if(current.version!==c.expectedVersion)return fail('VERSION_CONFLICT',409);if(current.status!=='pending')return fail('CANDIDATE_ALREADY_DECIDED',409);after.candidate={...current,status:c.action==='candidate.approve'?'approved':'rejected',version:current.version+1};}
 }else{
  const current=await eventState(db,c.id);if(c.action==='create'){if(current)return fail('EVENT_EXISTS',409);}else{if(!current)return fail('EVENT_NOT_FOUND',404);if(current.mergedInto)return fail('EVENT_MERGED',409);if(current.version!==c.expectedVersion)return fail('VERSION_CONFLICT',409);before.events.push(current);}
  const next:EventState=current?{...current,version:current.version+1,sources:[...current.sources]}:{id:c.id,title:c.title!,version:1,mergedInto:null,sources:[]};
  if(c.action==='create'||c.action==='attach'||c.action==='refresh'){
   const existing=await sourceIdentities(db,next.sources);
   for(const source of c.sources!){const s=await resolveSource(db,source),old=existing.find(v=>v.identity_sha256===s.identity);
    if(c.action==='refresh'&&!old)return fail('REFRESH_SOURCE_NOT_LINKED',409);
    if(c.action!=='refresh'&&old)return fail('SOURCE_ALREADY_LINKED',409);
    if(c.action==='refresh'&&old?.id===sourceUuid(s))return fail('REFRESH_UNCHANGED',409);
    if(old)next.sources=next.sources.filter(id=>id!==old.id);
    resolved.push(s);next.sources.push(sourceUuid(s));
   }
  }
  if(c.action==='rename')next.title=c.title!;
  if(c.action==='merge'){
   const target=await eventState(db,c.targetId!);if(!target)return fail('TARGET_NOT_FOUND',404);if(target.mergedInto)return fail('TARGET_MERGED',409);if(target.version!==c.targetVersion)return fail('VERSION_CONFLICT',409);before.events.push(target);
   const targetSources=await sourceIdentities(db,target.sources),incomingSources=await sourceIdentities(db,next.sources),identities=new Set(targetSources.map(s=>s.identity_sha256));
   after.events.push({...target,version:target.version+1,sources:[...target.sources,...incomingSources.filter(s=>!identities.has(s.identity_sha256)).map(s=>String(s.id))].sort()});next.mergedInto=target.id;next.sources=[];
   const[aliases]=await db.query<RowDataPacket[]>('SELECT id FROM ts_editorial_events WHERE merged_into=? ORDER BY id LIMIT 501',[c.id]);if(aliases.length>500)return fail('ALIAS_LIMIT',409);
   for(const alias of aliases){const old=(await eventState(db,String(alias.id)))!;before.events.push(old);after.events.push({...old,version:old.version+1,mergedInto:target.id});}
  }
  if(c.action==='split'){
   if(await eventState(db,c.targetId!))return fail('TARGET_EXISTS',409);if(c.sourceIds!.some(id=>!next.sources.includes(id)))return fail('SOURCE_NOT_IN_EVENT',409);
   after.events.push({id:c.targetId!,title:c.title!,version:1,mergedInto:null,sources:[...c.sourceIds!].sort()});next.sources=next.sources.filter(id=>!c.sourceIds!.includes(id));
  }
  next.sources.sort();after.events.push(next);if(after.events.some(e=>e.sources.length>500))return fail('EVENT_SOURCE_CAP',409);
 }
 const warnings=command.action==='merge'?['此合併不可復原：來源事件與其舊網址會永久導向目標事件；同一來源保留目標快照，來源事件原快照只留存於封存與稽核紀錄。拆分只會建立新事件，不能復原原事件身分、網址或被去重的快照。']:[];
 const content={command,before,after,resolved,warnings};return {...content,previewHash:hash(canonical(previewActor===undefined?content:{...content,previewActor}))};
}
export async function editorialTransaction(db:Connection,raw:unknown,actor:string,previewHash:string,now=new Date(),bindActor=false){
 if(!/^[a-f0-9]{64}$/.test(previewHash))return fail('PREVIEW_REQUIRED');const command=parseCommand(raw),inputHash=hash(canonical(command));
 return withWriterLock(db,'editorial.registry',async assertOwnership=>{
  await db.beginTransaction();try{
   const[requests]=await db.query<RowDataPacket[]>('SELECT input_sha256,actor,result_json FROM ts_editorial_requests WHERE request_id=?',[command.requestId]);
   if(requests[0]){if(requests[0].input_sha256!==inputHash||requests[0].actor!==actor)return fail('REQUEST_ID_CONFLICT',409);await db.rollback();return {...decode(requests[0].result_json),replayed:true};}
   const plan=await planEditorial(db,command,bindActor?actor:undefined);if(plan.previewHash!==previewHash)return fail('PREVIEW_CHANGED',409);await assertOwnership();
   const at=sqlTime(now);
   for(const s of plan.resolved){
    const id=sourceUuid(s),[existing]=await db.query<RowDataPacket[]>('SELECT id,identity_sha256,source_sha256 FROM ts_editorial_sources WHERE id=? OR (identity_sha256=? AND source_sha256=?)',[id,s.identity,s.sourceHash]);
    if(existing.length){if(existing.length!==1||existing[0]!.id!==id||existing[0]!.identity_sha256!==s.identity||existing[0]!.source_sha256!==s.sourceHash)return fail('SOURCE_IDENTITY_CONFLICT',409);}
    else await db.execute('INSERT INTO ts_editorial_sources(id,identity_sha256,kind,source_id,headline,url,published_at,observed_at,source_sha256,provenance_json,snapshot_json) VALUES(?,?,?,?,?,?,?,?,?,?,?)',[id,s.identity,s.kind,s.sourceId,s.headline,s.url,s.publishedAt,s.observedAt,s.sourceHash,canonical(s.provenance),canonical(s.snapshot)]);
   }
   for(const e of plan.after.events){
    if(plan.before.events.some(old=>old.id===e.id))await db.execute('UPDATE ts_editorial_events SET title=?,version=?,merged_into=?,updated_at=? WHERE id=?',[e.title,e.version,e.mergedInto,at,e.id]);
    else await db.execute('INSERT INTO ts_editorial_events(id,title,version,created_at,updated_at) VALUES(?,?,?,?,?)',[e.id,e.title,e.version,at,at]);
    await db.execute('UPDATE ts_editorial_links SET active=0 WHERE event_id=?',[e.id]);
    for(const sourceId of e.sources)await db.execute('INSERT INTO ts_editorial_links(event_id,source_id,active) VALUES(?,?,1) ON DUPLICATE KEY UPDATE active=1',[e.id,sourceId]);
   }
   const candidate=plan.after.candidate;if(candidate){if(plan.before.candidate)await db.execute('UPDATE ts_editorial_candidates SET status=?,version=?,updated_at=? WHERE id=?',[candidate.status,candidate.version,at,candidate.id]);else await db.execute('INSERT INTO ts_editorial_candidates(id,channel_id,proposed_name,reason,status,version,submitted_by,created_at,updated_at) VALUES(?,?,?,?,?,1,?,?,?)',[candidate.id,candidate.channelId,candidate.proposedName,candidate.reason,candidate.status,actor,at,at]);}
   const result={requestId:command.requestId,action:command.action,...plan.after,replayed:false};
   await appendAudit(db,{requestId:command.requestId,action:command.action,actor,reason:command.reason,before:plan.before,after:plan.after,inputHash,result,at});
   await assertOwnership();await db.commit();return result;
  }catch(error){await db.rollback().catch(()=>undefined);throw error;}
 });
}
export async function appendAudit(db:Connection,v:{requestId:string;action:string;actor:string;reason:string;before:unknown;after:unknown;inputHash:string;result:unknown;at:string}){
 await db.execute('INSERT INTO ts_editorial_audit(request_id,action,actor,reason,before_json,after_json,created_at) VALUES(?,?,?,?,?,?,?)',[v.requestId,v.action,v.actor,v.reason,canonical(v.before),canonical(v.after),v.at]);
 const eventIds=new Set<string>();
 for(const state of [v.before,v.after]){
  const events=(state&&typeof state==='object'&&!Array.isArray(state)?(state as {events?:unknown}).events:undefined);
  if(events!==undefined){if(!Array.isArray(events))return fail('INVALID_AUDIT_EVENTS',500);for(const event of events){if(!event||typeof event!=='object'||!uuid(event.id))return fail('INVALID_AUDIT_EVENT',500);eventIds.add(event.id);}}
 }
 for(const id of eventIds)await db.execute('INSERT INTO ts_editorial_audit_events(sequence,event_id) SELECT sequence,? FROM ts_editorial_audit WHERE request_id=?',[id,v.requestId]);
 await db.execute('INSERT INTO ts_editorial_requests(request_id,input_sha256,actor,result_json,created_at) VALUES(?,?,?,?,?)',[v.requestId,v.inputHash,v.actor,canonical(v.result),v.at]);
}
export async function inspectEditorial(db:Connection,page=1){if(!Number.isSafeInteger(page)||page<1||page>1000)return fail('INVALID_PAGE');const[events]=await db.query<RowDataPacket[]>('SELECT id,title,version,merged_into,updated_at FROM ts_editorial_events ORDER BY updated_at DESC,id LIMIT 100 OFFSET ?',[(page-1)*100]);const[candidates]=await db.query<RowDataPacket[]>('SELECT id,channel_id,proposed_name,status,version,adopted_u_id FROM ts_editorial_candidates ORDER BY updated_at DESC,id LIMIT 100 OFFSET ?',[(page-1)*100]);return {events,candidates,page,limit:100,hasMore:events.length===100||candidates.length===100};}
export {EditorialError};
