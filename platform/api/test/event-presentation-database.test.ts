import {planEvent} from '../../ai/src/event.js';
import {derivedHash} from '../../ai/src/derived-runner.js';
import {describe,it,expect,beforeAll,beforeEach,afterAll} from 'vitest';
import mysql from 'mysql2/promise';
import {assertTestDatabaseUrl} from '../../shared/test-database.js';
import {aiBusinessKey,canonicalHash} from '../../shared/ai-business-key.js';
import {buildApp} from '../src/app.js';
const url=process.env.TEST_DATABASE_URL?assertTestDatabaseUrl(process.env.TEST_DATABASE_URL):undefined;
describe.skipIf(!url)('event presentation and source identity on MariaDB',()=>{
 const daily=988501,uid=988502,date='2220-01-02',from=date+' 00:00:00',to=date+' 23:59:59',token='EVENT_PRESENT',title='正式議題',dailyResult=JSON.stringify([{標題:title,媒體事件:{甲:['來源別名']}}]),app=buildApp({databaseUrl:url,dataset:'fixture'});let db:Awaited<ReturnType<typeof mysql.createConnection>>;
 const cleanup=async()=>{await db.query("DELETE FROM ts_ai_runs WHERE workflow='ai.event' AND target_pk BETWEEN 988510 AND 988599");await db.query("DELETE FROM ts_ai_runs WHERE run_id=?",['ep'.repeat(32)]);await db.query('DELETE FROM urt_ai_event WHERE pk BETWEEN 988510 AND 988599');await db.query('DELETE FROM urt_ai_date WHERE pk=?',[daily]);await db.query('DELETE FROM urt_channel_ai WHERE u_id=?',[uid]);await db.query('DELETE FROM urt_video WHERE u_id=?',[uid]);await db.query('DELETE FROM urt_channel WHERE u_id=?',[uid]);};
 const insert=async(pk:number,type:string,result:unknown,event=title,sourceToken=token)=>db.execute('INSERT INTO urt_ai_event(pk,aipk,event_name,ctime,date_from,date_to,prompt_type,ai_type,data_type,condition_type,user_token,result_json) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',[pk,daily,event,from,from,to,type,'test','oneday','all',sourceToken,JSON.stringify(result)]);
 const summary=(headline='儲存引文')=>({events:[{event:title,description:'儲存描述',keywords:['議題'],media:['甲'],fact:[{media:'甲',headline,video_id:'EventAa0001'}],opinion:[{media:'甲',stance:'中立',intensity:'低',content:'儲存觀點',video_id:'Eventaa0001'}]}]});
 const journal=async(pk:number,type:string,result:unknown,status='published',savedDaily=dailyResult)=>{
  const key={aipk:daily,event_name:title,prompt_type:type,condition_type:'all',user_token:token},source={daily:{pk:String(daily),date,from,to,condition:'all',userToken:token,runId:null,resultSha256:canonicalHash(savedDaily)},topic:{title,media:[{u_id:uid,channel:'甲',event:{事件:'來源別名',videoId:['EventAa0001','Eventaa0001']}}]},videos:[{videoId:'EventAa0001',u_id:uid,title:'快照大寫',publishedAt:from},{videoId:'Eventaa0001',u_id:uid,title:'快照小寫',publishedAt:from}],promptType:type},plan={workflow:'ai.event',table:'urt_ai_event',key,columns:{date_from:from,date_to:to},source},business=aiBusinessKey('urt_ai_event',key),inputHash=canonicalHash({version:'yt-ai-derived-v1',model:'sky-quality',plan}),run=canonicalHash({business,inputHash});
  await db.execute('INSERT INTO ts_ai_runs(run_id,workflow,business_key_sha256,input_sha256,input_json,status,result_json,target_pk,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)',[run,'ai.event',business,inputHash,JSON.stringify({version:'yt-ai-derived-v1',plan}),status,JSON.stringify(result),pk,from,from]);return run;
 };
 beforeAll(async()=>{db=await mysql.createConnection({uri:url!,dateStrings:true});});beforeEach(async()=>{await cleanup();await db.execute('INSERT INTO urt_channel(u_id,ctime,title,youtube_id) VALUES(?,?,?,?)',[uid,from,'甲','UCEventPresent']);await db.execute('INSERT INTO urt_ai_date(pk,ctime,date_from,date_to,data_type,condition_type,user_token,ai_type,channel_id,result_json) VALUES(?,?,?,?,?,?,?,?,?,?)',[daily,from,from,to,'oneday','all',token,'test',JSON.stringify({[uid]:'甲'}),dailyResult]);await db.execute('INSERT INTO urt_channel_ai(pk,u_id,ctime,date_from,date_to,data_type,user_token,ai_type,result_json) VALUES(?,?,?,?,?,?,?,?,?)',[uid,uid,from,from,to,'oneday',token,'test',JSON.stringify([{事件:'來源別名',videoId:['EventAa0001','Eventaa0001']}])]);for(const id of ['EventAa0001','Eventaa0001'])await db.execute("INSERT INTO urt_video(u_id,ctime,publishedAt,videoId,title,id,channelId,thumbnails,channelTitle,playlistId,position,description) VALUES(?,?,?,?,?,'fixture','fixture','','甲','fixture',0,'')",[uid,from,from,id,'目前影片'+id]);});
 afterAll(async()=>{await app.close();if(db){await cleanup();await db.end();}});
 const get=async(path:string)=>{const r=await app.inject('/api/v1/'+path);expect(r.statusCode,r.body).toBe(200);return r.json();};
 const dailyPath=(name=title)=>`ai/days/${daily}/events?event=${encodeURIComponent(name)}`;
 it('renders stored summary/people/media sections and exact case-distinct citations with source alias metadata',async()=>{
  await insert(988510,'summary',summary());await insert(988511,'people',{main_subject:title,supporting_persons:[{person:'某人',role:'来賓',support_or_opposition:'支持',strength:'中',description:'人物描述',videos:[{media:'甲',video_id:'EventAa0001'},{media:'甲',video_id:'Eventaa0001'}]}]});await insert(988512,'media',{main_subject:title,all_medias:['甲'],other_opinions_medias:[{media:'甲',support_or_opposition:'中立',strength:'低',description:'媒體描述'}]});
  const r=await get(dailyPath('來源別名'));expect(r.data.resolution).toMatchObject({requestedTitle:'來源別名',canonicalTitle:title,kind:'same-day-source-alias',sourceDailyId:daily});expect(r.data.presentation.media).toMatchObject({analysisId:988512,all:['甲']});expect(r.data.videos.map((v:any)=>v.id).sort()).toEqual(['EventAa0001','Eventaa0001']);expect(r.data.presentation.summaries[0].facts[0].citation.verification).toBe('stored-reference');
  const people=await get(`ai/events/${daily}/people?event=${encodeURIComponent('來源別名')}`);expect(people.data.rows).toHaveLength(2);expect(people.data.sections[0].rows[0]).toMatchObject({media:{value:'甲',sources:[{channelId:null,channelTitle:'甲',channelAvatar:null}]},description:'媒體描述'});
 });
 it('exact title takes precedence and alias ambiguity never guesses another source topic',async()=>{
  await insert(988510,'summary',summary(),'來源別名');expect((await get(dailyPath('來源別名'))).data.resolution.kind).toBe('exact');
  await db.execute('DELETE FROM urt_ai_event WHERE pk=988510');await db.execute('UPDATE urt_ai_date SET result_json=? WHERE pk=?',[JSON.stringify([{標題:title,媒體事件:{甲:['來源別名']}},{標題:'其他議題',媒體事件:{甲:['來源別名']}}]),daily]);expect((await app.inject('/api/v1/'+dailyPath('來源別名'))).statusCode).toBe(409);
 });
 it('pins requested eventPK despite newer revision and keeps dailyPK route semantics explicit',async()=>{
  await insert(988510,'summary',summary('舊修訂'));await insert(988511,'summary',summary('新修訂'));expect((await get('ai/events/988510')).data).toMatchObject({id:988510,idKind:'event',dailyId:daily,analyses:[{id:988510}]});expect((await get('ai/events/988510')).data.presentation.summaries[0].facts[0].headline).toBe('舊修訂');expect((await get(dailyPath())).data.analyses[0].id).toBe(988511);
 });
 it('uses byte-exact titles and tokens before latest-per-type selection',async()=>{
  await insert(988510,'summary',summary(),'ABC');await insert(988511,'summary',summary('wrong case'),'abc');await insert(988512,'summary',summary('wrong token'),'ABC',token.toLowerCase());expect((await get(dailyPath('ABC'))).data.analyses.map((a:any)=>a.id)).toEqual([988510]);
 });
 it('uses immutable snapshot citations and retains valid historical output when daily source changes',async()=>{
  await insert(988510,'summary',summary());await journal(988510,'summary',summary());await insert(988511,'media',{main_subject:title,all_medias:['甲']});await db.execute('UPDATE urt_ai_date SET result_json=? WHERE pk=?',[JSON.stringify([{標題:'較新的議題',媒體事件:{甲:['新的來源名稱']}}]),daily]);
  const r=await get('ai/events/988510');expect(r.meta.coverage).toMatchObject({sourceChanged:true,incompatibleSources:1});expect(r.data.topics).toEqual([]);expect(r.data.analyses[0].lineage).toMatchObject({state:'immutable-snapshot',sourceChanged:true});expect(r.data.analyses[0].lineage.sourceVideos[0].title).toBe('快照大寫');expect(r.data.presentation.summaries[0].facts[0].citation.verification).toBe('snapshot');
 });
 it('never applies a current daily alias to an older immutable event source',async()=>{
  await insert(988510,'summary',summary());await journal(988510,'summary',summary());await db.execute('UPDATE urt_ai_date SET result_json=? WHERE pk=?',[JSON.stringify([{標題:title,媒體事件:{甲:['新的別名']}}]),daily]);expect((await app.inject('/api/v1/'+dailyPath('新的別名'))).statusCode).toBe(409);
 });
 it('does not mix changed snapshot media with a legacy summary based on the current daily source',async()=>{
  await insert(988510,'summary',summary());const media={main_subject:title,all_medias:['甲']};await insert(988511,'media',media);await journal(988511,'media',media,'published','older-source');const r=await get(dailyPath());expect(r.meta.coverage.incompatibleSources).toBe(1);expect(r.data.presentation.media).toBeNull();
 });
 it('accepts the real writer plan and identical daily source hash without marking unchanged output stale',async()=>{
  const source=[{事件:'來源別名',描述:'描述',角度:'報導',陣營:'未知',分類:'議題',關鍵字:['議題'],人物:['某人'],地名:['台北'],類型:['新聞'],videoId:['EventAa0001','Eventaa0001']}];await db.execute('UPDATE urt_channel_ai SET result_json=? WHERE pk=?',[JSON.stringify(source),uid]);
  const plan=await planEvent(db,{date,userToken:token,event:title,promptType:'summary'}),business=aiBusinessKey(plan.table,plan.key),inputHash=derivedHash(plan),run=canonicalHash({business,inputHash});await insert(988510,'summary',summary());await db.execute('INSERT INTO ts_ai_runs(run_id,workflow,business_key_sha256,input_sha256,input_json,status,result_json,target_pk,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)',[run,'ai.event',business,inputHash,JSON.stringify({version:'yt-ai-derived-v1',plan}),'published',JSON.stringify(summary()),988510,from,from]);const r=await get('ai/events/988510');expect(r.data.analyses[0].lineage).toMatchObject({state:'immutable-snapshot',sourceChanged:false,runId:run});expect(r.meta.coverage.sourceChanged).toBe(false);expect(r.data.topics).toHaveLength(1);
 });
 it('direct event scope selects matching siblings and never borrows daily-token analyses',async()=>{
  await insert(988510,'summary',summary(),title,'OTHER');await insert(988511,'media',{main_subject:'wrong scope',all_medias:['甲']});await insert(988512,'media',{main_subject:'right scope',all_medias:['甲']},title,'OTHER');const r=await get('ai/events/988510');expect(r.meta.coverage.sourceScopeMismatch).toBe(true);expect(r.data.topics).toEqual([]);expect(r.data.presentation.media.mainSubject).toBe('right scope');
 });
 it('keeps older legacy eventPK readable when a newer revision has a published journal',async()=>{
  await insert(988510,'summary',summary('older'));await insert(988511,'summary',summary());await journal(988511,'summary',summary());const r=await get('ai/events/988510');expect(r.data.analyses[0]).toMatchObject({id:988510,lineage:{state:'legacy-unrecorded'}});expect(r.data.presentation.summaries[0].facts[0].headline).toBe('older');
 });
 it('withholds pending/diverged exact publications and never substitutes older same-type rows',async()=>{
  await insert(988510,'summary',summary('older'));await insert(988511,'summary',summary());const run=await journal(988511,'summary',summary(),'validated');let r=await get(dailyPath());expect(r.meta.coverage.unpublishedAnalyses).toBe(1);expect(r.data.analyses).toEqual([]);
  await db.execute("UPDATE ts_ai_runs SET status='published' WHERE run_id=?",[run]);await db.execute('UPDATE urt_ai_event SET result_json=? WHERE pk=988511',[JSON.stringify(summary('changed'))]);r=await get('ai/events/988511');expect(r.meta.coverage).toMatchObject({divergedAnalyses:1,pinnedUnavailable:true});expect(r.data.analyses).toEqual([]);expect(r.data.topics).toEqual([]);
 });
 it('rejects corrupt immutable snapshots and untrusted aliases on unavailable daily lineage',async()=>{
  await insert(988510,'summary',summary());const run=await journal(988510,'summary',summary());await db.execute('UPDATE ts_ai_runs SET input_sha256=? WHERE run_id=?',['0'.repeat(64),run]);expect((await get('ai/events/988510')).meta.coverage.snapshotUnavailableAnalyses).toBe(1);
  await db.execute('DELETE FROM urt_ai_event WHERE pk=988510');await db.execute('INSERT INTO ts_ai_runs(run_id,workflow,business_key_sha256,input_sha256,input_json,status,result_json,target_pk,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)',['ep'.repeat(32),'ai.daily',aiBusinessKey('urt_ai_date',{date_from:from,date_to:to,data_type:'oneday',condition_type:'all',user_token:token}),'b'.repeat(64),'{}','validated',dailyResult,daily,from,from]);expect((await app.inject('/api/v1/'+dailyPath('來源別名'))).statusCode).toBe(404);
 });
 it('keeps missing case-distinct citations unresolved and rejects excessive prompt types',async()=>{
  await insert(988510,'summary',summary());await db.execute("DELETE FROM urt_video WHERE BINARY videoId=BINARY 'EventAa0001'");expect((await get(dailyPath())).meta.coverage).toMatchObject({referencedVideos:2,resolvedVideos:1,unresolvedVideos:1});
  for(let i=0;i<31;i++)await insert(988520+i,'type'+i,{});expect((await get(dailyPath())).data.analyses).toHaveLength(32);await insert(988551,'type31',{});expect((await app.inject('/api/v1/'+dailyPath())).statusCode).toBe(422);
 });
});
