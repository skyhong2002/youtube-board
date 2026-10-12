import {beforeAll,afterAll,describe,it,expect} from 'vitest';
import mysql,{type Connection} from 'mysql2/promise';
import {randomUUID} from 'node:crypto';
import {assertTestDatabaseUrl} from '../../shared/test-database.js';
import {buildApp} from '../src/app.js';
import {channelHistoryPaths} from '../src/reports/channel-identity.js';
const url=process.env.TEST_DATABASE_URL?assertTestDatabaseUrl(process.env.TEST_DATABASE_URL):undefined;
describe.skipIf(!url)('retained channel child reports on MariaDB',()=>{
 let db:Connection,id:number;const token=randomUUID().replaceAll('-','').slice(0,9),video='R'+token+'1',stamp='2026-10-11 12:00:00';
 const app=buildApp({databaseUrl:url,dataset:'fixture',clock:()=>new Date('2026-10-12T01:00:00Z')});
 beforeAll(async()=>{
  db=await mysql.createConnection(url!);
  const [r]=await db.execute<mysql.ResultSetHeader>('INSERT INTO urt_channel(ctime,youtube_id,title,flag_del) VALUES(?,?,?,1)',[stamp,'UCRetention'+token,'合成保留頻道']);id=r.insertId;
  await db.execute('INSERT INTO urt_video(ctime,u_id,id,publishedAt,channelId,title,thumbnails,channelTitle,playlistId,position,videoId,description,viewCount) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)',[stamp,id,video,stamp,'UCRetention'+token,'合成封存影片','','合成保留頻道','PLfixture',0,video,'保留資料',1200]);
  await db.execute('INSERT INTO urt_channel_ai(u_id,ctime,date_from,date_to,ai_type,data_type,user_token,result_json) VALUES(?,?,?,?,?,?,?,?)',[id,stamp,'2026-10-11 00:00:00','2026-10-11 23:59:59','fixture','oneday','CLI',JSON.stringify([{事件:'合成歷史分析',人物:['範例人物'],videoId:[video]}])]);
 });
 afterAll(async()=>{await app.close();if(db){if(id){await db.execute('DELETE FROM urt_channel_ai WHERE u_id=?',[id]);await db.execute('DELETE FROM urt_video WHERE u_id=? AND BINARY videoId=BINARY ?',[id,video]);await db.execute('DELETE FROM urt_channel WHERE u_id=?',[id]);}await db.end();}});
 it.each([null,0,1])('all retained children support existing flag_del=%s and preserve observations',async flag=>{
  await db.execute('UPDATE urt_channel SET flag_del=? WHERE u_id=?',[flag,id]);
  for(const path of channelHistoryPaths){const response=await app.inject('/api/v1'+path.replace(':id',String(id)));expect(response.statusCode,path+' '+response.body).toBe(200);expect(response.json().meta.coverage).toMatchObject({channelId:id,channelStatus:flag===1?'archived':'active',channelProfileAvailable:flag!==1});if(path.endsWith('/videos'))expect(response.json().data.rows.map((r:any)=>r.id)).toContain(video);if(path.endsWith('/ai/days'))expect(response.json().data.rows[0]?.title).toBe('合成歷史分析');}
  expect((await app.inject('/api/v1/channels/'+id)).statusCode).toBe(flag===1?404:200);
  const directory=await app.inject('/api/v1/channels?q='+encodeURIComponent('合成保留頻道'));expect(directory.statusCode,directory.body).toBe(200);expect(directory.json().data.rows.some((r:any)=>r.id===id)).toBe(flag!==1);
 });
 it('every unknown child is 404 even if a valid period was requested',async()=>{
  const missing=1999999999;const [rows]=await db.execute<mysql.RowDataPacket[]>('SELECT u_id FROM urt_channel WHERE u_id=?',[missing]);expect(rows).toHaveLength(0);
  for(const path of channelHistoryPaths)expect((await app.inject('/api/v1'+path.replace(':id',String(missing))+'?date=2026-10-11')).statusCode,path).toBe(404);
 });
});
