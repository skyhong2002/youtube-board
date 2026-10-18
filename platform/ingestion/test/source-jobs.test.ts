import { MysqlQuotaLedger } from '../src/quota.js';
import { withWriterLock } from '../../jobs/src/database.js';
import { it, expect, afterAll } from 'vitest';
import mysql, { type Connection, type RowDataPacket, type ResultSetHeader } from 'mysql2/promise';
import { randomUUID } from 'node:crypto';
import { isolatedTestEnv } from '../../shared/test-database.js';
import { channelStatisticsJob, channelRetirementJob, channelUploadsJob, nextUploadsCheck } from '../src/channel-jobs.js';
import { videoDurationsJob } from '../src/video-durations.js';
import { commentQueueJob, commentFetchJob, commentResetJob } from '../src/comments.js';
import { YoutubeDataApiClient } from '../src/youtube.js';
import { videoStatisticsJob, type SourceJobContext } from '../src/video-statistics.js';
const enabled = process.env.INGESTION_DB_TEST === '1', now = new Date('2026-10-12T02:00:00Z');
const uid = () => 'T' + randomUUID().replaceAll('-', '').slice(0, 10);
async function connect() { const env = isolatedTestEnv(); return mysql.createConnection({ host: env.DB_HOST, port: Number(env.DB_PORT), database: env.DB_DATABASE, user: env.DB_USERNAME, password: env.DB_PASSWORD, timezone: 'Z', dateStrings: true, supportBigNumbers: true, bigNumberStrings: true }); }

// Remove this file's synthetic channels so later DB suites (media sweep, evidence batches) see a clean source.
afterAll(async () => {
  if (process.env.INGESTION_DB_TEST !== '1') return;
  const db = await connect();
  try {
    const ids = `SELECT u_id FROM urt_channel WHERE title='source test'`;
    for (const table of ['urt_count', 'urt_video', 'urt_video_schedule', 'urt_video_live']) await db.query(`DELETE FROM ${table} WHERE u_id IN (SELECT u_id FROM (${ids}) t)`).catch(() => undefined);
    await db.query(`DELETE FROM urt_channel WHERE title='source test'`);
  } finally { await db.end(); }
});
function context(db: Connection, handler: (url: URL) => unknown): SourceJobContext {
  return { db, now, execute: true, assertOwnership: async () => {}, youtube: new YoutubeDataApiClient({ keys: ['fake-key'], ledger: { precharge: async () => '2026-10-11', markDailyExhausted: async () => {} }, now: () => now, fetcher: async url => new Response(JSON.stringify(handler(new URL(String(url))))) }) };
}
async function channel(db: Connection, youtubeId: string) { const [result] = await db.execute<ResultSetHeader>('INSERT INTO urt_channel (ctime,youtube_id,uploads,title,subscriberCount) VALUES (?,?,?,?,?)', ['2026-09-01 00:00:00', youtubeId, 'UU' + youtubeId, 'source test', 7]); return result.insertId; }
async function video(db: Connection, id: string, uId: number, youtubeId: string) { await db.execute('INSERT INTO urt_video (ctime,u_id,id,publishedAt,channelId,title,thumbnails,channelTitle,playlistId,position,videoId,description,viewCount,commentCount) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)', ['2026-10-11 10:00:00', uId, id, '2026-10-11 11:00:00', youtubeId, 'test', '', 'channel', 'UU' + youtubeId, 0, id, 'test description', 500, 500]); }
async function clean(db: Connection, uId: number, ids: string[], authors: string[] = []) {
  for (const id of authors) { const [rows] = await db.query<RowDataPacket[]>('SELECT author_id FROM urt_comment_author WHERE BINARY ChannelId=BINARY ?', [id]); for (const row of rows) await db.execute('DELETE FROM urt_comment_rev WHERE author_id=?', [row.author_id]); await db.execute('DELETE FROM urt_comment_author WHERE BINARY ChannelId=BINARY ?', [id]); }
  for (const id of ids) {
    await db.execute('DELETE FROM ts_comment_stage_archive WHERE video_id=?', [id]);
    await db.execute('DELETE FROM ts_comment_stages WHERE video_id=?', [id]);
    await db.execute('DELETE FROM ts_youtube_item_backoff WHERE video_id=?', [id]);
    for (const table of ['urt_comment','urt_comment_queue','urt_comment_queue_done','urt_video_duration','urt_video_live','urt_video_schedule','urt_video_log','urt_video_log_history','urt_video']) await db.execute(`DELETE FROM ${table} WHERE BINARY videoId=BINARY ?`, [id]);
  }
  await db.execute('DELETE FROM ts_youtube_item_backoff WHERE video_id=?', [String(uId)]);
  for (const table of ['urt_log','urt_count','urt_channel']) await db.execute(`DELETE FROM ${table} WHERE u_id=?`, [uId]);
}
it('uploads cadence preserves minimum interval and Taipei morning rule', () => {
  // Laravel estimateNextVtime checks 08:00 on the raw (sub-two-hour) interval before applying the two-hour floor.
  expect(nextUploadsCheck(new Date('2026-10-11T15:00:00Z'), 1000)).toBe('2026-10-12 01:00:00');
  expect(nextUploadsCheck(now, 1000)).toBe('2026-10-12 12:00:00');
  expect(nextUploadsCheck(new Date('2026-10-11T22:00:00Z'), 0)).toBe('2026-10-19 08:00:00');
});
it.skipIf(!enabled)('channel statistics preserve hidden counts, accept >32-bit counts, and reject corrupt history before source freshness', async () => {
  const db = await connect(), id = uid(), uId = await channel(db,id);
  try {
    const ctx = context(db, () => ({ items: [{ id, statistics: { viewCount: '3000000000',videoCount:'3000000001',hiddenSubscriberCount:true } }] }));
    expect((await channelStatisticsJob({ ...ctx, execute:false },{ uId,limit:1 })).apiAttempts).toBe(0);
    expect((await channelStatisticsJob(ctx,{uId,limit:1})).applied).toEqual([uId]);
    const [rows] = await db.query<RowDataPacket[]>('SELECT * FROM urt_channel WHERE u_id=?',[uId]); expect(Number(rows[0]?.subscriberCount)).toBe(7); expect(Number(rows[0]?.videoCount)).toBe(3000000001); expect(Number(rows[0]?.viewCount)).toBe(3000000000);
    const [counts] = await db.query<RowDataPacket[]>('SELECT viewCount FROM urt_count WHERE u_id=?',[uId]); expect(Number(counts[0]?.viewCount)).toBe(3000000000);
    const [logs] = await db.query<RowDataPacket[]>('SELECT thedata FROM urt_log WHERE u_id=?',[uId]); expect(JSON.parse(logs[0]?.thedata)['2026-10-12'].view).toBe(3000000000);
    await db.execute('UPDATE urt_log SET thedata=? WHERE u_id=?',['{broken',uId]);
    expect((await channelStatisticsJob({...ctx,now:new Date('2026-10-13T02:00:00Z')},{uId,limit:1})).skipped).toHaveLength(1);
    const [fresh] = await db.query<RowDataPacket[]>('SELECT mtime FROM urt_channel WHERE u_id=?',[uId]); expect(fresh[0]?.mtime).toBe('2026-10-12 10:00:00');
  } finally { await clean(db,uId,[]);await db.end(); }
});
it.skipIf(!enabled)('retirement only applies after successful exact presence check and supports presence-confirmed restore',async()=>{
  const db=await connect(),id=uid(),uId=await channel(db,id);
  try {
    expect((await channelRetirementJob(context(db,()=>({items:[{}]})),{uId,limit:1})).skipped).toHaveLength(1);
    expect((await channelRetirementJob(context(db,()=>({items:[{id}]})),{uId,limit:1})).applied).toHaveLength(0);
    expect((await channelRetirementJob(context(db,()=>({items:[]})),{uId,limit:1})).applied).toEqual([uId]);
    expect((await channelRetirementJob(context(db,()=>({items:[{id}]})),{uId,limit:1,restore:true})).applied).toEqual([uId]);
  }finally{await clean(db,uId,[]);await db.end();}
});
it.skipIf(!enabled)('uploads discovery publishes a bounded sample and optional subsequent pages preserve case-exact IDs',async()=>{
  const db=await connect(),id=uid(),uId=await channel(db,id),vid=uid(),other=vid.toLowerCase();
  const item=(videoId:string,position:number)=>({id:'PI'+videoId,snippet:{resourceId:{videoId},publishedAt:'2026-10-11T02:00:00Z',channelId:id,title:'title',description:'description',thumbnails:{default:{url:'https://i.ytimg.com/default_live.jpg'}},channelTitle:'channel',playlistId:'UU'+id,position}});
  try {
    const ctx=context(db,url=>url.searchParams.get('pageToken')?{items:[item(other,1)]}:{items:[item(vid,0)],nextPageToken:'next'});
    expect((await channelUploadsJob(ctx,{uId,limit:1,maxPages:1,days:7})).applied[0]).toMatchObject({videos:1,apiItems:1,pages:1,pageExhausted:false,oldestPublishedAt:'2026-10-11T02:00:00.000Z'});
    const [absent]=await db.query<RowDataPacket[]>('SELECT videoId FROM urt_video WHERE u_id=?',[uId]);expect(absent).toHaveLength(1);
    expect((await channelUploadsJob(ctx,{uId,limit:1,maxPages:2,days:7,stopAt:Date.parse('2026-10-11T02:00:00Z')})).applied[0]).toMatchObject({videos:1,apiItems:1,pages:1,pageExhausted:false});
    expect((await channelUploadsJob(ctx,{uId,limit:1,maxPages:2,days:7})).applied[0]).toMatchObject({videos:2,apiItems:2,pages:2,pageExhausted:true,oldestPublishedAt:'2026-10-11T02:00:00.000Z'});
    const [rows]=await db.query<RowDataPacket[]>('SELECT videoId FROM urt_video WHERE u_id=?',[uId]);expect(new Set(rows.map(r=>r.videoId))).toEqual(new Set([vid,other]));
    await channelUploadsJob(ctx,{uId,limit:1,maxPages:2,days:7});
    const [live]=await db.query<RowDataPacket[]>('SELECT videoId FROM urt_video_live WHERE u_id=?',[uId]);expect(live).toHaveLength(2);
  }finally{await clean(db,uId,[vid,other]);await db.end();}
});
it.skipIf(!enabled)('durations enqueue missing videos, persist >32-bit seconds and backoff invalid details without fabricated freshness',async()=>{
  const db=await connect(),id=uid(),uId=await channel(db,id),vid=uid();
  try{
    await video(db,vid,uId,id);
    const ctx=context(db,()=>({items:[{id:vid,contentDetails:{duration:'PT3000000000S',caption:'false'}}]}));
    expect((await videoDurationsJob(ctx,{videoId:vid,limit:1,enqueueMissing:false})).selected).toBe(0);
    expect((await videoDurationsJob(ctx,{videoId:vid,limit:1,enqueueMissing:true})).applied).toEqual([vid]);
    const [rows]=await db.query<RowDataPacket[]>('SELECT duration,mtime FROM urt_video_duration WHERE videoId=?',[vid]);expect(Number(rows[0]?.duration)).toBe(3000000000);
    expect((await videoDurationsJob(context(db,()=>({items:[]})),{videoId:vid,limit:1,enqueueMissing:true})).selected).toBe(0);
    const [fresh]=await db.query<RowDataPacket[]>('SELECT mtime FROM urt_video_duration WHERE videoId=?',[vid]);expect(fresh[0]?.mtime).toBe(rows[0]?.mtime);
  }finally{await clean(db,uId,[vid]);await db.end();}
});
it.skipIf(!enabled)('video statistics writes >signed32-bit counts to source, schedule and history exactly',async()=>{
  const db=await connect(),id=uid(),uId=await channel(db,id),vid=uid();
  try{
    await video(db,vid,uId,id);
    const statistics={viewCount:'8000000000',likeCount:'3000000000',favoriteCount:'0',commentCount:'4000000000'};
    expect((await videoStatisticsJob(context(db,()=>({items:[{id:vid,statistics}]})),{videoId:vid,limit:1})).applied).toEqual([vid]);
    for(const table of ['urt_video','urt_video_schedule','urt_video_log_history']){const[rows]=await db.query<RowDataPacket[]>(`SELECT viewCount,likeCount,commentCount FROM ${table} WHERE videoId=?`,[vid]);expect(rows.map(r=>[Number(r.viewCount),Number(r.likeCount),Number(r.commentCount)])).toEqual([[8000000000,3000000000,4000000000]]);}
  }finally{await clean(db,uId,[vid]);await db.end();}
});
function comment(author:string,parentId?:string){return{authorChannelId:{value:author},authorDisplayName:'author',authorProfileImageUrl:'https://example.test/image',authorChannelUrl:'https://youtube.com/channel/'+author,textDisplay:'留言',textOriginal:'留言',publishedAt:'2026-10-12T01:00:00Z',updatedAt:'2026-10-12T01:00:00Z',likeCount:3,...(parentId?{parentId}:{})};}
it.skipIf(!enabled)('comments stage multiple thread/reply pages, resume at exact cursor, then publish cache and author reverse index once',async()=>{
  const db=await connect(),id=uid(),uId=await channel(db,id),vid=uid(),author=uid(),calls:string[]=[];
  try{
    await video(db,vid,uId,id);
    const ctx=context(db,url=>{
      const path=url.pathname.split('/').pop(),token=url.searchParams.get('pageToken');calls.push(path+':'+(token??''));
      if(path==='comments')return token?{items:[{id:'TOP.9xYz000002',snippet:comment(author,'TOP')}]}:{items:[{id:'TOP.9xYz000001',snippet:comment(author,'TOP')}],nextPageToken:'reply2'};
      return token?{items:[]}:{items:[{id:'THREAD',snippet:{videoId:vid,channelId:id,totalReplyCount:2,topLevelComment:{id:'TOP',snippet:comment(author)}}}],nextPageToken:'thread2'};
    });
    expect((await commentQueueJob({...ctx,execute:false},{videoId:vid,limit:1,hours:24,min:0})).applied).toHaveLength(0);
    await commentQueueJob(ctx,{videoId:vid,limit:1,hours:24,min:0});await commentQueueJob(ctx,{videoId:vid,limit:1,hours:24,min:0});
    expect((await commentFetchJob(ctx,{videoId:vid,limit:1,maxPages:1,maxReplyPages:1})).checkpointed).toEqual([vid]);
    const [unpublished]=await db.query<RowDataPacket[]>('SELECT videoId FROM urt_comment WHERE videoId=?',[vid]);expect(unpublished).toHaveLength(0);
    expect((await commentFetchJob(ctx,{videoId:vid,limit:1,maxPages:1,maxReplyPages:1})).applied[0]?.complete).toBe(true);
    expect(calls).toEqual(['commentThreads:','comments:','comments:reply2','commentThreads:thread2']);
    const[rows]=await db.query<RowDataPacket[]>('SELECT * FROM urt_comment WHERE videoId=?',[vid]);expect(Number(rows[0]?.comments_count)).toBe(3);expect(Number(rows[0]?.likes_count)).toBe(9);expect(rows[0]?.stime).toBe(rows[0]?.mtime);
    const[reverse]=await db.query<RowDataPacket[]>('SELECT r.index_json FROM urt_comment_rev r JOIN urt_comment_author a ON a.author_id=r.author_id WHERE a.ChannelId=?',[author]);expect(JSON.parse(reverse[0]?.index_json)).toEqual([vid]);
    expect((await commentFetchJob(ctx,{videoId:vid,limit:1,maxPages:1,maxReplyPages:1})).selected).toBe(0);
    expect((await commentQueueJob(ctx,{videoId:vid,limit:1,hours:24,min:0})).selected).toBe(0);
  }finally{await clean(db,uId,[vid],[author]);await db.end();}
});
it.skipIf(!enabled)('malformed comment identity cannot replace a published cache or mark queue complete',async()=>{
  const db=await connect(),id=uid(),uId=await channel(db,id),vid=uid(),author=uid();
  try{
    await video(db,vid,uId,id);
    await db.execute('INSERT INTO urt_comment (videoId,ctime,mtime,stime,comments_json) VALUES (?,?,?,?,?)',[vid,'2026-10-10 00:00:00','2026-10-10 00:00:00','2026-10-10 00:00:00','{"old":true}']);
    const ctx=context(db,()=>({items:[{id:'THREAD',snippet:{videoId:vid,channelId:'wrong',totalReplyCount:0,topLevelComment:{id:'TOP',snippet:comment(author)}}}]}));
    await commentQueueJob(ctx,{videoId:vid,limit:1,hours:24,min:0});
    expect((await commentFetchJob(ctx,{videoId:vid,limit:1,maxPages:1,maxReplyPages:1})).skipped).toHaveLength(1);
    const[rows]=await db.query<RowDataPacket[]>('SELECT comments_json,mtime FROM urt_comment WHERE videoId=?',[vid]);expect(rows[0]?.comments_json).toBe('{"old":true}');expect(rows[0]?.mtime).toBe('2026-10-10 00:00:00');
    const[queue]=await db.query<RowDataPacket[]>('SELECT pk FROM urt_comment_queue WHERE videoId=?',[vid]);expect(queue).toHaveLength(1);
    for(let n=1;n<12;n++) await commentFetchJob(ctx,{videoId:vid,limit:1,maxPages:1,maxReplyPages:1});
    expect((await commentFetchJob(ctx,{videoId:vid,limit:1,maxPages:1,maxReplyPages:1})).selected).toBe(1);
    expect((await commentResetJob({...ctx,execute:false},vid)).applied).toHaveLength(0);
    expect((await commentResetJob(ctx,vid)).applied).toEqual([vid]);
    const[archive]=await db.query<RowDataPacket[]>('SELECT status FROM ts_comment_stage_archive WHERE video_id=?',[vid]);expect(archive[0]?.status).toBe('scanning');
    expect((await commentFetchJob(context(db,()=>({items:[]})),{videoId:vid,limit:1,maxPages:1,maxReplyPages:1})).applied[0]?.complete).toBe(true);

  }finally{await clean(db,uId,[vid],[author]);await db.end();}
});
it.skipIf(!enabled)('zero-duration live observations remain eligible and two separate duration rows preserve independent identities',async()=>{
  const db=await connect(),id=uid(),uId=await channel(db,id),a=uid(),b=uid();
  try{
    await video(db,a,uId,id);await video(db,b,uId,id);
    const ctx=context(db,()=>({items:[{id:a,contentDetails:{duration:'P0D'}}]}));
    expect((await videoDurationsJob(ctx,{videoId:a,limit:1,enqueueMissing:true})).skipped).toHaveLength(1);
    const[empty]=await db.query<RowDataPacket[]>('SELECT pk_video FROM urt_video_duration WHERE videoId=?',[a]);expect(empty).toHaveLength(1);
    for(const videoId of [a,b])expect((await videoDurationsJob(context(db,()=>({items:[{id:videoId,contentDetails:{duration:'PT2M'}}]})),{videoId,limit:1,enqueueMissing:true})).applied).toEqual([videoId]);
    const[rows]=await db.query<RowDataPacket[]>('SELECT pk_video FROM urt_video_duration WHERE videoId IN (?,?)',[a,b]);expect(new Set(rows.map(r=>r.pk_video)).size).toBe(2);
  }finally{await clean(db,uId,[a,b]);await db.end();}
});
it.skipIf(!enabled)('resource-specific HTTP errors backoff queue items while global quota errors stop the run',async()=>{
  const db=await connect(),id=uid(),uId=await channel(db,id),vid=uid();
  try{
    await video(db,vid,uId,id);
    const ctx=context(db,()=>({items:[]}));
    await commentQueueJob(ctx,{videoId:vid,limit:1,hours:24,min:0});
    const failing=(status:number,reason:string)=>new YoutubeDataApiClient({keys:['fake'],ledger:{precharge:async()=>'2026-10-11',markDailyExhausted:async()=>{}},now:()=>now,fetcher:async()=>new Response(JSON.stringify({error:{errors:[{reason}]}}),{status})});
    expect((await commentFetchJob({...ctx,youtube:failing(403,'commentsDisabled')},{videoId:vid,limit:1,maxPages:1,maxReplyPages:1})).skipped).toHaveLength(1);
    const[backoff]=await db.query<RowDataPacket[]>('SELECT failures FROM ts_youtube_item_backoff WHERE workflow=? AND video_id=?',['youtube.comments.fetch',vid]);expect(backoff[0]?.failures).toBe(1);
    expect((await commentFetchJob({...ctx,youtube:failing(403,'quotaExceeded')},{videoId:vid,limit:1,maxPages:1,maxReplyPages:1})).stoppedReason).toBe('quota-daily');
    expect((await channelUploadsJob({...ctx,youtube:failing(404,'playlistNotFound')},{uId,limit:1,maxPages:1,days:7})).skipped).toHaveLength(1);
    // Laravel playlist_api_error: the channel's vtime moves one hour ahead (no TS-only backoff row).
    const[deferred]=await db.query<RowDataPacket[]>('SELECT vtime FROM urt_channel WHERE u_id=?',[uId]);expect(deferred[0]?.vtime).toBe('2026-10-12 11:00:00');
  }finally{await clean(db,uId,[vid]);await db.end();}
});
it.skipIf(!enabled)('batch item rejection defers statistics and duration without fabricated freshness and quota stops preserve enqueue provenance',async()=>{
  const db=await connect(),id=uid(),uId=await channel(db,id),vid=uid(),fresh=uid();
  try {
    await video(db,vid,uId,id);await video(db,fresh,uId,id);
    const failing=(status:number,reason:string)=>new YoutubeDataApiClient({keys:['fake'],ledger:{precharge:async()=>'2026-10-11',markDailyExhausted:async()=>{}},now:()=>now,fetcher:async()=>new Response(JSON.stringify({error:{errors:[{reason}]}}),{status})});
    const ctx={...context(db,()=>({items:[]})),youtube:failing(400,'invalidParameter')};
    expect((await videoStatisticsJob(ctx,{videoId:vid,limit:1})).skipped).toEqual([{videoId:vid,reason:'api-batch-item-rejected'}]);
    expect((await videoDurationsJob({...ctx,youtube:failing(400,'invalidParameter')},{videoId:vid,limit:1,enqueueMissing:true})).skipped).toEqual([{videoId:vid,reason:'api-batch-item-rejected'}]);
    for(const table of ['urt_video','urt_video_duration']){const[rows]=await db.query<RowDataPacket[]>(`SELECT mtime,stime FROM ${table} WHERE BINARY videoId=BINARY ?`,[vid]);expect(rows[0]).toMatchObject({mtime:null,stime:'2026-10-12 10:05:00'});}
    const[backoffs]=await db.query<RowDataPacket[]>('SELECT workflow,failures FROM ts_youtube_item_backoff WHERE video_id=?',[vid]);expect(backoffs).toHaveLength(2);expect(backoffs.every(row=>row.failures===1)).toBe(true);
    const stopped=await videoDurationsJob({...ctx,youtube:failing(403,'quotaExceeded')},{videoId:fresh,limit:1,enqueueMissing:true});
    expect(stopped).toMatchObject({enqueued:[fresh],applied:[],stoppedReason:'quota-daily'});
    const[queued]=await db.query<RowDataPacket[]>('SELECT mtime,duration FROM urt_video_duration WHERE BINARY videoId=BINARY ?',[fresh]);expect(queued[0]).toMatchObject({mtime:null,duration:null});
    await db.execute('DELETE FROM urt_video_duration WHERE BINARY videoId=BINARY ?',[fresh]);
    const unexpected=context(db,()=>({items:[]}));unexpected.youtube.videoContentDetails=async()=>{throw new Error('unclassified provider boundary failure');};
    // Laravel api_batch_failed: an unclassified request failure gives the batch the five-minute retry cooldown.
    expect(await videoDurationsJob(unexpected,{videoId:fresh,limit:1,enqueueMissing:true})).toMatchObject({enqueued:[fresh],applied:[],skipped:[{videoId:fresh,reason:'api-batch-item-rejected'}]});
    const[cooled]=await db.query<RowDataPacket[]>('SELECT stime,mtime FROM urt_video_duration WHERE BINARY videoId=BINARY ?',[fresh]);expect(cooled[0]).toMatchObject({stime:'2026-10-12 10:05:00',mtime:null});
  }finally{await clean(db,uId,[vid,fresh]);await db.end();}
});
it.skipIf(!enabled)('uploads write failures retain source rows already published, take the Laravel five-minute cooldown and reassign owners like Laravel',async()=>{
  const db=await connect(),id=uid(),uId=await channel(db,id),a=uid(),b=uid();
  try {
    await video(db,b,uId+999,id);
    const item=(videoId:string)=>({id:'PI'+videoId,snippet:{resourceId:{videoId},publishedAt:'2026-10-11T02:00:00Z',channelId:id,title:'title',description:'description',thumbnails:{default:{url:'https://i.ytimg.com/default.jpg'}},channelTitle:'channel',playlistId:'UU'+id,position:0}});
    // An out-of-range position makes the second item's MyISAM write fail after the first item was published.
    const huge=(videoId:string)=>({...item(videoId),snippet:{...item(videoId).snippet,position:99999999999}});
    expect(await channelUploadsJob(context(db,()=>({items:[item(a),huge(b)]})),{uId,limit:1,maxPages:1,days:7})).toMatchObject({applied:[],skipped:[{uId,reason:'item-processing-failed',partialVideos:[a]}]});
    const[cooldown]=await db.query<RowDataPacket[]>('SELECT vtime FROM urt_channel WHERE u_id=?',[uId]);expect(cooldown[0]?.vtime).toBe('2026-10-12 10:05:00');
    expect((await channelUploadsJob(context(db,()=>({items:[item(a),item(b)]})),{uId,limit:1,maxPages:1,days:7})).skipped).toEqual([]);
    const[owners]=await db.query<RowDataPacket[]>('SELECT videoId,u_id,ctime FROM urt_video WHERE BINARY videoId IN (BINARY ?,BINARY ?)',[a,b]);
    expect(owners.map(r=>[Number(r.u_id),r.ctime])).toEqual([[uId,'2026-10-12 10:00:00'],[uId,'2026-10-12 10:00:00']]);
  }finally{await clean(db,uId,[a,b]);await db.end();}
});
it.skipIf(!enabled)('publication interruption keeps staged evidence and public cache untouched, then replays and permits a new queue generation',async()=>{
  const db=await connect(),id=uid(),uId=await channel(db,id),vid=uid(),author=uid();let lost=false;
  try{
    await video(db,vid,uId,id);
    const ctx=context(db,()=>({items:[{id:'THREAD',snippet:{videoId:vid,channelId:id,totalReplyCount:0,topLevelComment:{id:'TOP',snippet:comment(author)}}}]}));
    await commentQueueJob(ctx,{videoId:vid,limit:1,hours:24,min:0});
    await expect(commentFetchJob({...ctx,assertOwnership:async()=>{const[rows]=await db.query<RowDataPacket[]>('SELECT status FROM ts_comment_stages WHERE video_id=?',[vid]);if(rows[0]?.status==='publishing')lost=true;if(lost)throw new Error('Writer ownership lost');}},{videoId:vid,limit:1,maxPages:1,maxReplyPages:1})).rejects.toThrow('ownership');
    const[empty]=await db.query<RowDataPacket[]>('SELECT videoId FROM urt_comment WHERE videoId=?',[vid]);expect(empty).toHaveLength(0);
    const replay=context(db,()=>{throw new Error('Replay must use completed checkpoint');});
    expect((await commentFetchJob(replay,{videoId:vid,limit:1,maxPages:1,maxReplyPages:1})).applied[0]?.complete).toBe(true);
    const[stages]=await db.query<RowDataPacket[]>('SELECT video_id FROM ts_comment_stages WHERE video_id=?',[vid]);expect(stages).toHaveLength(0);
    await db.execute('INSERT INTO urt_comment_queue (videoId,ctime) VALUES (?,?)',[vid,'2026-10-12 10:00:00']);
    expect((await commentFetchJob(ctx,{videoId:vid,limit:1,maxPages:1,maxReplyPages:1})).applied[0]?.complete).toBe(true);
    const[reverse]=await db.query<RowDataPacket[]>('SELECT r.index_json FROM urt_comment_rev r JOIN urt_comment_author a ON a.author_id=r.author_id WHERE a.ChannelId=?',[author]);expect(JSON.parse(reverse[0]?.index_json)).toEqual([vid]);
  }finally{await clean(db,uId,[vid],[author]);await db.end();}
});
it.skipIf(!enabled)('an API attempt-cap stop retains already published progress and untouched later queue work',async()=>{
  const db=await connect(),id=uid(),uId=await channel(db,id),a=uid(),b=uid();
  try{
    // Connection-local queue isolates selection without deleting fixtures owned by other tests.
    await db.query('CREATE TEMPORARY TABLE urt_comment_queue (pk INT NOT NULL AUTO_INCREMENT PRIMARY KEY, ctime DATETIME NOT NULL, stime DATETIME NULL, ftime DATETIME NULL, videoId VARCHAR(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL) ENGINE=MyISAM');
    await db.query('ALTER TABLE urt_comment_queue AUTO_INCREMENT=1900000000');
    await video(db,a,uId,id);await video(db,b,uId,id);
    const ctx=context(db,()=>({items:[]}));
    await commentQueueJob(ctx,{videoId:a,limit:1,hours:24,min:0});await commentQueueJob(ctx,{videoId:b,limit:1,hours:24,min:0});
    ctx.youtube=new YoutubeDataApiClient({keys:['fake'],maxAttempts:1,ledger:{precharge:async()=>'2026-10-11',markDailyExhausted:async()=>{}},now:()=>now,fetcher:async()=>new Response(JSON.stringify({items:[]}))});
    const result=await commentFetchJob(ctx,{limit:2,maxPages:1,maxReplyPages:1});
    expect(result.applied.map(r=>r.videoId)).toEqual([a]);expect(result.stoppedReason).toBe('quota-budget');expect(result.remaining).toBe(1);
    const[queue]=await db.query<RowDataPacket[]>('SELECT videoId FROM urt_comment_queue');expect(queue.map(r=>r.videoId)).toEqual([b]);
  }finally{await clean(db,uId,[a,b]);await db.end();}
});
it.skipIf(!enabled)('queue completion identity collision fails before publishing or overwriting another video history',async()=>{
  const db=await connect(),id=uid(),uId=await channel(db,id),vid=uid(),other=uid();
  try{
    await video(db,vid,uId,id);const ctx=context(db,()=>({items:[]}));
    await commentQueueJob(ctx,{videoId:vid,limit:1,hours:24,min:0});
    const[queue]=await db.query<RowDataPacket[]>('SELECT pk FROM urt_comment_queue WHERE videoId=?',[vid]);
    await db.execute('INSERT INTO urt_comment_queue_done (pk,ctime,videoId) VALUES (?,?,?)',[queue[0]?.pk,'2026-10-10 00:00:00',other]);
    expect((await commentFetchJob(ctx,{videoId:vid,limit:1,maxPages:1,maxReplyPages:1})).skipped).toHaveLength(1);
    const[done]=await db.query<RowDataPacket[]>('SELECT videoId FROM urt_comment_queue_done WHERE pk=?',[queue[0]?.pk]);expect(done[0]?.videoId).toBe(other);
    const[cache]=await db.query<RowDataPacket[]>('SELECT pk FROM urt_comment WHERE videoId=?',[vid]);expect(cache).toHaveLength(0);
  }finally{await clean(db,uId,[vid,other]);await db.end();}
});
it.skipIf(!enabled)('non-positive and missing channel statistics record only the failed attempt marker used by retirement',async()=>{
  const db=await connect(),id=uid(),uId=await channel(db,id);
  try{
    await db.execute('UPDATE urt_channel SET mtime=?,viewCount=100,videoCount=10 WHERE u_id=?',['2026-09-01 00:00:00',uId]);
    for(const items of [[{id,statistics:{viewCount:'0',videoCount:'0',subscriberCount:'0'}}],[]]){
      expect((await channelStatisticsJob(context(db,()=>({items})),{uId,limit:1})).skipped).toHaveLength(1);
      const[rows]=await db.query<RowDataPacket[]>('SELECT stime,mtime,viewCount,videoCount FROM urt_channel WHERE u_id=?',[uId]);
      expect(rows[0]?.stime).toBe('2026-10-12 10:00:00');expect(rows[0]?.mtime).toBe('2026-09-01 00:00:00');expect(Number(rows[0]?.viewCount)).toBe(100);expect(Number(rows[0]?.videoCount)).toBe(10);
      const[logs]=await db.query<RowDataPacket[]>('SELECT pk FROM urt_log WHERE u_id=?',[uId]);expect(logs).toHaveLength(0);
    }
  }finally{await clean(db,uId,[]);await db.end();}
});
it.skipIf(!enabled)('tag-52 live discovery (--live=1) ignores future vtime, handles premiere chronology and refreshes old metadata with five-item cadence',async()=>{
  const db=await connect(),id=uid(),uId=await channel(db,id),a=uid(),b=uid();
  try{
    await db.execute('UPDATE urt_channel SET vtime=? WHERE u_id=?',['2099-01-01 00:00:00',uId]);
    await db.execute('INSERT INTO urt_count (u_id,ctime,tags) VALUES (?,?,?)',[uId,'2026-10-10 00:00:00','[52]']);
    const ctx=context(db,url=>{expect(url.searchParams.get('maxResults')).toBe('5');return {items:[['2026-08-01T00:00:00Z',a],['2026-10-11T00:00:00Z',b]].map(([publishedAt,videoId],position)=>({id:'PI'+videoId,snippet:{resourceId:{videoId},publishedAt,channelId:id,title:'refreshed',description:'old and premiere',thumbnails:{default:{url:'https://i.ytimg.com/default.jpg'}},channelTitle:'test',playlistId:'UU'+id,position}})),nextPageToken:'more'};});
    const result=await channelUploadsJob(ctx,{uId,live:1,limit:1,maxPages:1,days:7});expect(result.applied[0]?.videos).toBe(2);
    const[rows]=await db.query<RowDataPacket[]>('SELECT videoId FROM urt_video WHERE u_id=?',[uId]);expect(rows).toHaveLength(2);
    const[channelRows]=await db.query<RowDataPacket[]>('SELECT vtime FROM urt_channel WHERE u_id=?',[uId]);expect(channelRows[0]?.vtime).toBe(nextUploadsCheck(now,1));
    // Verify the broad tagged selection SQL also bypasses vtime, without executing other fixture rows.
    await db.execute('UPDATE urt_channel SET vtime=? WHERE u_id=?',['2099-01-01 00:00:00',uId]);
    const preview=await channelUploadsJob({...ctx,execute:false},{live:1,limit:100,maxPages:1,days:7});expect(preview.selected).toBeGreaterThan(0);
  }finally{await clean(db,uId,[a,b]);await db.end();}
});
it.skipIf(!enabled)('comment claims exclude active/finished rows, renew across pages and preserve the final claim in done history',async()=>{
  const db=await connect(),id=uid(),uId=await channel(db,id),vid=uid();let time=new Date(now);
  try{
    await video(db,vid,uId,id);const ctx=context(db,url=>{time=new Date(time.getTime()+61000);return url.searchParams.has('pageToken')?{items:[]}:{items:[],nextPageToken:'empty-page-next'};});ctx.clock=()=>time;
    await commentQueueJob(ctx,{videoId:vid,limit:1,hours:24,min:0});
    await db.execute('UPDATE urt_comment_queue SET stime=? WHERE videoId=?',['2026-10-12 09:59:00',vid]);
    expect((await commentFetchJob(ctx,{videoId:vid,limit:1,maxPages:1,maxReplyPages:1})).selected).toBe(0);
    await db.execute('UPDATE urt_comment_queue SET stime=NULL,ftime=? WHERE videoId=?',['2026-10-12 09:59:00',vid]);
    expect((await commentFetchJob(ctx,{videoId:vid,limit:1,maxPages:1,maxReplyPages:1})).selected).toBe(0);
    await db.execute('UPDATE urt_comment_queue SET ftime=NULL WHERE videoId=?',[vid]);
    expect((await commentFetchJob(ctx,{videoId:vid,limit:1,maxPages:1,maxReplyPages:1})).checkpointed).toEqual([vid]);
    const[released]=await db.query<RowDataPacket[]>('SELECT stime FROM urt_comment_queue WHERE videoId=?',[vid]);expect(released[0]?.stime).toBeNull();
    expect((await commentFetchJob(ctx,{videoId:vid,limit:1,maxPages:1,maxReplyPages:1})).applied[0]?.complete).toBe(true);
    const[done]=await db.query<RowDataPacket[]>('SELECT stime FROM urt_comment_queue_done WHERE videoId=?',[vid]);expect(done[0]?.stime).toBe('2026-10-12 10:02:02');
    expect((await commentResetJob(ctx,vid)).applied).toEqual([vid]);
    const[requeued]=await db.query<RowDataPacket[]>('SELECT videoId FROM urt_comment_queue WHERE videoId=?',[vid]);expect(requeued).toHaveLength(1);
  }finally{await clean(db,uId,[vid]);await db.end();}
});
it.skipIf(!enabled)('legacy duplicate authors and empty object reverse indices do not block publication with excess embedded replies',async()=>{
  const db=await connect(),id=uid(),uId=await channel(db,id),vid=uid(),author=uid();
  try{
    await video(db,vid,uId,id);
    for(let i=0;i<2;i++){const[r]=await db.execute<ResultSetHeader>('INSERT INTO urt_comment_author (ctime,ChannelId,ChannelUrl,ImageUrl,DisplayName) VALUES (?,?,?,?,?)',['2026-10-01 00:00:00',author,'','','old']);await db.execute('INSERT INTO urt_comment_rev (author_id,ctime,index_json) VALUES (?,?,?)',[r.insertId,'2026-10-01 00:00:00',i?'':'{}']);}
    const ctx=context(db,()=>({items:[{id:'THREAD',snippet:{videoId:vid,channelId:id,totalReplyCount:0,topLevelComment:{id:'TOP',snippet:comment(author)}},replies:{comments:[{id:'TOP.reply',snippet:comment(author,'TOP')}]}}]}));
    await commentQueueJob(ctx,{videoId:vid,limit:1,hours:24,min:0});
    expect((await commentFetchJob(ctx,{videoId:vid,limit:1,maxPages:1,maxReplyPages:1})).applied[0]?.complete).toBe(true);
    const[rows]=await db.query<RowDataPacket[]>('SELECT replies_count FROM urt_comment WHERE videoId=?',[vid]);expect(Number(rows[0]?.replies_count)).toBe(1);
  }finally{await clean(db,uId,[vid],[author]);await db.end();}
});
it.skipIf(!enabled)('a real quota ledger charges the job once, ownership loss stops publication, and durable budget/breaker paths send no HTTP',async()=>{
  const db=await connect(),id=uid(),uId=await channel(db,id),date='2099-02-10',at=new Date('2099-02-10T20:00:00Z');let inserted=false,calls=0;
  try{
    await db.execute('INSERT INTO ingestion_youtube_quota_daily (provider,quota_date,consumed_units,reserved_units) VALUES (?,?,0,0)',['youtube_data_api_v3',date]);inserted=true;
    const ledger=new MysqlQuotaLedger(db,1,()=>at);
    const youtube=new YoutubeDataApiClient({keys:['fake'],ledger,now:()=>at,fetcher:async()=>{calls++;await db.query('SELECT RELEASE_ALL_LOCKS()');return new Response(JSON.stringify({items:[{id,statistics:{viewCount:'100',videoCount:'1',subscriberCount:'1'}}]}));}});
    await expect(withWriterLock(db,'test-source-real-quota',assertOwnership=>channelStatisticsJob({db,youtube,now:at,execute:true,assertOwnership},{uId,limit:1}))).rejects.toThrow('ownership');
    const[source]=await db.query<RowDataPacket[]>('SELECT mtime FROM urt_channel WHERE u_id=?',[uId]);expect(source[0]?.mtime).toBeNull();
    const usage=async()=>{const[r]=await db.query<RowDataPacket[]>('SELECT consumed_units FROM ingestion_youtube_quota_daily WHERE provider=? AND quota_date=?',['youtube_data_api_v3',date]);return Number(r[0]?.consumed_units);};expect(await usage()).toBe(1);
    const ctx={db,youtube,now:at,execute:true,assertOwnership:async()=>{}};
    await expect(channelStatisticsJob(ctx,{uId,limit:1})).rejects.toMatchObject({code:'quota-budget'});expect(calls).toBe(1);
    await ledger.markDailyExhausted(date);
    await expect(channelStatisticsJob(ctx,{uId,limit:1})).rejects.toMatchObject({code:'quota-exhausted'});expect(calls).toBe(1);expect(await usage()).toBe(1);
  }finally{if(inserted)await db.execute('DELETE FROM ingestion_youtube_quota_daily WHERE provider=? AND quota_date=?',['youtube_data_api_v3',date]);await clean(db,uId,[]);await db.end();}
});
it.skipIf(!enabled)('comment snapshots larger than 8 MiB publish through bounded resumable stages and capacity can be raised without destructive reset',async()=>{
  const db=await connect(),id=uid(),uId=await channel(db,id),vid=uid(),author=uid();
  try{
    await video(db,vid,uId,id);
    const ctx=context(db,url=>{const offset=url.searchParams.has('pageToken')?60:0;return {items:Array.from({length:60},(_,n)=>({id:'THREAD'+(n+offset),snippet:{videoId:vid,channelId:id,totalReplyCount:0,topLevelComment:{id:'TOP'+(n+offset),snippet:{...comment(author),textDisplay:'x'.repeat(45000),textOriginal:'y'.repeat(45000)}}}})),...(offset?{}:{nextPageToken:'second'})};});
    await commentQueueJob(ctx,{videoId:vid,limit:1,hours:24,min:0});
    const blocked=await commentFetchJob(ctx,{videoId:vid,limit:1,maxPages:1,maxReplyPages:1,maxStateMiB:1});expect(blocked.capacityBlocked).toBeTruthy();expect(blocked.skipped).toHaveLength(0);
    expect((await commentFetchJob(ctx,{videoId:vid,limit:1,maxPages:1,maxReplyPages:1})).checkpointed).toEqual([vid]);
    expect((await commentFetchJob(ctx,{videoId:vid,limit:1,maxPages:1,maxReplyPages:1})).applied[0]?.complete).toBe(true);
    const[cache]=await db.query<RowDataPacket[]>('SELECT comments_count,OCTET_LENGTH(comments_json) AS bytes FROM urt_comment WHERE videoId=?',[vid]);expect(Number(cache[0]?.comments_count)).toBe(120);expect(Number(cache[0]?.bytes)).toBeGreaterThan(8*1024*1024);
  }finally{await clean(db,uId,[vid],[author]);await db.end();}
});
