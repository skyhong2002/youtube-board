import type { Connection,RowDataPacket,ResultSetHeader } from 'mysql2/promise';
import { canonicalHash as hash } from '../../shared/ai-business-key.js';
import { loadDailySource,dailyLock,type DailySource } from './daily-source.js';
import { workflowShutdownSignal } from '../../shared/shutdown.js';
export interface TopicCacheInput {date:string;condition?:string;userToken?:string}
const COLUMN_BYTES:Record<string,number>={text:65535,mediumtext:16777215,longtext:16000000};
/** urt_ai_date.data_json was TEXT (64 KiB) in Laravel, which rejected most daily caches; read the live column size. */
export async function topicDataCapacity(db:Connection){
 const [rows]=await db.query<RowDataPacket[]>("SELECT LOWER(DATA_TYPE) type FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='urt_ai_date' AND COLUMN_NAME='data_json'");
 return COLUMN_BYTES[String(rows[0]?.type??'text')]??65535;
}
export async function projectTopics(db:Connection,source:DailySource,dataCapacity=65535){
 const ids=[...new Set(source.topics.flatMap(t=>t.media.flatMap(m=>m.event.videoId)))].sort();if(!ids.length||ids.length>5000)throw new Error('topic_video_cap_exceeded');
 const [rows]=await db.query<RowDataPacket[]>(`SELECT videoId,title,u_id,publishedAt,thumbnails,viewCount,likeCount,commentCount FROM urt_video WHERE BINARY videoId IN (${ids.map(()=>'?').join(',')}) ORDER BY BINARY videoId`,ids);
 if(new Set(rows.map(r=>String(r.videoId))).size!==rows.length)throw new Error('topic_video_source_incomplete');
 const [durations]=await db.query<RowDataPacket[]>(`SELECT videoId,duration FROM urt_video_duration WHERE BINARY videoId IN (${ids.map(()=>'?').join(',')}) ORDER BY pk_video DESC`,ids);
 const uids=source.channels.map(c=>c.u_id),[tags]=await db.query<RowDataPacket[]>(`SELECT u_id,tags FROM urt_count WHERE u_id IN (${uids.map(()=>'?').join(',')})`,uids);
 if(tags.length!==uids.length||new Set(tags.map(r=>Number(r.u_id))).size!==uids.length)throw new Error('topic_channel_tags_incomplete');
 // Laravel AiTopicProjector::videos(): integer counts (NULL kept), u_id integer, duration from the newest row, default 0.
 const int=(v:unknown)=>v===null||v===undefined?null:Number(v);
 const videos:Record<string,unknown>=Object.create(null);for(const row of rows){const duration=durations.find(d=>d.videoId===row.videoId)?.duration;videos[String(row.videoId)]={title:String(row.title??''),u_id:Number(row.u_id??0),publishedAt:String(row.publishedAt??''),thumbnails:String(row.thumbnails??''),viewCount:int(row.viewCount),likeCount:int(row.likeCount),commentCount:int(row.commentCount),duration:Math.max(0,Number(duration??0)||0)};}
 const topics:Record<string,unknown>=Object.create(null);
 // Laravel drops a topic whose videos are missing or belong to another channel instead of failing the whole day.
 const usable=source.topics.filter(topic=>topic.media.every(m=>m.event.videoId.every(id=>rows.some(r=>r.videoId===id&&Number(r.u_id)===m.u_id))));
 if(!usable.length)throw new Error('topic_video_source_incomplete');
 for(const id of Object.keys(videos))if(!usable.some(t=>t.media.some(m=>m.event.videoId.includes(id))))delete videos[id];
 for(const topic of usable){
  const videoMap:Record<string,string[]>=Object.create(null),angle:Record<string,number>=Object.create(null),camp:Record<string,number>=Object.create(null),keywords:Record<string,number>=Object.create(null),keywordCount:Record<string,number>=Object.create(null),people:Record<string,number>=Object.create(null),places:Record<string,number>=Object.create(null),taxonomy:Record<string,number>=Object.create(null);
  const add=(target:Record<string,number>,s:string,n=1)=>{target[s]=(target[s]??0)+n;};
  for(const m of topic.media){
   const e=m.event,n=e.videoId.length;
   videoMap[String(m.u_id)]=[...new Set([...(videoMap[String(m.u_id)]??[]),...e.videoId])];
   for(const k of ['台灣','中國'])if(e.角度.includes(k))add(angle,k,n);
   for(const k of ['民進黨','國民黨'])if(e.陣營.includes(k))add(camp,k,n);
   e.關鍵字.forEach(k=>{add(keywords,k);add(keywordCount,k,n);});e.人物.forEach(k=>add(people,k));e.地名.forEach(k=>add(places,k));
   const raw=String(tags.find(t=>Number(t.u_id)===m.u_id)!.tags??'');for(const match of raw.matchAll(/\[(\d+)\]/g))add(taxonomy,match[1]!,n);
  }
  topics[topic.title]={媒體數:Object.keys(videoMap).length,影片數:new Set(Object.values(videoMap).flat()).size,videos:videoMap,角度:angle,陣營:camp,關鍵字:keywords,關鍵字次數:keywordCount,人物:people,地名:places,標籤:taxonomy,媒體明細:topic.media.map(m=>({u_id:m.u_id,媒體:m.channel,...m.event}))};
 }
 const dataJson=JSON.stringify(topics),videoJson=JSON.stringify(videos);if(Buffer.byteLength(dataJson)>dataCapacity||Buffer.byteLength(videoJson)>16000000)throw new Error('topic_cache_capacity_exceeded');
 return {source,topics,videos,dataJson,videoJson};
}
export async function buildTopicCache(db:Connection,input:TopicCacheInput,options:{execute:boolean;assertAuthorized:()=>void}){
 if(options.execute)options.assertAuthorized();let source=await loadDailySource(db,input.date,input.condition,input.userToken);
 const capacity=await topicDataCapacity(db);
 if(!options.execute){const p=await projectTopics(db,source,capacity);return {status:'dry-run',topics:Object.keys(p.topics).length,videos:Object.keys(p.videos).length,writes:0};}
 const lock=dailyLock(source),[locked]=await db.query<RowDataPacket[]>('SELECT GET_LOCK(?,0) acquired',[lock]);if(Number(locked[0]?.acquired)!==1)throw new Error('AI business key is locked');
 try{
  source=await loadDailySource(db,input.date,input.condition,input.userToken);if(dailyLock(source)!==lock)throw new Error('AI source changed');
  const p=await projectTopics(db,source,capacity),inputHash=hash(p),business=hash({workflow:'reports.ai_topic.build',pk:source.pk}),runId=hash({business,inputHash});
  const now=new Date(Date.now()+8*3600000).toISOString().slice(0,19).replace('T',' ');
  const [rows]=await db.query<RowDataPacket[]>('SELECT data_json,video_json FROM urt_ai_date WHERE pk=?',[source.pk]);
  const unchanged=rows[0]?.data_json===p.dataJson&&rows[0]?.video_json===p.videoJson;
  options.assertAuthorized();
  const inputJson=JSON.stringify(p),resultJson=JSON.stringify({topics:p.topics,videos:p.videos});
  if(Buffer.byteLength(inputJson)+Buffer.byteLength(resultJson)>8000000)throw new Error('topic_journal_capacity_exceeded');
  const [prior]=await db.query<RowDataPacket[]>('SELECT input_sha256,input_json,result_json FROM ts_ai_runs WHERE run_id=?',[runId]);
  if(prior[0]){if(prior[0].input_sha256!==inputHash||hash(JSON.parse(String(prior[0].input_json)))!==inputHash||prior[0].result_json!==resultJson)throw new Error('Topic journal mismatch');}
  else await db.execute("INSERT INTO ts_ai_runs(run_id,workflow,business_key_sha256,input_sha256,input_json,status,result_json,target_pk,created_at,updated_at) VALUES(?,'reports.ai_topic.build',?,?,?,'validated',?,?,?,?)",[runId,business,inputHash,inputJson,resultJson,source.pk,now,now]);
  const fresh=await projectTopics(db,await loadDailySource(db,input.date,input.condition,input.userToken),capacity);if(hash(fresh)!==inputHash)throw new Error('AI source changed during cache build');
  const [owned]=await db.query<RowDataPacket[]>('SELECT IS_USED_LOCK(?)=CONNECTION_ID() owned',[lock]);if(Number(owned[0]?.owned)!==1)throw new Error('AI writer lock lost');options.assertAuthorized();
  // One MyISAM row write keeps both derived blobs together; journal enables recovery after interruption.
  if(!unchanged){const [written]=await db.execute<ResultSetHeader>('UPDATE urt_ai_date SET data_json=?,video_json=?,mtime=? WHERE pk=? AND BINARY result_json=BINARY ? AND del_flag IS NULL',[p.dataJson,p.videoJson,now,source.pk,source.result]);if(written.affectedRows!==1)throw new Error('AI source changed during projection');}
  await db.execute("UPDATE ts_ai_runs SET status='published',updated_at=? WHERE run_id=?",[now,runId]);
  return {status:unchanged?'unchanged':'published',runId,targetPk:source.pk,topics:Object.keys(p.topics).length,videos:Object.keys(p.videos).length};
 }finally{await db.query('SELECT RELEASE_LOCK(?)',[lock]).catch(()=>undefined);}
}
const CACHE_REASONS:[RegExp,string][]=[[/locked/,'business_key_locked'],[/source changed/,'source_changed'],[/authoriz|not allowed|denied/i,'not_authorized'],[/^[a-z_]+$/,'']];
/** The derived topic cache after daily synthesis (Laravel ran it inside ai.daily and hid failures).
 * Failures are reported in the result, never thrown: the daily AI rows stay valid without the cache. */
export async function dailyTopicCacheStep(db:Connection,date:string,userToken:string,options:{execute:boolean;missingOnly:boolean;assertAuthorized:()=>void}){
 const step={workflow:'reports.ai_topic.build',date,condition:'all'};
 try{
  if(options.missingOnly){
   const [rows]=await db.query<RowDataPacket[]>("SELECT (data_json IS NOT NULL AND data_json<>'') present FROM urt_ai_date WHERE date_from=? AND date_to=? AND data_type='oneday' AND (condition_type='all' OR condition_type IS NULL) AND BINARY user_token=BINARY ? AND del_flag IS NULL ORDER BY pk DESC LIMIT 1",[date+' 00:00:00',date+' 23:59:59',userToken]);
   if(!rows[0])return {...step,status:'skipped',reason:'daily_source_missing'};
   if(Number(rows[0].present)===1)return {...step,status:'skipped',reason:'cache_already_present'};
  }
  return {...step,...await buildTopicCache(db,{date,condition:'all',userToken},options)};
 }catch(error){
  workflowShutdownSignal().throwIfAborted();
  const message=error instanceof Error?error.message:'',match=CACHE_REASONS.find(([pattern])=>pattern.test(message));
  return {...step,status:'failed',reason:match?(match[1]||message):'topic_cache_failed'};
 }
}
