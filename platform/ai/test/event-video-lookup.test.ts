import {afterAll,beforeAll,describe,expect,it,vi} from 'vitest';
import mysql,{type Connection,type RowDataPacket} from 'mysql2/promise';
import {assertTestDatabaseUrl} from '../../shared/test-database.js';
import {loadDailySource} from '../src/daily-source.js';
import {planEvent} from '../src/event.js';

vi.mock('../src/daily-source.js',async original=>({...await original<typeof import('../src/daily-source.js')>(),loadDailySource:vi.fn()}));
const url=process.env.TEST_DATABASE_URL?assertTestDatabaseUrl(process.env.TEST_DATABASE_URL):undefined;
describe.skipIf(!url)('indexed event video identity lookup with MariaDB',()=>{
 let db:Connection,wrapped:Connection,plan:RowDataPacket[]=[];
 const input={date:'2046-10-10',event:'fixture',promptType:'summary' as const,userToken:'EVENT_LOOKUP_TEST'};
 beforeAll(async()=>{
  db=await mysql.createConnection({uri:url!,dateStrings:true});
  // The integration runner owns the lane lock. This connection writes only its
  // own temporary table, so it must not reacquire that lock on another connection.
  await db.query('CREATE TEMPORARY TABLE event_video_lookup (pk INT AUTO_INCREMENT PRIMARY KEY,videoId VARCHAR(32) COLLATE utf8mb4_general_ci,u_id INT,title VARCHAR(100),publishedAt DATETIME,KEY videoId(videoId))');
  const rows=Array.from({length:1000},(_,i)=>['filler'+String(i).padStart(5,'0'),1,'fixture','2046-10-10 12:00:00']);
  rows.push(['CaseVIDEO01',1,'exact','2046-10-10 12:00:00'],['caseVIDEO01',2,'case collision','2046-10-10 12:00:00']);
  await db.query('INSERT INTO event_video_lookup(videoId,u_id,title,publishedAt) VALUES ?',[rows]);
  vi.mocked(loadDailySource).mockResolvedValue({pk:1,date:input.date,from:input.date+' 00:00:00',to:input.date+' 23:59:59',condition:'all',userToken:input.userToken,runId:'fixture',result:'[]',topics:[{title:'fixture',media:[{u_id:1,channel:'fixture',event:{videoId:['CaseVIDEO01','CaseVIDEO01']}}]}]} as never);
  wrapped=new Proxy(db,{get(target,key){if(key==='query')return async(statement:string,params:unknown[])=>{
   const query=statement.replace('FROM urt_video','FROM event_video_lookup');
   if(query===statement||/\burt_video\b/.test(query))throw new Error('Lookup test must use only its temporary source table');
   [plan]=await db.query<RowDataPacket[]>('EXPLAIN '+query,params);
   return db.query(query,params);
  };const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;}});
 });
 afterAll(async()=>{await db?.end();});
 it('uses the videoId index and preserves exact-case results and request deduplication',async()=>{
  const result=await planEvent(wrapped,input);
  expect(plan[0]).toMatchObject({key:'videoId'});expect(['ref','range']).toContain(plan[0]?.type);
  const [legacy]=await db.query<RowDataPacket[]>('SELECT videoId,u_id,title,publishedAt FROM event_video_lookup WHERE BINARY videoId IN (?) ORDER BY BINARY videoId',['CaseVIDEO01']);
  expect((result.source as {videos:unknown[]}).videos).toEqual(legacy.map(r=>({...r,u_id:Number(r.u_id)})));
  expect(result.sourceCount).toBe(1);
 });
 it('still rejects duplicate source identities',async()=>{
  await db.query("INSERT INTO event_video_lookup(videoId,u_id,title,publishedAt) VALUES ('CaseVIDEO01',1,'duplicate','2046-10-10 12:00:00')");
  try{await expect(planEvent(wrapped,input)).rejects.toThrow('event_video_source_incomplete');}
  finally{await db.query("DELETE FROM event_video_lookup WHERE title='duplicate'");}
 });
 it('still rejects a missing exact-case identity',async()=>{
  await db.query("DELETE FROM event_video_lookup WHERE BINARY videoId=BINARY 'CaseVIDEO01'");
  await expect(planEvent(wrapped,input)).rejects.toThrow('event_video_source_incomplete');
 });
});
