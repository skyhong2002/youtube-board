import {refreshDays} from '../src/days-refresh.js';
import {CHANNEL_IDS} from '../src/contracts.js';
import {laravelAiLock,aiBusinessKey} from '../../shared/ai-business-key.js';
import {canRecoverScheduled,sourceIdentity} from '../src/runner.js';
import {runCatchup} from '../src/catchup.js';
import {RetryableProviderError} from '../src/provider.js';
import {runHourlyPipeline} from '../src/hourly-pipeline.js';
import { describe,it,expect,beforeAll,afterAll } from 'vitest';
import mysql,{type Connection,type RowDataPacket} from 'mysql2/promise';
import { readFile } from 'node:fs/promises';
import { runAi } from '../src/runner.js';
import { runDailyPipeline } from '../src/pipeline.js';
import { planAi } from '../src/planner.js';
import type { Input,Plan } from '../src/contracts.js';
const event=(id:string,i:number)=>({事件:`事件${i}`,描述:'來源描述',角度:'無法判斷',陣營:'無法判斷',分類:'新聞',關鍵字:[],人物:[],地名:[],類型:[],videoId:[id]});
describe.skipIf(process.env.AI_DB_TEST!=='1')('AI real MariaDB isolated workflow',()=>{
 let db:Connection;const uid=870091;const from='2039-10-10 00:00:00',to='2039-10-10 23:59:59';
 const input:Input={kind:'channel',channelId:uid,from,to,userToken:'AI_TEST'};
 const cleanup=async()=>{await db.query('DELETE FROM urt_video WHERE u_id=?',[uid]);await db.query('DELETE FROM urt_channel_ai WHERE u_id=?',[uid]);await db.query("DELETE FROM ts_ai_runs WHERE input_json LIKE '%AI_TEST%'");};
 beforeAll(async()=>{
  if(process.env.DB_DATABASE!=='youtube_board_test_rewrite')throw new Error('AI tests require dedicated test DB');
  const host=process.env.DB_HOST??'127.0.0.1';if(!['127.0.0.1','localhost'].includes(host))throw new Error('AI tests require localhost');
  db=await mysql.createConnection({host,port:23306,user:'youtube_rewrite',password:process.env.DB_PASSWORD,database:'youtube_board_test_rewrite',dateStrings:true,charset:'utf8mb4_bin'});
  await db.query(await readFile(new URL('../../jobs/migrations/006_ai_runs.sql',import.meta.url),'utf8'));await cleanup();
  for(let i=0;i<6;i++)await db.query("INSERT INTO urt_video(u_id,videoId,title,publishedAt,ctime,viewCount,id,channelId,thumbnails,channelTitle,playlistId,position,description) VALUES(?,?,?,?,?,?,'fixture','fixture','','fixture','fixture',0,'')",[uid,`AIAAAAAAAA${i}`,'測試標題'+i,from,from,100-i]);
 });
 afterAll(async()=>{if(db){await cleanup();await db.end();}});
 const provider={complete:async(p:Plan)=>({requestedModel:'sky-quality',model:'actual-provider',usage:{total_tokens:10},content:JSON.stringify({events:(p.source as {videoId:string}[]).slice(0,3).map((v,i)=>event(v.videoId,i))})})};
 const options={execute:true,assertAuthorized:()=>{},provider,modelAlias:'sky-quality'};
 it('preview makes no provider call; denied execute writes nothing',async()=>{
  let called=0;expect(await runAi(db,input,{...options,execute:false,provider:{complete:async()=>{called++;throw Error();}}})).toMatchObject({mode:'dry-run',sourceCount:6,writes:0});expect(called).toBe(0);
  await expect(runAi(db,input,{...options,assertAuthorized:()=>{throw Error('gate');}})).rejects.toThrow('gate');
 });
 it('publishes source-linked output and skips unchanged input',async()=>{
  let calls=0;const counted={complete:async(p:Plan)=>{calls++;return provider.complete(p);}};
  expect(await runAi(db,input,{...options,provider:counted})).toMatchObject({status:'published'});
  expect(await runAi(db,input,{...options,provider:counted})).toMatchObject({status:'unchanged'});expect(calls).toBe(1);
  const [rows]=await db.query<RowDataPacket[]>('SELECT * FROM urt_channel_ai WHERE u_id=?',[uid]);expect(rows).toHaveLength(1);expect(rows[0]!.ai_type).toBe('sky-quality');expect(JSON.parse(rows[0]!.result_json)[0].videoId).toEqual(['AIAAAAAAAA0']);
 });
 it('rejects hallucinated refs, preserves previous cache and requires explicit failed retry',async()=>{
  await db.query('UPDATE urt_video SET title=? WHERE u_id=? AND videoId=?',['新標題',uid,'AIAAAAAAAA0']);
  const invalid={complete:async(p:Plan)=>({...await provider.complete(p),content:JSON.stringify({events:[event('UNKNOWN_ID0',0),event('UNKNOWN_ID1',1),event('UNKNOWN_ID2',2)]})})};
  await expect(runAi(db,input,{...options,provider:invalid})).rejects.toThrow('valid event count');
  await expect(runAi(db,input,options)).rejects.toThrow('retryFailed');
  expect(await runAi(db,input,{...options,retryFailed:true})).toMatchObject({status:'published'});
  const [count]=await db.query<RowDataPacket[]>('SELECT COUNT(*) n FROM urt_channel_ai WHERE u_id=?',[uid]);expect(count[0]!.n).toBe(1);
 });
 it('blocks hourly source cap before generation',async()=>{await db.query('INSERT INTO urt_count(u_id,tags,ctime) VALUES(?,?,?)',[uid,'[102]',from]);try{expect((await planAi(db,{kind:'hourly',from,to,condition:'all',limit:2})).blocked).toBe('hourly_source_cap_exceeded');}finally{await db.query('DELETE FROM urt_count WHERE u_id=?',[uid]);}});
 it('replays validated output after projection loss without another provider call',async()=>{
  await db.query('DELETE FROM urt_channel_ai WHERE u_id=?',[uid]);
  expect(await runAi(db,input,{...options,provider:{complete:async()=>{throw Error('must not infer');}}})).toMatchObject({status:'published'});
 });
 it('retains old projection if source changes while provider is running',async()=>{
  await db.query('UPDATE urt_video SET title=? WHERE u_id=? AND videoId=?',['初始標題',uid,'AIAAAAAAAA0']);
  const mutate={complete:async(p:Plan)=>{await db.query('UPDATE urt_video SET title=? WHERE u_id=? AND videoId=?',['生成中更新',uid,'AIAAAAAAAA0']);return provider.complete(p);}};
  await expect(runAi(db,input,{...options,provider:mutate})).rejects.toThrow('source changed');
  const [rows]=await db.query<RowDataPacket[]>('SELECT COUNT(*) n FROM urt_channel_ai WHERE u_id=?',[uid]);expect(rows[0]!.n).toBe(1);
 });

 it('writes daily UID-to-name map and keeps exact channel AI source lineage in run snapshot',async()=>{
  const date='2040-10-10',ids=[870092,870093];
  const clear=async()=>{await db.query('DELETE FROM urt_channel WHERE u_id IN (?,?)',ids);await db.query('DELETE FROM urt_channel_ai WHERE u_id IN (?,?)',ids);await db.query("DELETE FROM urt_ai_date WHERE user_token='AI_TEST'");};
  await clear();try{
    for(const [index,id] of ids.entries()){
      await db.query('INSERT INTO urt_channel(u_id,ctime,youtube_id,title) VALUES(?,?,?,?)',[id,from,'AI-TEST-'+id,'媒體'+index]);
      const events=Array.from({length:5},(_,i)=>({...event('ABCDEFGHIJ'+i,i),videoId:['ABCDEFGHIJ'+i,'BCDEFGHIJK'+i]}));
      await db.query('INSERT INTO urt_channel_ai(u_id,ctime,date_from,date_to,ai_type,data_type,user_token,result_json) VALUES(?,?,?,?,?,?,?,?)',[id,from,date+' 00:00:00',date+' 23:59:59','sky-quality','oneday','AI_TEST',JSON.stringify(events)]);
      await db.query('INSERT INTO urt_channel_ai(u_id,ctime,date_from,date_to,ai_type,data_type,user_token,result_json) VALUES(?,?,?,?,?,?,?,?)',[id,from,date+' 00:00:00',date+' 23:59:59','sky-quality','oneday','ai_test',JSON.stringify(events.map(e=>({...e,事件:'另一使用者'+e.事件})))]);
    }
    const daily={kind:'daily' as const,from:date+' 00:00:00',to:date+' 23:59:59',condition:'all' as const,userToken:'AI_TEST'};
    const fake={complete:async()=>({requestedModel:'sky-quality',model:'actual-provider',usage:null,content:JSON.stringify({events:Array.from({length:5},(_,i)=>({標題:'綜合事件'+i,媒體事件:[{媒體:'媒體0',事件:['事件'+i]},{媒體:'媒體1',事件:['事件'+i]}]}))})})};
    expect((await planAi(db,daily)).sourceCount).toBe(2);
    const result=await runAi(db,daily,{...options,provider:fake});expect(result.status).toBe('published');
    const [rows]=await db.query<RowDataPacket[]>("SELECT channel_id FROM urt_ai_date WHERE user_token='AI_TEST'");expect(JSON.parse(rows[0]!.channel_id)).toEqual({'870092':'媒體0','870093':'媒體1'});
    const [runs]=await db.query<RowDataPacket[]>('SELECT input_json FROM ts_ai_runs WHERE run_id=?',[result.runId]);expect(JSON.parse(runs[0]!.input_json).plan.source[0].pk).toMatch(/^\d+$/);
  }finally{await clear();}
 });

 it('Laravel advisory lock excludes TS generation on the same key',async()=>{
  const other=await mysql.createConnection({host:'127.0.0.1',port:23306,user:'youtube_rewrite',password:process.env.DB_PASSWORD,database:'youtube_board_test_rewrite',dateStrings:true});
  const p=await planAi(db,input),lock=laravelAiLock(p.table,p.key);await other.query('SELECT GET_LOCK(?,0)',[lock]);try{await expect(runAi(db,input,options)).rejects.toThrow('locked');}finally{await other.query('SELECT RELEASE_LOCK(?)',[lock]);await other.end();}
 });
 it('scheduled catchup recovers failed no-result runs and cools down orphan running rows',async()=>{
  await db.query('UPDATE urt_video SET title=? WHERE u_id=? AND videoId=?',['scheduled retry',uid,'AIAAAAAAAA0']);
  await expect(runAi(db,input,{...options,provider:{complete:async()=>{throw new RetryableProviderError('temporary');}}})).rejects.toThrow('temporary');
  expect(await runAi(db,input,{...options,scheduledRecovery:true})).toMatchObject({status:'published'});
  expect(canRecoverScheduled({status:'running',updated_at:new Date(Date.now()+8*3600000).toISOString().slice(0,19).replace('T',' ')},true)).toBe(false);
  expect(canRecoverScheduled({status:'running',updated_at:'2020-01-01 00:00:00'},true)).toBe(true);
 });
 it('missing-only preserves a valid existing cache without provider calls',async()=>{expect(await runAi(db,input,{...options,missingOnly:true,provider:{complete:async()=>{throw Error('must not call');}}})).toMatchObject({status:'unchanged',reason:'existing_valid'});});
 it('three hourly videos can generate two topics and implicit/explicit all cannot overwrite each other',async()=>{
  await db.query('INSERT INTO urt_count(u_id,tags,ctime) VALUES(?,?,?)',[uid,'[102]',from]);
  const hourly={kind:'hourly' as const,from,to,userToken:'AI_TEST'};
  await db.query("UPDATE urt_video SET publishedAt='2039-10-09 00:00:00' WHERE u_id=? AND videoId IN ('AIAAAAAAAA3','AIAAAAAAAA4','AIAAAAAAAA5')",[uid]);
  try{const p=await planAi(db,hourly);expect(p.sourceCount).toBe(3);expect(p.blocked).toBeNull();expect(p.key.condition_type).toBe('all');const fake={complete:async()=>({requestedModel:'sky-quality',model:'fake',usage:null,content:JSON.stringify({events:[event('AIAAAAAAAA0',0),event('AIAAAAAAAA1',1)]})})};expect(await runAi(db,hourly,{...options,provider:fake})).toMatchObject({status:'published'});await expect(runAi(db,{...hourly,condition:'all'},options)).rejects.toThrow('hourly_scope_conflict');}finally{await db.query('DELETE FROM urt_count WHERE u_id=?',[uid]);await db.query("DELETE FROM urt_ai_hour WHERE user_token='AI_TEST'");await db.query('UPDATE urt_video SET publishedAt=? WHERE u_id=?',[from,uid]);}
 });
 it('catchup blocks before source API when required channels are outside crawl scope',async()=>{
  let calls=0;const result=await runCatchup(db,{date:'2047-01-01',userToken:'AI_TEST'},{...options,callLimit:45,assertAuthorized:()=>{},provider:{complete:async()=>{calls++;throw Error();}},refreshSource:async()=>({complete:false,details:{failed:1}})});expect(result).toMatchObject({status:'blocked',reason:'required_channel_not_in_crawl_scope',calls:0});expect(calls).toBe(0);
 });
 it('daily generation continues with successful channels, skips a malformed unused source and missing-only catchup skips all APIs',async()=>{
  const day='2048-10-10',ids=[350,268,456],from=day+' 00:00:00',to=day+' 23:59:59';
  const clear=async()=>{await db.query('DELETE FROM urt_video WHERE publishedAt=? AND u_id IN (?,?,?)',[from,...ids]);await db.query("DELETE FROM urt_channel WHERE youtube_id LIKE 'PIPE-RECOVERY-%'");await db.query('DELETE FROM urt_channel_ai WHERE date_from=? AND user_token=?',[from,'AI_TEST']);await db.query('DELETE FROM urt_ai_date WHERE date_from=? AND user_token=?',[from,'AI_TEST']);};
  await clear();try{
   for(const [i,id] of ids.entries()){await db.query('INSERT INTO urt_channel(u_id,ctime,youtube_id,title) VALUES(?,?,?,?)',[id,from,'PIPE-RECOVERY-'+id,'Recovery '+id]);for(let n=0;n<10;n++)await db.query("INSERT INTO urt_video(u_id,videoId,title,publishedAt,ctime,viewCount,id,channelId,thumbnails,channelTitle,playlistId,position,description) VALUES(?,?,'fixture',?,?,10,'fixture','fixture','','fixture','fixture',0,'')",[id,'RCV'+i+'AAAAAA'+n,from,from]);}
   const fake={complete:async(request:any)=>{const p=request as Plan;if(p.input.channelId===350)throw Error('transient');const events=p.input.kind==='daily'?Array.from({length:5},(_,i)=>({標題:'Daily '+i,媒體事件:(p.source as any[]).map(s=>({媒體:s.title,事件:[s.events[0].事件]}))})):Array.from({length:3},(_,i)=>({...event((p.source as any[])[i*2].videoId,i),videoId:[(p.source as any[])[i*2].videoId,(p.source as any[])[i*2+1].videoId]}));return {requestedModel:'sky-quality',model:'fake',usage:null,content:JSON.stringify({events})};}};
   const result=await runDailyPipeline(db,{kind:'daily',from,to,condition:'all',userToken:'AI_TEST'},{...options,provider:fake,callLimit:5,assertAuthorized:()=>{}});expect(result.status).toBe('partial_failure');expect(result.rows.some((r:any)=>r.workflow==='ai.daily'&&r.status==='published')).toBe(true);
   let regenerated=false;const sourceDb=new Proxy(db,{get(target,property){if(property==='query')return (statement:string,params:any[])=>statement.startsWith('SELECT c.u_id,n.tags')?Promise.resolve([CHANNEL_IDS.map(u_id=>({u_id,tags:'[102]'})),[]]):db.query(statement,params);const value=Reflect.get(target,property);return typeof value==='function'?value.bind(target):value;}});
   await runCatchup(sourceDb,{date:day,userToken:'AI_TEST'},{...options,retryFailed:true,callLimit:5,assertAuthorized:()=>{},provider:{complete:async(p)=>{if((p as Plan).input.channelId===268)regenerated=true;return fake.complete(p);}},refreshSource:async()=>{await db.query('UPDATE urt_video SET title=? WHERE u_id=? AND publishedAt=?',['refreshed source text',268,from]);return {complete:true,completedChannelIds:[...CHANNEL_IDS],details:{executionKey:'source-refresh-test'}};}});expect(regenerated).toBe(true);
   await db.query("INSERT INTO urt_channel_ai(u_id,ctime,date_from,date_to,ai_type,data_type,user_token,result_json) VALUES(999999,?,?,?,'fake','oneday','AI_TEST','broken')",[from,from,to]);expect((await planAi(db,{kind:'daily',from,to,condition:'all',userToken:'AI_TEST'})).blocked).toBeNull();
   const refreshed=await refreshDays(db,{from:day,to:day,condition:'all',userToken:'AI_TEST',skipCache:true,skipPeriod:true},{...options,retryFailed:true,provider:fake,callLimit:1,assertAuthorized:()=>{}});expect(refreshed.rows.some(r=>r.workflow==='ai.event')).toBe(true);
   const [published]=await db.query<RowDataPacket[]>("SELECT * FROM ts_ai_runs WHERE workflow='ai.daily' AND JSON_UNQUOTE(JSON_EXTRACT(input_json,'$.plan.key.date_from'))=? AND status='published'",[from]);const original=published[0]!;
   for(const condition of ['green','blue','neutral','finance','world']){const snapshot=JSON.parse(original.input_json);snapshot.plan.input.condition=condition;snapshot.plan.key.condition_type=condition;const [insert]=await db.execute<any>("INSERT INTO urt_ai_date(ctime,date_from,date_to,ai_type,data_type,condition_type,user_token,channel_id,result_json) VALUES(?,?,?,'sky-quality','oneday',?,'AI_TEST','{}',?)",[from,from,to,condition,original.result_json]);const h=sourceIdentity(snapshot.plan,'sky-quality');await db.query("INSERT INTO ts_ai_runs(run_id,workflow,business_key_sha256,input_sha256,input_json,status,result_json,target_pk,created_at,updated_at) VALUES(?,'ai.daily',?,?,?,'published',?,?,?,?)",[h,aiBusinessKey('urt_ai_date',snapshot.plan.key),h,JSON.stringify(snapshot),original.result_json,insert.insertId,from,from]);}
   await db.query("UPDATE urt_ai_date SET condition_type=NULL WHERE date_from=? AND user_token='AI_TEST' AND condition_type='all'",[from]);
   const catchup=await runCatchup(db,{date:day,userToken:'AI_TEST'},{...options,callLimit:45,assertAuthorized:(job)=>{if(job!=='ai.daily.catchup')throw Error('must skip dependencies');},refreshSource:async()=>{throw Error('must skip source API');},provider:{complete:async()=>{throw Error('must skip inference');}}});expect(catchup).toMatchObject({status:'success',reason:'all_daily_rows_complete',calls:0,sourceSkipped:true});
   let refreshedSource=0;const wrapped=new Proxy(db,{get(target,property){if(property==='query')return (statement:string,params:any[])=>statement.startsWith('SELECT c.u_id,n.tags')?Promise.resolve([CHANNEL_IDS.map(u_id=>({u_id,tags:'[102]'})),[]]):db.query(statement,params);const value=Reflect.get(target,property);return typeof value==='function'?value.bind(target):value;}});
   const regular=await runCatchup(wrapped,{date:day,userToken:'AI_TEST'},{...options,workflow:'ai.daily',callLimit:45,assertAuthorized:()=>{},refreshSource:async()=>{refreshedSource++;return {complete:false,details:{}};}});expect(regular).toMatchObject({status:'blocked',reason:'source_refresh_incomplete'});expect(refreshedSource).toBe(1);

  }finally{await clear();}
 });
 it('catchup rejects a successful crawl that omits a required channel',async()=>{
  const wrapped=new Proxy(db,{get(target,property){if(property==='query')return (statement:string,params:any[])=>statement.startsWith('SELECT c.u_id,n.tags')?Promise.resolve([CHANNEL_IDS.map(u_id=>({u_id,tags:'[102]'})),[]]):db.query(statement,params);const value=Reflect.get(target,property);return typeof value==='function'?value.bind(target):value;}});
  const result=await runCatchup(wrapped,{date:'2047-01-01',userToken:'AI_TEST'},{...options,callLimit:45,assertAuthorized:()=>{},refreshSource:async()=>({complete:true,completedChannelIds:CHANNEL_IDS.slice(1),details:{}})});expect(result).toMatchObject({status:'blocked',reason:'source_refresh_incomplete',missingRequiredChannelIds:[CHANNEL_IDS[0]]});
 });
 it('view-ranking cutoff changes preserve the selected input snapshot during inference',async()=>{
  const fake={complete:async(p:Plan)=>{await db.query("UPDATE urt_video SET viewCount=999999 WHERE u_id=? AND videoId IN ('AIAAAAAAAA4','AIAAAAAAAA5')",[uid]);return provider.complete(p);}};
  expect(await runAi(db,{...input,limit:4},{...options,provider:fake})).toMatchObject({status:'published'});
 });
 it('view-count-only changes do not spend another completion',async()=>{
  await runAi(db,input,options);
  await db.query('UPDATE urt_video SET viewCount=viewCount+1 WHERE u_id=?',[uid]);
  expect(await runAi(db,input,{...options,provider:{complete:async()=>{throw Error('must not infer');}}})).toMatchObject({status:'unchanged'});
 });

 it('hourly pipeline requires complete source coverage and journals the refresh before publishing',async()=>{
  const hourly={kind:'hourly' as const,from,to,userToken:'AI_TEST_PIPE'};let calls=0;
  await db.query('INSERT INTO urt_count(u_id,tags,ctime) VALUES(?,?,?)',[uid,'[102]',from]);
  const pipelineOptions={...options,provider:{complete:async(p:Plan)=>{calls++;return provider.complete(p);}},assertAuthorized:()=>{}};
  expect(await runHourlyPipeline(db,hourly,{...pipelineOptions,refreshSource:async()=>({complete:false,details:{executionKey:'incomplete'}})})).toMatchObject({status:'blocked',calls:0});expect(calls).toBe(0);
  try{const result=await runHourlyPipeline(db,hourly,{...pipelineOptions,refreshSource:async()=>({complete:true,details:{executionKey:'synthetic-source'}})});expect(result).toMatchObject({status:'published',sourceComplete:true});expect(calls).toBe(1);const [rows]=await db.query<RowDataPacket[]>('SELECT input_json FROM ts_ai_runs WHERE run_id=?',[(result as {runId:string}).runId]);expect(JSON.parse(rows[0]!.input_json).sourceCapture).toEqual({executionKey:'synthetic-source'});expect(await runHourlyPipeline(db,hourly,{...pipelineOptions,missingOnly:true,refreshSource:async()=>{throw Error('must skip source');}})).toMatchObject({status:'unchanged',sourceSkipped:true});}finally{await db.query('DELETE FROM urt_ai_hour WHERE BINARY user_token=BINARY ?',['AI_TEST_PIPE']);await db.query('DELETE FROM urt_count WHERE u_id=?',[uid]);}
 });
 it('a deleted projection during update remains validated and replays without another inference',async()=>{
  await db.query('UPDATE urt_video SET title=? WHERE u_id=? AND videoId=?',['CAS race source',uid,'AIAAAAAAAA0']);let raced=false;
  const wrapped=new Proxy(db,{get(target,property){if(property==='execute')return async(statement:string,params:any[])=>{if(statement.startsWith('UPDATE urt_channel_ai SET')&&!raced){raced=true;await db.query('UPDATE urt_channel_ai SET del_flag=1 WHERE u_id=?',[uid]);}return db.execute(statement,params);};const value=Reflect.get(target,property);return typeof value==='function'?value.bind(target):value;}});
  try{await expect(runAi(wrapped,input,options)).rejects.toThrow('projection target changed');const p=await planAi(db,input);const [rows]=await db.query<RowDataPacket[]>('SELECT status FROM ts_ai_runs WHERE input_sha256=?',[sourceIdentity(p,'sky-quality')]);expect(rows[0]!.status).toBe('validated');}finally{await db.query('UPDATE urt_channel_ai SET del_flag=NULL WHERE u_id=?',[uid]);}
  expect(await runAi(db,input,{...options,provider:{complete:async()=>{throw Error('must replay validated result');}}})).toMatchObject({status:'published'});
 });

 it('missing-only preserves unowned legacy channel daily and hourly shapes without inference',async()=>{
  for(const kind of ['channel','daily','hourly'] as const){const legacyInput={kind,from,to,userToken:'AI_TEST_LEGACY',...(kind==='channel'?{channelId:uid}:{condition:'all' as const})};const p=await planAi(db,legacyInput);const historical=JSON.stringify([{[kind==='daily'?'標題':'事件']:'Legacy topic',媒體事件:{媒體一:['事件一','事件二']},videoId:['OLDONLYID00']}]);
   const values={...p.key,ctime:from,ai_type:'legacy-v1',result_json:historical,...(kind==='daily'?{channel_id:'{}'}:{})};await db.query(`INSERT INTO ${p.table}(${Object.keys(values).join(',')}) VALUES(${Object.keys(values).map(()=>'?').join(',')})`,Object.values(values));
   try{expect(await runAi(db,legacyInput,{...options,missingOnly:true,provider:{complete:async()=>{throw Error('must preserve legacy');}}})).toMatchObject({status:'unchanged',reason:'legacy_present_unvalidated'});const [rows]=await db.query<RowDataPacket[]>(`SELECT result_json,ai_type FROM ${p.table} WHERE BINARY user_token=BINARY ?`,['AI_TEST_LEGACY']);expect(rows[0]).toMatchObject({result_json:historical,ai_type:'legacy-v1'});}finally{await db.query(`DELETE FROM ${p.table} WHERE BINARY user_token=BINARY ?`,['AI_TEST_LEGACY']);}
  }
 });
 it('scheduled malformed output retries after cooldown with a three-completion ceiling',async()=>{
  const invalidInput={...input,userToken:'AI_TEST_INVALID'};let calls=0;const invalid={complete:async()=>{calls++;return {requestedModel:'sky-quality',model:'fake',usage:null,content:'{"events":[]}'};}};
  await expect(runAi(db,invalidInput,{...options,scheduledRecovery:true,provider:invalid})).rejects.toThrow('valid event count');await expect(runAi(db,invalidInput,{...options,scheduledRecovery:true,provider:invalid})).rejects.toThrow('retryFailed');expect(calls).toBe(1);for(let n=0;n<2;n++){await db.query("UPDATE ts_ai_runs SET updated_at='2020-01-01 00:00:00' WHERE input_json LIKE '%AI_TEST_INVALID%'");await expect(runAi(db,invalidInput,{...options,scheduledRecovery:true,provider:invalid})).rejects.toThrow('valid event count');}await db.query("UPDATE ts_ai_runs SET updated_at='2020-01-01 00:00:00' WHERE input_json LIKE '%AI_TEST_INVALID%'");await expect(runAi(db,invalidInput,{...options,scheduledRecovery:true,provider:invalid})).rejects.toThrow('retryFailed');expect(calls).toBe(3);
 });
 it('authorization revoked after budget reservation creates no journal before dispatch',async()=>{let reserved=false;const target={...input,userToken:'AI_TEST_PREFLIGHT'};await expect(runAi(db,target,{...options,reserveCall:()=>{reserved=true;},assertAuthorized:()=>{if(reserved)throw Error('revoked');}})).rejects.toThrow('revoked');const [rows]=await db.query<RowDataPacket[]>("SELECT COUNT(*) n FROM ts_ai_runs WHERE input_json LIKE '%AI_TEST_PREFLIGHT%'");expect(rows[0]!.n).toBe(0);});
 it('retry preflight never resets failed or running cooldown timestamps or transient classification',async()=>{
  const stateInput={...input,userToken:'AI_TEST_STATE'};await expect(runAi(db,stateInput,{...options,provider:{complete:async()=>{throw new RetryableProviderError('temporary');}}})).rejects.toThrow('temporary');
  const timestamp=new Date(Date.now()+8*3600000-60000).toISOString().slice(0,19).replace('T',' ');const [r]=await db.query<RowDataPacket[]>("SELECT run_id FROM ts_ai_runs WHERE input_json LIKE '%AI_TEST_STATE%'");const id=r[0]!.run_id;
  await db.query('UPDATE ts_ai_runs SET updated_at=? WHERE run_id=?',[timestamp,id]);
  await expect(runAi(db,stateInput,{...options,scheduledRecovery:true,reserveCall:()=>{throw Error('budget exhausted');}})).rejects.toThrow('budget');
  const fetch=async()=>{const [rows]=await db.query<RowDataPacket[]>('SELECT status,failure_code,updated_at FROM ts_ai_runs WHERE run_id=?',[id]);return rows[0];};expect(await fetch()).toMatchObject({status:'failed',failure_code:'provider_transient',updated_at:timestamp});
  await db.query("UPDATE ts_ai_runs SET status='running' WHERE run_id=?",[id]);await expect(runAi(db,stateInput,{...options,scheduledRecovery:true})).rejects.toThrow('retryFailed');expect(await fetch()).toMatchObject({status:'running',updated_at:timestamp});
  await db.query("UPDATE ts_ai_runs SET status='failed',failure_code='generation_or_projection_failed' WHERE run_id=?",[id]);await expect(runAi(db,stateInput,{...options,scheduledRecovery:true})).rejects.toThrow('retryFailed');expect(await fetch()).toMatchObject({status:'failed',failure_code:'generation_or_projection_failed',updated_at:timestamp});
 });
 it('missing-only preserves a later legacy overwrite of a previously TS-published row',async()=>{
  const target={...input,userToken:'AI_TEST_OVERWRITE'};await runAi(db,target,options);const historical=JSON.stringify([{事件:'Legacy replacement',videoId:['OLDONLYID00']}]);await db.query('UPDATE urt_channel_ai SET result_json=?,ai_type=? WHERE BINARY user_token=BINARY ?',[historical,'legacy','AI_TEST_OVERWRITE']);
  try{expect(await runAi(db,target,{...options,missingOnly:true,provider:{complete:async()=>{throw Error('must preserve replacement');}}})).toMatchObject({status:'unchanged',reason:'legacy_present_unvalidated'});}finally{await db.query('DELETE FROM urt_channel_ai WHERE BINARY user_token=BINARY ?',['AI_TEST_OVERWRITE']);}
 });
 it('scheduled source-first pipelines reject unclosed windows before source calls',async()=>{
  const future={...options,scheduledRecovery:true,callLimit:10,assertAuthorized:()=>{},refreshSource:async()=>{throw Error('must reject before API');}};
  expect(await runCatchup(db,{date:'2099-01-01'},future)).toMatchObject({status:'blocked',reason:'window_not_closed'});expect(await runHourlyPipeline(db,{kind:'hourly',from:'2099-01-01 00:00:00',to:'2099-01-01 00:59:59'},future)).toMatchObject({status:'blocked',reason:'window_not_closed'});
 });
 it('daily shared call cap blocks the channel stage and prevents downstream synthesis',async()=>{
  const day='2045-10-10';const clear=async()=>{await db.query('DELETE FROM urt_video WHERE u_id=76 AND publishedAt=?',[day+' 00:00:00']);await db.query("DELETE FROM urt_channel_ai WHERE u_id=76 AND user_token='AI_TEST'");};
  await clear();try{
    for(let i=0;i<10;i++)await db.query("INSERT INTO urt_video(u_id,videoId,title,publishedAt,ctime,viewCount,id,channelId,thumbnails,channelTitle,playlistId,position,description) VALUES(76,?,'fixture',?,?,10,'fixture','fixture','','fixture','fixture',0,'')",['PIPAAAAAAA'+i,day+' 00:00:00',from]);
    let attempted=0;const result=await runDailyPipeline(db,{kind:'daily',from:day+' 00:00:00',to:day+' 23:59:59',userToken:'AI_TEST'},{...options,callLimit:0,assertAuthorized:()=>{},provider:{complete:async(p)=>{attempted++;return provider.complete(p as Plan);}}});
    expect(result).toMatchObject({status:'partial_failure',calls:0});expect(attempted).toBe(0);expect(result.rows).toHaveLength(7);
    const [failed]=await db.query<RowDataPacket[]>("SELECT COUNT(*) n FROM ts_ai_runs WHERE workflow='ai.channel' AND JSON_UNQUOTE(JSON_EXTRACT(input_json,'$.plan.key.date_from'))=?",[day+' 00:00:00']);expect(failed[0]!.n).toBe(0);
    const retry=await runDailyPipeline(db,{kind:'daily',from:day+' 00:00:00',to:day+' 23:59:59',userToken:'AI_TEST'},{...options,callLimit:1,assertAuthorized:()=>{}});expect(retry.calls).toBe(1);expect(retry.rows[0]).toMatchObject({workflow:'ai.channel',status:'published'});
  }finally{await clear();}
 });

});
