import type {ExecuteValues} from 'mysql2';
import {beforeAll,afterAll,describe,it,expect} from 'vitest';
import mysql,{type ResultSetHeader} from 'mysql2/promise';
import {randomUUID} from 'node:crypto';
import {MySqlDialect} from 'drizzle-orm/mysql-core';
import {authorParticipation,commentParticipationReport} from '../src/reports/comments.js';
import {buildApp} from '../src/app.js';
import {assertTestDatabaseUrl} from '../../shared/test-database.js';
import {createReader,type Reader} from '../src/db/client.js';
it('deduplicates exact authors within each batch without making anonymous list keys into identities',()=>{
 const map=authorParticipation({one:{ChannelId:'Ab',DisplayName:'第一名字'},two:{channelId:'Ab',displayName:'第二名字'},three:{channel_id:'ab'},anonymous:{ChannelId:''}})!;
 expect([...map.authors]).toEqual([['Ab','第一名字'],['ab','ab']]);expect(map.invalid).toBe(1);
 expect([...authorParticipation([{ChannelId:'UCauthor'},{DisplayName:'匿名'}])!.authors.keys()]).toEqual(['UCauthor']);expect(authorParticipation('bad-json')).toBeNull();expect(authorParticipation('')).toMatchObject({entries:0});
});
it('rejects per-row and aggregate metadata bounds before loading author payloads',async()=>{
 for(const rows of [[{comment_pk:1,author_bytes:2*1024*1024+1}],Array.from({length:9},(_,pk)=>({comment_pk:pk+1,author_bytes:2*1024*1024}))]){
 let calls=0;const reader={rows:async()=>{calls++;return rows;},close:async()=>{}} as Reader;
 await expect(commentParticipationReport(reader,()=>new Date(),{})).rejects.toMatchObject({statusCode:422});expect(calls).toBe(1);
 }
});
const url=process.env.TEST_DATABASE_URL?assertTestDatabaseUrl(process.env.TEST_DATABASE_URL):undefined;
describe.skipIf(!url)('comment participation MariaDB',()=>{
 const token=randomUUID().replaceAll('-','').slice(0,8),vids=['A','a','B','C','D'].map(c=>token+c+'01'),tag=976134,stamp='2026-10-11 12:00:00',clock=()=>new Date('2026-10-11T10:00:00Z'),app=buildApp({databaseUrl:url,dataset:'fixture',clock});let db:mysql.Connection,uId:number;
 beforeAll(async()=>{db=await mysql.createConnection(url!);const [r]=await db.execute<ResultSetHeader>('INSERT INTO urt_channel(title,youtube_id,ctime)VALUES(?,?,?)',['comment-participation-fixture','UC'+token,stamp]);uId=r.insertId;await db.execute('INSERT INTO urt_count(u_id,ctime,tags)VALUES(?,?,?)',[uId,stamp,`[${tag}]`]);
  for(let i=0;i<vids.length;i++){
   await db.execute('INSERT INTO urt_video(ctime,u_id,id,publishedAt,channelId,title,thumbnails,channelTitle,playlistId,position,videoId,description,viewCount,commentCount)VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)',[stamp,uId,vids[i],i===4?'2026-01-01 00:00:00':stamp,'UC'+token,'comment-video-'+i,'','合成頻道','PL'+token,0,vids[i],'',i===4?1:10000-i,999]);
   if(i===3)continue;
   const authors=i===0?{one:{ChannelId:'fixture-author',DisplayName:'合成作者'},dup:{ChannelId:'fixture-author'},anon:{ChannelId:''}}:i===1?[{channelId:'fixture-author'}, {channelId:'Fixture-Author'}]:i===2?{p:{ChannelId:'pending-secret'}}:{old:{ChannelId:'old-author'}};
   await db.execute('INSERT INTO urt_comment(videoId,u_id,ctime,mtime,pageToken,authors_json,comments_count,threads_count,replies_count,authors_count,likes_count,latest_time)VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',[vids[i],uId,i===4?'2026-10-11 13:00:00':stamp,stamp,i===2?'pending-token':'',JSON.stringify(authors),null,3,2,0,7,stamp]);
  }
 });
 afterAll(async()=>{await app.close();if(db){for(const id of vids){await db.execute('DELETE FROM urt_comment WHERE BINARY videoId=BINARY ?',[id]);await db.execute('DELETE FROM urt_video WHERE BINARY videoId=BINARY ?',[id]);}if(uId){await db.execute('DELETE FROM urt_count WHERE u_id=?',[uId]);await db.execute('DELETE FROM urt_channel WHERE u_id=?',[uId]);}await db.end();}});
 const get=async(path:string)=>{const r=await app.inject('/api/v1/'+path);expect(r.statusCode,r.body).toBe(200);return r.json();};
 it('channel sampling precedes complete-batch filtering, preserves source diagnostics and exact IDs',async()=>{
  const {data,meta}=await get(`channels/${uId}/comments?min=1000&hours=24`);expect(data.rows).toEqual([{author:{value:'合成作者',href:'/comments/authors/fixture-author'},videoCount:2},{author:{value:'Fixture-Author',href:'/comments/authors/Fixture-Author'},videoCount:1}]);
  expect((await get(`channels/${uId}/comments?not=${tag}`)).data.rows).toEqual(data.rows);expect(meta.coverage).toMatchObject({selectedVideos:4,completeBatches:2,pendingBatches:1,missingBatches:1});const rows=data.sections[0].rows;expect(rows[0]).toMatchObject({recordedComments:5,providerComments:999,decodedAuthors:1,recordedAuthors:0});expect(rows[1].decodedAuthors).toBe(2);expect(rows[2]).toMatchObject({status:'擷取尚未完成',decodedAuthors:null,recordedComments:null});expect(rows[3]).toMatchObject({status:'未收錄',decodedAuthors:null});
 });
 it('category mode follows archive time independently of video publication/hours/min, capped before ranking',async()=>{
  const {data,meta}=await get(`tags/${tag}/comments?hours=1&min=999999&sourceLimit=1`);expect(data.rows[0].author.value).toBe('old-author');expect(meta.coverage).toMatchObject({sourceMode:'recent-category-comment-batches',selectedVideos:1,sourceTruncated:true});expect(data.sections[0].rows[0].views).toBe(1);
  expect((await get(`tags/${tag}/comments?not=${tag}`)).data.rows).toEqual([]);
 });
 it('keeps author paging separate from bounded source sampling and rejects invalid/missing channel',async()=>{
  const r=await get(`channels/${uId}/comments?sourceLimit=1&limit=1`);expect(r.data.rows[0].videoCount).toBe(1);expect(r.meta.coverage.sourceTruncated).toBe(true);
  expect((await app.inject(`/api/v1/channels/${uId}/comments?sourceLimit=1001`)).statusCode).toBe(400);expect((await app.inject('/api/v1/channels/2147483647/comments')).statusCode).toBe(404);
 });
 it('malformed author payload preserves stored metrics and discloses missing ranking evidence',async()=>{
  const [before]=await db.query<any[]>('SELECT authors_json FROM urt_comment WHERE BINARY videoId=BINARY ?',[vids[0]]);await db.execute('UPDATE urt_comment SET authors_json=? WHERE BINARY videoId=BINARY ?',['bad json',vids[0]]);
  try{const r=await get(`channels/${uId}/comments?sourceLimit=1`);expect(r.data.rows).toEqual([]);expect(r.meta.coverage.malformedAuthorBatches).toBe(1);expect(r.data.sections[0].rows[0]).toMatchObject({recordedComments:5,decodedAuthors:null,status:'作者格式無法解析'});}finally{await db.execute('UPDATE urt_comment SET authors_json=? WHERE BINARY videoId=BINARY ?',[before[0].authors_json,vids[0]]);}
 });
 it('preserves nullable archived counts and orphan archives without fabricated local links',async()=>{
  const [video]=await db.query<any[]>('SELECT * FROM urt_video WHERE BINARY videoId=BINARY ?',[vids[4]]);const [comment]=await db.query<any[]>('SELECT threads_count,replies_count FROM urt_comment WHERE BINARY videoId=BINARY ?',[vids[4]]);await db.execute('UPDATE urt_comment SET threads_count=NULL,replies_count=NULL WHERE BINARY videoId=BINARY ?',[vids[4]]);await db.execute('DELETE FROM urt_video WHERE BINARY videoId=BINARY ?',[vids[4]]);try{
  const r=await get(`tags/${tag}/comments?sourceLimit=1`);expect(r.data.sections[0].rows[0]).toMatchObject({video:vids[4],recordedComments:null,views:null,providerComments:null});expect(r.data.rows[0].author.value).toBe('old-author');}finally{await db.query('INSERT INTO urt_video SET ?',[video[0]]);await db.execute('UPDATE urt_comment SET threads_count=?,replies_count=? WHERE BINARY videoId=BINARY ?',[comment[0].threads_count,comment[0].replies_count,vids[4]]);}
 });
 it('withholds author payload if completion changes after metadata selection',async()=>{
  const reader=createReader(url);let calls=0;const guarded={rows:async(q:any)=>{calls++;if(calls===3)await db.execute("UPDATE urt_comment SET pageToken='new-page' WHERE BINARY videoId=BINARY ?",[vids[0]]);return reader.rows(q);},close:()=>reader.close()} as Reader;
  try{const r=await commentParticipationReport(guarded,clock,{sourceLimit:'1'},uId);expect(r.rows).toEqual([]);expect(r.evidenceCoverage.changedSources).toBe(1);expect(r.sections![0]!.rows[0]!.status).toBe('來源已變更');}finally{await reader.close();await db.execute("UPDATE urt_comment SET pageToken='' WHERE BINARY videoId=BINARY ?",[vids[0]]);}
 });
 it('category archive appears once and uses newest source metadata even on a legacy duplicate-video table',async()=>{
  // A connection-private compatibility table exercises imported duplicate rows
  // without dropping the real schema's unique videoId constraint.
  await db.query('CREATE TEMPORARY TABLE participation_video_compat LIKE urt_video');
  try {
   await db.query('ALTER TABLE participation_video_compat DROP INDEX videoId');
   await db.execute('INSERT INTO participation_video_compat SELECT * FROM urt_video WHERE u_id=?',[uId]);
   const [old]=await db.query<any[]>('SELECT * FROM participation_video_compat WHERE BINARY videoId=BINARY ?',[vids[4]]);
   const {pk,...copy}=old[0];await db.query('INSERT INTO participation_video_compat SET ?',[{...copy,title:'newest duplicate title',viewCount:42}]);
   const dialect=new MySqlDialect();
   const compat={rows:async(query:any)=>{const compiled=dialect.sqlToQuery(query);const [rows]=await db.execute(compiled.sql.replace(/\burt_video\b/g,'participation_video_compat'),compiled.params as ExecuteValues[]);return rows;},close:async()=>{}} as Reader;
   const result=await commentParticipationReport(compat,clock,{tagid:String(tag),sourceLimit:'3'});
   expect(result.evidenceCoverage).toMatchObject({selectedVideos:3,completeBatches:3,sourceTruncated:false});
   expect(result.sections?.[0]?.rows[0]).toMatchObject({video:{value:'newest duplicate title'},views:42});
   expect(result.sections?.[0]?.rows).toHaveLength(3);
   expect(result.rows.find((r:any)=>r.author.href==='/comments/authors/fixture-author')).toMatchObject({videoCount:2});
  } finally {await db.query('DROP TEMPORARY TABLE participation_video_compat');}
 });

});
