import { channelUploadsJob } from '../src/channel-jobs.js';
import { selectPhotoTerms,channelPredictionSummary, photosCacheJob, predictionsCacheJob, safeWikipediaImage, wikipediaPhoto } from '../src/photos-predictions.js';
import { channelReport } from '../../api/src/legacy/channel.js';
import { it,expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import mysql,{type RowDataPacket} from 'mysql2/promise';
import { isolatedTestEnv } from '../../shared/test-database.js';
import { reportCacheKey } from '../../shared/report-cache-key.js';
import { channelDeltas, countsCacheJob, liveCacheCleanJob, liveDayMetrics, liveDisplayCacheJob, liveTagDateCacheJob, scheduleCacheJob } from '../src/maintenance-caches.js';
import { keywordRelationCacheJob,keywordsCacheJob,cloudCacheJob, tagCloudCacheJob, tagDateCacheJob, tagMonthCacheJob, type CacheContext, type CacheInput } from '../src/report-caches.js';
import { livePollingJob } from '../src/live-polling.js';
import { YoutubeDataApiClient } from '../src/youtube.js';
const enabled=process.env.INGESTION_DB_TEST==='1';
const now=new Date('2090-02-03T02:00:00Z');
const dictionary={version:'cache-fixture',coverage:'observed-article-window',rule:'youtube-tag-exact-v1-title2-length',match:(title:string,description:string)=>[...title.includes('台灣')?[{term:'台灣',field:'title' as const}]:[],...description.includes('AI')?[{term:'AI',field:'description' as const}]:[]]};
it('counts follow Laravel computeDeltas: zero for one point, kept subscriber deltas, older months override, i=30 still observed',()=>{
 const result=channelDeltas([JSON.stringify({'2090-02-03':{view:100,video:5,hidden:true},'2090-01-27':{view:80,video:5,subscriber:30},'2090-01-05':{view:50,video:3,subscriber:10}})],'2090-02-03');
 // Latest point hides subscribers: Laravel omits sub_* so the stored values are kept.
 expect(result).toEqual({view_week:20,video_week:0,view_month:50,video_month:2});
 expect(channelDeltas([JSON.stringify({'2090-02-03':{view:100,video:5,subscriber:10}})],'2090-02-03')).toEqual({view_week:0,video_week:0,view_month:0,video_month:0});
 // A farther point without a subscriber count keeps the nearer subscriber delta (sub_month 10, not NULL).
 expect(channelDeltas([JSON.stringify({'2090-02-03':{view:100,video:5,subscriber:40},'2090-01-27':{view:80,video:5,subscriber:30},'2090-01-05':{view:50,video:3,hidden:true}})],'2090-02-03')).toEqual({view_week:20,sub_week:10,video_week:0,view_month:50,sub_month:10,video_month:2});
 expect(channelDeltas([JSON.stringify({'2090-01-04':{view:7,video:1,subscriber:1}})],'2090-02-03')).toEqual({view_week:0,video_week:0,view_month:0,video_month:0});
 expect(channelDeltas([JSON.stringify({'2090-01-03':{view:7,video:1,subscriber:1}})],'2090-02-03')).toBeNull();
 expect(channelDeltas(['{"2090-02-30":{"view":1,"video":1,"subscriber":1}}'],'2090-02-03')).toBeNull();
 // urt_log rows arrive newest pk first; array_replace lets the older row win for the same date.
 expect(channelDeltas([JSON.stringify({'2090-02-03':{view:100,video:5,subscriber:1}}),JSON.stringify({'2090-02-03':{view:90,video:4,subscriber:1},'2090-02-01':{view:80,video:4,subscriber:1}})],'2090-02-03')).toMatchObject({view_week:10});
 for(const bad of ['','null','5','{"2090-02-03":{"view":1,"video":1}}','{"2090-02-03":{"view":1,"video":1,"hidden":"yes"}}','{"2090-02-03":[1]}','{"2090-02-03":{"view":-1,"video":1,"subscriber":1}}','[{"view":1}]'])expect(channelDeltas([bad],'2090-02-03')).toBeNull();
 expect(channelDeltas(['[]','{"2090-02-03":{"view":"12.7","video":" 3","hidden":true}}'],'2090-02-03')).toEqual({view_week:0,video_week:0,view_month:0,video_month:0});
});
it('live hourly maxima retain measured zero, exact minute boundaries and title-only vocabulary',()=>{
 const result=liveDayMetrics([{videoId:'x',u_id:1,title:'台灣',log_json:'{"09:01":0,"09:59":20,"10:00":10}',max_current:999} as RowDataPacket],dictionary);
 expect(JSON.parse(result.tags_views)).toEqual({'台灣':{'09':20,'10':10}});expect(result.total_views).toBe(20);
 expect(()=>liveDayMetrics([{videoId:'x',title:'台灣',log_json:'{"09:70":1}'} as RowDataPacket],dictionary)).toThrow();
 expect(()=>liveDayMetrics([{videoId:'x',title:'台灣',log_json:'{"09:00":null}'} as RowDataPacket],dictionary)).toThrow();
});
async function fixture() {
 const env=isolatedTestEnv(),db=await mysql.createConnection({host:env.DB_HOST,port:Number(env.DB_PORT),database:env.DB_DATABASE,user:env.DB_USERNAME,password:env.DB_PASSWORD,dateStrings:true,timezone:'Z',charset:'utf8mb4_bin'});
 await db.query("SET SESSION sql_mode='STRICT_ALL_TABLES'");
 for(const statement of (await readFile(new URL('../../jobs/migrations/008_report_cache_lineage.sql',import.meta.url),'utf8')).split(';').map(s=>s.trim()).filter(Boolean))await db.query(statement);
 const id='C'+randomUUID().replaceAll('-','').slice(0,10),tag=800000000+Math.floor(Math.random()*1000000),at='2090-02-03 09:00:00';
 const [insert]=await db.execute<mysql.ResultSetHeader>('INSERT INTO urt_channel(ctime,youtube_id,title) VALUES(?,?,?)',[at,'UC'+id,'cache fixture']);const uid=insert.insertId;
 await db.execute('INSERT INTO urt_count(u_id,ctime,tags) VALUES(?,?,?)',[uid,at,`[${tag}]`]);
 await db.execute('INSERT INTO urt_video(ctime,u_id,id,publishedAt,channelId,title,thumbnails,channelTitle,playlistId,position,videoId,description,viewCount) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)',[at,uid,id,at,'UC'+id,'台灣','','fixture','UUfixture',0,id,'AI',10]);
 const ctx:CacheContext={db,now,execute:true,assertOwnership:async()=>{}};
 const input:CacheInput={from:'2090-02-03',to:'2090-02-03',days:1,tagIds:[tag],orTagIds:[],notTagIds:[],channelLimit:5,videoLimit:5};
 const cleanup=async()=>{for(const table of ['urt_video_live_log_tvbs','urt_video_live_tvbs','urt_video_live_log','urt_video_live','urt_video_log_history','urt_video_schedule','urt_show_video_live','urt_video'])await db.execute(`DELETE FROM ${table} WHERE BINARY videoId=BINARY ?`,[id]);
 for(const table of ['urt_show_tag_date','urt_show_tag_cloud','urt_show_tag_cloud_tag','urt_show_tag_month','urt_show_live_tag_date'])await db.execute(`DELETE FROM ${table} WHERE tagid=?`,[String(tag)]);
 await db.execute('DELETE FROM ts_cache_item_state WHERE item_key IN (?,?)',[id,String(uid)]);
 for(const table of ['ts_tag_cache_lineage','ts_live_tag_cache_lineage'])await db.execute(`DELETE FROM ${table} WHERE selection_key=?`,[JSON.stringify([[tag],[],[]])]);
 await db.execute('DELETE FROM ts_report_cache_lineage WHERE vocabulary_version=?',['cache-fixture']);await db.execute('DELETE FROM urt_show_cloud WHERE u_id=?',[uid]);await db.execute('DELETE FROM urt_log WHERE u_id=?',[uid]);await db.execute('DELETE FROM urt_count WHERE u_id=?',[uid]);await db.execute('DELETE FROM urt_channel WHERE u_id=?',[uid]);await db.end();};return {db,ctx,input,id,uid,tag,at,cleanup};
}
it.skipIf(!enabled)('MariaDB tag/cloud rebuilds publish provenance, replay idempotently, and preserve cache on cap failure',async()=>{
 const f=await fixture();try{
 const preview=await tagDateCacheJob({...f.ctx,execute:false},f.input,dictionary);expect(preview.applied).toEqual([]);
 await tagDateCacheJob(f.ctx,f.input,dictionary);await tagDateCacheJob(f.ctx,f.input,dictionary);
 const [rows]=await f.db.query<RowDataPacket[]>('SELECT * FROM urt_show_tag_date WHERE tagid=?',[String(f.tag)]);expect(rows).toHaveLength(1);expect(JSON.parse(rows[0]!.tags_video)).toEqual({'台灣':1,AI:1});expect(Number(rows[0]!.total_views)).toBe(10);
 await cloudCacheJob(f.ctx,{...f.input,uId:f.uid},dictionary,'channel');await tagCloudCacheJob(f.ctx,f.input,[1],dictionary);await cloudCacheJob(f.ctx,{...f.input,subject:'台灣'},dictionary,'keyword');
 const [lineage]=await f.db.query<RowDataPacket[]>('SELECT * FROM ts_report_cache_lineage WHERE cache_table=? AND cache_key=?',['urt_show_cloud',reportCacheKey({u_id:f.uid,days:1})]);expect(lineage[0]!.status).toBe('published');
 await f.db.execute('UPDATE urt_video SET viewCount=NULL WHERE BINARY videoId=BINARY ?',[f.id]);await tagDateCacheJob(f.ctx,f.input,dictionary);
 const [unknown]=await f.db.query<RowDataPacket[]>('SELECT * FROM ts_tag_cache_lineage WHERE selection_key=?',[JSON.stringify([[f.tag],[],[]])]);expect(unknown[0]!.unknown_view_videos).toBe(1);
 await expect(tagMonthCacheJob(f.ctx,{...f.input,subject:'台灣'},dictionary)).rejects.toThrow('closed calendar month');
 await f.db.execute('UPDATE urt_video SET viewCount=10 WHERE BINARY videoId=BINARY ?',[f.id]);await tagDateCacheJob(f.ctx,f.input,dictionary);
 const month={...f.input,from:'2090-01-01',to:'2090-01-31',days:31,subject:'台灣'};await tagDateCacheJob(f.ctx,month,dictionary);await tagDateCacheJob({...f.ctx,now:new Date('2090-01-31T02:00:00Z')},{...month,from:'2090-01-31'},dictionary);await expect(tagMonthCacheJob(f.ctx,month,dictionary)).rejects.toThrow('complete same-version');await tagDateCacheJob(f.ctx,month,dictionary);await tagMonthCacheJob(f.ctx,month,dictionary);
 await f.db.execute('DELETE FROM urt_show_tag_date WHERE tagid=? AND the_date=?',[String(f.tag),'2090-01-02']);await expect(tagMonthCacheJob(f.ctx,month,dictionary)).rejects.toThrow('missing dates');
 const extra=f.id+'x';try{await f.db.execute('INSERT INTO urt_video(ctime,u_id,id,publishedAt,channelId,title,thumbnails,channelTitle,playlistId,position,videoId,description,viewCount) SELECT ctime,u_id,id,publishedAt,channelId,title,thumbnails,channelTitle,playlistId,position,?,description,viewCount FROM urt_video WHERE BINARY videoId=BINARY ?',[extra,f.id]);expect((await tagDateCacheJob(f.ctx,{...f.input,videoLimit:1},dictionary)).skipped).toEqual([{date:f.input.to,reason:'video_scan_limit_exceeded'}]);const [kept]=await f.db.query<RowDataPacket[]>('SELECT status FROM ts_tag_cache_lineage WHERE selection_key=? AND the_date=?',[JSON.stringify([[f.tag],[],[]]),f.input.to]);expect(kept[0]!.status).toBe('published');}finally{await f.db.execute('DELETE FROM urt_video WHERE BINARY videoId=BINARY ?',[extra]);}
 const [dupe]=await f.db.execute<mysql.ResultSetHeader>('INSERT INTO urt_show_tag_date(ctime,the_date,tagid) VALUES(?,?,?)',[f.at,f.input.to,String(f.tag)]);try{await expect(tagDateCacheJob(f.ctx,f.input,dictionary)).rejects.toThrow('Duplicate logical');const [pending]=await f.db.query<RowDataPacket[]>('SELECT status FROM ts_tag_cache_lineage WHERE selection_key=? AND the_date=?',[JSON.stringify([[f.tag],[],[]]),f.input.to]);expect(pending[0]!.status).toBe('pending');}finally{await f.db.execute('DELETE FROM urt_show_tag_date WHERE pk=?',[dupe.insertId]);}await tagDateCacheJob(f.ctx,f.input,dictionary);
 }finally{await f.cleanup();}
});
it.skipIf(!enabled)('MariaDB live cache builds title terms/hourly peaks, excludes malformed histories, and protects TS caches from legacy cleaner',async()=>{
 const f=await fixture();try{
 await f.db.execute('INSERT INTO urt_video_live(ctime,publishedAt,videoId,u_id) VALUES(?,?,?,?)',[f.at,f.at,f.id,f.uid]);
 await f.db.execute('INSERT INTO urt_video_live_log(ctime,the_date,videoId,u_id,max_current,log_json) VALUES(?,?,?,?,?,?)',[f.at,'2090-02-03',f.id,f.uid,30,'{"09:00":0,"09:10":30}']);
 await liveDisplayCacheJob(f.ctx,{hours:2,limit:100});await liveTagDateCacheJob(f.ctx,f.input,dictionary);
 const [rows]=await f.db.query<RowDataPacket[]>('SELECT * FROM urt_show_live_tag_date WHERE tagid=?',[String(f.tag)]);expect(JSON.parse(rows[0]!.tags_views)).toEqual({'台灣':{'09':30}});
 const clean=await liveCacheCleanJob(f.ctx,200);expect(clean.applied).not.toContain(rows[0]!.pk);
 await f.db.execute('UPDATE urt_video_live_log SET log_json=? WHERE BINARY videoId=BINARY ?',['{"09:00":null}',f.id]);await expect(liveTagDateCacheJob(f.ctx,f.input,dictionary)).rejects.toThrow('Invalid live');
 const [retained]=await f.db.query<RowDataPacket[]>('SELECT total_views FROM urt_show_live_tag_date WHERE tagid=?',[String(f.tag)]);expect(Number(retained[0]!.total_views)).toBe(30);
 }finally{await f.cleanup();}
});
it.skipIf(!enabled)('MariaDB count/schedule builds derive history without manufacturing source observations; TVBS polling stays isolated',async()=>{
 const f=await fixture();try{
 await f.db.execute('INSERT INTO urt_log(ctime,u_id,themonth,thedata) VALUES(?,?,?,?)',[f.at,f.uid,'2090-02-01',JSON.stringify({'2090-02-03':{view:100,video:2,subscriber:10},'2090-02-02':{view:50,video:1,subscriber:8}})]);
 expect((await countsCacheJob(f.ctx,{uId:f.uid,limit:1})).skipped).toEqual([]);
 const [c]=await f.db.query<RowDataPacket[]>('SELECT view_week,sub_week FROM urt_count WHERE u_id=?',[f.uid]);expect(Number(c[0]!.view_week)).toBe(50);expect(Number(c[0]!.sub_week)).toBe(2);
 await expect(countsCacheJob({...f.ctx,assertOwnership:async()=>{throw new Error('ownership lost');}},{uId:f.uid,limit:1})).rejects.toThrow('ownership lost');
 await f.db.execute('INSERT INTO urt_video_schedule(ctime,mtime,publishedAt,videoId) VALUES(?,?,?,?)',[f.at,f.at,'2090-02-03 07:00:00',f.id]);
 await f.db.execute('INSERT INTO urt_video_log_history(ctime,videoId,viewCount,likeCount,dislikeCount,favoriteCount,commentCount) VALUES(?,?,?,0,0,0,0)',[f.at,f.id,1000]);
 await scheduleCacheJob(f.ctx,{videoId:f.id,limit:1});const [s]=await f.db.query<RowDataPacket[]>('SELECT mtime,stime FROM urt_video_schedule WHERE BINARY videoId=BINARY ?',[f.id]);expect(s[0]!.mtime).toBe('2090-02-03 10:00:00');expect(s[0]!.stime).toBe('2090-02-03 11:00:01');
 await f.db.execute('INSERT INTO urt_video_live_tvbs(ctime,publishedAt,videoId,u_id) VALUES(?,?,?,?)',[f.at,f.at,f.id,f.uid]);
 const youtube=new YoutubeDataApiClient({keys:['fake'],ledger:{precharge:async()=> '2090-02-02',markDailyExhausted:async()=>{}},now:()=>now,fetcher:async()=>new Response(JSON.stringify({items:[{id:f.id,liveStreamingDetails:{concurrentViewers:'3000000000'}}]}))});
 expect((await livePollingJob({...f.ctx,youtube},{tvbs:true,videoId:f.id,limit:1})).applied).toEqual([f.id]);
 const [tvbs]=await f.db.query<RowDataPacket[]>('SELECT max_current FROM urt_video_live_log_tvbs WHERE BINARY videoId=BINARY ?',[f.id]);expect(Number(tvbs[0]!.max_current)).toBe(3000000000);
 const [normal]=await f.db.query<RowDataPacket[]>('SELECT pk FROM urt_video_live_log WHERE BINARY videoId=BINARY ?',[f.id]);expect(normal).toEqual([]);
 }finally{await f.cleanup();}
});

it('Wikipedia thumbnails use fixed host and bounded transport, never request in preview',async()=>{
 const url='https://upload.wikimedia.org/wikipedia/commons/thumb/a/a1/Fixture.jpg/500px-Fixture.jpg';
 expect(safeWikipediaImage(url)).toBe(url);for(const bad of ['https://upload.wikimedia.org.evil/a','https://u:p@upload.wikimedia.org/wikipedia/a','http://upload.wikimedia.org/wikipedia/a','https://upload.wikimedia.org:8443/wikipedia/a'])expect(safeWikipediaImage(bad)).toBeNull();
 let called=0;const fetcher:typeof fetch=async(input,init)=>{called++;expect(new URL(String(input)).origin).toBe('https://zh.wikipedia.org');expect(init?.redirect).toBe('error');return new Response(JSON.stringify({query:{pages:{1:{thumbnail:{source:url}}}}}));};
 expect(await wikipediaPhoto('台灣',fetcher)).toBe(url);expect(called).toBe(1);
 await expect(wikipediaPhoto('台灣',async()=>new Response('x'.repeat(1024*1024+1)))).rejects.toThrow('exceeds cap');
});
it('channel prediction summary matches the existing legacy reader seasonal interpolation',async()=>{
 const points:Record<string,unknown>={};for(let i=0;i<90;i++){const day=new Date(Date.parse('2090-01-01')+i*86400000).toISOString().slice(0,10);if(i!==65&&i!==72)points[day]={view:1000+i*100,video:i};}
 const logs=[{thedata:JSON.stringify(points)}],now=new Date('2090-03-31T00:00:00Z');const expected=await channelReport({rows:async()=>[],close:async()=>{}} as never,{u_id:'1',limit:'29'},now,true,{logs});
 expect(channelPredictionSummary(logs.map(r=>r.thedata),'2090-03-31')).toEqual(expected.summary);expect(()=>channelPredictionSummary([logs[0]!.thedata,logs[0]!.thedata],'2090-03-31')).toThrow('Duplicate channel observation');
});
it.skipIf(!enabled)('photo and prediction writes use exact term identity and retain channel freshness',async()=>{
 const f=await fixture(),term='圖片'+f.id,absent='無圖'+f.id;try{
 const url='https://upload.wikimedia.org/wikipedia/commons/a/a1/Test.jpg',fetcher:typeof fetch=async()=>new Response(JSON.stringify({query:{pages:{1:{thumbnail:{source:url}}}}}));
 expect((await photosCacheJob({...f.ctx,execute:false},{terms:[term],limit:1},async()=>{throw new Error('must not call');})).externalRequests).toBe(0);
 expect((await photosCacheJob(f.ctx,{terms:[term],limit:1},fetcher)).applied).toEqual([term]);expect((await photosCacheJob(f.ctx,{terms:[term],limit:1},async()=>{throw new Error('cache should skip');})).cached).toBe(1);
 const noimage=await photosCacheJob(f.ctx,{terms:[absent],limit:1},async()=>new Response(JSON.stringify({query:{pages:{'-1':{missing:''}}}})));expect(noimage.skipped).toEqual([]);expect(noimage.withoutThumbnail).toEqual([absent]);expect(await selectPhotoTerms(f.ctx,[absent,absent+'後'],1)).toEqual([absent+'後']);
 const before=(await f.db.query<RowDataPacket[]>('SELECT mtime FROM urt_count WHERE u_id=?',[f.uid]))[0][0]!.mtime;
 await f.db.execute('INSERT INTO urt_log(ctime,u_id,themonth,thedata) VALUES(?,?,?,?)',[f.at,f.uid,'2090-02-01',JSON.stringify({'2090-02-01':{view:10},'2090-02-02':{view:20},'2090-02-03':{view:30}})]);
 expect((await predictionsCacheJob(f.ctx,{uId:f.uid,limit:1})).applied).toEqual([f.uid]);const [rows]=await f.db.query<RowDataPacket[]>('SELECT mtime,views_pred_week FROM urt_count WHERE u_id=?',[f.uid]);expect(rows[0]!.mtime).toBe(before);expect(Number(rows[0]!.views_pred_week)).toBe(10);await f.db.execute('DELETE FROM urt_log WHERE u_id=?',[f.uid]);const unavailable=await predictionsCacheJob(f.ctx,{uId:f.uid,limit:1});expect(unavailable.unavailable).toEqual([f.uid]);expect(unavailable).not.toHaveProperty('nextAfterId');expect((await f.db.query<RowDataPacket[]>('SELECT views_pred_week FROM urt_count WHERE u_id=?',[f.uid]))[0][0]!.views_pred_week).toBeNull();
 }finally{await f.db.execute('DELETE FROM urt_show_photo WHERE BINARY tag=BINARY ?',[term]);await f.db.execute("DELETE FROM ts_cache_item_state WHERE workflow='reports.photos.build' AND item_key IN (?,?)",[reportCacheKey({tag:term}),reportCacheKey({tag:absent})]);await f.cleanup();}
});
it.skipIf(!enabled)('keyword relation and fixed tags_all builders derive only YouTube counts and reject coverage poisoning',async()=>{
 const f=await fixture(),subject='關聯'+f.id;try{
 const dict={...dictionary,match:()=>[{term:subject,field:'title' as const},{term:'AI',field:'description' as const}]};
 await expect(keywordRelationCacheJob(f.ctx,{...f.input,subject},dict)).rejects.toThrow('all active');
 await keywordRelationCacheJob(f.ctx,{...f.input,subject,tagIds:[],channelLimit:5000},dict);
 const [r]=await f.db.query<RowDataPacket[]>('SELECT tags_json,videos_json FROM urt_show_video_tag_date WHERE BINARY tag=BINARY ?',[subject]);expect(JSON.parse(r[0]!.tags_json)).toEqual({[subject]:1,AI:1});expect(JSON.parse(r[0]!.videos_json)).toEqual({[f.id]:f.uid});
 await expect(keywordsCacheJob(f.ctx,f.input,dict)).rejects.toThrow('tags_all requires');
 await f.db.execute('UPDATE urt_count SET tags=? WHERE u_id=?',[`[${f.tag}][13]`,f.uid]);
 // Both tags_all target and generic lineage are InnoDB; preserve any other test fixture's global cache.
 await f.db.beginTransaction();try{await keywordsCacheJob(f.ctx,{...f.input,from:'2090-01-28',days:7,tagIds:[],orTagIds:[1,2,13,14],channelLimit:5000},dict);const [r]=await f.db.query<RowDataPacket[]>('SELECT the_result FROM urt_show_data WHERE data_name=?',['tags_all']);expect(JSON.parse(r[0]!.the_result)[subject]).toEqual({video:1,video_all:1,views:10,views_all:10});}finally{await f.db.rollback();}
 }finally{await f.db.execute('DELETE FROM urt_show_video_tag_date WHERE BINARY tag=BINARY ?',[subject]);await f.cleanup();}
});
it.skipIf(!enabled)('TVBS upload taxonomy and stale polling use isolated tables and retire absent live IDs',async()=>{
 const f=await fixture();try{
 await f.db.execute('UPDATE urt_count SET tags=? WHERE u_id=?',[`[${f.tag}][29]`,f.uid]);await f.db.execute('UPDATE urt_channel SET uploads=? WHERE u_id=?',['UUfixture',f.uid]);
 const api=(response:unknown)=>new YoutubeDataApiClient({keys:['fake'],ledger:{precharge:async()=> '2090-02-02',markDailyExhausted:async()=>{}},now:()=>now,fetcher:async()=>new Response(JSON.stringify(response))});
 const item={id:'playlist-fixture',snippet:{resourceId:{videoId:f.id},publishedAt:'2090-02-03T01:00:00Z',channelId:'UC'+f.id,title:'台灣',description:'AI',thumbnails:{default:{url:'https://i.ytimg.com/vi/'+f.id+'/default_live.jpg'}},channelTitle:'fixture',playlistId:'UUfixture',position:0}};
 expect((await channelUploadsJob({...f.ctx,youtube:api({items:[item]})},{uId:f.uid,tvbs:true,limit:1,maxPages:1,days:7})).skipped).toEqual([]);
 const [normal]=await f.db.query<RowDataPacket[]>('SELECT pk FROM urt_video_live WHERE BINARY videoId=BINARY ?',[f.id]);expect(normal).toEqual([]);
 expect((await livePollingJob({...f.ctx,youtube:api({items:[{id:f.id,liveStreamingDetails:{concurrentViewers:'0'}}]})},{tvbs:true,limit:50})).applied).toContain(f.id);
 const later={...f.ctx,now:new Date(now.getTime()+60000),youtube:api({items:[]})};expect((await livePollingJob(later,{tvbs:true,limit:50})).skipped).toContainEqual({videoId:f.id,reason:'api-item-absent'});
 const [tvbs]=await f.db.query<RowDataPacket[]>('SELECT del_flag FROM urt_video_live_tvbs WHERE BINARY videoId=BINARY ?',[f.id]);expect(Number(tvbs[0]!.del_flag)).toBe(1);
 }finally{await f.db.execute('DELETE FROM ts_youtube_item_backoff WHERE video_id IN (?,?)',[f.id,String(f.uid)]);await f.cleanup();}
});
it('predictions match the original PHP seasonal routine, including ISO year boundary',async()=>{
 const fixtures=JSON.parse(await readFile(new URL('./fixtures/channel-prediction-php.json',import.meta.url),'utf8')) as {today:string;points:Record<string,unknown>;expected:{views_pred_week:number;views_pred_month:number}}[];
 for(const f of fixtures)expect(channelPredictionSummary([JSON.stringify(f.points)],f.today)).toEqual(f.expected);
});
