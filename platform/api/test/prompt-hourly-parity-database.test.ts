import {randomInt,randomBytes,createHash} from 'node:crypto';
import {beforeAll,afterAll,describe,it,expect} from 'vitest';
import mysql from 'mysql2/promise';
import {buildApp} from '../src/app.js';
import {planAi} from '../../ai/src/planner.js';
import {assertTestDatabaseUrl} from '../../shared/test-database.js';
import {aiBusinessKey} from '../../shared/ai-business-key.js';
const url=process.env.TEST_DATABASE_URL?assertTestDatabaseUrl(process.env.TEST_DATABASE_URL):undefined;
describe.skipIf(!url)('prompt scope and historical hourly parsing MariaDB parity',()=>{
 const uid=randomInt(10000000,20000000),ids=[uid,uid+1,uid+2],stamp='2026-10-12 00:00:00',suffix=randomBytes(5).toString('hex'),type='b2_'+suffix;
 const app=buildApp({databaseUrl:url,dataset:'fixture',clock:()=>new Date('2088-04-09T01:00:00Z')});
 let db:Awaited<ReturnType<typeof mysql.createConnection>>;
 const hourlyPks:number[]=[],runIds:string[]=[];
 const event=(name:string)=>({事件:name,描述:'Synthetic source only',videoId:['AbC_123xYz9','abc_123xYz9']});
 beforeAll(async()=>{
  db=await mysql.createConnection({uri:url!,dateStrings:true});
  for(const [i,id]of ids.entries()){
   await db.execute('INSERT INTO urt_channel(u_id,ctime,youtube_id,title) VALUES(?,?,?,?)',[id,stamp,'PROMPT_'+suffix+'_'+i,'Prompt fixture '+suffix+' '+i]);
   await db.execute('INSERT INTO urt_count(u_id,ctime,tags) VALUES(?,?,?)',[id,stamp,i===2?'[4]':'[3]']);
  }
  const add=async(id:number,date:string,token='CLI',to=date+' 23:59:59',deleted:number|null=null)=>db.execute('INSERT INTO urt_channel_ai(u_id,ctime,date_from,date_to,ai_type,data_type,user_token,result_json,del_flag) VALUES(?,?,?,?,?,?,?,?,?)',[id,stamp,date+' 00:00:00',to,'fixture','week',token,JSON.stringify([event('Source '+id)]),deleted]);
  await add(ids[0]!,'2088-04-01');await add(ids[1]!,'2088-04-01');await add(ids[2]!,'2088-04-03');
  await add(ids[0]!,'2088-04-04','cli');
  await add(ids[0]!,'2088-04-05','CLI','2088-04-06 23:59:59');
  await add(ids[0]!,'2088-04-07','CLI','2088-04-07 23:59:59',1);
  const wrapped='Legacy prose\n```json\n'+JSON.stringify({hourly_events:[event('Wrapped historical event')]})+'\n```\nEnd';
  for(const [i,content]of [wrapped,'{"events":[]}','broken','{}',wrapped,wrapped].entries()){
   const hour=String(i).padStart(2,'0'),from='2088-04-01 '+hour+':00:00',to='2088-04-01 '+hour+':59:59';
   const [insert]=await db.execute<mysql.ResultSetHeader>('INSERT INTO urt_ai_hour(ctime,date_from,date_to,ai_type,data_type,user_token,condition_type,result_json) VALUES(?,?,?,?,?,?,?,?)',[stamp,from,to,'fixture',type,suffix,'all',content]);hourlyPks.push(insert.insertId);
   if(i>=4){const runId=createHash('sha256').update(suffix+String(i)).digest('hex');runIds.push(runId);const key={date_from:from,date_to:to,data_type:type,user_token:suffix,condition_type:'all'};
    await db.execute('INSERT INTO ts_ai_runs(run_id,workflow,business_key_sha256,input_sha256,input_json,status,result_json,target_pk,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)',[runId,'ai.hourly',aiBusinessKey('urt_ai_hour',key),'0'.repeat(64),'{}',i===4?'planned':'published','{}',insert.insertId,stamp,stamp]);
   }
  }
 });
 afterAll(async()=>{
  await app.close();if(!db)return;
  try{if(runIds.length)await db.query('DELETE FROM ts_ai_runs WHERE run_id IN (?)',[runIds]);if(hourlyPks.length)await db.query('DELETE FROM urt_ai_hour WHERE pk IN (?)',[hourlyPks]);for(const table of ['urt_channel_ai','urt_count','urt_channel'])await db.query(`DELETE FROM ${table} WHERE u_id IN (?)`,[ids]);}finally{await db.end();}
 });
 it('latest blue date excludes other taxonomy, wrong-case CLI, deleted and non-complete-day rows',async()=>{
  const response=await app.inject('/api/v1/ai/days/prompt?condition=blue&type=week');expect(response.statusCode,response.body).toBe(200);
  expect(response.json().data.period).toEqual({from:'2088-04-01 00:00:00',to:'2088-04-01 23:59:59'});expect(response.json().data.sourceCount).toBe(2);
  const plan=await planAi(db,{kind:'daily',from:'2088-04-01 00:00:00',to:'2088-04-01 23:59:59',condition:'blue',dataType:'week',userToken:'CLI'});expect(response.json().data.prompt).toBe(plan.prompt);expect(response.json().data.blocked).toBe(plan.blocked);
 });
 it('omitted and explicit all use the latest eligible global scope while explicit empty dates remain visible',async()=>{
  for(const query of ['type=week','condition=all&type=week']){
   const r=await app.inject('/api/v1/ai/days/prompt?'+query);expect(r.statusCode,r.body).toBe(200);expect(r.json().data.period.from).toBe('2088-04-03 00:00:00');expect(r.json().data.sourceCount).toBe(1);
  }
  const empty=await app.inject('/api/v1/ai/days/2088-04-02/blue/prompt?type=week');expect(empty.json().data).toMatchObject({sourceCount:0,blocked:'no_source_events'});
 });
 it('legacy extraction follows publication guards and explicitly accounts for unrenderable records',async()=>{
  const r=await app.inject('/api/v1/ai/hours?date=2088-04-01&type='+type);expect(r.statusCode,r.body).toBe(200);expect(r.json().data.rows.map((row:any)=>row.event)).toEqual(['Wrapped historical event']);
  expect(r.json().data.evidenceCoverage).toMatchObject({visibleSources:4,withheldSources:1,divergedSources:1,decoding:{sourceRows:4,decodedSources:1,emptySources:1,malformedSources:1,unsupportedSources:1,extractedLegacySources:1}});
 });
});
