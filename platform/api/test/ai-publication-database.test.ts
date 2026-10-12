import {beforeAll,afterAll,describe,it,expect} from 'vitest';
import mysql,{type Connection} from 'mysql2/promise';
import {sql} from 'drizzle-orm';
import {assertTestDatabaseUrl} from '../../shared/test-database.js';
import {canonicalHash} from '../../shared/ai-business-key.js';
import {runAi,type RunOptions} from '../../ai/src/runner.js';
import {runMayor} from '../../ai/src/mayor.js';
import {buildTopicCache} from '../../ai/src/topic-cache.js';
import type {Plan} from '../../ai/src/contracts.js';
import {buildApp} from '../src/app.js';
import {DataQueryFailed,createReader,type Row} from '../src/db/client.js';
import {aiPublication,topicPublication,publicationBudget} from '../src/reports/ai-publication.js';
const url=process.env.TEST_DATABASE_URL?assertTestDatabaseUrl(process.env.TEST_DATABASE_URL):undefined;
const token='PUB_GUARD_TEST',day='2038-08-18',from=day+' 00:00:00',to=day+' 23:59:59',uids=[992611,992612],ids=['PubGuard001','PubGuard002','PubGuard003','PubGuard004'];
const event=(name:string,videoId:string[])=>({事件:name,描述:'已保存來源描述',角度:'無法判斷',陣營:'無法判斷',分類:'新聞',關鍵字:['交通'],人物:['蔣萬安'],地名:['台北'],類型:[],videoId});
describe.skipIf(!url)('AI publication guards against real writer journals',()=>{
 let db:Connection;const reader=createReader(url),app=buildApp({databaseUrl:url,dataset:'fixture'});let hourly:Row,daily:Row,mayor:Row,hourRun:Row,dailyRun:Row,mayorRun:Row,topicRun:Row;
 const clean=async()=>{await db.query('DELETE FROM ts_ai_runs WHERE input_json LIKE ?',['%'+token+'%']);for(const table of ['urt_ai_hour','urt_ai_date','urt_mayor_person_ai'])await db.query(`DELETE FROM ${table} WHERE user_token=?`,[token]);for(const table of ['urt_video','urt_channel','urt_count','urt_channel_ai'])await db.query(`DELETE FROM ${table} WHERE u_id IN (?)`,[uids]);};
 const options:RunOptions={execute:true,assertAuthorized:()=>{},modelAlias:'sky-quality',provider:{complete:async request=>{const plan=request as Plan;const events=plan.input.kind==='daily'?[{標題:'交通政策',媒體事件:[{媒體:'發布測試甲',事件:['交通甲']},{媒體:'發布測試乙',事件:['交通乙']}]}]:[event('時段甲',[ids[0]!]),event('時段乙',[ids[1]!])];return {content:JSON.stringify({events}),requestedModel:'sky-quality',model:'fixture',usage:null};}}};
 beforeAll(async()=>{
  db=await mysql.createConnection({uri:url!,dateStrings:true,charset:'utf8mb4_bin'});await clean();
  for(const [index,uid]of uids.entries()){
   await db.execute('INSERT INTO urt_channel(u_id,ctime,title,youtube_id)VALUES(?,?,?,?)',[uid,from,index?'發布測試乙':'發布測試甲','UCPublication'+index]);
   await db.execute('INSERT INTO urt_count(u_id,ctime,tags)VALUES(?,?,?)',[uid,from,'[102]']);
   await db.execute("INSERT INTO urt_channel_ai(u_id,ctime,date_from,date_to,ai_type,data_type,user_token,result_json)VALUES(?,?,?,?,'fixture','oneday',?,?)",[uid,from,from,to,token,JSON.stringify([event(index?'交通乙':'交通甲',ids.slice(index*2,index*2+2))])]);
  }
  for(const [index,id]of ids.entries())await db.execute("INSERT INTO urt_video(u_id,videoId,title,publishedAt,ctime,viewCount,id,channelId,thumbnails,channelTitle,playlistId,position,description)VALUES(?,?,?,?,?,?,'fixture','fixture','','fixture','fixture',0,'來源說明')",[uids[Math.floor(index/2)]!,id,'蔣萬安交通政策 '+index,from,from,100-index]);
  expect(await runAi(db,{kind:'hourly',from,to,userToken:token},options)).toMatchObject({status:'published'});
  expect(await runAi(db,{kind:'daily',from,to,userToken:token},options)).toMatchObject({status:'published'});
  expect(await buildTopicCache(db,{date:day,userToken:token},{execute:true,assertAuthorized:()=>{}})).toMatchObject({status:'published'});
  expect(await runMayor(db,{city:'taipei',person:'蔣萬安',date:day,userToken:token},{...options,callLimit:1,provider:{complete:async()=>({content:JSON.stringify({observations:[{videoId:ids[0],quote:'蔣萬安交通政策 0'}]}),requestedModel:'sky-quality',model:'fixture',usage:null})}})).toMatchObject({status:'success'});
  hourly=(await reader.rows(sql`SELECT * FROM urt_ai_hour WHERE user_token=${token}`))[0]!;daily=(await reader.rows(sql`SELECT * FROM urt_ai_date WHERE user_token=${token}`))[0]!;mayor=(await reader.rows(sql`SELECT * FROM urt_mayor_person_ai WHERE user_token=${token}`))[0]!;
  const runs=await reader.rows(sql`SELECT * FROM ts_ai_runs WHERE input_json LIKE ${'%'+token+'%'}`);hourRun=runs.find(r=>r.workflow==='ai.hourly')!;dailyRun=runs.find(r=>r.workflow==='ai.daily')!;mayorRun=runs.find(r=>r.workflow==='ai.mayor_person')!;topicRun=runs.find(r=>r.workflow==='reports.ai_topic.build')!;
 });
 afterAll(async()=>{await app.close();await reader.close();if(db){await clean();await db.end();}});
 const changedRun=async(run:Row,change:Record<string,unknown>,test:()=>Promise<void>)=>{const keys=Object.keys(change);await db.query(`UPDATE ts_ai_runs SET ${keys.map(k=>k+'=?').join(',')} WHERE run_id=?`,[...Object.values(change),run.run_id]);try{await test();}finally{await db.query(`UPDATE ts_ai_runs SET ${keys.map(k=>k+'=?').join(',')} WHERE run_id=?`,[...keys.map(k=>run[k]),run.run_id]);}};
 it('accepts exact real hourly, daily, mayor and materializer published snapshots',async()=>{
  for(const [workflow,row]of [['ai.hourly',hourly],['ai.daily',daily],['ai.mayor_person',mayor]]as const)expect(await aiPublication(reader,workflow,row)).toMatchObject({state:'immutable-snapshot'});
  const p=await aiPublication(reader,'ai.daily',daily);expect(await topicPublication(reader,daily,p)).toMatchObject({state:'immutable-snapshot'});
  const r=await app.inject('/api/v1/ai/periods?from='+day+'&to='+day);expect(r.statusCode).toBe(200);expect(r.json().data.rows[0]).toMatchObject({videos:4,channels:2});expect(r.json().meta.coverage.topicCache.publishedSources).toBe(1);
 });
 it('withholds a projection written before the journal status flips to published',async()=>{
  await changedRun(hourRun,{status:'validated'},async()=>{const r=await app.inject('/api/v1/ai/hours?date='+day);expect(r.statusCode).toBe(200);expect(r.json().data.rows).toEqual([]);expect(r.json().meta.coverage.withheldSources).toBe(1);});
 });
 it('claims an inserted projection even if crash left journal target_pk null',async()=>{await changedRun(hourRun,{status:'validated',target_pk:null},async()=>{expect(await aiPublication(reader,'ai.hourly',hourly)).toMatchObject({state:'unpublished'});});});
 it('does not relabel a previously published mutated output as legacy',async()=>{expect(await aiPublication(reader,'ai.hourly',{...hourly,result_json:'[]'})).toMatchObject({state:'diverged'});});
 it('keeps an exact published revision visible while a newer one is pending',async()=>{
  const runId=canonicalHash('newer-pending-publication-fixture');await db.query("INSERT INTO ts_ai_runs(run_id,workflow,business_key_sha256,input_sha256,input_json,status,result_json,target_pk,created_at,updated_at) VALUES(?,'ai.hourly',?,?,?,'validated','[]',?,NOW(),NOW())",[runId,hourRun.business_key_sha256,hourRun.input_sha256,hourRun.input_json,hourly.pk]);try{expect(await aiPublication(reader,'ai.hourly',hourly)).toMatchObject({state:'immutable-snapshot',runId:hourRun.run_id});}finally{await db.query('DELETE FROM ts_ai_runs WHERE run_id=?',[runId]);}
 });
 it('preserves unclaimed legacy output',async()=>{
  await db.query('DELETE FROM ts_ai_runs WHERE run_id=?',[hourRun.run_id]);try{expect(await aiPublication(reader,'ai.hourly',hourly)).toMatchObject({state:'legacy-unrecorded'});}finally{const keys=Object.keys(hourRun);await db.query(`INSERT INTO ts_ai_runs(${keys.join(',')})VALUES(${keys.map(()=>'?').join(',')})`,Object.values(hourRun));}
 });
 it('fails closed on malformed and hash-diverged immutable snapshots',async()=>{
  for(const value of ['{broken',JSON.stringify({...JSON.parse(String(hourRun.input_json)),model:'different-model'})])await changedRun(hourRun,{input_json:value},async()=>{expect(await aiPublication(reader,'ai.hourly',hourly)).toMatchObject({state:'snapshot-unavailable'});});
 });
 it('bounds snapshot transfer and output separately without hiding other blocks',async()=>{
  const budget=publicationBudget();budget.remaining=1;expect(await aiPublication(reader,'ai.hourly',hourly,budget)).toMatchObject({state:'budget-exhausted'});expect(await aiPublication(reader,'ai.hourly',{...hourly,result_bytes:131073,result_json:null})).toMatchObject({state:'oversized'});
 });
 it('keeps immutable output after live source text or channel analysis changes',async()=>{
  await db.query("UPDATE urt_video SET title='已更新的來源文字' WHERE videoId=?",[ids[0]]);await db.query("UPDATE urt_channel_ai SET result_json='[]' WHERE user_token=?",[token]);try{expect(await aiPublication(reader,'ai.hourly',hourly)).toMatchObject({state:'immutable-snapshot'});expect(await aiPublication(reader,'ai.daily',daily)).toMatchObject({state:'immutable-snapshot'});expect(await aiPublication(reader,'ai.mayor_person',mayor)).toMatchObject({state:'immutable-snapshot'});}finally{await db.query('UPDATE urt_video SET title=? WHERE videoId=?',['蔣萬安交通政策 0',ids[0]]);for(const [i,uid]of uids.entries())await db.query('UPDATE urt_channel_ai SET result_json=? WHERE u_id=? AND user_token=?',[JSON.stringify([event(i?'交通乙':'交通甲',ids.slice(i*2,i*2+2))]),uid,token]);}
 });
 it('withholds daily results but preserves route coverage',async()=>{await changedRun(dailyRun,{status:'validated'},async()=>{const r=await app.inject('/api/v1/ai/periods?from='+day+'&to='+day);expect(r.statusCode).toBe(200);expect(r.json().data.rows).toEqual([]);expect(r.json().meta.coverage.withheldSources).toBe(1);});});
 it('withholds pending topic metrics while keeping the published daily topics',async()=>{await changedRun(topicRun,{status:'validated'},async()=>{const r=await app.inject('/api/v1/ai/periods?from='+day+'&to='+day);expect(r.statusCode).toBe(200);expect(r.json().data.rows[0]).toMatchObject({videos:null,channels:2,event:{value:'交通政策'}});expect(r.json().meta.coverage.topicCache.withheldSources).toBe(1);});});
 it('rejects caches belonging to a different daily source and corrupt topic snapshots',async()=>{
  const publication=await aiPublication(reader,'ai.daily',daily);expect(await topicPublication(reader,{...daily,result_json:'[]'},publication)).toMatchObject({state:'diverged'});
  await changedRun(topicRun,{input_sha256:'0'.repeat(64)},async()=>{expect(await topicPublication(reader,daily,publication)).toMatchObject({state:'snapshot-unavailable'});});
 });
 it('missing sidecar withholds only mayor AI and schema drift remains a real error',async()=>{
  await db.query('RENAME TABLE ts_ai_runs TO pub_guard_hidden_runs');
  try{const r=await app.inject('/api/v1/mayor/cities/taipei/people/'+encodeURIComponent('蔣萬安')+'?date='+day);expect(r.statusCode).toBe(200);expect(r.json().data.rows.some((v:any)=>v.kind==='來源影片')).toBe(true);expect(r.json().meta.coverage.ai.unavailableJournals).toBe(1);}finally{await db.query('RENAME TABLE pub_guard_hidden_runs TO ts_ai_runs');}
  await expect(aiPublication({rows:async()=>{throw new DataQueryFailed('ER_BAD_FIELD_ERROR');},close:async()=>{}},'ai.hourly',hourly)).rejects.toMatchObject({driverCode:'ER_BAD_FIELD_ERROR'});
 });
 it('reports oversized and exhausted topic snapshots distinctly',async()=>{
  const p=await aiPublication(reader,'ai.daily',daily),budget=publicationBudget();budget.remaining=1;
  expect(await topicPublication(reader,daily,p,budget)).toMatchObject({state:'budget-exhausted'});
  expect(await topicPublication(reader,{...daily,data_bytes:131073},p)).toMatchObject({state:'oversized'});
 });
 it('caps topic history parsing without asserting whether older history matches or current content diverges',async()=>{
  const runIds=Array.from({length:9},(_,i)=>canonicalHash('publication-candidate-'+i));
  try{for(const runId of runIds)await db.query("INSERT INTO ts_ai_runs(run_id,workflow,business_key_sha256,input_sha256,input_json,status,result_json,target_pk,created_at,updated_at) SELECT ?,workflow,business_key_sha256,input_sha256,JSON_SET(input_json,'$.dataJson','{}'),status,result_json,target_pk,created_at,'2099-01-01 00:00:00' FROM ts_ai_runs WHERE run_id=?",[runId,topicRun.run_id]);
   expect(await topicPublication(reader,daily,await aiPublication(reader,'ai.daily',daily))).toMatchObject({state:'history-unverified'});
   expect(await topicPublication(reader,{...daily,data_json:'{\"changed\":true}'},await aiPublication(reader,'ai.daily',daily))).toMatchObject({state:'history-unverified'});
  }finally{await db.query('DELETE FROM ts_ai_runs WHERE run_id IN (?)',[runIds]);}
 });
 it('an ambiguous failed same-key takeover cannot establish legacy provenance',async()=>{
  await changedRun(hourRun,{status:'failed',target_pk:null,result_json:null},async()=>{expect(await aiPublication(reader,'ai.hourly',hourly)).toMatchObject({state:'unpublished'});});
 });
 it('route withholds an actual in-place external rewrite of a published row',async()=>{
  await db.query("UPDATE urt_ai_hour SET result_json='[]' WHERE pk=?",[hourly.pk]);
  try{const r=await app.inject('/api/v1/ai/hours?date='+day);expect(r.json().data.rows).toEqual([]);expect(r.json().meta.coverage.divergedSources).toBe(1);}finally{await db.query('UPDATE urt_ai_hour SET result_json=? WHERE pk=?',[hourly.result_json,hourly.pk]);}
 });
 it('withholds mayor summary while retaining independent source videos',async()=>{await changedRun(mayorRun,{status:'validated'},async()=>{const r=await app.inject('/api/v1/mayor/cities/taipei/people/'+encodeURIComponent('蔣萬安')+'?date='+day);expect(r.statusCode).toBe(200);expect(r.json().data.rows.some((v:any)=>v.kind==='來源影片')).toBe(true);expect(r.json().data.notes.some((v:string)=>v.startsWith('AI 摘要：'))).toBe(false);expect(r.json().meta.coverage.ai.withheldSources).toBe(1);});});
});
