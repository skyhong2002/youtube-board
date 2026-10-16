import {createHash} from 'node:crypto';
import {describe,it,expect,beforeAll,beforeEach,afterAll} from 'vitest';
import mysql,{type Connection,type RowDataPacket} from 'mysql2/promise';
import {MySqlDialect} from 'drizzle-orm/mysql-core';
import {reports} from '../src/reports/service.js';
import {buildApp} from '../src/app.js';
import type {Reader} from '../src/db/client.js';
import {sourceTextFingerprint} from '../../shared/video-fingerprint.js';
import {assertTestDatabaseUrl} from '../../shared/test-database.js';
const url=process.env.TEST_DATABASE_URL?assertTestDatabaseUrl(process.env.TEST_DATABASE_URL):undefined;
// Synthetic publication with real source identity keys; snapshots without
// matchingRule select the legacy exact-text-v1 reader.
const fixtureTermKey=(term:string)=>createHash('sha256').update('https://tag.observe.tw\0'+term).digest('hex');
const fixtureVocabularyTerms=(terms:string[])=>terms.map(term=>({key:fixtureTermKey(term),term,articleCount:1,media:[]}));
const RULE='exact-text-v1';
describe.skipIf(!url)('video keyset pagination on connection-private MariaDB fixtures',()=>{
 let db:Connection;let now=new Date('2036-05-12T04:00:00Z');
 const dialect=new MySqlDialect(),queries:Array<{sql:string;params:unknown[]}>=[];
 const reader:Reader={rows:async query=>{const q=dialect.sqlToQuery(query);queries.push(q);const[rows]=await db.query<RowDataPacket[]>(q.sql,q.params);return rows as never;},close:async()=>{}};
 const service=reports(reader,()=>now),app=buildApp({reader,dataset:'fixture',clock:()=>now});
 const pks=['9007199254740991','9007199254740992','9007199254740993','9007199254740994','9007199254740995','9007199254740996'];
 const ids=['CursorAa001','Cursoraa001','CursorOld01','CursorLow01','CursorNil01','CursorNil02'];
 const times=['2036-05-12 11:00:00.123456','2036-05-12 11:00:00.123456','2036-05-12 11:00:00.123455','2036-05-11 12:00:00.000000',null,null];
 beforeAll(async()=>{
  db=await mysql.createConnection({uri:url!,dateStrings:true,supportBigNumbers:true,bigNumberStrings:true,timezone:'+08:00'});
  // Connection-local shadows exercise nullable DATETIME(6)/BIGINT precision without
  // altering any source table or shared fixture/schema. Closing the connection drops all.
  await db.query('CREATE TEMPORARY TABLE urt_video(pk BIGINT UNSIGNED PRIMARY KEY,videoId VARCHAR(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin,u_id INT,title VARCHAR(512),description TEXT,channelId VARCHAR(32),channelTitle VARCHAR(256),thumbnails VARCHAR(2048),publishedAt DATETIME(6) NULL,viewCount BIGINT,likeCount BIGINT,commentCount BIGINT,dislikeCount BIGINT,mtime DATETIME,ctime DATETIME,KEY publishedAt(publishedAt))');
  await db.query('CREATE TEMPORARY TABLE urt_count(u_id INT PRIMARY KEY,tags VARCHAR(100))');
  await db.query('CREATE TEMPORARY TABLE ts_vocabulary_runs(id VARCHAR(100) PRIMARY KEY,status VARCHAR(20),snapshot LONGTEXT)');
  await db.query('CREATE TEMPORARY TABLE ts_vocabulary_current(source VARCHAR(100) PRIMARY KEY,run_id VARCHAR(100))');
  await db.query('CREATE TEMPORARY TABLE ts_video_tag_matches(video_id VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin,vocabulary_version VARCHAR(100),source_pk BIGINT UNSIGNED,source_text_sha256 CHAR(64),rule_version VARCHAR(40),PRIMARY KEY(video_id,vocabulary_version))');
  await db.query('CREATE TEMPORARY TABLE ts_video_tag_evidence(video_id VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin,vocabulary_version VARCHAR(100),term VARCHAR(240),term_key CHAR(64),rule_version VARCHAR(40),field_name VARCHAR(16),snippet VARCHAR(512),start_offset INT,end_offset INT,snippet_start INT,PRIMARY KEY(video_id,vocabulary_version,term))');
  await db.query("INSERT INTO urt_count VALUES(1,'[1][2]'),(2,'[3]')");
 });
 beforeEach(async()=>{
  now=new Date('2036-05-12T04:00:00Z');queries.length=0;
  for(const table of ['urt_video','ts_vocabulary_current','ts_vocabulary_runs','ts_video_tag_matches','ts_video_tag_evidence'])await db.query('DELETE FROM '+table);
  await db.query("INSERT INTO ts_vocabulary_runs VALUES('cursor-v1','published',?),('cursor-v2','published',?)",Array(2).fill(JSON.stringify({terms:fixtureVocabularyTerms(['交通'])})));
  await db.query("INSERT INTO ts_vocabulary_current VALUES('https://tag.observe.tw','cursor-v1')");
  for(let i=0;i<ids.length;i++){
   await db.query("INSERT INTO urt_video VALUES(?,?,1,'交通','原文','fixture','測試','',?,?,1,2,0,'2036-05-12','2036-05-12')",[pks[i],ids[i],times[i],100+i]);
   await db.query("INSERT INTO ts_video_tag_matches(video_id,vocabulary_version,source_pk,source_text_sha256,rule_version) VALUES(?,'cursor-v1',?,?,?)",[ids[i],pks[i],sourceTextFingerprint('交通','原文'),RULE]);
   await db.query("INSERT INTO ts_video_tag_evidence VALUES(?,'cursor-v1','交通',?,?,'title','交通',0,2,0)",[ids[i],fixtureTermKey('交通'),RULE]);
  }
 });
 afterAll(async()=>{await app.close();await db?.end();});
 it('walks publication ties, adjacent BIGINTs, microseconds and NULL tail exactly once',async()=>{
  const seen:string[]=[];let cursor:string|undefined;
  do{const page=await service.videos({limit:'1',...(cursor?{cursor}:{})});seen.push(...page.rows.map(r=>r.id));if(page.nextCursor){const decoded=JSON.parse(Buffer.from(page.nextCursor,'base64url').toString());expect(typeof decoded.pk).toBe('string');if(seen.length===1)expect(decoded.publishedAt).toBe('2036-05-12 11:00:00.123456');}cursor=page.nextCursor??undefined;}while(cursor);
  expect(seen).toEqual([ids[1],ids[0],ids[2],ids[3],ids[5],ids[4]]);
  const first=await service.videos({limit:'2'});expect((await service.videos({limit:'3',cursor:first.nextCursor!})).rows.map(r=>r.id)).toEqual([ids[2],ids[3],ids[5]]);
 });
 it('preserves offset ordering/metadata and metric sorts omit cursor fields and PK-ceiling query',async()=>{
  const page=await service.videos({limit:'2',offset:'1'});expect(page.rows.map(r=>r.id)).toEqual([ids[0],ids[2]]);expect(page).toMatchObject({offset:1,total:6,totalStatus:'exact',hasNext:true});
  queries.length=0;const metric=await service.videos({column:'viewCount',limit:'2',offset:'1'});expect(metric.rows.map(r=>r.id)).toEqual([ids[4],ids[3]]);expect(metric).not.toHaveProperty('nextCursor');expect(queries.some(q=>q.sql.includes('cursor_max_pk'))).toBe(false);
 });
 it('excludes later inserts including backdated ones and does not claim immutable source rows',async()=>{
  const first=await service.videos({limit:'1'});
  await db.query("INSERT INTO urt_video SELECT 9007199254740997,'CursorNew01',u_id,title,description,channelId,channelTitle,thumbnails,'2036-05-12 10:30:00',viewCount,likeCount,commentCount,dislikeCount,mtime,ctime FROM urt_video WHERE pk=?",[pks[0]]);
  let next=await service.videos({limit:'50',cursor:first.nextCursor!});expect(next.rows.map(r=>r.id)).toEqual([ids[0],ids[2],ids[3],ids[5],ids[4]]);expect(next.total).toBe(6);
  await db.query('UPDATE urt_video SET title=? WHERE pk=?',['已修改',pks[0]]);
  next=await service.videos({limit:'50',cursor:first.nextCursor!});expect(next.rows[0]?.title).toBe('已修改');
 });
 it('keeps a valid cursor when the unchanged first-page offset read observes an in-flight insert',async()=>{
  let inserted=false;
  const racing:Reader={rows:async query=>{if(!inserted&&dialect.sqlToQuery(query).sql.includes('MIN(boundary.')){inserted=true;await db.query("INSERT INTO urt_video SELECT 9007199254740997,'CursorRace1',u_id,title,description,channelId,channelTitle,thumbnails,'2036-05-12 11:30:00',viewCount,likeCount,commentCount,dislikeCount,mtime,ctime FROM urt_video WHERE pk=?",[pks[0]]);}return reader.rows(query);},close:async()=>{}};
  const first=await reports(racing,()=>now).videos({limit:'1'});expect(first.rows[0]?.id).toBe('CursorRace1');
  expect((await service.videos({limit:'1',cursor:first.nextCursor!})).rows[0]?.id).toBe(ids[1]);
 });
 it('anchors hours and keyword days in Taipei while equivalent sets keep the binding',async()=>{
  const query={hours:'24',channelIds:'1,2',tagid:'2,1',limit:'1'};const first=await service.videos(query);now=new Date(+now+3600000);
  const page=await service.videos({...query,channelIds:'02,1,2',tagid:'1,2',limit:'50',cursor:first.nextCursor!});expect(page.rows.map(r=>r.id)).toEqual([ids[0],ids[2],ids[3]]);
  now=new Date('2036-05-12T15:59:59Z');const kw=await service.videos({keyword:'交通',days:'1',limit:'1'});now=new Date('2036-05-12T16:00:01Z');expect((await service.videos({keyword:'交通',days:'1',limit:'50',cursor:kw.nextCursor!})).rows.map(r=>r.id)).toEqual([ids[0],ids[2],ids[3]]);
 });
 it('rechecks exact keyword identity and source hash, and rejects a switched or withdrawn version with400',async()=>{
  const path='/api/v1/keywords/'+encodeURIComponent('交通')+'/videos?limit=1',first=(await app.inject(path)).json().data;
  await db.query('UPDATE urt_video SET title=? WHERE pk=?',['改字',pks[0]]);
  await db.query("UPDATE ts_video_tag_evidence SET term='交通 ' WHERE video_id=?",[ids[2]]);
  const url=path+'&cursor='+first.nextCursor,response=await app.inject(url);expect(response.statusCode).toBe(200);expect(response.json().data.rows[0].id).toBe(ids[3]);
  await db.query("UPDATE ts_vocabulary_current SET run_id='cursor-v2'");expect((await app.inject(url)).statusCode).toBe(400);
  await db.query('DELETE FROM ts_vocabulary_current');expect((await app.inject(url)).statusCode).toBe(400);
 });
 it('rejects mismatched filters, nonzero offset and metric cursor sorts; tampering cannot remove active SQL filters',async()=>{
  const first=await service.videos({limit:'1',min:'100',channelIds:'1'}),cursor=first.nextCursor!;
  for(const suffix of ['&min=101&channelIds=1','&min=100&channelIds=2','&min=100&channelIds=1&offset=1','&min=100&channelIds=1&column=viewCount'])expect((await app.inject('/api/v1/videos?cursor='+cursor+suffix)).statusCode).toBe(400);
  const token=JSON.parse(Buffer.from(cursor,'base64url').toString());token.pk='18446744073709551615';token.maxPk=token.pk;token.publishedAt='9999-12-31 23:59:59';const changed=Buffer.from(JSON.stringify(token)).toString('base64url');
  await db.query('UPDATE urt_video SET viewCount=1 WHERE pk=?',[pks[0]]);
  const result=await service.videos({min:'100',channelIds:'1',cursor:changed});expect(result.rows.some(r=>r.id===ids[0])).toBe(false);expect(result.rows.every(r=>r.channelId===1)).toBe(true);
 });
 it('cursor predicate remains parameterized and eligible for the existing publication index',async()=>{
  const first=await service.videos({limit:'1'});queries.length=0;await service.videos({limit:'1',cursor:first.nextCursor!});
  const query=queries.find(q=>q.sql.includes('v.pk<'))!;expect(query.sql).not.toContain('9007199254740992');
  const[plan]=await db.query<RowDataPacket[]>('EXPLAIN '+query.sql,query.params);expect(String(plan.find(r=>r.table==='v')?.possible_keys)).toContain('publishedAt');expect(queries.some(q=>q.sql.includes('MIN(boundary.'))).toBe(false);
 });
});
