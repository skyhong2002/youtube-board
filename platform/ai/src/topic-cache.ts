import type { Connection,RowDataPacket,ResultSetHeader } from 'mysql2/promise';
import { canonicalHash as hash } from '../../shared/ai-business-key.js';
import { loadDailySource,dailyLock,type DailySource } from './daily-source.js';
export interface TopicCacheInput {date:string;condition?:string;userToken?:string}
export async function projectTopics(db:Connection,source:DailySource){
 const ids=[...new Set(source.topics.flatMap(t=>t.media.flatMap(m=>m.event.videoId)))].sort();if(!ids.length||ids.length>5000)throw new Error('topic_video_cap_exceeded');
 const [rows]=await db.query<RowDataPacket[]>(`SELECT videoId,title,u_id,publishedAt,thumbnails,viewCount,likeCount,commentCount FROM urt_video WHERE BINARY videoId IN (${ids.map(()=>'?').join(',')}) ORDER BY BINARY videoId`,ids);
 if(rows.length!==ids.length||new Set(rows.map(r=>String(r.videoId))).size!==ids.length)throw new Error('topic_video_source_incomplete');
 const [durations]=await db.query<RowDataPacket[]>(`SELECT videoId,duration FROM urt_video_duration WHERE BINARY videoId IN (${ids.map(()=>'?').join(',')}) ORDER BY pk_video DESC`,ids);
 const uids=source.channels.map(c=>c.u_id),[tags]=await db.query<RowDataPacket[]>(`SELECT u_id,tags FROM urt_count WHERE u_id IN (${uids.map(()=>'?').join(',')})`,uids);
 if(tags.length!==uids.length||new Set(tags.map(r=>Number(r.u_id))).size!==uids.length)throw new Error('topic_channel_tags_incomplete');
 const videos:Record<string,unknown>=Object.create(null);for(const row of rows){const {videoId,...data}=row;videos[String(videoId)]={...data,duration:durations.find(d=>d.videoId===videoId)?.duration??null};}
 const topics:Record<string,unknown>=Object.create(null);
 for(const topic of source.topics){
  const videoMap:Record<string,string[]>=Object.create(null),angle:Record<string,number>=Object.create(null),camp:Record<string,number>=Object.create(null),keywords:Record<string,number>=Object.create(null),keywordCount:Record<string,number>=Object.create(null),people:Record<string,number>=Object.create(null),places:Record<string,number>=Object.create(null),taxonomy:Record<string,number>=Object.create(null);
  const add=(target:Record<string,number>,s:string,n=1)=>{target[s]=(target[s]??0)+n;};
  for(const m of topic.media){
   const e=m.event,n=e.videoId.length;for(const id of e.videoId)if(!rows.some(r=>r.videoId===id&&Number(r.u_id)===m.u_id))throw new Error('topic_video_channel_mismatch');
   videoMap[String(m.u_id)]=[...new Set([...(videoMap[String(m.u_id)]??[]),...e.videoId])];
   for(const k of ['台灣','中國'])if(e.角度.includes(k))add(angle,k,n);
   for(const k of ['民進黨','國民黨'])if(e.陣營.includes(k))add(camp,k,n);
   e.關鍵字.forEach(k=>{add(keywords,k);add(keywordCount,k,n);});e.人物.forEach(k=>add(people,k));e.地名.forEach(k=>add(places,k));
   const raw=String(tags.find(t=>Number(t.u_id)===m.u_id)!.tags??'');for(const match of raw.matchAll(/\[(\d+)\]/g))add(taxonomy,match[1]!,n);
  }
  topics[topic.title]={媒體數:Object.keys(videoMap).length,影片數:new Set(Object.values(videoMap).flat()).size,videos:videoMap,角度:angle,陣營:camp,關鍵字:keywords,關鍵字次數:keywordCount,人物:people,地名:places,標籤:taxonomy,媒體明細:topic.media.map(m=>({u_id:m.u_id,媒體:m.channel,...m.event}))};
 }
 const dataJson=JSON.stringify(topics),videoJson=JSON.stringify(videos);if(Buffer.byteLength(dataJson)>60000||Buffer.byteLength(videoJson)>16000000)throw new Error('topic_cache_capacity_exceeded');
 return {source,topics,videos,dataJson,videoJson};
}
export async function buildTopicCache(db:Connection,input:TopicCacheInput,options:{execute:boolean;assertAuthorized:()=>void}){
 if(options.execute)options.assertAuthorized();let source=await loadDailySource(db,input.date,input.condition,input.userToken);
 if(!options.execute){const p=await projectTopics(db,source);return {status:'dry-run',topics:Object.keys(p.topics).length,videos:Object.keys(p.videos).length,writes:0};}
 const lock=dailyLock(source),[locked]=await db.query<RowDataPacket[]>('SELECT GET_LOCK(?,0) acquired',[lock]);if(Number(locked[0]?.acquired)!==1)throw new Error('AI business key is locked');
 try{
  source=await loadDailySource(db,input.date,input.condition,input.userToken);if(dailyLock(source)!==lock)throw new Error('AI source changed');
  const p=await projectTopics(db,source),inputHash=hash(p),business=hash({workflow:'reports.ai_topic.build',pk:source.pk}),runId=hash({business,inputHash});
  const now=new Date(Date.now()+8*3600000).toISOString().slice(0,19).replace('T',' ');
  const [rows]=await db.query<RowDataPacket[]>('SELECT data_json,video_json FROM urt_ai_date WHERE pk=?',[source.pk]);
  const unchanged=rows[0]?.data_json===p.dataJson&&rows[0]?.video_json===p.videoJson;
  options.assertAuthorized();
  const inputJson=JSON.stringify(p),resultJson=JSON.stringify({topics:p.topics,videos:p.videos});
  if(Buffer.byteLength(inputJson)+Buffer.byteLength(resultJson)>8000000)throw new Error('topic_journal_capacity_exceeded');
  const [prior]=await db.query<RowDataPacket[]>('SELECT input_sha256,input_json,result_json FROM ts_ai_runs WHERE run_id=?',[runId]);
  if(prior[0]){if(prior[0].input_sha256!==inputHash||hash(JSON.parse(String(prior[0].input_json)))!==inputHash||prior[0].result_json!==resultJson)throw new Error('Topic journal mismatch');}
  else await db.execute("INSERT INTO ts_ai_runs(run_id,workflow,business_key_sha256,input_sha256,input_json,status,result_json,target_pk,created_at,updated_at) VALUES(?,'reports.ai_topic.build',?,?,?,'validated',?,?,?,?)",[runId,business,inputHash,inputJson,resultJson,source.pk,now,now]);
  const fresh=await projectTopics(db,await loadDailySource(db,input.date,input.condition,input.userToken));if(hash(fresh)!==inputHash)throw new Error('AI source changed during cache build');
  const [owned]=await db.query<RowDataPacket[]>('SELECT IS_USED_LOCK(?)=CONNECTION_ID() owned',[lock]);if(Number(owned[0]?.owned)!==1)throw new Error('AI writer lock lost');options.assertAuthorized();
  // One MyISAM row write keeps both derived blobs together; journal enables recovery after interruption.
  if(!unchanged){const [written]=await db.execute<ResultSetHeader>('UPDATE urt_ai_date SET data_json=?,video_json=?,mtime=? WHERE pk=? AND BINARY result_json=BINARY ? AND del_flag IS NULL',[p.dataJson,p.videoJson,now,source.pk,source.result]);if(written.affectedRows!==1)throw new Error('AI source changed during projection');}
  await db.execute("UPDATE ts_ai_runs SET status='published',updated_at=? WHERE run_id=?",[now,runId]);
  return {status:unchanged?'unchanged':'published',runId,targetPk:source.pk,topics:Object.keys(p.topics).length,videos:Object.keys(p.videos).length};
 }finally{await db.query('SELECT RELEASE_LOCK(?)',[lock]).catch(()=>undefined);}
}
