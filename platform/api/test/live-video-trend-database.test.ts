import {beforeAll,afterAll,describe,it,expect} from 'vitest';
import {randomBytes} from 'node:crypto';
import mysql from 'mysql2/promise';
import {MySqlDialect} from 'drizzle-orm/mysql-core';
import {assertTestDatabaseUrl} from '../../shared/test-database.js';
import {createReader} from '../src/db/client.js';
import {buildApp} from '../src/app.js';
const url=process.env.TEST_DATABASE_URL?assertTestDatabaseUrl(process.env.TEST_DATABASE_URL):undefined;
describe.skipIf(!url)('bounded exact live trend MariaDB route',()=>{
 const id='LT'+randomBytes(4).toString('hex')+'A',other=id.slice(0,-1)+'a';let db:mysql.Connection,pk:number;
 const reader=createReader(url),original=reader.rows.bind(reader),app=buildApp({reader,dataset:'fixture'});let mutate=false;
 reader.rows=async query=>{const rows=await original(query);if(mutate&&new MySqlDialect().sqlToQuery(query).sql.includes('AS log_hash')){mutate=false;await db.execute('UPDATE urt_video_live_log SET log_json=? WHERE pk=?',['{"00:00":2}',pk]);}return rows as any;};
 beforeAll(async()=>{db=await mysql.createConnection(url!);const [r]=await db.execute<mysql.ResultSetHeader>('INSERT INTO urt_video_live_log(videoId,u_id,the_date,ctime,max_current,log_json) VALUES(?,1,?,?,999,?)',[id,'2031-01-02','2031-01-02 01:00:00','{"00:00":1}']);pk=r.insertId;await db.execute('INSERT INTO urt_video_live_log(videoId,u_id,the_date,ctime,max_current,log_json) VALUES(?,1,?,?,999,?)',[other,'2031-01-02','2031-01-02 01:00:00','{"00:00":700}']);});
 afterAll(async()=>{await app.close();if(db){await db.execute('DELETE FROM urt_video_live_log WHERE BINARY videoId IN (?,?)',[id,other]);await db.end();}});
 it('routes exact IDs and exposes source evidence separately from stored aggregates',async()=>{
  const r=await app.inject('/api/v1/live/videos/'+id+'/trend');expect(r.statusCode).toBe(200);expect(r.json().data.series[0].points.map((p:any)=>p.value)).toEqual([1]);expect(r.json().meta.coverage.sourceRows).toBe(1);
 });
 it('same-length edits are withheld and aggregate transfer budget skips excess TEXT rows',async()=>{
  mutate=true;const changed=await app.inject('/api/v1/live/videos/'+id+'/trend');expect(changed.statusCode).toBe(200);expect(changed.json().meta.coverage.changedRows).toBe(1);expect(changed.json().data.series[0].points).toEqual([]);
  const payload=JSON.stringify({'00:00':5,padding:'x'.repeat(61000)});for(let i=0;i<140;i++)await db.execute('INSERT INTO urt_video_live_log(videoId,u_id,the_date,ctime,log_json) VALUES(?,1,?,?,?)',[id,'2031-01-02','2031-01-02 01:00:00',payload]);const bounded=await app.inject('/api/v1/live/videos/'+id+'/trend');expect(bounded.statusCode).toBe(200);expect(bounded.json().meta.coverage).toMatchObject({partialLogEvidence:true,totalByteCap:8388608});expect(bounded.json().meta.coverage.skippedRows).toBeGreaterThan(0);expect(bounded.json().data.series[0].points.map((p:any)=>p.value)).toEqual([5]);
 });
});
