import {randomBytes,randomInt,createHash} from 'node:crypto';
import {beforeAll,afterAll,describe,it,expect} from 'vitest';
import mysql from 'mysql2/promise';
import {MySqlDialect} from 'drizzle-orm/mysql-core';
import {assertTestDatabaseUrl} from '../../shared/test-database.js';
import {aiBusinessKey} from '../../shared/ai-business-key.js';
import {buildApp} from '../src/app.js';
import {createReader} from '../src/db/client.js';
const url=process.env.TEST_DATABASE_URL?assertTestDatabaseUrl(process.env.TEST_DATABASE_URL):undefined;
describe.skipIf(!url)('neutral mayor-person bounded source MariaDB contract',()=>{
 const day='2077-03-07',previous='2077-03-06',name='蔣萬安',other='沈伯洋',stamp='2026-10-12 12:00:00',suffix=randomBytes(4).toString('hex'),uid=randomInt(30000000,40000000),id='MP'+suffix+'A',caseId='MP'+suffix+'a';
 let db:mysql.Connection,cachePk:number,aiPk:number;const inserted:number[]=[],latest=new Map<string,number>(),original=new Map<number,string>();
 const runId=createHash('sha256').update('mayor-person-'+suffix).digest('hex'),reader=createReader(url),read=reader.rows.bind(reader),dialect=new MySqlDialect();let mutate:'bucket'|'cache'|null=null;
 reader.rows=async q=>{const rows=await read(q),s=dialect.sqlToQuery(q).sql;if(mutate==='bucket'&&s.includes('AS payload_bytes')&&s.includes('`tags_views`')){mutate=null;await db.execute('UPDATE urt_show_tag_date SET tags_views=? WHERE pk=?',[JSON.stringify({[name]:9,[other]:2}),latest.get(day+'|3')!]);}else if(mutate==='cache'&&s.includes('AS video_hash')){mutate=null;await db.execute('UPDATE urt_show_video_tag_date SET tags_json=? WHERE pk=?',['{"道路":2}',cachePk]);}return rows as any;};
 const app=buildApp({reader,dataset:'fixture',clock:()=>new Date('2077-03-09T01:00:00Z')});
 const get=async(path='/api/v1/mayor/cities/taipei/people/'+encodeURIComponent(name)+'/days/'+day+'?type=views')=>{const r=await app.inject(path);expect(r.statusCode,r.body).toBe(200);return r.json();};
 beforeAll(async()=>{
  db=await mysql.createConnection({uri:url!,dateStrings:true});
  const add=async(date:string,tag:string,value:number)=>{const raw=JSON.stringify({[name]:value,[other]:2}),[r]=await db.execute<mysql.ResultSetHeader>('INSERT INTO urt_show_tag_date(ctime,mtime,the_date,tagid,tag_or,tag_not,tags_views,tags_video,tags_result) VALUES(?,?,?,?,?,?,?,?,?)',[stamp,stamp,date,tag,'','',raw,raw,raw]);inserted.push(r.insertId);latest.set(date+'|'+tag,r.insertId);original.set(r.insertId,raw);};
  await add(day,'3',999);
  for(let n=1;n<=7;n++)for(const tag of ['3','4','5','6'])await add('2077-03-0'+n,tag,n===7&&['3','4'].includes(tag)?4:1);
  for(const videoId of [id,caseId])await db.execute("INSERT INTO urt_video(u_id,videoId,title,publishedAt,ctime,viewCount,id,channelId,thumbnails,channelTitle,playlistId,position,description) VALUES(?,?,?,?,?,?,'fixture','fixture','','fixture','fixture',0,'source')",[uid,videoId,'Synthetic exact reference',day+' 12:00:00',stamp,videoId===id?10:999]);
  const [cache]=await db.execute<mysql.ResultSetHeader>('INSERT INTO urt_show_video_tag_date(ctime,mtime,the_date,tag,videos_json,tags_json) VALUES(?,?,?,?,?,?)',[stamp,stamp,day,name,JSON.stringify([id]),'{"道路":1}']);cachePk=cache.insertId;
  const [ai]=await db.execute<mysql.ResultSetHeader>('INSERT INTO urt_mayor_person_ai(ctime,mtime,city_key,city_label,person,the_date,user_token,ai_type,provider,result_json) VALUES(?,?,?,?,?,?,?,?,?,?)',[stamp,stamp,'taipei','台北市',name,day,suffix,'fixture','fixture','{"summary":"Synthetic stored summary"}']);aiPk=ai.insertId;
 });
 afterAll(async()=>{
  await app.close();if(!db)return;
  try{await db.execute('DELETE FROM ts_ai_runs WHERE run_id=?',[runId]);
  await db.execute('DELETE FROM ts_tag_cache_lineage WHERE the_date=? AND selection_key=?',[day,'[[4],[],[]]']);
  if(inserted.length)await db.query('DELETE FROM urt_show_tag_date WHERE pk IN (?)',[inserted]);if(cachePk)await db.execute('DELETE FROM urt_show_video_tag_date WHERE pk=?',[cachePk]);if(aiPk)await db.execute('DELETE FROM urt_mayor_person_ai WHERE pk=?',[aiPk]);await db.execute('DELETE FROM urt_video WHERE u_id=?',[uid]);}finally{await db.end();}
 });
 it('uses newest source rows and exactly the city raw-share denominator, preserving case-distinct video identity',async()=>{
  const {data,meta}=await get();expect(data.summary.daily).toMatchObject({total:10,observedTotal:10,observedCategories:4,complete:true});expect(data.summary.change).toBe(6);expect(data.summary.largestObservedCategories).toEqual(['泛藍','泛綠']);expect(data.summary.rolling).toMatchObject({value:34,cityTotal:90,observedBuckets:28,complete:true});
  const city=await get('/api/v1/mayor/cities/taipei?from='+day+'&to='+day+'&type=views');expect(data.summary.rolling.value).toBe(city.data.rows[0][name]);expect(data.summary.rolling.sharePercent).toBe(city.data.rows[0][name+'：占比']);
  expect(data.rows.filter((r:any)=>r.kind==='來源影片').map((r:any)=>r.name.href)).toEqual(['/videos/'+id]);expect(meta.coverage).toMatchObject({comparableDays:true,rollingComplete:true,referenceCache:'legacy'});
 });
 it('withholds pending latest buckets without reverting to old revisions or inventing comparable totals',async()=>{
  await db.execute('INSERT INTO ts_tag_cache_lineage(selection_key,the_date,vocabulary_version,coverage,rule_version,status,generated_at,unknown_view_videos) VALUES(?,?,?,?,?,?,?,0)',['[[4],[],[]]',day,'fixture','full','fixture','pending',stamp]);
  try{const {data,meta}=await get();expect(data.summary.daily).toMatchObject({observedCategories:3,observedTotal:6,total:null});expect(data.summary.change).toBeNull();expect(data.summary.rolling.observedBuckets).toBe(27);expect(meta.coverage.signals.withheldBuckets).toBe(1);}finally{await db.execute('DELETE FROM ts_tag_cache_lineage WHERE the_date=? AND selection_key=?',[day,'[[4],[],[]]']);}
 });
 it('missing historical days stay null and an unconfigured person never gets a city percentage',async()=>{
  const missing=await get('/api/v1/mayor/cities/taipei/people/'+encodeURIComponent(name)+'/days/2076-01-01');expect(missing.data.summary.daily.observedTotal).toBeNull();expect(missing.data.summary.rolling.sharePercent).toBeNull();expect(missing.meta.coverage.date).toBe('2076-01-01');
  const outside=await get('/api/v1/mayor/cities/taipei/people/'+encodeURIComponent('名單外人物')+'/days/'+day);expect(outside.data.summary.rolling).toMatchObject({candidateInConfiguration:false,sharePercent:null});
 });
 it('keeps a complete recorded zero distinct from unavailable data',async()=>{
  const keys=[...latest].filter(([key])=>key.startsWith(day)||key.startsWith(previous)).map(([,pk])=>pk);
  try{await db.query("UPDATE urt_show_tag_date SET tags_views='{}' WHERE pk IN (?)",[keys]);const {data}=await get();expect(data.summary.daily.total).toBe(0);expect(data.summary.previous.total).toBe(0);expect(data.summary.change).toBe(0);expect(data.summary.largestObservedCategories).toEqual([]);}finally{for(const pk of keys)await db.execute('UPDATE urt_show_tag_date SET tags_views=? WHERE pk=?',[original.get(pk)!,pk]);}
 });
 it('oversized and same-length changed category bodies are separately withheld',async()=>{
  const pk=latest.get(day+'|3')!;
  try{await db.execute('UPDATE urt_show_tag_date SET tags_views=? WHERE pk=?',[' '.repeat(131073),pk]);const huge=await get();expect(huge.meta.coverage.signals.oversizedBuckets).toBe(1);expect(huge.data.rows[0].views).toBeNull();await db.execute('UPDATE urt_show_tag_date SET tags_views=? WHERE pk=?',[original.get(pk)!,pk]);mutate='bucket';const raced=await get();expect(raced.meta.coverage.signals.changedBuckets).toBe(1);expect(raced.data.rows[0].views).toBeNull();}finally{mutate=null;await db.execute('UPDATE urt_show_tag_date SET tags_views=? WHERE pk=?',[original.get(pk)!,pk]);}
 });
 it('bounds reference-cache bodies and catches same-length changes before exposing source links',async()=>{
  try{mutate='cache';const raced=await get();expect(raced.meta.coverage.referenceCache).toBe('changed');expect(raced.data.rows.filter((r:any)=>r.kind==='來源影片')).toEqual([]);await db.execute('UPDATE urt_show_video_tag_date SET tags_json=? WHERE pk=?',[' '.repeat(131073),cachePk]);const huge=await get();expect(huge.meta.coverage.referenceCache).toBe('oversized');expect(huge.data.words).toEqual([]);}finally{mutate=null;await db.execute('UPDATE urt_show_video_tag_date SET tags_json=? WHERE pk=?',['{"道路":1}',cachePk]);}
 });
 it('independent deterministic summary remains when the AI output is withheld',async()=>{
  const key={city_key:'taipei',person:name,the_date:day,user_token:suffix};await db.execute('INSERT INTO ts_ai_runs(run_id,workflow,business_key_sha256,input_sha256,input_json,status,result_json,target_pk,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)',[runId,'ai.mayor_person',aiBusinessKey('urt_mayor_person_ai',key),'0'.repeat(64),'{}','validated','{}',aiPk,stamp,stamp]);
  try{const {data,meta}=await get();expect(meta.coverage.ai.withheldSources).toBe(1);expect(data.summary.daily.total).toBe(10);expect(data.notes.some((n:string)=>n.startsWith('AI 摘要：'))).toBe(false);expect(data.notes.join(' ')).toContain('增加 6');}finally{await db.execute('DELETE FROM ts_ai_runs WHERE run_id=?',[runId]);}
 });
 it('default AI anchor excludes future and old dates, accepts visible boundary history and preserves explicit old dates',async()=>{
  const path='/api/v1/mayor/cities/taipei/people/'+encodeURIComponent(name),today='2077-03-09',oldest=new Date(Date.parse(today)-364*86400000).toISOString().slice(0,10),expired=new Date(Date.parse(today)-365*86400000).toISOString().slice(0,10);
  try{
   for(const date of ['2077-03-10',expired]){await db.execute('UPDATE urt_mayor_person_ai SET the_date=? WHERE pk=?',[date,aiPk]);const r=await get(path);expect(r.meta.coverage).toMatchObject({date:day,dateSource:'observed-signal'});expect(r.meta.coverage.dateAnchorAi.sourceRows).toBe(0);}
   for(const date of ['2077-03-08',oldest]){await db.execute('UPDATE urt_mayor_person_ai SET the_date=? WHERE pk=?',[date,aiPk]);const r=await get(path);expect(r.meta.coverage).toMatchObject({date,dateSource:'stored-ai'});expect(r.meta.coverage.dateAnchorAi.legacySources).toBe(1);}
   await db.execute('UPDATE urt_mayor_person_ai SET the_date=? WHERE pk=?',[expired,aiPk]);const explicit=await get(path+'/days/'+expired);expect(explicit.meta.coverage).toMatchObject({date:expired,dateSource:'explicit'});expect(explicit.data.notes.join(' ')).toContain('Synthetic stored summary');
  }finally{await db.execute('UPDATE urt_mayor_person_ai SET the_date=? WHERE pk=?',[day,aiPk]);}
 });
 it('unpublished or oversized latest AI cannot anchor or rescue an older same-date revision',async()=>{
  const path='/api/v1/mayor/cities/taipei/people/'+encodeURIComponent(name),candidateDay='2077-03-08';let pendingPk:number|undefined;
  try{
   // The original visible row is an older same-date revision. It must not rescue the latest one.
   await db.execute('UPDATE urt_mayor_person_ai SET the_date=? WHERE pk=?',[candidateDay,aiPk]);
   const [r]=await db.execute<mysql.ResultSetHeader>('INSERT INTO urt_mayor_person_ai(ctime,mtime,city_key,city_label,person,the_date,user_token,result_json) VALUES(?,?,?,?,?,?,?,?)',[stamp,stamp,'taipei','台北市',name,candidateDay,suffix,'{"summary":"Pending synthetic anchor"}']);pendingPk=r.insertId;
   await db.execute('INSERT INTO ts_ai_runs(run_id,workflow,business_key_sha256,input_sha256,input_json,status,result_json,target_pk,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)',[runId,'ai.mayor_person',aiBusinessKey('urt_mayor_person_ai',{city_key:'taipei',person:name,the_date:candidateDay,user_token:suffix}),'0'.repeat(64),'{}','validated','{}',pendingPk,stamp,stamp]);
   const withheld=await get(path);expect(withheld.meta.coverage).toMatchObject({date:day,dateSource:'observed-signal'});expect(withheld.meta.coverage.dateAnchorAi.withheldSources).toBe(1);
   await db.execute('DELETE FROM ts_ai_runs WHERE run_id=?',[runId]);await db.execute('UPDATE urt_mayor_person_ai SET result_json=? WHERE pk=?',[' '.repeat(131073),pendingPk]);const oversized=await get(path);expect(oversized.meta.coverage).toMatchObject({date:day,dateSource:'observed-signal'});expect(oversized.meta.coverage.dateAnchorAi.oversizedSources).toBe(1);
  }finally{await db.execute('DELETE FROM ts_ai_runs WHERE run_id=?',[runId]);if(pendingPk)await db.execute('DELETE FROM urt_mayor_person_ai WHERE pk=?',[pendingPk]);await db.execute('UPDATE urt_mayor_person_ai SET the_date=? WHERE pk=?',[day,aiPk]);}
 });

});
