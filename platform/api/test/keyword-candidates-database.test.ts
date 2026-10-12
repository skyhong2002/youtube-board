import {readFile} from 'node:fs/promises';
import {createHash,randomBytes} from 'node:crypto';
import mysql,{type Connection,type RowDataPacket} from 'mysql2/promise';
import {MySqlDialect} from 'drizzle-orm/mysql-core';
import {beforeAll,afterAll,it,describe,expect} from 'vitest';
import {DataSourceUnavailable,type Reader} from '../src/db/client.js';
import {reports} from '../src/reports/service.js';
import {sourceTextFingerprint} from '../../shared/video-fingerprint.js';
import {assertTestDatabaseUrl} from '../../shared/test-database.js';
const url=process.env.TEST_DATABASE_URL?assertTestDatabaseUrl(process.env.TEST_DATABASE_URL):undefined;
const dialect=new MySqlDialect();
const clock=()=>new Date('2026-10-12T04:00:00Z');
describe.skipIf(!url)('candidate-first keyword reports on isolated real MariaDB tables',()=>{
 const prefix='kw_'+randomBytes(5).toString('hex')+'_';
 const tables=['urt_video','urt_count','ts_vocabulary_runs','ts_vocabulary_current','ts_video_tag_matches','ts_video_tag_evidence'];
 const replace=(statement:string)=>statement.replace(new RegExp('\\b('+tables.join('|')+')\\b','g'),name=>prefix+name);
 const created:string[]=[];let db:Connection;
 const queries:Array<ReturnType<typeof dialect.sqlToQuery>>=[];
 let coverageTimeout=false,observedDeadline=false;
 const reader:Reader={async rows(q){const query=dialect.sqlToQuery(q);queries.push(query);
  try{
   if(coverageTimeout&&query.sql.includes('AS sourceVideos')){
    await db.query('SET STATEMENT max_statement_time=0.01 FOR SELECT SLEEP(0.1)');
    throw new Error('Expected actual MariaDB deadline');
   }
   const[rows]=await db.query<RowDataPacket[]>('SET STATEMENT max_statement_time=2 FOR '+replace(query.sql),query.params);return rows as never;
  }catch(error){const e=error as {errno?:number};if(e.errno===1969){observedDeadline=true;throw new DataSourceUnavailable();}throw error;}
 },async close(){}};
 const term='交通',key=createHash('sha256').update('https://tag.observe.tw\0'+term).digest('hex');
 const ids=['CandAa00001','Candaa00001','CandOld0001','CandStale01','CandWrong01','CandPad0001','CandMulti01'];
 beforeAll(async()=>{
  db=await mysql.createConnection({uri:url!,dateStrings:true,supportBigNumbers:true,bigNumberStrings:true,timezone:'+08:00'});
  const ddl=(await Promise.all([
   '../../../database/schema/legacy-dashboard-baseline.sql','../../jobs/migrations/001_vocabulary.sql','../../jobs/migrations/002_video_tag_evidence.sql',
  ].map(path=>readFile(new URL(path,import.meta.url),'utf8')))).join('\n');
  for(const name of tables){const definition=new RegExp('CREATE TABLE IF NOT EXISTS `?'+name+'`? \\([\\s\\S]*?\\) ENGINE=[^;]+;').exec(ddl)?.[0];if(!definition)throw new Error('Missing test DDL');await db.query(replace(definition));created.push(name);}
  await db.query(replace("INSERT INTO ts_vocabulary_runs(id,window_since,window_until,status,snapshot) VALUES('candidate-v1','','','published','{}')"));
  await db.query(replace("INSERT INTO ts_vocabulary_current VALUES('https://tag.observe.tw','candidate-v1')"));
  await db.query(replace("INSERT INTO urt_count(u_id,ctime,tags) VALUES(1,'2026-10-01','[1]'),(2,'2026-10-01','[2]')"));
  for(const [i,id] of ids.entries()){
   const pk=i+1,title=term+'標題',published=i===2?'2020-01-01 00:00:00':'2026-10-11 12:00:00';
   await db.query(replace("INSERT INTO urt_video(pk,ctime,mtime,u_id,id,publishedAt,channelId,title,thumbnails,channelTitle,playlistId,position,videoId,description,viewCount,likeCount,commentCount) VALUES(?,'2026-10-01','2026-10-12',?,?,?,'UCfixture',?,'','Fixture','fixture',0,?,'原文',?,10,20)"),[pk,i===2?2:1,id,published,title,id,i===2?500:100]);
   await db.query(replace("INSERT INTO ts_video_tag_matches(video_id,vocabulary_version,source_pk,source_text_sha256,rule_version,evidence_count) VALUES(?,'candidate-v1',?,?,'exact-text-v1',1)"),[id,i===4?0:pk,sourceTextFingerprint(i===3?'stale title':title,'原文')]);
   for(let occurrence=0;occurrence<(i===6?3:1);occurrence++)await db.query(replace("INSERT INTO ts_video_tag_evidence(video_id,vocabulary_version,term_key,term,source,field_name,start_offset,end_offset,matched_text,snippet,snippet_start,rule_version) VALUES(?,'candidate-v1',?,?,'https://tag.observe.tw','title',?,?,'交通','交通',0,'exact-text-v1')"),[id,key,i===5?'交通 ':term,occurrence*2,occurrence*2+2]);
  }
  // Noise is newer than the rare evidence, exercising the former full-history
  // walk. Only the candidate term range should drive video row lookups now.
  for(let start=0;start<12000;start+=1000){const rows=Array.from({length:1000},(_,j)=>{const n=start+j,id='Noise'+String(n).padStart(6,'0');return [100+n,'2026-10-12','2026-10-12',1,id,'2026-10-12 08:00:00','UCfixture','unrelated','','Fixture','fixture',0,id,'',0];});await db.query(replace('INSERT INTO urt_video(pk,ctime,mtime,u_id,id,publishedAt,channelId,title,thumbnails,channelTitle,playlistId,position,videoId,description,viewCount) VALUES ?'),[rows]);}
 },15000);
 afterAll(async()=>{try{for(const name of [...created].reverse())await db.query('DROP TABLE `'+prefix+name+'`');}finally{await db?.end();}});
 it('returns rare all-history matches once, excluding stale text/PK and padded labels while preserving case-distinct IDs',async()=>{
  const result=await reports(reader,clock).videos({keyword:term});
  expect(result.rows.map(r=>r.id)).toEqual([ids[6],ids[1],ids[0],ids[2]]);expect(result.total).toBe(4);expect(result.hasNext).toBe(false);
  expect(result.evidenceCoverage).toMatchObject({coverageStatus:'not-calculated',sourceVideos:null,keywordMatchedVideos:4});
 });
 it('handles zero-match no-date reads without imposing a hidden time or candidate cap',async()=>{
  const result=await reports(reader,clock).videos({keyword:'不存在的維護詞'});
  expect(result).toMatchObject({rows:[],total:0,hasNext:false,totalStatus:'exact'});
  expect(result.evidenceCoverage?.sourceVideos).toBeNull();
 });
 it('preserves ties, offset/limits, metric order and scope filters',async()=>{
  const service=reports(reader,clock);
  const page=await service.videos({keyword:term,limit:'1',offset:'1'});expect(page.rows.map(r=>r.id)).toEqual([ids[1]]);expect(page.hasNext).toBe(true);expect(page.total).toBe(4);
  expect((await service.videos({keyword:term,column:'viewCount',limit:'2'})).rows.map(r=>r.id)).toEqual([ids[2],ids[6]]);
  expect((await service.videos({keyword:term,channelId:'2'})).rows.map(r=>r.id)).toEqual([ids[2]]);
  expect((await service.videos({keyword:term,tagid:'1',days:'7'})).rows.map(r=>r.id)).toEqual([ids[6],ids[1],ids[0]]);
  expect((await service.videos({keyword:term,min:'101'})).rows.map(r=>r.id)).toEqual([ids[2]]);
  expect((await service.videos({keyword:'交通 '})).rows).toEqual([]);
 });
 it('EXPLAIN uses the term range index and video identity ref lookup instead of the publication index scan',async()=>{
  const relevant=queries.filter(q=>q.sql.includes('keyword_candidates')&&q.params.includes(term)).slice(0,3);
  expect(relevant).toHaveLength(3);
  for(const query of relevant){
   const[plan]=await db.query<RowDataPacket[]>('EXPLAIN '+replace(query.sql),query.params);
   const candidate=plan.find(row=>row.table==='e'&&row.key==='version_term');expect(candidate,JSON.stringify(plan)).toBeDefined();expect(['ref','range']).toContain(candidate!.type);
   const video=plan.find(row=>row.table==='v');expect(video,JSON.stringify(plan)).toBeDefined();expect(video!.key).toBe('videoId');expect(['ref','eq_ref']).toContain(video!.type);expect(Number(video!.rows)).toBeLessThanOrEqual(1);
   const newer=plan.find(row=>row.table==='newer');expect(newer,JSON.stringify(plan)).toBeDefined();expect(newer!.key).toBe('videoId');expect(['ref','eq_ref']).toContain(newer!.type);
  }
 });
 it('retains exact selected rows after a real server coverage deadline and does not cache unavailable counts',async()=>{
  coverageTimeout=true;const service=reports(reader,clock);
  try{const result=await service.videos({keyword:term,from:'2020-01-01'});expect(observedDeadline).toBe(true);expect(result.total).toBe(4);expect(result.rows).toHaveLength(4);expect(result.evidenceCoverage).toMatchObject({coverageStatus:'unavailable',sourceVideos:null,freshVideos:null,staleVideos:null,unprocessedVideos:null});}
  finally{coverageTimeout=false;}
  expect((await service.videos({keyword:term,from:'2020-01-01'})).evidenceCoverage?.coverageStatus).toBe('available');
 });
 it('does not resurrect an old duplicate whose marker is still fresh for the older source PK',async()=>{
  await db.query(replace('ALTER TABLE urt_video DROP INDEX videoId, ADD INDEX videoId(videoId)'));
  await db.query(replace('INSERT INTO urt_video(ctime,mtime,u_id,id,publishedAt,channelId,title,thumbnails,channelTitle,playlistId,position,videoId,description,viewCount) SELECT ctime,mtime,u_id,id,publishedAt,channelId,title,thumbnails,channelTitle,playlistId,position,videoId,description,viewCount FROM urt_video WHERE pk=1'));
  const result=await reports(reader,clock).videos({keyword:term});expect(result.rows.map(r=>r.id)).toEqual([ids[6],ids[1],ids[2]]);expect(result.total).toBe(3);
 });
});
