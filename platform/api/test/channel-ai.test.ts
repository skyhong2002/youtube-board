import {beforeAll,afterAll,describe,it,expect} from 'vitest';
import mysql,{type ResultSetHeader} from 'mysql2/promise';
import {MySqlDialect} from 'drizzle-orm/mysql-core';
import {sql,type SQL} from 'drizzle-orm';
import {createReader,DataQueryFailed,type Row} from '../src/db/client.js';
import {randomUUID,createHash} from 'node:crypto';
import {assertTestDatabaseUrl} from '../../shared/test-database.js';
import {aiBusinessKey} from '../../shared/ai-business-key.js';
import {buildApp} from '../src/app.js';
import {channelText,channelTopics,overviewAspects,overviewItems,storedNumber,excludedChannelPeople} from '../src/reports/channel-ai-shapes.js';
it('preserves daily fields, exact references and the complete presenter exclusion list',()=>{
 expect(excludedChannelPeople.size).toBe(31);for(const name of ['王淑麗','郭正亮','鄭凱銘','交通部官員','居民'])expect(excludedChannelPeople.has(name)).toBe(true);
 const [topic]=channelTopics(JSON.stringify({events:[{事件:'標題',描述:'描述',分類:'公共政策',角度:'採訪',陣營:'無法判斷',人物:['人甲','人甲'],關鍵字:['關鍵詞'],地名:['台北'],videoId:['AbcDefGhi12','abcdefghi12','bad id']}]}));
 expect(topic).toMatchObject({title:'標題',description:'描述',category:'公共政策',angle:'採訪',camp:'無法判斷',people:['人甲'],videos:['AbcDefGhi12','abcdefghi12'],invalidReferences:1});
});
it('unwraps legacy overview forms and retains null score rather than manufacturing zero',()=>{
 expect(channelText({強弱:3},['強弱'])).toBe('3');
 expect(storedNumber(' ')).toBeNull();expect(storedNumber(false)).toBeNull();expect(storedNumber('7.5')).toBe(7.5);
 expect(overviewItems(JSON.stringify({discussion_topics:[{title:'題目'}]}),['discussion_topics'])).toEqual([{title:'題目'}]);
 expect(overviewAspects(JSON.stringify({data:{政治:[{項目:'項目甲',描述:'原始描述',偏好度:4}],國際:{x:{item:'項目乙',preference:null}}}}))).toEqual([{group:'政治',item:'項目甲',description:'原始描述',preference:4},{group:'國際',item:'項目乙',description:'',preference:null}]);
});
const url=process.env.TEST_DATABASE_URL?assertTestDatabaseUrl(process.env.TEST_DATABASE_URL):undefined;
describe.skipIf(!url)('channel AI report MariaDB selection and coverage',()=>{
 const token=randomUUID().replaceAll('-','').slice(0,8),ids=['A','a','B'].map(s=>'C'+token+s+'1'),app=buildApp({databaseUrl:url,dataset:'fixture'}),aiIds:number[]=[],runIds:string[]=[];
 let db:mysql.Connection,uId:number,otherId:number,dayPk:number,weekPk:number,topicPk:number,withheldPk:number;
 const stamp='2026-10-11 18:00:00';
 const insertAi=async(type:string,from:string,to:string,payload:unknown,deleted:number|null=null)=>{const [r]=await db.execute<ResultSetHeader>('INSERT INTO urt_channel_ai(u_id,ctime,mtime,ai_type,data_type,user_token,date_from,date_to,result_json,del_flag)VALUES(?,?,?,?,?,?,?,?,?,?)',[uId,stamp,stamp,'fixture',type,'CLI',from+' 00:00:00',to+' 23:59:59',JSON.stringify(payload),deleted]);aiIds.push(r.insertId);return r.insertId;};
 beforeAll(async()=>{
  db=await mysql.createConnection(url!);
  for(const other of [false,true]){const [r]=await db.execute<ResultSetHeader>('INSERT INTO urt_channel(ctime,youtube_id,title)VALUES(?,?,?)',[stamp,'UCAiFixture'+token+(other?'Other':''),other?'另一頻道':'合成AI頻道']);if(other)otherId=r.insertId;else uId=r.insertId;}
  for(let i=0;i<ids.length;i++)await db.execute('INSERT INTO urt_video(ctime,u_id,id,publishedAt,channelId,title,thumbnails,channelTitle,playlistId,position,videoId,description)VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',[stamp,i===2?otherId:uId,ids[i],stamp,'UCAiFixture'+token,'合成影片'+i,'','合成AI頻道','PLfixture',0,ids[i],'合成']);
  await insertAi('oneday','2026-10-09','2026-10-09',[{事件:'舊版本',人物:['舊人物'],videoId:[ids[0]]}]);
  await insertAi('oneday','2026-10-09','2026-10-09',[{事件:'原始事件',人物:['人物甲','郭正亮','警方'],videoId:[ids[0],ids[1]]}]);
  dayPk=await insertAi('todate','2026-10-09','2026-10-09',[{事件:'最新當日事件',描述:'事件描述',分類:'民生',角度:'現場',陣營:'未知',人物:['人物乙'],關鍵字:['交通'],地名:['台北'],videoId:[ids[0],ids[2],'MissingAi01','bad']}]);
  await insertAi('oneday','2026-10-11','2026-10-11',[{事件:'未附引用',人物:['人物甲'],videoId:[]}]);
  await insertAi('oneday','2026-10-11','2026-10-11',[{事件:'刪除事件',人物:['刪除人物']}],1);
  weekPk=await insertAi('week','2026-10-01','2026-10-07',[{事件:'每週事件',videoId:[ids[0]]}]);
  topicPk=await insertAi('topic','2026-09-01','2026-09-07',{discussion_topics:[{標題:'總覽議題',內容:'既有描述',強弱:'強'}]});
  await insertAi('people','2026-09-02','2026-09-08',{persons:[{人名:'既有人物',角色:'角色',內容:'既有描述',評價:'無法判斷',分數:null}]});
  await insertAi('aspect','2026-09-03','2026-09-09',{政治:[{項目:'觀察項目',描述:'既有分析',偏好度:5}]});
  await insertAi('topic','2026-09-04','2026-09-10',{discussion_topics:[{標題:'刪除總覽'}]},1);
  withheldPk=await insertAi('oneday','2026-10-12','2026-10-12',[{事件:'未發布事件',人物:['不可見'],videoId:[ids[0]]}]);
  const runId=createHash('sha256').update(token).digest('hex');runIds.push(runId);
  const key={date_from:'2026-10-12 00:00:00',date_to:'2026-10-12 23:59:59',data_type:'oneday',user_token:'CLI',u_id:uId};
  await db.execute('INSERT INTO ts_ai_runs(run_id,workflow,business_key_sha256,input_sha256,input_json,status,target_pk,result_json,created_at,updated_at)VALUES(?,?,?,?,?,?,?,?,?,?)',[runId,'ai.channel',aiBusinessKey('urt_channel_ai',key),'a'.repeat(64),'{}','validated',withheldPk,JSON.stringify([{事件:'未發布事件',人物:['不可見'],videoId:[ids[0]]}]),stamp,stamp]);
 });
 afterAll(async()=>{await app.close();if(db){for(const id of runIds)await db.execute('DELETE FROM ts_ai_runs WHERE run_id=?',[id]);for(const pk of aiIds)await db.execute('DELETE FROM urt_channel_ai WHERE pk=?',[pk]);for(const id of ids)await db.execute('DELETE FROM urt_video WHERE BINARY videoId=BINARY ?',[id]);for(const id of [uId,otherId].filter(Boolean))await db.execute('DELETE FROM urt_channel WHERE u_id=?',[id]);await db.end();}});
 async function get(path:string){const response=await app.inject(`/api/v1/channels/${uId}/${path}`);expect(response.statusCode,response.body).toBe(200);return response.json();}
 it('plain overview selects independent latest topic/people/aspect, periods and stored-only links',async()=>{
  const {data,meta}=await get('ai');expect(data.rows.map((r:any)=>r.title)).toEqual(['總覽議題']);expect(data.sections[0].rows[0]).toMatchObject({name:'既有人物',score:null});expect(data.sections[1].rows[0]).toMatchObject({item:'觀察項目',preference:5});expect(data.sections[2].rows.map((r:any)=>r.from).sort()).toEqual(['2026-09-01 00:00:00','2026-09-02 00:00:00','2026-09-03 00:00:00']);expect(meta.coverage).toMatchObject({sourceRows:3,topicAvailable:true,peopleAvailable:true,aspectAvailable:true});
  expect((await get('ai?pk='+topicPk)).data.rows[0].source.href).toBe(`/channels/${uId}/ai?pk=${topicPk}`);
 });
 it('daily date chooses newest todate/oneday, retains full fields and reference coverage',async()=>{
  for(const path of ['ai/days?date=2026-10-09','ai?date=2026-10-09&days=1']){const {data,meta}=await get(path);expect(data.rows).toHaveLength(1);expect(data.rows[0]).toMatchObject({title:'最新當日事件',description:'事件描述',category:'民生',angle:'現場',places:'台北',videos:3});expect(data.rows[0].source.href).toBe(`/channels/${uId}/ai/days?pk=${dayPk}`);expect(meta.coverage).toMatchObject({referencedVideos:3,resolvedVideos:1,unresolvedVideos:2,invalidReferences:1});expect(data.sections[1].rows.map((r:any)=>r.status)).toEqual(['本地同頻道影片','所屬頻道不符','本地來源缺漏']);}
 });
 it('daily supports exact source citation and stored week, never infers absent daily output',async()=>{
  expect((await get('ai/days?pk='+dayPk)).data.rows[0].title).toBe('最新當日事件');expect((await get('ai/days?pk='+aiIds[0])).data.sections[0].rows[0].revision).toBe('已有較新紀錄');expect((await get('ai/days?type=week')).data.rows[0].source.href).toContain(String(weekPk));
  expect((await get('ai/days?date=2026-10-10')).data.rows).toEqual([]);expect((await get('ai/days?date=2026-10-10')).meta.coverage.observedDays).toBe(0);
 });
 it('people uses oneday latest revisions, complete exclusion list, missing-day null and actual reference counts',async()=>{
  const {data,meta}=await get('people?date=2026-10-11&days=3');expect(data.rows).toEqual([{name:'人物甲',topics:2,videos:2,unreferencedTopics:1}]);expect(data.sections[0].rows).toEqual([{date:'2026-10-11',person_0:{value:0,detail:'1 個議題提及；0 部影片引用'}},{date:'2026-10-10',person_0:null},{date:'2026-10-09',person_0:{value:2,detail:'1 個議題提及；2 部影片引用'}}]);expect(meta.coverage).toMatchObject({observedDays:2,requestedDays:3,resolvedVideos:2});
 });
 it('automatic dates skip unpublished newer rows and channel profile exposes stored overview and daily availability',async()=>{
  const daily=await get('ai/days');expect(daily.data.rows[0].title).toBe('未附引用');expect(daily.meta.coverage.newerUnavailableSources).toBe(1);expect((await get('people')).data.period.to).toBe('2026-10-11');
  const response=await app.inject(`/api/v1/channels/${uId}`);expect(response.statusCode,response.body).toBe(200);const d=response.json().data;expect(d.aiSummary.rows[0].title).toBe('總覽議題');expect(d.dailySummary.rows[0].title).toBe('未附引用');expect(d.trendAvailable).toBe(false);
 });
 it('failed same-key attempts do not hide existing rows; unknown insert projections remain withheld',async()=>{
  const key={date_from:'2026-10-09 00:00:00',date_to:'2026-10-09 23:59:59',data_type:'todate',user_token:'CLI',u_id:uId},runId=createHash('sha256').update(token+'failed').digest('hex');runIds.push(runId);
  await db.execute('INSERT INTO ts_ai_runs(run_id,workflow,business_key_sha256,input_sha256,input_json,status,target_pk,result_json,created_at,updated_at)VALUES(?,?,?,?,?,?,?,?,?,?)',[runId,'ai.channel',aiBusinessKey('urt_channel_ai',key),'b'.repeat(64),'{}','failed',null,null,stamp,stamp]);
  expect((await get('ai/days?pk='+dayPk)).data.rows[0].title).toBe('最新當日事件');
  const [rows]=await db.query<any[]>('SELECT result_json FROM urt_channel_ai WHERE pk=?',[dayPk]);
  await db.execute("UPDATE ts_ai_runs SET status='validated',target_pk=?,result_json=? WHERE run_id=?",[dayPk,JSON.stringify([{事件:'未寫入的新輸出'}]),runId]);expect((await get('ai/days?pk='+dayPk)).data.rows[0].title).toBe('最新當日事件');
  await db.execute("UPDATE ts_ai_runs SET status='validated',target_pk=NULL,result_json=? WHERE run_id=?",[rows[0].result_json,runId]);expect((await get('ai/days?pk='+dayPk)).meta.coverage.withheldSources).toBe(1);
  await db.execute("UPDATE ts_ai_runs SET status='published',target_pk=? WHERE run_id=?",[withheldPk+1000000,runId]);expect((await get('ai/days?pk='+dayPk)).data.rows[0].title).toBe('最新當日事件');
 });
 it('withholds uncommitted TypeScript projections until matching published output exists',async()=>{
  expect((await get('ai/days?pk='+withheldPk)).data.rows).toEqual([]);expect((await get('ai/days?pk='+withheldPk)).meta.coverage.withheldSources).toBe(1);
  await db.execute("UPDATE ts_ai_runs SET status='published' WHERE run_id=?",[runIds[0]]);
  try{expect((await get('ai/days?pk='+withheldPk)).data.rows[0].title).toBe('未發布事件');await db.execute('UPDATE urt_channel_ai SET result_json=? WHERE pk=?',[JSON.stringify([{事件:'投影已改寫'}]),withheldPk]);expect((await get('ai/days?pk='+withheldPk)).meta.coverage.divergedSources).toBe(1);}finally{await db.execute("UPDATE ts_ai_runs SET status='validated' WHERE run_id=?",[runIds[0]]);const [run]=await db.query<any[]>('SELECT result_json FROM ts_ai_runs WHERE run_id=?',[runIds[0]]);await db.execute('UPDATE urt_channel_ai SET result_json=? WHERE pk=?',[run[0].result_json,withheldPk]);}
 });
 it('withheld dates have explicit matrix status and publication comparison preserves four-byte output',async()=>{
  const pending=await get('people?date=2026-10-12&days=4');expect(pending.data.sections[0].rows[0].person_0).toEqual({value:null,detail:'分析尚未發布'});expect(pending.data.sourceAvailability[0]).toMatchObject({status:'pending',reasons:['pending'],label:'分析尚未發布'});
  const emoji=JSON.stringify([{事件:'測試😀𠀀',人物:['測試人物'],videoId:[]}]);
  const [before]=await db.query<any[]>('SELECT result_json,status FROM ts_ai_runs WHERE run_id=?',[runIds[0]]);
  try{await db.execute('UPDATE urt_channel_ai SET result_json=? WHERE pk=?',[emoji,withheldPk]);await db.execute("UPDATE ts_ai_runs SET status='published',result_json=? WHERE run_id=?",[emoji,runIds[0]]);expect((await get('ai/days?pk='+withheldPk)).data.rows[0].title).toBe('測試😀𠀀');}
  finally{await db.execute('UPDATE urt_channel_ai SET result_json=? WHERE pk=?',[before[0].result_json,withheldPk]);await db.execute('UPDATE ts_ai_runs SET status=?,result_json=? WHERE run_id=?',[before[0].status,before[0].result_json,runIds[0]]);}
 });
 it('more than two thousand historical attempts do not make a visible legacy report unavailable',async()=>{
  const key={date_from:'2026-09-01 00:00:00',date_to:'2026-09-07 23:59:59',data_type:'topic',user_token:'CLI',u_id:uId},fields=[] as string[],batch=[] as string[];
  for(let i=0;i<2001;i++){const runId=createHash('sha256').update(token+'history'+i).digest('hex');batch.push(runId);fields.push(runId,'ai.channel',aiBusinessKey('urt_channel_ai',key),'c'.repeat(64),'{}','failed',stamp,stamp);}
  try{await db.execute('INSERT INTO ts_ai_runs(run_id,workflow,business_key_sha256,input_sha256,input_json,status,created_at,updated_at)VALUES'+batch.map(()=>'(?,?,?,?,?,?,?,?)').join(','),fields);expect((await get('ai?pk='+topicPk)).data.rows[0].title).toBe('總覽議題');}
  finally{await db.execute('DELETE FROM ts_ai_runs WHERE run_id IN('+batch.map(()=>'?').join(',')+')',batch);}
 });
 it('channel profiles degrade each optional AI block only for explicit bounds and missing publication sidecar',async()=>{
  for(const fault of ['missing-sidecar','bound','daily-bound','unknown-column'] as const){
   const base=createReader(url),dialect=new MySqlDialect();
   const reader={close:()=>base.close(),rows:async<T extends Row>(query:SQL):Promise<T[]>=>{
    const compiled=dialect.sqlToQuery(query).sql;
    if(compiled.includes('FROM ts_ai_runs')){if(fault==='missing-sidecar')return base.rows<T>(sql.raw('SELECT run_id FROM ts_ai_absent_fixture_'+token));if(fault==='unknown-column')throw new DataQueryFailed('ER_BAD_FIELD_ERROR');}
    if(fault==='bound'&&compiled.includes('GROUP BY data_type'))return Array.from({length:401},()=>({pk:topicPk,u_id:uId,result_json:'[]'})) as unknown as T[];
    if(fault==='daily-bound'&&compiled.includes('FROM urt_channel_ai')&&compiled.includes('LIMIT 91'))return [{pk:dayPk,u_id:uId,result_json:'x'.repeat(17*1024*1024),date_from:'2026-10-09 00:00:00'}] as unknown as T[];
    return base.rows<T>(query);
   }},profile=buildApp({reader,dataset:'fixture'});
   try{const response=await profile.inject(`/api/v1/channels/${uId}`);expect(response.statusCode,response.body).toBe(fault==='unknown-column'?500:200);
    if(fault!=='unknown-column'){const d=response.json().data;expect(d.channel.id).toBe(uId);expect(d.videos.length).toBe(2);expect(d.aiSummary.evidenceCoverage.status).toBe(fault==='daily-bound'?'available':fault==='bound'?'bounded':'unavailable');const degraded=fault==='daily-bound'?d.dailySummary:d.aiSummary;expect(degraded.evidenceCoverage.sourceRows).toBeNull();expect(degraded.notes.join(' ')).toContain('頻道基本資料與影片仍可瀏覽');if(fault==='bound')expect(d.dailySummary.rows.length).toBeGreaterThan(0);if(fault==='missing-sidecar')expect(d.dailySummary.evidenceCoverage.status).toBe('unavailable');if(fault==='daily-bound')expect(d.dailySummary.evidenceCoverage.status).toBe('bounded');if(fault==='bound'||fault==='daily-bound')expect((await profile.inject(`/api/v1/channels/${uId}/ai${fault==='daily-bound'?'/days':''}`)).statusCode).toBe(400);}
   }finally{await profile.close();}
  }
 });
 it('rejects incompatible filters, unknown records and wrong channel source IDs',async()=>{
  for(const query of ['type=bogus','type=todate','type=week&date=2026-10-09','date=2026-02-30','pk='+dayPk+'&days=2'])expect((await app.inject(`/api/v1/channels/${uId}/ai/days?${query}`)).statusCode).toBe(400);
  expect((await app.inject(`/api/v1/channels/${uId}/people?limit=31`)).statusCode).toBe(400);expect((await app.inject(`/api/v1/channels/${otherId}/ai/days?pk=${dayPk}`)).statusCode).toBe(404);
 });
});
