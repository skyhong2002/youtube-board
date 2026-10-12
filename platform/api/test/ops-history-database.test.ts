import {beforeAll,afterAll,describe,it,expect} from 'vitest';
import mysql,{type Connection} from 'mysql2/promise';
import {randomUUID,createHash} from 'node:crypto';
import {assertTestDatabaseUrl} from '../../shared/test-database.js';
import {createReader} from '../src/db/client.js';
import {workflowHistory} from '../src/ops/history.js';
const url=process.env.TEST_DATABASE_URL?assertTestDatabaseUrl(process.env.TEST_DATABASE_URL):undefined;
describe.skipIf(!url)('operator durable history MariaDB metadata',()=>{
 const id=randomUUID(),aiId=createHash('sha256').update(id).digest('hex'),reader=createReader(url);let db:Connection;
 beforeAll(async()=>{
  db=await mysql.createConnection(url!);await db.query("SET time_zone='+00:00'");
  await db.execute('INSERT INTO ts_job_runs(job_key,execution_key,status,result,updated_at) VALUES(?,?,?,?,?)',['youtube.videos.stats',id,'skipped','secret-provider-error','2037-10-12 00:00:00']);
  await db.execute('INSERT INTO ts_ai_runs(run_id,workflow,business_key_sha256,input_sha256,input_json,status,result_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)',[aiId,'ai.daily',aiId,aiId,'secret-input','published','secret-output','2037-10-12 08:00:00','2037-10-12 08:00:00']);
  await db.execute('INSERT INTO ts_notification_runs(run_id,workflow,status,source_json,created_at,updated_at) VALUES(?,?,?,?,?,?)',[id,'notify.telegram.hourly','nothing-eligible','secret-source','2037-10-12 00:00:00','2037-10-12 00:00:00']);
  await db.execute('INSERT INTO ts_vocabulary_runs(id,window_since,window_until,status,snapshot,created_at) VALUES(?,?,?,?,?,?)',[id,'2037-10-12T00:00:00Z','2037-10-12T00:00:00Z','scanning','secret-snapshot','2037-10-12 00:00:00']);
 });
 afterAll(async()=>{await reader.close();if(db){await db.execute('DELETE FROM ts_job_runs WHERE job_key=? AND execution_key=?',['youtube.videos.stats',id]);await db.execute('DELETE FROM ts_ai_runs WHERE run_id=?',[aiId]);await db.execute('DELETE FROM ts_notification_runs WHERE run_id=?',[id]);await db.execute('DELETE FROM ts_vocabulary_runs WHERE id=?',[id]);await db.end();}});
 it('shows retained run state without selecting payloads and normalizes all source clocks',async()=>{
  for(const workflow of ['youtube.videos.stats','ai.daily','notify.telegram.hourly','tags.vocabulary.import']){
   const result=await workflowHistory(reader,{workflow,limit:'50'}),row=result.rows.find(r=>r.id===(workflow==='ai.daily'?aiId:id));expect(row).toBeTruthy();expect(Date.parse(row!.updatedAt!)).toBe(Date.parse('2037-10-12T00:00:00Z'));expect(JSON.stringify(result)).not.toContain('secret-');
  }
 });
 it('indexes support bounded workflow ordering without reading LONGTEXT',async()=>{
  for(const [table,index,columns]of [['ts_job_runs','ops_job_history','job_key,updated_at,execution_key'],['ts_ai_runs','ops_ai_history','workflow,updated_at,run_id'],['ts_notification_runs','ops_notification_history','workflow,updated_at,run_id'],['ts_vocabulary_runs','ops_vocabulary_history','created_at,id']]){
   const [rows]=await db.execute<mysql.RowDataPacket[]>('SELECT COLUMN_NAME FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND INDEX_NAME=? ORDER BY SEQ_IN_INDEX',[table,index]);expect(rows.map(r=>r.COLUMN_NAME).join(',')).toBe(columns);
  }
 });
});
