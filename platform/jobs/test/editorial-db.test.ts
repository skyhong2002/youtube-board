import {describe,it,expect,beforeAll,beforeEach,afterAll} from 'vitest';
import {MySqlDialect} from 'drizzle-orm/mysql-core';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import type {Connection,RowDataPacket,ResultSetHeader} from 'mysql2/promise';
import {isolatedTestEnv} from '../../shared/test-database.js';
import {connectDatabase,withWriterLock} from '../src/database.js';
import {editorialTransaction,eventState,planEditorial,candidateState} from '../../shared/editorial/service.js';
import {adoptCandidate} from '../../shared/editorial/adoption.js';
import {YoutubeDataApiClient} from '../../ingestion/src/youtube.js';
import {buildApp} from '../../api/src/app.js';
import {registerEditorialOps} from '../../api/src/ops/editorial.js';
import {createReader} from '../../api/src/db/client.js';
const enabled=process.env.JOBS_DB_TEST==='1';
const tables=['ts_editorial_audit_events','ts_editorial_links','ts_editorial_sources','ts_editorial_audit','ts_editorial_requests','ts_editorial_candidates','ts_editorial_events'];
const channelId='UCED'+randomUUID().replaceAll('-','').slice(0,20),videoId='ED'+randomUUID().replaceAll('-','').slice(0,9),video2='ED'+randomUUID().replaceAll('-','').slice(0,9),run='editorial-test-'+randomUUID();
let dailyPk:number,eventPk:number,storyPk:number;
const now=new Date('2026-10-12T02:00:00Z'),base=(action:string,id=randomUUID())=>({action,id,requestId:randomUUID(),reason:'核對來源後審核'});
let db:Connection,env:NodeJS.ProcessEnv;
const execute=async(command:unknown)=>{const preview=await planEditorial(db,command);return editorialTransaction(db,command,'test-editor',preview.previewHash,now);};
const create=(id=randomUUID(),sources=[{kind:'video',sourceId:videoId}])=>({...base('create',id),title:'公共事件',sources});
async function approved(){const id=randomUUID();await execute({...base('candidate.submit',id),channelId,proposedName:'新聞候選'});await execute({...base('candidate.approve',id),expectedVersion:1});return {candidateId:id,expectedVersion:2,requestId:randomUUID()};}
const profile=()=>({id:channelId,snippet:{title:'來源頻道',description:'簡介',publishedAt:'2020-01-01T00:00:00Z'},contentDetails:{relatedPlaylists:{uploads:'UU'+channelId.slice(2)}},statistics:{viewCount:'5',videoCount:'1',subscriberCount:'2',hiddenSubscriberCount:false}});
function adoptionContext(onCall=()=>{}){const youtube=new YoutubeDataApiClient({keys:['fake-only'],now:()=>now,ledger:{precharge:async()=> '2026-10-11',markDailyExhausted:async()=>{}},fetcher:async()=>{onCall();return new Response(JSON.stringify({items:[profile()]}));}});return {db,execute:true,actor:'test-editor',now,assertOwnership:async()=>{},profiles:(ids:string[])=>youtube.channelProfiles(ids)};}
const adopt=async(input:Parameters<typeof adoptCandidate>[1],context=adoptionContext())=>withWriterLock(db,'youtube.source-and-caches',async source=>withWriterLock(db,'editorial.registry',async editorial=>adoptCandidate({...context,assertOwnership:async()=>{await source();await editorial();await context.assertOwnership();}},input)));
describe.skipIf(!enabled)('transactional editorial registry and reviewed source adoption',()=>{
 beforeAll(async()=>{
  env=isolatedTestEnv();db=await connectDatabase(env);
  for(const file of ['010_editorial.sql','011_editorial_audit_events.sql'])for(const statement of (await readFile(new URL('../migrations/'+file,import.meta.url),'utf8')).split(';').map(s=>s.trim()).filter(Boolean))await db.query(statement);
  for(const id of [videoId,video2])await db.execute("INSERT INTO urt_video(videoId,u_id,title,ctime,publishedAt,id,channelId,thumbnails,channelTitle,playlistId,position,description) VALUES(?,1,'原始影片標題','2026-10-11 12:00:00','2026-10-11 11:00:00','fixture','fixture','','來源媒體','fixture',0,'原始內容')",[id]);
  await db.execute("INSERT INTO ts_vocabulary_runs(id,window_since,window_until,status,published_at) VALUES(?,'2026-10-01T00:00:00Z','2026-10-12T00:00:00Z','published','2026-10-12 01:00:00')",[run]);
  const[daily]=await db.execute<ResultSetHeader>("INSERT INTO urt_ai_date(ctime,date_from,date_to,ai_type,data_type,user_token,channel_id,result_json) VALUES('2026-10-11 12:00:00','2026-10-11 00:00:00','2026-10-11 23:59:59','fixture','oneday','EDITORIAL_TEST','{}',?)",[JSON.stringify([{事件:'每日事件',videoId:[videoId]}])]);dailyPk=daily.insertId;
  const[event]=await db.execute<ResultSetHeader>("INSERT INTO urt_ai_event(ctime,date_from,date_to,aipk,event_name,ai_type,data_type,user_token,result_json) VALUES('2026-10-11 12:00:00','2026-10-11 00:00:00','2026-10-11 23:59:59',?,'事件分析','fixture','event','EDITORIAL_TEST','{}')",[dailyPk]);eventPk=event.insertId;
  const[story]=await db.execute<ResultSetHeader>("INSERT INTO telegram_digest_stories(story_key,canonical_title,fingerprint_json,video_ids_json,video_channels_json,observations_json,first_seen_at,last_seen_at) VALUES(?,'推播故事','{}',?,'{}','[]','2026-10-11 03:00:00','2026-10-11 04:00:00')",[run,JSON.stringify([videoId])]);storyPk=story.insertId;
  await db.execute('INSERT INTO ts_vocabulary_stage(run_id,article_id,payload) VALUES(?,?,?)',[run,'123',JSON.stringify({id:'123',media:'test-media',publishedAt:'2026-10-11T02:00:00Z',tags:['公共建設']})]);
 });
 beforeEach(async()=>{for(const table of tables)await db.query('TRUNCATE TABLE '+table);await db.execute('DELETE FROM urt_channel WHERE BINARY youtube_id=BINARY ?',[channelId]);await db.execute("UPDATE urt_video SET title='原始影片標題' WHERE BINARY videoId=BINARY ?",[videoId]);});
 afterAll(async()=>{if(!db)return;for(const table of tables)await db.query('TRUNCATE TABLE '+table);await db.execute('DELETE FROM urt_video WHERE BINARY videoId IN (?,?)',[videoId,video2]);await db.execute('DELETE FROM urt_channel WHERE BINARY youtube_id=BINARY ?',[channelId]);await db.execute('DELETE FROM urt_ai_event WHERE pk=?',[eventPk]);await db.execute('DELETE FROM urt_ai_date WHERE pk=?',[dailyPk]);await db.execute('DELETE FROM telegram_digest_stories WHERE id=?',[storyPk]);await db.execute('DELETE FROM ts_vocabulary_stage WHERE run_id=?',[run]);await db.execute('DELETE FROM ts_vocabulary_runs WHERE id=?',[run]);await db.end();});
 it('preview is read-only and changed source content invalidates approval',async()=>{
  const c=create(),p=await planEditorial(db,c);expect(p.after.events[0]!.sources).toHaveLength(1);
  for(const table of tables){const[r]=await db.query<RowDataPacket[]>('SELECT COUNT(*) AS n FROM '+table);expect(Number(r[0]!.n)).toBe(0);}
  await db.execute('UPDATE urt_video SET title=? WHERE BINARY videoId=BINARY ?',['來源新標題',videoId]);await expect(editorialTransaction(db,c,'test-editor',p.previewHash,now)).rejects.toMatchObject({code:'PREVIEW_CHANGED'});expect(await eventState(db,c.id)).toBeNull();
  await execute(c);expect((await eventState(db,c.id))?.version).toBe(1);
 });
 it('request UUID replays exactly once and rejects changed command or actor',async()=>{
  const c=create(),p=await planEditorial(db,c);await editorialTransaction(db,c,'test-editor',p.previewHash,now);expect((await editorialTransaction(db,c,'test-editor',p.previewHash,now)).replayed).toBe(true);
  await expect(editorialTransaction(db,{...c,title:'不同'},'test-editor',p.previewHash,now)).rejects.toMatchObject({code:'REQUEST_ID_CONFLICT'});await expect(editorialTransaction(db,c,'other-editor',p.previewHash,now)).rejects.toMatchObject({code:'REQUEST_ID_CONFLICT'});
  const[r]=await db.query<RowDataPacket[]>('SELECT COUNT(*) AS n FROM ts_editorial_audit');expect(Number(r[0]!.n)).toBe(1);
 });
 it('rename versions reject stale commands and immutable audit/source/request records reject mutations',async()=>{
  const c=create();await execute(c);await execute({...base('rename',c.id),expectedVersion:1,title:'審核後名稱'});expect((await eventState(db,c.id))?.title).toBe('審核後名稱');
  await expect(planEditorial(db,{...base('rename',c.id),expectedVersion:1,title:'過期修改'})).rejects.toMatchObject({code:'VERSION_CONFLICT'});
  await expect(db.query("UPDATE ts_editorial_audit SET actor='tampered'")).rejects.toThrow('append only');await expect(db.query('DELETE FROM ts_editorial_sources')).rejects.toThrow('immutable');await expect(db.query('DELETE FROM ts_editorial_requests')).rejects.toThrow('immutable');
 });
 it('merge resolves all previous URLs and split moves only selected refs with complete history',async()=>{
  const a=create(),b=create(randomUUID(),[{kind:'video',sourceId:video2}]),c=create();await execute(a);await execute(b);await execute(c);
  const merge={...base('merge',a.id),targetId:b.id,expectedVersion:1,targetVersion:1},preview=await planEditorial(db,merge);expect(preview.warnings).toHaveLength(1);expect(preview.warnings[0]).toContain('不可復原');expect(preview.warnings[0]).toContain('拆分');
  await editorialTransaction(db,merge,'test-editor',preview.previewHash,now);expect((await eventState(db,b.id))?.sources).toHaveLength(2);
  await execute({...base('merge',b.id),targetId:c.id,expectedVersion:2,targetVersion:1});expect((await eventState(db,a.id))?.mergedInto).toBe(c.id);expect((await eventState(db,b.id))?.mergedInto).toBe(c.id);
  const before=(await eventState(db,c.id))!,newId=randomUUID(),selected=before.sources[0]!;await execute({...base('split',c.id),title:'拆分事件',targetId:newId,expectedVersion:before.version,sourceIds:[selected]});expect((await eventState(db,newId))?.sources).toEqual([selected]);expect((await eventState(db,c.id))?.sources).not.toContain(selected);
  const[r]=await db.query<RowDataPacket[]>('SELECT active FROM ts_editorial_links WHERE event_id=? AND source_id=?',[c.id,selected]);expect(Number(r[0]!.active)).toBe(0);
  const[audit]=await db.query<RowDataPacket[]>("SELECT before_json,after_json FROM ts_editorial_audit WHERE action='split'");expect(JSON.parse(audit[0]!.before_json).events[0].sources).toContain(selected);expect(JSON.parse(audit[0]!.after_json).events[0].id).toBe(newId);
 });
 it('article references verify exact maintained snapshot and label transcribed titles separately',async()=>{
  const c={...create(),sources:[{kind:'article',sourceId:'123',headline:'報導標題轉錄',url:'https://news.example/123',sourceVersion:run}]};const p=await planEditorial(db,c);expect(p.resolved[0]?.provenance).toMatchObject({source:'https://tag.observe.tw',sourceVersion:run,headlineEvidence:'operator-transcribed',tags:['公共建設']});await execute(c);
  await expect(planEditorial(db,{...create(),sources:[{...c.sources[0],sourceVersion:'missing'}]})).rejects.toMatchObject({code:'ARTICLE_SNAPSHOT_NOT_FOUND'});
 });
 it('same exact source needs explicit refresh and merge retains only target observation',async()=>{
  const a=create();await execute(a);const old=(await eventState(db,a.id))!.sources[0]!;await expect(planEditorial(db,{...base('refresh',a.id),expectedVersion:1,sources:[{kind:'video',sourceId:videoId}]})).rejects.toMatchObject({code:'REFRESH_UNCHANGED'});const[auditBefore]=await db.query<RowDataPacket[]>('SELECT COUNT(*) AS n FROM ts_editorial_audit');expect(Number(auditBefore[0]!.n)).toBe(1);
  await db.execute("UPDATE urt_video SET title='新標題' WHERE BINARY videoId=BINARY ?",[videoId]);
  await expect(planEditorial(db,{...base('attach',a.id),expectedVersion:1,sources:[{kind:'video',sourceId:videoId}]})).rejects.toMatchObject({code:'SOURCE_ALREADY_LINKED'});
  await execute({...base('refresh',a.id),expectedVersion:1,sources:[{kind:'video',sourceId:videoId}]});const refreshed=(await eventState(db,a.id))!.sources;expect(refreshed).toHaveLength(1);expect(refreshed).not.toContain(old);
  const[archived]=await db.query<RowDataPacket[]>('SELECT active FROM ts_editorial_links WHERE event_id=? AND source_id=?',[a.id,old]);expect(Number(archived[0]!.active)).toBe(0);
  await db.execute("UPDATE urt_video SET title='第三版' WHERE BINARY videoId=BINARY ?",[videoId]);const b=create();await execute(b);const target=(await eventState(db,b.id))!.sources;await execute({...base('merge',a.id),targetId:b.id,expectedVersion:2,targetVersion:1});expect((await eventState(db,b.id))!.sources).toEqual(target);
 });
 it('daily/event/story refs preserve exact source IDs and Taipei/UTC timestamps',async()=>{
  const p=await planEditorial(db,{...create(),sources:[{kind:'daily',sourceId:dailyPk+':0'},{kind:'event',sourceId:String(eventPk)},{kind:'story',sourceId:String(storyPk)},{kind:'video',sourceId:videoId}]});
  expect(p.resolved[0]).toMatchObject({publishedAt:'2026-10-10 16:00:00.000',observedAt:'2026-10-11 04:00:00.000',headline:'每日事件',url:'/ai/events/'+dailyPk+'?event='+encodeURIComponent('每日事件')});
  expect(p.resolved[1]).toMatchObject({publishedAt:'2026-10-10 16:00:00.000',headline:'事件分析'});expect(p.resolved[2]).toMatchObject({publishedAt:'2026-10-11 03:00:00',observedAt:'2026-10-11 03:00:00',headline:'推播故事',provenance:{observationMeaning:'first-seen',snapshotScope:'stable-story-reference'}});expect(p.resolved[3]).toMatchObject({publishedAt:'2026-10-11 03:00:00.000'});
  await expect(planEditorial(db,{...create(),sources:[{kind:'daily',sourceId:dailyPk+':1'}]})).rejects.toMatchObject({code:'DAILY_EVENT_NOT_FOUND'});
 });
 it('hourly story polling preserves the approved reference while title changes require a new preview',async()=>{
  const command={...create(),sources:[{kind:'story',sourceId:String(storyPk)}]},preview=await planEditorial(db,command);
  expect(Object.keys(preview.resolved[0]!.snapshot as object).sort()).toEqual(['canonical_title','first_seen_at','id','story_key']);
  await db.execute("UPDATE telegram_digest_stories SET last_seen_at='2026-10-12 05:00:00',video_ids_json=?,observations_json='[{\"hour\":5}]' WHERE id=?",[JSON.stringify([videoId,video2]),storyPk]);
  expect((await planEditorial(db,command)).previewHash).toBe(preview.previewHash);await editorialTransaction(db,command,'test-editor',preview.previewHash,now);
  const changed={...create(),sources:command.sources},next=await planEditorial(db,changed);
  await db.execute("UPDATE telegram_digest_stories SET canonical_title='新故事標題' WHERE id=?",[storyPk]);
  try{await expect(editorialTransaction(db,changed,'test-editor',next.previewHash,now)).rejects.toMatchObject({code:'PREVIEW_CHANGED'});}finally{await db.execute("UPDATE telegram_digest_stories SET canonical_title='推播故事' WHERE id=?",[storyPk]);}
 });
 it('merge aliases reject further edits and resolve all original public URLs',async()=>{
  const a=create(),b=create(),c=create();await execute(a);await execute(b);await execute(c);await execute({...base('merge',a.id),targetId:b.id,expectedVersion:1,targetVersion:1});await execute({...base('merge',b.id),targetId:c.id,expectedVersion:2,targetVersion:1});
  await expect(planEditorial(db,{...base('rename',a.id),expectedVersion:3,title:'forbidden'})).rejects.toMatchObject({code:'EVENT_MERGED'});
  const reader=createReader(`mysql://${encodeURIComponent(env.DB_USERNAME!)}:${encodeURIComponent(env.DB_PASSWORD!)}@127.0.0.1:23306/youtube_board_test_rewrite`),app=buildApp({reader,dataset:'fixture'});try{for(const id of [a.id,b.id]){const r=await app.inject('/api/v1/editorial/events/'+id);expect(r.statusCode).toBe(200);expect(r.json().data.canonicalId).toBe(c.id);expect(r.json().data.history).toHaveLength(5);}}finally{await app.close();}
 });
 it('retired existing channels and provider-missing candidates fail before source writes',async()=>{
  const input=await approved();const ctx=adoptionContext();await expect(adopt(input,{...ctx,profiles:async()=>new Map()})).rejects.toMatchObject({code:'PROVIDER_CHANNEL_MISSING'});expect((await candidateState(db,input.candidateId))?.status).toBe('approved');
  await db.execute("INSERT INTO urt_channel(ctime,youtube_id,title,flag_del) VALUES('2026-10-11 12:00:00',?,'retired',1)",[channelId]);let calls=0;await expect(adopt(input,adoptionContext(()=>calls++))).rejects.toMatchObject({code:'EXISTING_CHANNEL_RETIRED'});expect(calls).toBe(0);
 });
 it('hidden subscribers without thumbnail remain NULL during adoption',async()=>{
  const input=await approved(),ctx=adoptionContext();const profiles=await ctx.profiles([channelId]),p=profiles.get(channelId)!;profiles.set(channelId,{...p,thumbnail:null,statistics:{...p.statistics,subscriberCount:null,hiddenSubscriberCount:true}});await adopt(input,{...ctx,profiles:async()=>profiles});const[r]=await db.query<RowDataPacket[]>('SELECT subscriberCount,thumbnails FROM urt_channel WHERE BINARY youtube_id=BINARY ?',[channelId]);expect(r[0]).toMatchObject({subscriberCount:null,thumbnails:null});
 });
 it('same-named daily topics retain exact index without misleading name-based links',async()=>{
  const[old]=await db.query<RowDataPacket[]>('SELECT result_json FROM urt_ai_date WHERE pk=?',[dailyPk]);try{
   await db.execute('UPDATE urt_ai_date SET result_json=? WHERE pk=?',[JSON.stringify([{事件:'同名',videoId:[videoId]},{事件:'同名',videoId:[video2]}]),dailyPk]);
   const plan=await planEditorial(db,{...create(),sources:[{kind:'daily',sourceId:dailyPk+':1'}]});expect(plan.resolved[0]).toMatchObject({url:null,provenance:{eventIndex:1,linkAmbiguous:true}});expect((plan.resolved[0]!.snapshot as {event:unknown}).event).toEqual({事件:'同名',videoId:[video2]});
  }finally{await db.execute('UPDATE urt_ai_date SET result_json=? WHERE pk=?',[old[0]!.result_json,dailyPk]);}
 });
 it('article observation epoch is stable across database session timezone changes',async()=>{
  const command={...create(),sources:[{kind:'article',sourceId:'123',headline:'轉錄',url:'https://news.example/123',sourceVersion:run}]},before=await planEditorial(db,command);await db.query("SET time_zone='+08:00'");try{const after=await planEditorial(db,command);expect(after.resolved[0]?.observedAt).toBe(before.resolved[0]?.observedAt);expect(after.previewHash).toBe(before.previewHash);}finally{await db.query("SET time_zone='+00:00'");}
 });
 it('candidate approval is audited and cannot be bypassed by source adoption',async()=>{
  const id=randomUUID();await execute({...base('candidate.submit',id),channelId,proposedName:'候選'});let calls=0;const ctx=adoptionContext(()=>calls++);
  await expect(adopt({candidateId:id,expectedVersion:1,requestId:randomUUID()},ctx)).rejects.toMatchObject({code:'CANDIDATE_NOT_APPROVED'});expect(calls).toBe(0);
  await execute({...base('candidate.reject',id),expectedVersion:1});expect((await candidateState(db,id))?.status).toBe('rejected');await expect(planEditorial(db,{...base('candidate.submit'),channelId,proposedName:'重新提名'})).rejects.toMatchObject({code:'CANDIDATE_EXISTS'});await expect(planEditorial(db,{...base('candidate.approve',id),expectedVersion:2})).rejects.toMatchObject({code:'CANDIDATE_ALREADY_DECIDED'});
 });
 it('approved adoption previews without external calls then fetches fake Google and replays without calls',async()=>{
  const input=await approved();let calls=0;const ctx=adoptionContext(()=>calls++);expect(await adopt(input,{...ctx,execute:false})).toMatchObject({mode:'dry-run',externalCalls:0,writes:0});expect(calls).toBe(0);
  const result=await adopt(input,ctx);expect(calls).toBe(1);expect(result.candidate.status).toBe('adopted');expect((await adopt(input,ctx)).replayed).toBe(true);expect(calls).toBe(1);
  const[r]=await db.query<RowDataPacket[]>('SELECT title,uploads FROM urt_channel WHERE BINARY youtube_id=BINARY ?',[channelId]);expect(r).toHaveLength(1);expect(r[0]!.title).toBe('來源頻道');expect(r[0]!.uploads).toBe('UU'+channelId.slice(2));
 });
 it('interrupted nontransactional channel insert is repaired on replay without duplicate channel',async()=>{
  const input=await approved();let checks=0;await expect(adopt(input,{...adoptionContext(),assertOwnership:async()=>{if(++checks===3)throw new Error('interrupted');}})).rejects.toThrow('interrupted');expect((await candidateState(db,input.candidateId))?.status).toBe('approved');
  const[before]=await db.query<RowDataPacket[]>('SELECT u_id FROM urt_channel WHERE BINARY youtube_id=BINARY ?',[channelId]);expect(before).toHaveLength(1);const result=await adopt(input);expect(result.uId).toBe(before[0]!.u_id);
 });
 it('public timeline exposes source evidence and resolves alias without exposing operator identity',async()=>{
  const a=create(),b=create();await execute(a);await execute(b);await execute({...base('merge',a.id),targetId:b.id,expectedVersion:1,targetVersion:1});
  const url=`mysql://${encodeURIComponent(env.DB_USERNAME!)}:${encodeURIComponent(env.DB_PASSWORD!)}@127.0.0.1:23306/youtube_board_test_rewrite`,app=buildApp({reader:createReader(url),dataset:'fixture'});
  try{const response=await app.inject('/api/v1/editorial/events/'+a.id);expect(response.statusCode).toBe(200);const data=response.json().data;expect(data.canonicalId).toBe(b.id);expect(data.sources[0].headline).toBe('原始影片標題');expect(data.sources[0].published_at).toBe('2026-10-11T03:00:00.000Z');expect(data.event.created_at).toBe('2026-10-12T02:00:00.000Z');expect(response.body).not.toContain('test-editor');expect(data.history.length).toBe(3);const x=data.history.filter((h:{action:string})=>h.action==='create');expect(x).toHaveLength(2);}finally{await app.close();}
 });
 it('audit event index backfills existing before/after states and remains append only',async()=>{
  const a=create(),b=create();await execute(a);await execute(b);await execute({...base('merge',a.id),targetId:b.id,expectedVersion:1,targetVersion:1});
  const [original]=await db.query<RowDataPacket[]>('SELECT sequence,event_id FROM ts_editorial_audit_events ORDER BY event_id,sequence');expect(original).toHaveLength(4);
  await db.query('TRUNCATE TABLE ts_editorial_audit_events');
  for(let pass=0;pass<2;pass++)for(const statement of (await readFile(new URL('../migrations/011_editorial_audit_events.sql',import.meta.url),'utf8')).split(';').map(s=>s.trim()).filter(Boolean))await db.query(statement);
  const [restored]=await db.query<RowDataPacket[]>('SELECT sequence,event_id FROM ts_editorial_audit_events ORDER BY event_id,sequence');expect(restored).toEqual(original);
  await expect(db.query('DELETE FROM ts_editorial_audit_events')).rejects.toThrow('append only');
  const [plan]=await db.query<RowDataPacket[]>('EXPLAIN SELECT sequence FROM ts_editorial_audit_events WHERE event_id=? ORDER BY sequence DESC LIMIT 100',[a.id]);expect(plan[0]!.key).toBe('PRIMARY');
 });
 it('indexed public history returns the latest100 related changes only',async()=>{
  const a=create(),unrelated=create();await execute(a);await execute(unrelated);
  for(let i=0;i<105;i++)await execute({...base('rename',a.id),expectedVersion:i+1,title:'版本'+i});
  const app=buildApp({databaseUrl:process.env.TEST_DATABASE_URL??`mysql://${encodeURIComponent(env.DB_USERNAME!)}:${encodeURIComponent(env.DB_PASSWORD!)}@127.0.0.1:23306/youtube_board_test_rewrite`,dataset:'fixture'});
  try{const response=await app.inject('/api/v1/editorial/events/'+a.id);expect(response.statusCode).toBe(200);const history=response.json().data.history;expect(history).toHaveLength(100);expect(history[0].after[0].title).toBe('版本104');expect(history.at(-1).after[0].title).toBe('版本5');expect(history.every((h:any)=>h.action==='rename')).toBe(true);}finally{await app.close();}
 });
 it('index insertion failure rolls back the event, links, audit and request atomically',async()=>{
  const command=create(),preview=await planEditorial(db,command);
  const failing=new Proxy(db,{get(target,key){if(key==='execute')return (statement:string,values:any)=>statement.startsWith('INSERT INTO ts_editorial_audit_events')?Promise.reject(new Error('injected index failure')):target.execute(statement,values);const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;}});
  await expect(editorialTransaction(failing,command,'test-editor',preview.previewHash,now)).rejects.toThrow('injected index failure');
  for(const table of tables){const [rows]=await db.query<RowDataPacket[]>('SELECT COUNT(*) AS n FROM '+table);expect(Number(rows[0]!.n)).toBe(0);}
 });
 it('concurrent editorial revision changes return409 rather than a mixed public snapshot',async()=>{
  const c=create();await execute(c);const reader=createReader(`mysql://${encodeURIComponent(env.DB_USERNAME!)}:${encodeURIComponent(env.DB_PASSWORD!)}@127.0.0.1:23306/youtube_board_test_rewrite`),original=reader.rows.bind(reader);let changed=false;
  reader.rows=async query=>{const rows=await original(query);if(!changed&&new MySqlDialect().sqlToQuery(query).sql.includes('SELECT a.sequence')){changed=true;await execute({...base('rename',c.id),expectedVersion:1,title:'concurrent revision'});}return rows as any;};
  const app=buildApp({reader,dataset:'fixture'});try{expect((await app.inject('/api/v1/editorial/events/'+c.id)).statusCode).toBe(409);expect((await app.inject('/api/v1/editorial/events/'+c.id)).statusCode).toBe(200);}finally{await app.close();}
 });
 it('merged multi-event history deduplicates shared audits and orders global top100',async()=>{
  const a=create(),b=create();await execute(a);await execute(b);for(let i=0;i<60;i++){await execute({...base('rename',a.id),expectedVersion:i+1,title:'a'+i});await execute({...base('rename',b.id),expectedVersion:i+1,title:'b'+i});}
  await execute({...base('merge',a.id),targetId:b.id,expectedVersion:61,targetVersion:61});
  const [expected]=await db.query<RowDataPacket[]>('SELECT action,after_json FROM ts_editorial_audit ORDER BY sequence DESC LIMIT 100');
  const app=buildApp({databaseUrl:`mysql://${encodeURIComponent(env.DB_USERNAME!)}:${encodeURIComponent(env.DB_PASSWORD!)}@127.0.0.1:23306/youtube_board_test_rewrite`,dataset:'fixture'});try{const response=await app.inject('/api/v1/editorial/events/'+a.id);expect(response.statusCode).toBe(200);expect(response.json().data.history.map((h:any)=>({action:h.action,after:h.after}))).toEqual(expected.map(row=>({action:row.action,after:JSON.parse(row.after_json).events})));}finally{await app.close();}
 });
 it('authenticated API enforces preview + explicit gates and uses server actor',async()=>{
  const token='test-token-'.repeat(4),app=buildApp({reader:{rows:async()=>[],close:async()=>{}}});const settings={...env,TS_OPS_TOKEN:token,TS_OPS_ACTOR:'server-editor',TS_OPS_EXECUTION_ENABLED:'true',TS_OPS_WRITE_ALLOWLIST:'editorial.registry',TS_INGESTION_ENABLED:'true',TS_INGESTION_OWNERS:'editorial.registry'};
  await registerEditorialOps(app,{env:settings});const c=create(),headers={authorization:'Bearer '+token};try{
   const p=await app.inject({method:'POST',url:'/api/ops/editorial/preview',headers,payload:{command:c}});expect(p.statusCode).toBe(200);expect(p.json().actor).toBe('service:server-editor');expect(await eventState(db,c.id)).toBeNull();
   const other=await connectDatabase(env);try{await withWriterLock(other,'editorial.registry',async()=>{const busy=await app.inject({method:'POST',url:'/api/ops/editorial/execute',headers,payload:{command:c,previewHash:p.json().previewHash,execute:true}});expect(busy.statusCode).toBe(409);expect(busy.json().error.code).toBe('WRITER_BUSY');});}finally{await other.end();}
   const r=await app.inject({method:'POST',url:'/api/ops/editorial/execute',headers,payload:{command:c,previewHash:p.json().previewHash,execute:true}});expect(r.statusCode).toBe(200);const[audit]=await db.query<RowDataPacket[]>('SELECT actor FROM ts_editorial_audit WHERE request_id=?',[c.requestId]);expect(audit[0]?.actor).toBe('service:server-editor');const replay=await app.inject({method:'POST',url:'/api/ops/editorial/execute',headers,payload:{command:c,previewHash:p.json().previewHash,execute:true}});expect(replay.json().replayed).toBe(true);
  }finally{await app.close();}
 });
});
