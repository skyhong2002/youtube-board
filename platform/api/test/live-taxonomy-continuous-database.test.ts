import {beforeAll,afterAll,it,describe,expect} from 'vitest';
import mysql,{type Connection,type ResultSetHeader} from 'mysql2/promise';
import type {SQL} from 'drizzle-orm';
import {MySqlDialect} from 'drizzle-orm/mysql-core';
import {assertTestDatabaseUrl} from '../../shared/test-database.js';
import {createReader,type Reader,type Row} from '../src/db/client.js';
import type {Register} from '../src/reports/table.js';
import type {Query} from '../src/reports/query.js';
import {registerLiveTaxonomyVideos} from '../src/reports/live-taxonomy-videos.js';
import {registerLiveContinuous} from '../src/reports/live-continuous.js';
const url=process.env.TEST_DATABASE_URL?assertTestDatabaseUrl(process.env.TEST_DATABASE_URL):undefined;
const clock=()=>new Date('2038-10-12T10:00:00Z'),stamp='2038-10-12 18:00:00',day='2038-10-10',uid=985621,uid2=985622,ids=['A1A3Case001','A1A3case001','A1A3Orphan1','A1A3Stale01'];
describe.skipIf(!url)('taxonomy source-row and continuous daily MariaDB contracts',()=>{
 let db:Connection,targetPk=0;const reader=createReader(url);
 function routes(using=reader){const map=new Map<string,Parameters<Register>[1]>(),register:Register=(path,handler)=>map.set(path,handler);registerLiveTaxonomyVideos(register,using,clock);registerLiveContinuous(register,using,clock);return map;}
 const get=async(path:string,q:Query={},p:Record<string,string>={},using=reader)=>await routes(using).get(path)!(p,q) as any;
 const clear=async()=>{for(const table of ['urt_show_video_live','urt_video_live_log','urt_video_live','urt_video'])for(const id of ids)await db.execute(`DELETE FROM ${table} WHERE BINARY videoId=BINARY ?`,[id]);for(const table of ['urt_count','urt_channel'])for(const id of [uid,uid2])await db.execute(`DELETE FROM ${table} WHERE u_id=?`,[id]);};
 const add=async(id:string,date:string,peak:number|null,raw:string|null)=>{const[r]=await db.execute<ResultSetHeader>('INSERT INTO urt_video_live_log(videoId,u_id,the_date,ctime,mtime,max_current,log_json)VALUES(?,?,?,?,?,?,?)',[id,id===ids[1]?uid2:uid,date,stamp,stamp,peak,raw]);return r.insertId;};
 beforeAll(async()=>{
  db=await mysql.createConnection(url!);await clear();
  for(const id of [uid,uid2]){await db.execute('INSERT INTO urt_channel(u_id,ctime,youtube_id,title)VALUES(?,?,?,?)',[id,stamp,'LIVE_A1A3_'+id,'Source channel '+id]);await db.execute('INSERT INTO urt_count(u_id,ctime,tags)VALUES(?,?,?)',[id,stamp,id===uid?'[985621][3][1]':'[985621][3][2][48]']);}
  for(const[i,id]of ids.entries()){
   if(i!==2)await db.execute('INSERT INTO urt_video(ctime,mtime,u_id,id,publishedAt,channelId,title,thumbnails,channelTitle,playlistId,position,videoId,description)VALUES(?,?,?,?,?,?,?,?,?,?,0,?,?)',[stamp,stamp,i===1?uid2:uid,id,stamp,'LIVE_A1A3','Current title '+i,'','Source channel','fixture',id,'']);
   if(i<2||i===3)await db.execute('INSERT INTO urt_video_live(ctime,mtime,publishedAt,videoId,u_id,actualStartTime,concurrentViewers,max_current)VALUES(?,?,?,?,?,?,?,?)',[stamp,i===3?'2038-10-12 16:00:00':stamp,stamp,id,i===1?uid2:uid,i===1?null:'2038-10-10 01:00:00',i===0?50:30,90]);
   if(i===1||i===2)await db.execute('INSERT INTO urt_show_video_live(pk_live,v_pk,ctime,videoId,u_id,publishedAt,channelId,channelTitle,title,thumbnails,description)VALUES(?,0,?,?,?,?,?,?,?,?,?)',[9856210+i,stamp,id,i===1?uid2:uid,'2038-10-08 08:00:00','LIVE_A1A3','Retained display channel',i===1?'Lower retained title':'Orphan retained title','','']);
  }
  await add(ids[0]!,'2038-10-09',6,'{"01:00":0}');targetPk=await add(ids[0]!,day,20,'{"01:00":2}');await add(ids[0]!,day,30,'{"01:00":0,"02:00":15,"24:00":100}');await add(ids[0]!,day,0,null);await add(ids[0]!,day,null,null);await add(ids[0]!,day,-1,null);await add(ids[1]!,day,40,'{}');await add(ids[2]!,day,15,'{"01:00":12}');
 });
 afterAll(async()=>{await reader.close();if(db){await clear();await db.end();}});
 it('default is today while old date and explicit range preserve every positive source row',async()=>{
  expect((await get('/tags/live/videos',{tagid:String(uid)})).rows).toEqual([]);
  const old=await get('/tags/live/videos',{tagid:String(uid),date:day});expect(old.total).toBe(4);expect(old.rows.map((r:any)=>r.peak)).toEqual([40,30,20,15]);expect(old.rows.every((r:any)=>r.date===day)).toBe(true);expect(new Set(old.rows.map((r:any)=>r.sourceLogId)).size).toBe(4);
  const range=await get('/tags/live/videos',{tagid:String(uid),from:'2038-10-09',to:day});expect(range.total).toBe(5);expect(range.rows.filter((r:any)=>r.video.value==='Current title 0').map((r:any)=>r.date)).toEqual([day,day,'2038-10-09']);expect(range.evidenceCoverage).toMatchObject({invalidSamples:1,emptySampleRows:1,from:'2038-10-09',to:day});
 });
 it('retained display rescues orphan videos and exact-case identities never borrow another title',async()=>{
  const data=await get('/tags/live/videos',{tagid:String(uid),date:day});expect(data.rows.map((r:any)=>r.video.value)).toEqual(['Lower retained title','Current title 0','Current title 0','Orphan retained title']);expect(data.rows[3].publishedAt).toBe('2038-10-08T08:00:00+08:00');expect(data.rows[1].samples.value).toBe('0 → 15');
  const search=await get('/tags/live/videos',{tagid:String(uid),date:day,q:'Orphan retained'});expect(search.total).toBe(1);expect(search.rows[0].video.value).toBe('Orphan retained title');
 });
 it('path classification intersects query taxonomy, union and exclusion; pagination retains total',async()=>{
  const data=await get('/tags/:id/live/videos',{tagid:'3',or:'1,2',not:'48',date:day,limit:'1',offset:'1'},{id:String(uid)});expect(data.total).toBe(3);expect(data.rows[0].peak).toBe(20);expect(data.navigation[0].href).toContain('tagid=3%2C985621');
  expect((await get('/tags/:id/live/videos',{tagid:'4',date:day},{id:String(uid)})).rows).toEqual([]);
 });
 it('metadata-first source hashes reject same-size sample changes without changing provider peaks',async()=>{
  const dialect=new MySqlDialect();let changed=false;const proxy:Reader={close:async()=>{},rows:async<T extends Row>(query:SQL)=>{const c=dialect.sqlToQuery(query);if(!changed&&c.sql.includes('AS log_json FROM')&&c.params.includes(targetPk)){changed=true;await db.execute('UPDATE urt_video_live_log SET log_json=? WHERE pk=?',['{"01:00":8}',targetPk]);}return reader.rows<T>(query);}};
  try{const data=await get('/tags/live/videos',{tagid:String(uid),date:day},{},proxy);expect(changed).toBe(true);expect(data.evidenceCoverage.changedSampleRows).toBe(1);expect(data.rows.find((r:any)=>r.sourceLogId===targetPk)).toMatchObject({peak:20,sampleCount:0});}finally{await db.execute('UPDATE urt_video_live_log SET log_json=? WHERE pk=?',['{"01:00":2}',targetPk]);}
 });
 it('continuous latest-date anchor and today=0 agree; duplicate logs produce disclosed daily mean',async()=>{
  for(const extra of [{},{today:'0'}]){const data=await get('/live/continuous',{tagid:String(uid),...extra});expect(data.evidenceCoverage).toMatchObject({from:'2038-10-04',to:day,anchor:day,anchorSource:'latest-log-date'});expect(data.total).toBe(2);expect(data.rows[0]).toMatchObject({video:{value:'Current title 0'},todayPeak:30,periodAverage:18,periodPeak:30,observedDays:2,sourceLogRows:6});expect(data.rows[1]).toMatchObject({video:{value:'Lower retained title'},todayPeak:40,periodAverage:40,startedAt:null});}
 });
 it('continuous explicit date, zero and missing historical observations retain distinct meanings',async()=>{
  const future=await get('/live/continuous',{tagid:String(uid),date:'2038-10-12',days:'1'});expect(future.rows.every((r:any)=>r.todayPeak===null&&r.periodAverage===null&&r.periodPeak===null)).toBe(true);
  const pk=await add(ids[0]!,'2038-10-11',0,null);try{const data=await get('/live/continuous',{tagid:String(uid),from:'2038-10-11',to:'2038-10-11'});expect(data.rows[0]).toMatchObject({todayPeak:0,periodAverage:0,periodPeak:0,observedDays:1});expect(data.rows[1]).toMatchObject({todayPeak:null,periodAverage:null,observedDays:0});}finally{await db.execute('DELETE FROM urt_video_live_log WHERE pk=?',[pk]);}
 });
 it('continuous history SQL touches selected-page identities only with bounded daily result cardinality',async()=>{
  const dialect=new MySqlDialect(),historyCalls:ReturnType<typeof dialect.sqlToQuery>[]=[];const proxy:Reader={close:async()=>{},rows:async<T extends Row>(query:SQL)=>{const c=dialect.sqlToQuery(query);if(c.sql.includes('GROUP BY BINARY videoId'))historyCalls.push(c);return reader.rows<T>(query);}};
  const data=await get('/live/continuous',{tagid:String(uid),limit:'1',offset:'1',from:'2038-10-09',to:day},{},proxy);expect(data.total).toBe(2);expect(data.rows[0].video.value).toBe('Lower retained title');expect(historyCalls[0]!.params).toEqual([ids[1],ids[1],'2038-10-09',day,3]);expect(data.evidenceCoverage).toMatchObject({selectedVideos:1,historyRowCap:2,selectedHistoryRows:1});
 });
});
