import {physicalTables} from '../../shared/physical-tables.js';
import {legacyScheduleSlot,claimLegacySchedule,legacySeenKey,markLegacySeen} from './legacy-dedup.js';
import type {Connection,RowDataPacket,ResultSetHeader} from 'mysql2/promise';
import {randomUUID} from 'node:crypto';
import type {Provider} from '@youtube-board/ai';
import {type Config,type Context,type Event,type Period,hash,md5,taipeiSql,notificationSql} from './contracts.js';
import {type Sender} from './clients.js';
import {loadContext} from './source.js';
import {evaluateStory,markStoryPosted,matches,fingerprint} from './stories.js';
import {renderPosts} from './render.js';
export interface NotificationOptions {execute:boolean;scheduled?:boolean;force?:boolean;now?:Date;clock?:()=>Date;config:Config;provider?:Provider;sender?:Sender;assertAuthorized:()=>void;assertOwnership:()=>Promise<void>}
export function scheduleSlot(period:Period,now:Date){const at=taipeiSql(now),minutes=Number(at.slice(11,13))*60+Number(at.slice(14,16));if(period==='daily'&&(minutes<540||minutes>1260))return null;const slot=legacyScheduleSlot(period,now);return {key:slot.key,expires:notificationSql(new Date(slot.expiration*1000))};}
export function dispatchKey(period:Period,contextKey:string,storyId:number){return hash(period==='daily'?'daily|'+contextKey:'hourly|'+contextKey+'|'+storyId);}
async function legacyPosted(db:Connection,context:Context,event:Event,cfg:Config,now:Date,required:boolean){const tables=await physicalTables(db,['cache']);if(!tables.length){if(required)throw new Error('notification_legacy_cache_unavailable');return false;}const key=legacySeenKey(context,event,cfg);const[rows]=await db.query<RowDataPacket[]>('SELECT expiration FROM cache WHERE `key`=? AND expiration>?',[key,Math.floor(now.getTime()/1000)]);return rows.length>0;}
export async function runNotification(db:Connection,period:Period,options:NotificationOptions){
 const clock=options.clock??(options.now?()=>options.now!:()=>new Date()),now=options.now??clock(),at=notificationSql(now),cfg=options.config,runId=options.execute?randomUUID():null,job='notify.telegram.'+period;
 const result={status:options.execute?'completed':'preview',period,runId,considered:0,eligible:0,posted:0,skippedSeen:0,skippedIncomplete:0,failed:0,uncertain:0,aiCalls:0,phase:'source',lastSendOutcome:null as null|{sent:boolean;uncertain:boolean;error:string|null;messageId:string|null;attemptId:string;dispatchKey:string},messages:[] as string[],contextKey:null as string|null};
 const assert=async()=>{options.assertAuthorized();await options.assertOwnership();};
 if(options.execute){await assert();const engines=await physicalTables(db,['telegram_digest_stories','telegram_digest_dispatches','ts_notification_runs','ts_notification_attempts','ts_notification_slots','ts_notification_resolutions','ts_notification_resolution_attempts','cache']);if(engines.length!==8||engines.some(r=>String(r.engine).toLowerCase()!=='innodb'))throw new Error('Notification durable state requires InnoDB schema009 and shared cache');if(!options.sender)throw new Error('Notification sender required');await db.execute('INSERT INTO ts_notification_runs(run_id,workflow,status,created_at,updated_at) VALUES(?,?,\'running\',?,?)',[runId,job,at,at]);}
 const finish=async()=>{if(options.execute)await db.execute('UPDATE ts_notification_runs SET status=?,result_json=?,updated_at=? WHERE run_id=?',[result.status,JSON.stringify(result),notificationSql(clock()),runId]);return result;};
 try{
  if(options.execute&&options.scheduled){const slot=scheduleSlot(period,now);if(!slot){result.status='outside-slot';return await finish();}await assert();await db.execute('DELETE FROM ts_notification_slots WHERE slot_key=? AND expires_at<=?',[slot.key,at]);const[claim]=await db.execute<ResultSetHeader>('INSERT IGNORE INTO ts_notification_slots(slot_key,run_id,claimed_at,expires_at) VALUES(?,?,?,?)',[slot.key,runId,at,slot.expires]);if(claim.affectedRows!==1){result.status='skipped-slot';return await finish();}}
  if(options.execute){await assert();await claimLegacySchedule(db,period,cfg,runId!,clock());}
  const context=await loadContext(db,period,cfg);if(!context){result.status='no-source';return await finish();}result.contextKey=context.key;result.considered=context.events.length;result.eligible=context.events.filter(e=>period==='daily'||e.videoCount>=cfg.hourlyMinVideos).length;
  if(options.execute){await assert();const source=JSON.stringify(context);if(Buffer.byteLength(source)>8_000_000)throw new Error('notification_source_journal_cap');await db.execute('UPDATE ts_notification_runs SET context_key=?,source_table=?,source_pk=?,source_sha256=?,source_json=? WHERE run_id=?',[context.key,context.sourceTable,context.sourcePk,context.sourceHash,source,runId]);}
  if(period==='daily'){const[prior]=await db.query<RowDataPacket[]>('SELECT status FROM telegram_digest_dispatches WHERE dispatch_key=?',[dispatchKey(period,context.key,0)]);if(prior.length){result.skippedSeen=1;result.status='already-dispatched';return await finish();}
   for(const event of context.events)if(await legacyPosted(db,context,event,cfg,now,options.execute)){if(options.execute){await assert();await db.execute("INSERT IGNORE INTO telegram_digest_dispatches(dispatch_key,period,context_key,status,attempted_at,sent_at,created_at,updated_at) VALUES(?,'daily',?,'adopted',?,?,?,?)",[dispatchKey(period,context.key,0),context.key,at,at,at,at]);}result.skippedSeen=1;result.status='adopted-existing';return await finish();}}
  const fresh:Parameters<typeof renderPosts>[0]=[],batch:Event[]=[];const stories=new Set<number>();
  for(const event of context.events){
   if(batch.some(e=>matches(fingerprint(event),fingerprint(e),event.videoIds,e.videoIds))){result.skippedSeen++;continue;}
   const decision=await evaluateStory(db,event,context,cfg,now,options.execute,assert,stories);
   if(decision.batchDuplicate){result.skippedSeen++;continue;}batch.push(event);if(decision.storyId>0)stories.add(decision.storyId);
   const[pending]=decision.storyId?await db.query<RowDataPacket[]>("SELECT id FROM telegram_digest_dispatches WHERE story_id=? AND status IN ('pending','uncertain') LIMIT 1",[decision.storyId]):[[]];
   if(pending.length){result.skippedSeen++;continue;}
   const seen=await legacyPosted(db,context,event,cfg,now,options.execute);
   if(seen){if(options.execute&&period==='hourly'){await assert();await db.beginTransaction();try{await markStoryPosted(db,decision.storyId,now,true);await db.commit();}catch(e){await db.rollback().catch(()=>undefined);throw e;}}result.skippedSeen++;continue;}
   const[already]=decision.storyId?await db.query<RowDataPacket[]>('SELECT id FROM telegram_digest_dispatches WHERE dispatch_key=?',[dispatchKey(period,context.key,decision.storyId)]):[[]];
   if(already.length||!options.force&&!decision.shouldPost){result.skippedSeen++;continue;}fresh.push({event,decision});
  }
  const cap=period==='daily'?cfg.dailyMaxPosts:cfg.hourlyMaxPosts;if(!fresh.length||cap===0){result.status='nothing-eligible';return await finish();}
  const provider=options.execute&&options.provider?{complete:async(plan:Parameters<Provider['complete']>[0])=>{await assert();result.aiCalls++;return options.provider!.complete(plan);}}:undefined;
  const rendered=await renderPosts(fresh,context,provider);result.skippedIncomplete=rendered.filter(p=>!p.complete).length;const posts=rendered.filter(p=>p.complete).slice(0,cap);result.messages=posts.map(p=>p.html);
  if(!options.execute)return result;
  await assert();const postJson=JSON.stringify(posts);if(Buffer.byteLength(postJson)>8_000_000)throw new Error('notification_posts_journal_cap');await db.execute('UPDATE ts_notification_runs SET posts_json=? WHERE run_id=?',[postJson,runId]);
  for(const post of posts){
   await assert();const current=await loadContext(db,period,cfg);if(!current||current.sourceHash!==context.sourceHash)throw new Error('notification_source_changed_before_send');
   await claimLegacySchedule(db,period,cfg,runId!,clock());
   if(await legacyPosted(db,context,post.event,cfg,clock(),true)){result.skippedSeen++;continue;}
   const key=dispatchKey(period,context.key,post.decision.storyId),attemptId=randomUUID(),messageHash=hash(post.html);
   await db.beginTransaction();let claimed=false;
   try{const[uncertain]=await db.query<RowDataPacket[]>("SELECT id FROM telegram_digest_dispatches WHERE story_id=? AND status IN ('pending','uncertain') FOR UPDATE",[post.decision.storyId]);if(!uncertain.length){const[claim]=await db.execute<ResultSetHeader>("INSERT IGNORE INTO telegram_digest_dispatches(dispatch_key,period,context_key,story_id,status,message_hash,attempted_at,created_at,updated_at) VALUES(?,?,?,?,'pending',?,?,?,?)",[key,period,context.key,post.decision.storyId,messageHash,at,at,at]);claimed=claim.affectedRows===1;if(claimed)await db.execute("INSERT INTO ts_notification_attempts(attempt_id,run_id,dispatch_key,story_id,status,message_hash,created_at,updated_at) VALUES(?,?,?,?,'pending',?,?,?)",[attemptId,runId,key,post.decision.storyId,messageHash,at,at]);}await db.commit();}catch(error){await db.rollback().catch(()=>undefined);throw error;}
   if(!claimed){result.skippedSeen++;continue;}
   result.phase='pre-send';await assert();
   const abortBeforeSend=async(reason:string)=>{await assert();await db.beginTransaction();try{const[removed]=await db.execute<ResultSetHeader>("DELETE FROM telegram_digest_dispatches WHERE dispatch_key=? AND status='pending' AND message_hash=?",[key,messageHash]);if(removed.affectedRows!==1)throw new Error('notification_pre_send_claim_changed');const[aborted]=await db.execute<ResultSetHeader>("UPDATE ts_notification_attempts SET status='aborted-before-send',error_code=?,updated_at=? WHERE attempt_id=? AND status='pending'",[reason,notificationSql(clock()),attemptId]);if(aborted.affectedRows!==1)throw new Error('notification_pre_send_attempt_changed');await db.commit();}catch(error){await db.rollback().catch(()=>undefined);throw error;}};
   try{await claimLegacySchedule(db,period,cfg,runId!,clock());if(await legacyPosted(db,context,post.event,cfg,clock(),true)){await abortBeforeSend('notification_legacy_seen_before_send');result.skippedSeen++;continue;}}
   catch(error){if(error instanceof Error&&/^notification_legacy_schedule_/.test(error.message))await abortBeforeSend(error.message);throw error;}
   result.phase='sending';let sent;try{sent=await options.sender!.send(post.html,post.previewUrl);}catch{sent={sent:false,uncertain:true,error:'telegram-outcome-unknown',messageId:null};}
   result.lastSendOutcome={...sent,attemptId,dispatchKey:key};result.phase='persisting-send';const sentNow=clock(),sentAt=notificationSql(sentNow);await db.beginTransaction();try{
    if(sent.sent){await markLegacySeen(db,context,post.event,cfg,sentNow);await markStoryPosted(db,post.decision.storyId,sentNow,false,post.decision.snapshot);await db.execute("UPDATE telegram_digest_dispatches SET status='sent',sent_at=?,updated_at=? WHERE dispatch_key=? AND status='pending'",[sentAt,sentAt,key]);result.posted++;}
    else if(sent.uncertain){await db.execute("UPDATE telegram_digest_dispatches SET status='uncertain',updated_at=? WHERE dispatch_key=? AND status='pending'",[sentAt,key]);result.uncertain++;}
    else{await db.execute("DELETE FROM telegram_digest_dispatches WHERE dispatch_key=? AND status='pending'",[key]);result.failed++;}
    await db.execute('UPDATE ts_notification_attempts SET status=?,telegram_message_id=?,error_code=?,updated_at=? WHERE attempt_id=?',[sent.sent?'sent':sent.uncertain?'uncertain':'failed',sent.messageId,sent.error,sentAt,attemptId]);await db.commit();
   }catch(error){await db.rollback().catch(()=>undefined);throw error;}
   // A failed/uncertain outcome stops this batch. Never retry a send in-process.
   if(!sent.sent)break;
  }
  result.phase='finished';result.status=result.uncertain?'uncertain':result.failed?'failed':result.posted?'completed':result.skippedIncomplete?'incomplete':'nothing-eligible';return await finish();
 }catch(error){if(options.execute)await db.execute("UPDATE ts_notification_runs SET status='failed',result_json=?,updated_at=? WHERE run_id=?",[JSON.stringify({...result,status:'failed',partial:result.posted>0,error:error instanceof Error&&/^notification_[a-z_]+$/.test(error.message)?error.message:'notification-workflow-failed'}),notificationSql(clock()),runId]).catch(()=>undefined);throw error;}
}
