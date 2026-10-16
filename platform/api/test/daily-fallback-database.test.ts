import {describe,it,expect,beforeAll,beforeEach,afterAll} from 'vitest';
import mysql from 'mysql2/promise';
import {assertTestDatabaseUrl} from '../../shared/test-database.js';
import {aiBusinessKey} from '../../shared/ai-business-key.js';
import {buildApp} from '../src/app.js';
const url=process.env.TEST_DATABASE_URL?assertTestDatabaseUrl(process.env.TEST_DATABASE_URL):undefined;
describe.skipIf(!url)('daily fallback on isolated MariaDB',()=>{
 const uid=[978001,978002],pks=[978011,978012],daily=978021,date='2200-01-02',from=date+' 00:00:00',to=date+' 23:59:59',run='9f'.repeat(32),app=buildApp({databaseUrl:url,dataset:'fixture'});
 let db:Awaited<ReturnType<typeof mysql.createConnection>>;
 const results=uid.map((id,i)=>JSON.stringify([{事件:'來源'+i,關鍵字:['獨特關鍵甲','獨特關鍵乙'],videoId:i===0?['DailyAa0001','DailyAa0002']:['DailyBb0001','Dailyaa0001']}]));
 const cleanup=async()=>{await db.query('DELETE FROM ts_ai_runs WHERE run_id=?',[run]);await db.query('DELETE FROM urt_ai_date WHERE pk=?',[daily]);await db.query('DELETE FROM urt_channel_ai WHERE u_id IN (?)',[uid]);await db.query('DELETE FROM urt_video WHERE u_id IN (?)',[uid]);await db.query('DELETE FROM urt_count WHERE u_id IN (?)',[uid]);await db.query('DELETE FROM urt_channel WHERE u_id IN (?)',[uid]);};
 beforeAll(async()=>{db=await mysql.createConnection(url!);});
 beforeEach(async()=>{await cleanup();for(let i=0;i<2;i++){
  await db.execute('INSERT INTO urt_channel(u_id,ctime,title,youtube_id) VALUES(?,?,?,?)',[uid[i],from,'Daily Source '+i,'UCDaily'+i]);
  await db.execute('INSERT INTO urt_count(u_id,ctime,tags) VALUES(?,?,?)',[uid[i],from,i===0?'[4]':'[3]']);
  await db.execute('INSERT INTO urt_channel_ai(pk,u_id,ctime,date_from,date_to,data_type,user_token,ai_type,result_json) VALUES(?,?,?,?,?,?,?,?,?)',[pks[i],uid[i],from,from,to,'oneday','DAILY_TEST','test',results[i]]);
 }
 for(const [id,owner]of [['DailyAa0001',uid[0]],['DailyAa0002',uid[0]],['DailyBb0001',uid[1]]]as const)await db.execute("INSERT INTO urt_video(u_id,ctime,publishedAt,videoId,title,id,channelId,thumbnails,channelTitle,playlistId,position,description) VALUES(?,?,?,?,?,'fixture','fixture','','daily fixture','fixture',0,'')",[owner,from,from,id,'fixture']);
 });
 afterAll(async()=>{await app.close();if(db){await cleanup();await db.end();}});
 const get=async(query='date='+date)=>{const r=await app.inject('/api/v1/ai/days?'+query);expect(r.statusCode,r.body).toBe(200);return r.json();};
 const cache=async(result=JSON.stringify([{標題:'舊零碎摘要',媒體事件:{'Daily Source 0':['来源不存在']}}]))=>db.execute('INSERT INTO urt_ai_date(pk,ctime,date_from,date_to,data_type,condition_type,user_token,ai_type,channel_id,result_json) VALUES(?,?,?,?,?,?,?,?,?,?)',[daily,from,from,to,'oneday','all','DAILY_TEST','test',JSON.stringify({[uid[0]!]: 'Daily Source 0',[uid[1]!]: 'Daily Source 1'}),result]);
 const journal=async(workflow:string,pk:number|null,result:string,input='{}',status='validated')=>db.execute('INSERT INTO ts_ai_runs(run_id,workflow,business_key_sha256,input_sha256,input_json,status,result_json,target_pk,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)',[run,workflow,aiBusinessKey(workflow==='ai.daily'?'urt_ai_date':'urt_channel_ai',workflow==='ai.daily'?{date_from:from,date_to:to,data_type:'oneday',condition_type:'all',user_token:'DAILY_TEST'}:{date_from:from,date_to:to,data_type:'oneday',u_id:uid[0],user_token:'DAILY_TEST'}),'b'.repeat(64),input,status,result,pk,from,from]);
 it('groups stored channel sources with exact citations, no fabricated daily ID and byte-exact local reference checks',async()=>{
  const r=await get();expect(r.data).toMatchObject({date,source:'channel-summaries',dailyId:null,channels:2,sourceChannels:2,rawVideoRows:3});expect(r.data.rows).toHaveLength(1);expect(r.data.rows[0]).toMatchObject({channelCount:2,videoCount:4,dailyId:0});
  const evidence=r.data.rows[0].evidence;expect(evidence.find((e:any)=>e.channelId===uid[0]).resolvedVideoIds).toEqual(['DailyAa0001','DailyAa0002']);expect(evidence.find((e:any)=>e.channelId===uid[1]).resolvedVideoIds).toEqual(['DailyBb0001']);expect(r.meta.coverage).toMatchObject({composition:'channel-summaries',unresolvedVideoReferences:1,rawVideoScope:'current-table-selected-summary-channels'});expect(r.meta.warnings.join(' ')).toContain('共同訊號');
 });
 it('uses the newer complete channel date for all but not a selected stored type',async()=>{
  await cache();await db.execute('UPDATE urt_ai_date SET date_from=?,date_to=? WHERE pk=?',['2199-12-31 00:00:00','2199-12-31 23:59:59',daily]);
  expect((await get('')).data).toMatchObject({date,source:'channel-summaries'});
  expect((await get('type=oneday')).data).toMatchObject({date:'2199-12-31',source:'daily-cache'});
 });
 it('regroups poor legacy caches but exact PK remains unchanged',async()=>{
  await cache();await db.execute('UPDATE urt_ai_date SET mtime=? WHERE pk=?',['2300-01-01 00:00:00',daily]);const regrouped=await get();expect(regrouped.data).toMatchObject({source:'channel-summaries',dailyId:null,updatedAt:'2200-01-01T16:00:00.000Z'});expect(regrouped.meta.coverage.replacedDailyId).toBe(daily);expect((await get()).data.rows[0].title).not.toBe('舊零碎摘要');
  const pinned=await get('pk='+daily);expect(pinned.data.source).toBe('daily-cache');expect(pinned.data.rows[0].title).toBe('舊零碎摘要');expect(pinned.data.rows[0].unresolvedReferences).toHaveLength(1);
 });
 it('todate source citations resolve through their exact source PK',async()=>{
  await db.execute("UPDATE urt_channel_ai SET data_type='todate' WHERE pk=?",[pks[0]]);const d=await get();expect(d.data.sourceChannels).toBe(2);expect((await app.inject(`/api/v1/channels/${uid[0]}/ai/days?pk=${pks[0]}`)).statusCode).toBe(200);
 });
 it('retains usable cached content when optional source regrouping exceeds capacity',async()=>{
  await cache();await db.execute('UPDATE urt_ai_date SET channel_id=? WHERE pk=?',[JSON.stringify({[uid[0]!]: 'Daily Source 0'}),daily]);
  await db.execute('UPDATE urt_channel_ai SET result_json=? WHERE pk=?',['{"data":'.repeat(34)+'[]'+'}'.repeat(34),pks[1]]);
  const r=await get();expect(r.data).toMatchObject({source:'daily-cache',dailyId:daily});expect(r.data.rows[0].title).toBe('舊零碎摘要');expect(r.meta.coverage.regroupReason).toBe('fallback-capacity-exceeded');
 });
 it('newer pending-only sources cannot erase the existing daily anchor',async()=>{
  await cache();await db.execute('UPDATE urt_ai_date SET date_from=?,date_to=? WHERE pk=?',['2199-12-31 00:00:00','2199-12-31 23:59:59',daily]);
  await db.execute('DELETE FROM urt_channel_ai WHERE u_id=?',[uid[1]]);await journal('ai.channel',null,results[0]!);
  const r=await get('');expect(r.data).toMatchObject({date:'2199-12-31',source:'daily-cache',dailyId:daily});expect(r.meta.coverage).toMatchObject({newerSourceDate:date,newerSourceReason:'newer-source-unavailable'});
 });
 it('condition scopes and active-channel rules apply before source grouping',async()=>{
  expect((await get('date='+date+'&condition=green')).data.rows[0].evidence.map((e:any)=>e.channelId)).toEqual([uid[0]]);
  expect((await get('date='+date+'&condition=blue')).data.rows[0].evidence.map((e:any)=>e.channelId)).toEqual([uid[1]]);
  expect((await get('date='+date+'&condition=neutral')).data.rows).toEqual([]);
  await db.execute('UPDATE urt_channel SET flag_del=1 WHERE u_id=?',[uid[1]]);expect((await get()).data.channels).toBe(1);
 });
 it('withholds pending latest source without falling back to an older revision',async()=>{
  await db.execute('INSERT INTO urt_channel_ai(pk,u_id,ctime,date_from,date_to,data_type,user_token,ai_type,result_json) VALUES(?,?,?,?,?,?,?,?,?)',[pks[0]!-1,uid[0],from,from,to,'oneday','DAILY_TEST','test',results[0]]);
  await journal('ai.channel',null,results[0]!);const r=await get();expect(r.data.sourceChannels).toBe(1);expect(r.meta.coverage.withheldSources).toBe(1);expect(r.data.rows[0].evidence[0].channelId).toBe(uid[1]);
 });
 it('never regroups unavailable or immutable TS daily lineage',async()=>{
  const result=JSON.stringify([{標題:'固定快照',媒體事件:{'Daily Source 0':['快照事件']}}]);await cache(result);await journal('ai.daily',daily,result);const unavailable=await get();expect(unavailable.data).toMatchObject({source:'daily-cache',lineage:{state:'snapshot-unavailable'}});expect(unavailable.data.rows[0].evidence).toEqual([]);
  const input={plan:{table:'urt_ai_date',key:{date_from:from,date_to:to,data_type:'oneday',condition_type:'all',user_token:'DAILY_TEST'},source:[{pk:pks[0],u_id:uid[0],title:'Daily Source 0',events:[{事件:'快照事件',videoId:['Snapshot001']}]}]}};
  await db.execute("UPDATE ts_ai_runs SET status='published',input_json=? WHERE run_id=?",[JSON.stringify(input),run]);const pinned=await get();expect(pinned.data).toMatchObject({source:'daily-cache',lineage:{state:'immutable-snapshot'}});expect(pinned.data.rows[0].evidence[0].videoIds).toEqual(['Snapshot001']);expect(pinned.meta.coverage).toMatchObject({referenceScope:'immutable-generation-snapshot',resolvedVideoReferences:null,unresolvedVideoReferences:null,rawVideoScope:'not-counted-for-snapshot'});expect(pinned.data.rawVideoRows).toBeNull();
 });
 it('preserves cached and immutable topic content while withholding excessive reference lists',async()=>{
  const result=JSON.stringify([{標題:'大量引用',媒體事件:{'Daily Source 0':['來源0'],'Daily Source 1':['來源1']}}]);await cache(result);
  const videos=uid.map((_,i)=>Array.from({length:2600},(_,j)=>'Cap'+String(i*2600+j).padStart(8,'0')));
  for(let i=0;i<2;i++)await db.execute('UPDATE urt_channel_ai SET result_json=? WHERE pk=?',[JSON.stringify([{事件:'來源'+i,videoId:videos[i]}]),pks[i]]);
  const mutable=await get('pk='+daily);expect(mutable.data.rows[0]).toMatchObject({title:'大量引用',videoCount:5200});expect(mutable.data.rows[0].evidence.every((e:any)=>e.videoIds.length===0&&e.withheldVideoReferenceCount===2600)).toBe(true);expect(mutable.meta.coverage.referenceScope).toBe('reference-capacity-exceeded');
  const input={plan:{table:'urt_ai_date',key:{date_from:from,date_to:to,data_type:'oneday',condition_type:'all',user_token:'DAILY_TEST'},source:uid.map((id,i)=>({pk:pks[i],u_id:id,title:'Daily Source '+i,events:[{事件:'來源'+i,videoId:videos[i]}]}))}};
  await journal('ai.daily',daily,result,JSON.stringify(input),'published');const immutable=await get('pk='+daily);expect(immutable.data.lineage.state).toBe('immutable-snapshot');expect(immutable.data.rows[0].title).toBe('大量引用');expect(immutable.meta.coverage).toMatchObject({referenceScope:'reference-capacity-exceeded',withheldVideoReferences:5200});
 });
 it('discloses invalid source citations and oversized maps instead of losing cached content',async()=>{
  await db.execute('UPDATE urt_channel_ai SET result_json=? WHERE pk=?',[JSON.stringify([{事件:'來源0',videoId:['DailyAa0001','DailyAa0002','invalid'],關鍵字:['獨特關鍵甲','獨特關鍵乙']}]),pks[0]]);
  const grouped=await get();expect(grouped.meta.coverage.invalidVideoReferences).toBe(1);expect(grouped.data.rows[0].evidence.find((e:any)=>e.channelId===uid[0]).invalidReferenceCount).toBe(1);
  await cache();await db.execute('UPDATE urt_ai_date SET channel_id=? WHERE pk=?',[JSON.stringify(Object.fromEntries(Array.from({length:401},(_,i)=>[978000+i,'來源'+i]))),daily]);const bounded=await get('pk='+daily);expect(bounded.data.source).toBe('daily-cache');expect(bounded.meta.coverage.sourceCapacityExceeded).toBe(true);
 });
 it('fails visibly on deeply nested sources and rejects malformed query values',async()=>{
  await db.execute('UPDATE urt_channel_ai SET result_json=? WHERE pk=?',['{"data":'.repeat(34)+'[]'+'}'.repeat(34),pks[0]]);expect((await app.inject('/api/v1/ai/days?date='+date)).statusCode).toBe(422);
  for(const q of ['date=bad','condition=all&condition=green','type=oneday&type=todate','pk=0'])expect((await app.inject('/api/v1/ai/days?'+q)).statusCode).toBe(400);
 });
});
