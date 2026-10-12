import {physicalTables} from '../../shared/physical-tables.js';
import type {Connection,RowDataPacket} from 'mysql2/promise';
import {randomUUID} from 'node:crypto';
import {instant,json,notificationSql,record,hash} from './contracts.js';
import {markLegacySeen} from './legacy-dedup.js';
import type {Config,Period} from './contracts.js';
import {markStoryPosted} from './stories.js';
export async function notificationReadiness(db:Connection){const[rows]=await db.query<RowDataPacket[]>("SELECT dispatch_key,period,context_key,story_id,status,attempted_at FROM telegram_digest_dispatches WHERE status IN ('pending','uncertain') ORDER BY attempted_at,id LIMIT 101");return {status:rows.length?'blocked':'ready',uncertainDispatches:rows.slice(0,100),truncated:rows.length>100,reason:rows.length?'Keep Laravel notification writers stopped; resolve every pending/uncertain delivery before rollback or notification handoff':null};}
export interface Resolution {dispatchKey:string;outcome:'sent'|'not-sent';operator:string;evidence:string;sentAt?:string}
export function validateResolution(input:Resolution,now=new Date()){
 if(!/^[a-f0-9]{64}$/.test(input.dispatchKey)||!['sent','not-sent'].includes(input.outcome)||!/^[-A-Za-z0-9_.@]{1,100}$/.test(input.operator)||typeof input.evidence!=='string'||input.evidence.trim().length<12||input.evidence.length>2000||/[\r\n\0]/.test(input.evidence))throw new Error('Invalid notification resolution');
 if(input.outcome==='sent'){if(!input.sentAt||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/.test(input.sentAt)||!Number.isFinite(Date.parse(input.sentAt))||new Date(input.sentAt).toISOString()!==input.sentAt.replace('Z','.000Z')||Date.parse(input.sentAt)>now.getTime())throw new Error('Confirmed sent resolution requires an explicit past UTC sent-at');}else if(input.sentAt)throw new Error('not-sent resolution cannot specify sent-at');return input;
}
/** No HTTP. Operator-confirmed outcomes are appended, never erased from attempt history. */
export async function resolveNotification(db:Connection,input:Resolution,options:{config:Pick<Config,'legacyCachePrefix'>;execute:boolean;now?:Date;assertAuthorized:()=>void;assertOwnership:()=>Promise<void>}){
 const now=options.now??new Date();validateResolution(input,now);if(options.execute){options.assertAuthorized();await options.assertOwnership();const engines=await physicalTables(db,['cache']);if(engines.length!==1||String(engines[0]?.engine).toLowerCase()!=='innodb')throw new Error('Notification reconciliation requires shared InnoDB cache');await db.beginTransaction();}
 try{
  const[rows]=await db.query<RowDataPacket[]>(`SELECT * FROM telegram_digest_dispatches WHERE dispatch_key=?${options.execute?' FOR UPDATE':''}`,[input.dispatchKey]);const row=rows[0];if(!row||!['pending','uncertain'].includes(row.status))throw new Error('Notification dispatch is not unresolved');
  const[attempts]=await db.query<RowDataPacket[]>("SELECT a.attempt_id,r.posts_json,r.source_json,r.context_key run_context_key,r.workflow FROM ts_notification_attempts a JOIN ts_notification_runs r ON r.run_id=a.run_id WHERE a.dispatch_key=? AND a.status IN ('pending','uncertain') AND a.message_hash=? AND NOT EXISTS (SELECT 1 FROM ts_notification_resolution_attempts x WHERE x.attempt_id=a.attempt_id)",[input.dispatchKey,row.message_hash]);
  if(attempts.length>1)throw new Error('Notification unresolved attempt is ambiguous');
  let legacyIdentity:{context:{period:Period;key:string};event:{title:string}}|undefined;
  let snapshot:Parameters<typeof markStoryPosted>[4]|undefined;
  if(input.outcome==='sent'){
   if(Date.parse(input.sentAt!)<instant(String(row.attempted_at)).getTime())throw new Error('Confirmed send predates attempted dispatch');
   if(attempts.length!==1)throw new Error('Notification sent resolution requires the exact unresolved attempt');
   const posts=attempts[0]?.posts_json?json(attempts[0].posts_json):null;const post=Array.isArray(posts)?posts.find(p=>record(p)&&record(p.decision)&&Number(p.decision.storyId)===Number(row.story_id)):null;
   if(!record(post)||typeof post.html!=='string'||hash(post.html)!==row.message_hash)throw new Error('Notification sent snapshot message hash mismatch');
   const source=attempts[0]?.source_json?json(attempts[0].source_json):null,eventTitle=record(post.event)?post.event.title:null;
   if(!record(source)||!['daily','hourly'].includes(String(row.period))||source.period!==row.period||source.key!==row.context_key||attempts[0]?.run_context_key!==row.context_key||attempts[0]?.workflow!=='notify.telegram.'+row.period||typeof eventTitle!=='string'||!eventTitle||!Array.isArray(source.events)||source.events.filter(e=>record(e)&&e.title===eventTitle).length!==1)throw new Error('Notification sent snapshot identity mismatch');
   legacyIdentity={context:{period:row.period as Period,key:String(row.context_key)},event:{title:eventTitle}};
   const state=record(post)&&record(post.decision)&&record(post.decision.snapshot)?post.decision.snapshot:null;
   if(!state||!Array.isArray(state.videoIds)||state.videoIds.some(id=>typeof id!=='string')||!record(state.videoChannels)||Object.values(state.videoChannels).some(v=>typeof v!=='string'))throw new Error('Notification resolution requires the original sent snapshot');
   snapshot={videoIds:state.videoIds as string[],videoChannels:state.videoChannels as Record<string,string>};
  }
  if(!options.execute)return {status:'preview',dispatchKey:input.dispatchKey,outcome:input.outcome,writes:0};
  options.assertAuthorized();await options.assertOwnership();const id=randomUUID(),at=notificationSql(now);
  await db.execute('INSERT INTO ts_notification_resolutions(resolution_id,dispatch_key,outcome,operator_name,evidence,previous_json,resolved_at) VALUES(?,?,?,?,?,?,?)',[id,input.dispatchKey,input.outcome,input.operator,input.evidence,JSON.stringify(row),at]);
  for(const attempt of attempts)await db.execute('INSERT INTO ts_notification_resolution_attempts(resolution_id,attempt_id) VALUES(?,?)',[id,attempt.attempt_id]);
  if(input.outcome==='not-sent')await db.execute("DELETE FROM telegram_digest_dispatches WHERE dispatch_key=? AND status IN ('pending','uncertain')",[input.dispatchKey]);
  else{const sent=new Date(input.sentAt!);await markLegacySeen(db,legacyIdentity!.context,legacyIdentity!.event,options.config,sent);await markStoryPosted(db,Number(row.story_id),sent,false,snapshot);await db.execute("UPDATE telegram_digest_dispatches SET status='sent',sent_at=?,updated_at=? WHERE dispatch_key=? AND status IN ('pending','uncertain')",[notificationSql(sent),at,input.dispatchKey]);}
  await db.commit();return {status:'resolved',resolutionId:id,dispatchKey:input.dispatchKey,outcome:input.outcome};
 }catch(error){if(options.execute)await db.rollback().catch(()=>undefined);throw error;}
}
