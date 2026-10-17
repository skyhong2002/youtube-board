import type {Connection,RowDataPacket,ResultSetHeader} from 'mysql2/promise';
import {randomUUID} from 'node:crypto';
import {type Config,type Context,type Decision,type Event,type Fingerprint,type Observation,hash,instant,json,record,strings,notificationSql,unique} from './contracts.js';
const phpTrim=(s:string)=>s.replace(/^[ \t\r\n\0\v]+|[ \t\r\n\0\v]+$/g,'');
// PHP's /u modifier also sets PCRE2_UCP (ext/pcre/php_pcre.c): \s is Unicode white space (\p{Z}, \h, \v) and
// [:punct:] is \p{P} plus the Latin-1 symbols (code points < 256 with \p{S}), so CJK punctuation and NBSP are removed.
const pcreUcpSpacePunct=/(?:[\t\n\v\f\r \u0085\u00a0\u1680\u180e\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\p{P}]|(?=\p{S})[\x00-\xff])+/gu;
export const normalize=(s:string)=>phpTrim(phpTrim(s.toLowerCase()).replace(pcreUcpSpacePunct,'').replace(/事件|新聞|最新|後續|焦點/g,''));
export function bigrams(s:string){const chars=[...s];return unique(chars.length<2?chars:chars.slice(0,-1).map((c,i)=>c+chars[i+1]));}
export function fingerprint(e:Event):Fingerprint {return {title:normalize(e.title),title_grams:bigrams(normalize(e.title)),keywords:unique(e.keywords.map(normalize).filter(v=>[...v].length>=2)),people:unique(e.people.map(normalize).filter(v=>[...v].length>=2)),places:unique(e.places.map(normalize).filter(v=>[...v].length>=2)),category:normalize(e.category)};}
const shared=(a:string[],b:string[])=>a.filter(v=>b.includes(v)).length;
export function matches(a:Fingerprint,b:Fingerprint,aIds:string[],bIds:string[]){if(shared(aIds,bIds))return true;if(a.category&&b.category&&a.category!==b.category)return false;if(a.title&&a.title===b.title)return true;const union=unique([...a.title_grams,...b.title_grams]).length,similarity=union?shared(a.title_grams,b.title_grams)/union:0;return shared(a.people,b.people)>=1&&shared(a.keywords,b.keywords)>=2&&similarity>=.2||shared(a.keywords,b.keywords)>=3&&similarity>=.3||similarity>=.6;}
const decoded=(v:unknown,fallback:unknown)=>v===null||v===undefined?fallback:json(v);
function fp(value:unknown):Fingerprint {const v=decoded(value,{});if(!record(v)||typeof v.title!=='string'||typeof v.category!=='string'||!['title_grams','keywords','people','places'].every(k=>Array.isArray(v[k])))throw new Error('notification_story_fingerprint_invalid');return v as unknown as Fingerprint;}
function stringMap(value:unknown){const raw=decoded(value,{}),v=Array.isArray(raw)&&raw.length===0?{}:raw;if(!record(v)||Object.values(v).some(x=>typeof x!=='string'))throw new Error('notification_story_channels_invalid');return v as Record<string,string>;}
function observations(value:unknown):Observation[]{const v=decoded(value,[]);if(!Array.isArray(v)||v.length>24||v.some(r=>!record(r)||typeof r.context_key!=='string'||typeof r.observed_at!=='string'||!Number.isFinite(r.video_count)||!Number.isFinite(r.media_count)))throw new Error('notification_story_observations_invalid');return v as Observation[];}
export function decide(event:Event,context:Context,cfg:Config,story:RowDataPacket|undefined,now:Date){
 const at=notificationSql(now),current=fingerprint(event),old=story?fp(story.fingerprint_json):current;
 const merged={...current,title_grams:unique([...old.title_grams,...current.title_grams]),keywords:unique([...old.keywords,...current.keywords]),people:unique([...old.people,...current.people]),places:unique([...old.places,...current.places])};
 const videoIds=unique([...strings(decoded(story?.video_ids_json,[])),...event.videoIds]),videoChannels={...stringMap(story?.video_channels_json)};
 const currentChannels:Record<string,string>=Object.create(null);for(const video of event.videos){const key=video.uId>0?'u:'+video.uId:video.channel?'c:'+video.channel:'';if(key){videoChannels[video.videoId]=key;currentChannels[video.videoId]=key;}}
 let obs=observations(story?.observations_json);if(context.period==='hourly')obs=[...obs.filter(o=>o.context_key!==context.key),{context_key:context.key,observed_at:context.dateFrom,video_count:event.videoIds.length,media_count:new Set(Object.values(currentChannels)).size}].slice(-24);
 const prior=obs.slice(0,-1).slice(-cfg.burstHours),baseline=prior.length?prior.reduce((n,o)=>n+o.video_count,0)/prior.length:0,ratio=baseline>0?event.videoIds.length/baseline:null;
 // Laravel computes a burst only for hourly observations; daily posts never carry a burst line.
 const media=new Set(Object.values(currentChannels)).size,isBurst=context.period==='hourly'&&prior.length===cfg.burstHours&&ratio!==null&&event.videoIds.length>=cfg.burstMinVideos&&media>=cfg.burstMinMedia&&ratio>=cfg.burstRatio;
 const posted=strings(decoded(story?.last_posted_video_ids_json,[])),delta=videoIds.filter(v=>!posted.includes(v)),deltaMedia=new Set(delta.map(v=>videoChannels[v]).filter(Boolean)).size;
 const previous=story?.last_posted_at?String(story.last_posted_at):null,hours=previous?(now.getTime()-instant(previous).getTime())/3600000:null;
 if(hours!==null&&(!Number.isFinite(hours)||hours<0))throw new Error('notification_story_posted_time_invalid');
 const eligible=context.period==='daily'||event.videoCount>=cfg.hourlyMinVideos;
 let shouldPost=false,trigger='below_threshold';
 if(!previous){shouldPost=eligible;trigger=eligible?(context.period==='daily'?'daily':'first'):'below_threshold';}
 else if(context.period==='daily')trigger='covered';
 else if(isBurst&&delta.length>=cfg.burstMinNewVideos&&hours!>=cfg.burstCooldown){shouldPost=true;trigger='burst';}
 else if(delta.length>=cfg.updateMinVideos&&deltaMedia>=cfg.updateMinMedia&&hours!>=cfg.updateCooldown){shouldPost=true;trigger=hours!>=cfg.resurfaceHours?'resurfaced':'update';}else trigger='cooldown';
 const metricLine=context.period==='daily'?`昨日整理｜影片${event.videoCount}｜來源頻道${media}`:['update','burst'].includes(trigger)?`上次推播後｜新增影片${delta.length}｜新增頻道${deltaMedia}`:trigger==='resurfaced'?`相隔${Math.max(1,Math.floor(hours!/24))}天再度升溫｜新增影片${delta.length}｜新增頻道${deltaMedia}`:`近1小時｜影片${event.videoCount}｜來源頻道${media}`;
 const decision:Decision={storyId:Number(story?.id??0),shouldPost,trigger,metricLine,burstLine:isBurst?`近1小時｜影片${event.videoCount}｜來源頻道${media}｜為前${prior.length}小時均值${Number(ratio!.toFixed(1))}倍`:'',displayVideoIds:['update','burst','resurfaced'].includes(trigger)?delta:event.videoIds,previousPostedAt:previous,deltaVideos:delta.length,deltaMedia,snapshot:{videoIds,videoChannels}};
 return {decision,at,merged,videoIds,videoChannels,obs};
}
export async function evaluateStory(db:Connection,event:Event,context:Context,cfg:Config,now:Date,execute:boolean,assertOwnership:()=>Promise<void>,skipStoryIds:ReadonlySet<number>=new Set()):Promise<Decision>{
 if(execute){await assertOwnership();await db.beginTransaction();}
 try{
  const [pending]=await db.query<RowDataPacket[]>(`SELECT s.* FROM telegram_digest_stories s WHERE EXISTS (SELECT 1 FROM telegram_digest_dispatches d WHERE d.story_id=s.id AND d.status IN ('pending','uncertain')) ORDER BY s.id LIMIT 101${execute?' FOR UPDATE':''}`);
  if(pending.length>100)throw new Error('notification_unresolved_story_cap');
  const [recent]=await db.query<RowDataPacket[]>(`SELECT * FROM telegram_digest_stories WHERE last_seen_at>=? ORDER BY last_seen_at DESC,id DESC LIMIT 100${execute?' FOR UPDATE':''}`,[notificationSql(new Date(now.getTime()-cfg.matchHours*3600000))]);
  const rows=[...pending,...recent.filter(r=>!pending.some(p=>String(p.id)===String(r.id)))];
  let story=rows.find(row=>matches(fingerprint(event),fp(row.fingerprint_json),event.videoIds,strings(decoded(row.video_ids_json,[]))));
  const state=decide(event,context,cfg,story,now);
  if(!Number.isSafeInteger(state.decision.storyId)||state.decision.storyId<0)throw new Error('notification_story_identity_invalid');
  if(skipStoryIds.has(state.decision.storyId)){if(execute)await db.commit();return {...state.decision,batchDuplicate:true};}
  if(execute){
   await assertOwnership();
   if(!story){const[r]=await db.execute<ResultSetHeader>('INSERT INTO telegram_digest_stories(story_key,canonical_title,fingerprint_json,video_ids_json,video_channels_json,observations_json,first_seen_at,last_seen_at,post_count,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,0,?,?)',[hash(fingerprint(event).title+'|'+randomUUID()),[...event.title].slice(0,500).join(''),JSON.stringify(state.merged),JSON.stringify(state.videoIds),JSON.stringify(state.videoChannels),JSON.stringify(state.obs),state.at,state.at,state.at,state.at]);state.decision.storyId=r.insertId;}
   else await db.execute('UPDATE telegram_digest_stories SET canonical_title=?,fingerprint_json=?,video_ids_json=?,video_channels_json=?,observations_json=?,last_seen_at=?,updated_at=? WHERE id=?',[[...event.title].slice(0,500).join(''),JSON.stringify(state.merged),JSON.stringify(state.videoIds),JSON.stringify(state.videoChannels),JSON.stringify(state.obs),state.at,state.at,story.id]);
   await db.commit();
  }
  return state.decision;
 }catch(error){if(execute)await db.rollback().catch(()=>undefined);throw error;}
}
export async function markStoryPosted(db:Connection,storyId:number,now:Date,adopt=false,snapshot?:{videoIds:string[];videoChannels:Record<string,string>}){
 const at=notificationSql(now);const[rows]=await db.query<RowDataPacket[]>('SELECT * FROM telegram_digest_stories WHERE id=? FOR UPDATE',[storyId]);const row=rows[0];if(!row)throw new Error('notification_story_missing');if(adopt&&row.last_posted_at!==null)return;
 const channels=unique(Object.values(snapshot?.videoChannels??stringMap(row.video_channels_json))),videoIds=snapshot?.videoIds??strings(decoded(row.video_ids_json,[]));
 await db.execute('UPDATE telegram_digest_stories SET last_posted_at=?,last_posted_video_ids_json=?,last_posted_channel_ids_json=?,post_count=?,updated_at=? WHERE id=?',[at,JSON.stringify(videoIds),JSON.stringify(channels),adopt?Math.max(1,Number(row.post_count)):Number(row.post_count)+1,at,storyId]);
}
