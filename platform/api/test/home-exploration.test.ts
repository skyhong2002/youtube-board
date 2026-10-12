import {describe,it,expect,beforeAll,afterAll} from 'vitest';
import {randomUUID} from 'node:crypto';
import mysql,{type Connection,type ResultSetHeader,type RowDataPacket} from 'mysql2/promise';
import {homeCategories,homeExploration} from '../src/reports/home-exploration.js';
import {sql} from 'drizzle-orm';
import {MySqlDialect} from 'drizzle-orm/mysql-core';
import {createReader,DataSourceUnavailable,DataQueryFailed} from '../src/db/client.js';
import {assertTestDatabaseUrl} from '../../shared/test-database.js';
import {sourceTextFingerprint} from '../../shared/video-fingerprint.js';
import {buildApp} from '../src/app.js';
it('homepage categories use Laravel weekly-total order and explicitly overlapping memberships',()=>{
 const rows=[{u_id:1,tags:'[1][2][1]',view_week:100,mtime:'2026-10-11 12:00:00'},{u_id:2,tags:'[1]',view_week:300},{u_id:3,tags:'[2]',view_week:5},{u_id:4,tags:'[3]',view_week:80}];
 const result=homeCategories(rows,new Map([[1,'社論'],[2,'新聞'],[3,'直播']]));expect(result.rows.map(r=>r.weeklyViews)).toEqual([400,100,80]);expect(result.rows[0]).toMatchObject({channels:2,average:200,median:200});expect(result.summary).toEqual({visibleCategories:3,channelMemberships:4,uniqueChannels:3,weeklyViews:580,overlapping:true});expect(result.updatedAt).toBe('2026-10-11T12:00:00+08:00');
});
it('category top eight considers high-view low-channel categories and rejects unsafe numeric sums',()=>{
 const records=Array.from({length:10},(_,i)=>({u_id:i+1,tags:`[${i+1}]`,view_week:(i+1)*100}));expect(homeCategories(records,new Map()).rows.map(r=>r.id)).toEqual([10,9,8,7,6,5,4,3]);expect(()=>homeCategories([{u_id:1,tags:'[1]',view_week:Number.MAX_SAFE_INTEGER},{u_id:2,tags:'[1]',view_week:20}],new Map())).toThrow('precision');expect(()=>homeCategories([{u_id:1,tags:'[1]',view_week:'9007199254740993'}],new Map())).toThrow('precision');
});
const url=process.env.TEST_DATABASE_URL?assertTestDatabaseUrl(process.env.TEST_DATABASE_URL):undefined;
describe.skipIf(!url)('homepage maintained vocabulary and source metrics with MariaDB',()=>{
 let db:Connection,previous:string|undefined;const run='home-'+randomUUID(),prefix='HM'+randomUUID().replaceAll('-','').slice(0,7),now=new Date('2035-01-08T04:00:00Z'),from='2035-01-08 10:00:00',term='首頁範例詞',key='a'.repeat(64),reader=createReader(url),app=buildApp({databaseUrl:url,dataset:'fixture',clock:()=>now});
 const ids=Array.from({length:6},(_,i)=>prefix+String(i).padStart(2,'0'));
 beforeAll(async()=>{
  db=await mysql.createConnection({uri:url!,dateStrings:true});const[r]=await db.query<RowDataPacket[]>("SELECT run_id FROM ts_vocabulary_current WHERE source='https://tag.observe.tw'");previous=r[0]?.run_id;
  await db.execute("INSERT INTO ts_vocabulary_runs(id,window_since,window_until,status,snapshot) VALUES(?,'2035-01-01T00:00:00Z','2035-01-08T04:00:00Z','published',?)",[run,JSON.stringify({source:'https://tag.observe.tw',terms:[{key,term,articleCount:999999,media:['fixture']}],coverage:'observed-article-window',publishedAt:'2035-01-08T04:00:00Z'})]);
  await db.execute("INSERT INTO ts_vocabulary_current(source,run_id) VALUES('https://tag.observe.tw',?) ON DUPLICATE KEY UPDATE run_id=VALUES(run_id)",[run]);
  for(const [i,id] of ids.entries()){
   const title=i===3?'changed':term,published=i===4?'2034-12-01 10:00:00':i===5?'2035-01-09 10:00:00':from;
   const[r]=await db.execute<ResultSetHeader>("INSERT INTO urt_video(videoId,u_id,title,ctime,publishedAt,description,viewCount,id,channelId,thumbnails,channelTitle,playlistId,position) VALUES(?,1,?,?,?,?,?,'fixture','fixture','','fixture','fixture',0)",[id,title,from,published,term,i===1?null:100]);
   if(i===2)continue;
   await db.execute("INSERT INTO ts_video_tag_matches(video_id,vocabulary_version,source_pk,source_text_sha256,source_observed_at,matched_at,rule_version,evidence_count) VALUES(?,?,?,?,?,'2035-01-08 03:00:00','fixture',2)",[id,run,r.insertId,sourceTextFingerprint(term,term),from]);
   for(const field of ['title','description'])await db.execute("INSERT INTO ts_video_tag_evidence(video_id,vocabulary_version,term_key,term,source,field_name,start_offset,end_offset,matched_text,snippet,snippet_start,rule_version) VALUES(?,?,?,?,'https://tag.observe.tw',?,0,5,?,?,0,'fixture')",[id,run,key,term,field,term,term]);
  }
 });
 afterAll(async()=>{await reader.close();await app.close();if(!db)return;if(previous)await db.execute("UPDATE ts_vocabulary_current SET run_id=? WHERE source='https://tag.observe.tw' AND run_id=?",[previous,run]);else await db.execute("DELETE FROM ts_vocabulary_current WHERE source='https://tag.observe.tw' AND run_id=?",[run]);await db.execute('DELETE FROM ts_video_tag_matches WHERE vocabulary_version=?',[run]);await db.execute('DELETE FROM ts_vocabulary_runs WHERE id=?',[run]);for(const id of ids)await db.execute('DELETE FROM urt_video WHERE BINARY videoId=BINARY ?',[id]);await db.end();});
 it('deduplicates title/description evidence and exposes fresh/stale/unmatched with unknown views',async()=>{
  const r=await homeExploration(reader,now);expect(r.keywords.rows).toEqual([{key,term,videoCount:2,views:null,unknownViewVideos:1}]);expect(r.keywords).toMatchObject({sourceVideos:4,freshVideos:2,staleVideos:1,unprocessedVideos:1,version:run});expect(r.keywords.from).toBe('2035-01-02T00:00:00+08:00');expect(r.keywords.rows[0]?.videoCount).not.toBe(999999);
 });
 it('statistics mtime changes do not stale textual matching, but title changes do',async()=>{
  await db.execute("UPDATE urt_video SET mtime='2035-01-08 12:00:00' WHERE BINARY videoId=BINARY ?",[ids[0]]);expect((await homeExploration(reader,now)).keywords.rows[0]?.videoCount).toBe(2);
  await db.execute("UPDATE urt_video SET title='edited' WHERE BINARY videoId=BINARY ?",[ids[0]]);try{const result=await homeExploration(reader,now);expect(result.keywords.rows[0]?.videoCount).toBe(1);expect(result.keywords.staleVideos).toBe(2);}finally{await db.execute('UPDATE urt_video SET title=? WHERE BINARY videoId=BINARY ?',[term,ids[0]]);}
 });
 it('freshness includes fresh scanned videos without ranked terms and uses exact TIMESTAMP epoch',async()=>{
  const[r]=await db.query<RowDataPacket[]>('SELECT pk FROM urt_video WHERE BINARY videoId=BINARY ?',[ids[2]]);
  await db.execute("INSERT INTO ts_video_tag_matches(video_id,vocabulary_version,source_pk,source_text_sha256,matched_at,rule_version,evidence_count) VALUES(?,?,?,?,'2035-01-08 04:00:00','fixture',0)",[ids[2],run,r[0]!.pk,sourceTextFingerprint(term,term)]);
  try{const result=await homeExploration(reader,now);expect(result.keywords.rows[0]?.videoCount).toBe(2);expect(result.keywords.freshVideos).toBe(3);expect(result.keywords.updatedAt).toBe('2035-01-08T04:00:00.000Z');}finally{await db.execute('DELETE FROM ts_video_tag_matches WHERE video_id=? AND vocabulary_version=?',[ids[2],run]);}
 });
 it('Taipei source DATETIME window includes exact bounds and excludes adjacent seconds',async()=>{
  try{for(const [published,expected] of [['2035-01-01 23:59:59',1],['2035-01-02 00:00:00',2],['2035-01-08 12:00:00',2],['2035-01-08 12:00:01',1]] as const){await db.execute('UPDATE urt_video SET publishedAt=? WHERE BINARY videoId=BINARY ?',[published,ids[0]]);expect((await homeExploration(reader,now)).keywords.rows[0]?.videoCount).toBe(expected);}}finally{await db.execute('UPDATE urt_video SET publishedAt=? WHERE BINARY videoId=BINARY ?',[from,ids[0]]);}
 });
 it('optional matching timeout keeps core homepage but unexpected schema errors remain HTTP500',async()=>{
  const dialect=new MySqlDialect();for(const [error,status] of [[new DataSourceUnavailable(),200],[new DataQueryFailed('ER_BAD_FIELD_ERROR'),500]] as const){const isolated=buildApp({dataset:'fixture',clock:()=>now,reader:{rows:async query=>{if(dialect.sqlToQuery(query).sql.includes('ts_video_tag_matches'))throw error;return reader.rows(query);},close:async()=>{}}});try{const r=await isolated.inject('/api/v1/home');expect(r.statusCode).toBe(status);if(status===200){expect(r.json().data.exploration.keywords).toMatchObject({status:'unavailable',sourceVideos:null});expect(r.json().data.channels).toBeInstanceOf(Array);expect(r.json().data.exploration.categories.status).toBe('available');expect(r.json().meta.warnings).toContain('關鍵字統計目前無法完整讀取。');}}finally{await isolated.close();}}
 });
 it('invalid aggregate coverage never becomes a fabricated zero',async()=>{
  const dialect=new MySqlDialect();const result=await homeExploration({rows:async query=>dialect.sqlToQuery(query).sql.includes('AS source_videos')?reader.rows(sql`SELECT '9007199254740993' AS source_videos,0 AS fresh,0 AS stale,0 AS unprocessed`):reader.rows(query),close:async()=>{}},now);expect(result.keywords).toMatchObject({status:'unavailable',reason:'precision',sourceVideos:null,freshVideos:null});
 });
 it('home preserves channels/live/daily fields alongside new exploration panels',async()=>{const r=await app.inject('/api/v1/home');expect(r.statusCode).toBe(200);const d=r.json().data;for(const key of ['channels','live','events','tags'])expect(Array.isArray(d[key])).toBe(true);expect(d.exploration.keywords.rows[0].videoCount).toBe(2);expect(d.exploration.categories.summary.overlapping).toBe(true);});
 it('unsynchronized vocabulary yields explicit unknown coverage rather than news or legacy keyword substitutes',async()=>{await db.execute("DELETE FROM ts_vocabulary_current WHERE source='https://tag.observe.tw' AND run_id=?",[run]);try{expect((await homeExploration(reader,now)).keywords).toMatchObject({status:'not-synchronized',rows:[],freshVideos:null,sourceVideos:null});}finally{await db.execute("INSERT INTO ts_vocabulary_current(source,run_id) VALUES('https://tag.observe.tw',?)",[run]);}});
});
