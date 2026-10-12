import type {Connection,RowDataPacket,ResultSetHeader} from 'mysql2/promise';
import {type Context,type Event,type Config,type Period,md5,notificationSql,taipeiSql} from './contracts.js';
export const LEGACY_ACTIVITY_SECONDS=30*60;
export function legacyScheduleSlot(period:Period,now:Date){
 const at=period==='hourly'?notificationSql(now):taipeiSql(now),width=period==='hourly'?10:30,minutes=Number(at.slice(11,13))*60+Number(at.slice(14,16));
 return {key:`tg:schedule:${period}:${at.slice(0,10).replaceAll('-','')}:${Math.floor(minutes/width)}`,period,ttl:(width+5)*60,expiration:Math.floor(now.getTime()/1000)+(width+5)*60};
}
function cacheKey(prefix:string,key:string){const result=prefix+key;if([...result].length>255||result.includes('\0'))throw new Error('notification_legacy_cache_prefix_invalid');return result;}
export function legacySeenKey(context:Pick<Context,'key'|'period'>,event:Pick<Event,'title'>,cfg:Pick<Config,'legacyCachePrefix'>){return cacheKey(cfg.legacyCachePrefix,`tg:digest:${context.period}:${context.key}:${md5(event.title)}`);}
const marker=(runId:string)=>{const value='ts-notification:'+runId;return `s:${Buffer.byteLength(value)}:"${value}";`;};
function owner(value:unknown){if(typeof value!=='string')return null;const match=/^s:52:"ts-notification:([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})";$/.exec(value);return match?.[1]??null;}
/** Reads only. Retained expired rows are opportunistic recent-activity evidence; absence never proves that Laravel stopped. */
export async function assertNoRecentLegacySchedule(db:Connection,cfg:Config,now:Date){
 const candidates=new Map<string,ReturnType<typeof legacyScheduleSlot>>();
 for(const period of ['hourly','daily'] as const)for(let minutes=-(period==='hourly'?10:30);minutes<=30;minutes+=period==='hourly'?10:30){const slot=legacyScheduleSlot(period,new Date(now.getTime()-minutes*60000));candidates.set(cacheKey(cfg.legacyCachePrefix,slot.key),slot);}
 const keys=[...candidates.keys()],[rows]=await db.query<RowDataPacket[]>(`SELECT \`key\`,value,expiration FROM cache WHERE \`key\` IN (${keys.map(()=>'?').join(',')})`,keys);
 const runIds=[...new Set(rows.map(r=>owner(r.value)).filter((v):v is string=>v!==null))],owners=new Map<string,string>();
 if(runIds.length){const[runs]=await db.query<RowDataPacket[]>(`SELECT run_id,workflow FROM ts_notification_runs WHERE run_id IN (${runIds.map(()=>'?').join(',')})`,runIds);for(const r of runs)owners.set(String(r.run_id),String(r.workflow));}
 const nowSeconds=Math.floor(now.getTime()/1000);
 for(const r of rows){const slot=candidates.get(String(r.key));if(!slot)throw new Error('notification_legacy_cache_key_collision');const runId=owner(r.value);// Run status is not a lease: the caller holds the shared connection-owned writer lock.
  if(runId&&owners.get(runId)==='notify.telegram.'+slot.period)continue;
  const expiration=Number(r.expiration),claimedAt=expiration-slot.ttl;
  if(!Number.isSafeInteger(expiration)||expiration>nowSeconds||claimedAt>=nowSeconds-LEGACY_ACTIVITY_SECONDS)throw new Error('notification_legacy_schedule_activity');
 }
}
/** Laravel Cache::add sees this non-null PHP string and refuses the same slot. TS ownership is journal-verified. */
export async function claimLegacySchedule(db:Connection,period:Period,cfg:Config,runId:string,now:Date){
 await assertNoRecentLegacySchedule(db,cfg,now);
 const slot=legacyScheduleSlot(period,now),key=cacheKey(cfg.legacyCachePrefix,slot.key),value=marker(runId),epoch=Math.floor(now.getTime()/1000);
 const[existing]=await db.query<RowDataPacket[]>('SELECT value,expiration FROM cache WHERE `key`=?',[key]);
 if(existing[0]){
  const previous=existing[0],previousOwner=owner(previous.value);if(!previousOwner)throw new Error('notification_legacy_schedule_activity');
  const[known]=await db.query<RowDataPacket[]>('SELECT run_id FROM ts_notification_runs WHERE run_id=? AND workflow=?',[previousOwner,'notify.telegram.'+period]);if(!known.length)throw new Error('notification_legacy_schedule_activity');
  // Compare-and-swap, including expiration: never replace another writer's claim observed after the preflight.
  const[updated]=await db.execute<ResultSetHeader>('UPDATE cache SET value=?,expiration=? WHERE `key`=? AND BINARY value=BINARY ? AND expiration=?',[value,Math.max(slot.expiration,Number(previous.expiration)),key,previous.value,previous.expiration]);if(updated.affectedRows!==1)throw new Error('notification_legacy_schedule_claim_lost');
 }else{
  const[inserted]=await db.execute<ResultSetHeader>('INSERT IGNORE INTO cache (`key`,value,expiration) VALUES(?,?,?)',[key,value,slot.expiration]);if(inserted.affectedRows!==1)throw new Error('notification_legacy_schedule_claim_lost');
 }
 // Detect a Laravel claim for the other period or preceding slot that appeared during acquisition.
 await assertNoRecentLegacySchedule(db,cfg,now);
 return {key,expiration:slot.expiration,epoch};
}
/** Must share the successful dispatch/story transaction; never called for rejected or uncertain sends. */
export async function markLegacySeen(db:Connection,context:Pick<Context,'period'|'key'>,event:Pick<Event,'title'>,cfg:Pick<Config,'legacyCachePrefix'>,now:Date){await db.execute("INSERT INTO cache (`key`,value,expiration) VALUES(?,'b:1;',?) ON DUPLICATE KEY UPDATE value='b:1;',expiration=GREATEST(expiration,VALUES(expiration))",[legacySeenKey(context,event,cfg),Math.floor(now.getTime()/1000)+3*86400]);}
