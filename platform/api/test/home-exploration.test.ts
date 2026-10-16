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
 const result=homeCategories(rows,new Map([[1,'社論'],[2,'新聞'],[3,'直播']]));expect(result.rows.map(r=>r.weeklyViews)).toEqual([400,100,80]);expect(result.rows[0]).toMatchObject({channels:2,average:200,median:200});expect(result.summary).toEqual({visibleCategories:3,channelMemberships:4,uniqueChannels:3,weeklyViews:580,overlapping:true});expect(Date.parse(result.updatedAt!)).toBe(Date.parse('2026-10-11T04:00:00.000Z'));
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
  await db.execute("INSERT INTO ts_vocabulary_runs(id,window_since,window_until,status,snapshot) VALUES(?,'2035-01-01T00:00:00Z','2035-01-08T04:00:00Z','published',?)",[run,JSON.stringify({source:'https://tag.observe.tw',terms:[{key,term,articleCount:999999,media:['fixture']}],matchingRule:'youtube-quality-v2',coverage:'observed-article-window',publishedAt:'2035-01-08T04:00:00Z'})]);
  await db.execute("INSERT INTO ts_vocabulary_current(source,run_id) VALUES('https://tag.observe.tw',?) ON DUPLICATE KEY UPDATE run_id=VALUES(run_id)",[run]);
  for(const [i,id] of ids.entries()){
   const title=i===3?'changed':term,published=i===4?'2034-12-01 10:00:00':i===5?'2035-01-09 10:00:00':from;
   const[r]=await db.execute<ResultSetHeader>("INSERT INTO urt_video(videoId,u_id,title,ctime,publishedAt,description,viewCount,id,channelId,thumbnails,channelTitle,playlistId,position) VALUES(?,1,?,?,?,?,?,'fixture','fixture','','fixture','youtube-quality-v2',0)",[id,title,from,published,term,i===1?null:100]);
   if(i===2)continue;
   await db.execute("INSERT INTO ts_video_tag_matches(video_id,vocabulary_version,source_pk,source_text_sha256,source_observed_at,matched_at,rule_version,evidence_count) VALUES(?,?,?,?,?,'2035-01-08 03:00:00','youtube-quality-v2',2)",[id,run,r.insertId,sourceTextFingerprint(term,term),from]);
   for(const field of ['title','description'])await db.execute("INSERT INTO ts_video_tag_evidence(video_id,vocabulary_version,term_key,term,source,field_name,start_offset,end_offset,matched_text,snippet,snippet_start,rule_version) VALUES(?,?,?,?,'https://tag.observe.tw',?,0,5,?,?,0,'youtube-quality-v2')",[id,run,key,term,field,term,term]);
  }
 });
 afterAll(async()=>{await reader.close();await app.close();if(!db)return;if(previous)await db.execute("UPDATE ts_vocabulary_current SET run_id=? WHERE source='https://tag.observe.tw' AND run_id=?",[previous,run]);else await db.execute("DELETE FROM ts_vocabulary_current WHERE source='https://tag.observe.tw' AND run_id=?",[run]);await db.execute('DELETE FROM ts_video_tag_matches WHERE vocabulary_version=?',[run]);await db.execute('DELETE FROM ts_vocabulary_runs WHERE id=?',[run]);for(const id of ids)await db.execute('DELETE FROM urt_video WHERE BINARY videoId=BINARY ?',[id]);await db.end();});
 it('deduplicates title/description evidence and exposes fresh/stale/unmatched with unknown views',async()=>{
  const r=await homeExploration(reader,now);expect(r.keywords.rows).toMatchObject([{key,term,videoCount:2,views:null,unknownViewVideos:1,knownViews:100,measuredViewVideos:1,channelCount:1,titleVideos:2,descriptionOnlyVideos:0,heatScore:4.5,rise:null}]);expect(r.keywords).toMatchObject({sourceVideos:4,freshVideos:2,staleVideos:1,unprocessedVideos:1,version:run});expect(Date.parse(r.keywords.from)).toBe(Date.parse('2035-01-01T16:00:00.000Z'));expect(r.keywords.rows[0]?.videoCount).not.toBe(999999);expect(r.keywords.rows[0]?.thumbnail).toMatch(/^https:\/\/i.ytimg.com\/vi\//);expect(r.keywords.rows[0]?.channel?.id).toBe(1);
 });
 it('duplicate source rows do not inflate coverage or supersede newest evidence',async()=>{
  // The development schema has a UNIQUE videoId; model legacy duplicate-capable
  // snapshots in a connection-local table without changing any shared schema.
  await db.query('CREATE TEMPORARY TABLE f2_duplicate_videos AS SELECT * FROM urt_video WHERE videoId IN ('+ids.map(()=>'?').join(',')+')',ids);
  const [old]=await db.query<RowDataPacket[]>('SELECT pk FROM f2_duplicate_videos WHERE BINARY videoId=BINARY ?',[ids[0]]);
  const [max]=await db.query<RowDataPacket[]>('SELECT MAX(pk)+1 AS pk FROM f2_duplicate_videos');const duplicatePk=Number(max[0]!.pk);
  const dialect=new MySqlDialect(),duplicateReader={rows:async(query:Parameters<typeof reader.rows>[0])=>{const q=dialect.sqlToQuery(query);const [rows]=await db.query(q.sql.replaceAll('urt_video','f2_duplicate_videos'),q.params);return rows as never;},close:async()=>{}};
  try{
   await db.execute("INSERT INTO f2_duplicate_videos(pk,videoId,u_id,title,ctime,publishedAt,description,viewCount,id,channelId,thumbnails,channelTitle,playlistId,position) VALUES(?,?,1,?,?,?,?,100,'fixture','fixture','','fixture','youtube-quality-v2',0)",[duplicatePk,ids[0],term,from,from,term]);
   const stale=await homeExploration(duplicateReader,now);expect(stale.keywords).toMatchObject({sourceVideos:4,freshVideos:1,staleVideos:2});
   await db.execute('UPDATE ts_video_tag_matches SET source_pk=? WHERE video_id=? AND vocabulary_version=?',[duplicatePk,ids[0],run]);
   const fresh=await homeExploration(duplicateReader,now);expect(fresh.keywords).toMatchObject({sourceVideos:4,freshVideos:2,staleVideos:1});expect(fresh.keywords.rows[0]?.videoCount).toBe(2);
  }finally{await db.execute('UPDATE ts_video_tag_matches SET source_pk=? WHERE video_id=? AND vocabulary_version=?',[old[0]!.pk,ids[0],run]);await db.query('DROP TEMPORARY TABLE f2_duplicate_videos');}
 });
 it.each(['exact-text-v1','youtube-quality-v2'])('homepage and support count agree for merged aliases under %s',async rule=>{
  const keys=['b'.repeat(64),'c'.repeat(64)];
  const [runs]=await db.query<RowDataPacket[]>('SELECT snapshot FROM ts_vocabulary_runs WHERE id=?',[run]);const original=runs[0]!.snapshot;const snapshot=JSON.parse(original);
  try{
   snapshot.matchingRule=rule;snapshot.terms.push({key:keys[0],term:'OpenAI'},{key:keys[1],term:'openai'});
   await db.execute('UPDATE ts_vocabulary_runs SET snapshot=? WHERE id=?',[JSON.stringify(snapshot),run]);
   for(const [i,label] of ['OpenAI','openai'].entries())await db.execute("INSERT INTO ts_video_tag_evidence(video_id,vocabulary_version,term_key,term,source,field_name,start_offset,end_offset,matched_text,snippet,snippet_start,rule_version) VALUES(?,?,?,?,'https://tag.observe.tw','description',0,5,?,?,0,?)",[ids[i],run,keys[i],label,label,label,rule]);
   await db.execute('UPDATE ts_video_tag_matches SET rule_version=? WHERE vocabulary_version=?',[rule,run]);
   const ranked=(await homeExploration(reader,now)).keywordToday.rows.find(r=>r.term==='OpenAI');
   const listing=await app.inject('/api/v1/keywords/OpenAI/videos?from=2035-01-08&to=2035-01-08');
   expect(listing.statusCode,listing.body).toBe(200);expect(ranked?.videoCount).toBe(2);expect(listing.json().data.total).toBe(ranked?.videoCount);
  }finally{
   await db.execute('DELETE FROM ts_video_tag_evidence WHERE vocabulary_version=? AND term_key IN (?,?)',[run,...keys]);
   await db.execute("UPDATE ts_video_tag_matches SET rule_version='youtube-quality-v2' WHERE vocabulary_version=?",[run]);
   await db.execute('UPDATE ts_vocabulary_runs SET snapshot=? WHERE id=?',[original,run]);
  }
 });
 it('keyword-scoped v2 listings resolve pool identities and attach bounded current snippets with real SQL',async()=>{
  const response=await app.inject('/api/v1/keywords/'+encodeURIComponent(term)+'/videos?from=2035-01-08&to=2035-01-08');
  expect(response.statusCode,response.body).toBe(200);const rows=response.json().data.rows;expect(rows).toHaveLength(2);
  for(const row of rows){expect(row.keywordEvidence).toHaveLength(2);expect(row.keywordEvidence[0]).toMatchObject({term,field:'title',start:0,end:5,snippet:term,snippetStart:0});}
 });
 it('today starts at Taipei midnight and keeps independent coverage from seven calendar days',async()=>{
  try{for(const [published,todayCount,todaySources] of [['2035-01-07 23:59:59',1,3],['2035-01-08 00:00:00',2,4],['2035-01-08 12:00:00',2,4],['2035-01-08 12:00:01',1,3]] as const){
   await db.execute('UPDATE urt_video SET publishedAt=? WHERE BINARY videoId=BINARY ?',[published,ids[0]]);
   const result=await homeExploration(reader,now);
   expect(result.keywordToday).toMatchObject({from:'2035-01-07T16:00:00.000Z',to:'2035-01-08T04:00:00.000Z',sourceVideos:todaySources,freshVideos:todayCount,staleVideos:1,unprocessedVideos:1,version:run});
   expect(result.keywordToday.rows[0]).toMatchObject({videoCount:todayCount,views:null,unknownViewVideos:1});
   expect(result.keywords.rows[0]?.videoCount).toBe(published==='2035-01-08 12:00:01'?1:2);
  }}finally{await db.execute('UPDATE urt_video SET publishedAt=? WHERE BINARY videoId=BINARY ?',[from,ids[0]]);}
 });
 it('each window independently selects up to forty cloud terms rather than filtering the weekly top forty',async()=>{
  const extraKeys=Array.from({length:43},(_,i)=>i===42?'f'.repeat(64):i.toString(16).padStart(64,'0'));
  try{
   await db.execute("UPDATE urt_video SET publishedAt='2035-01-07 10:00:00' WHERE BINARY videoId=BINARY ?",[ids[0]]);
   for(const [i,extraKey] of extraKeys.entries())await db.execute("INSERT INTO ts_video_tag_evidence(video_id,vocabulary_version,term_key,term,source,field_name,start_offset,end_offset,matched_text,snippet,snippet_start,rule_version) VALUES(?,?,?,?,'https://tag.observe.tw','title',0,5,?,?,0,'youtube-quality-v2')",[ids[i===42?1:0],run,extraKey,`排行詞${i}`,term,term]);
   const result=await homeExploration(reader,now);
   expect(result.keywords.rows).toHaveLength(40);expect(result.keywordToday.rows).toHaveLength(2);
   expect(result.keywords.rows.some(r=>r.key==='f'.repeat(64))).toBe(false);
   expect(result.keywordToday.rows.some(r=>r.key==='f'.repeat(64))).toBe(true);
   expect(result.keywords.rows[0]?.key).toBe(key);
   expect(result.keywordToday.sourceVideos).toBe(3);expect(result.keywords.sourceVideos).toBe(4);
  }finally{
   await db.execute('DELETE FROM ts_video_tag_evidence WHERE vocabulary_version=? AND term_key<>?',[run,key]);
   await db.execute('UPDATE urt_video SET publishedAt=? WHERE BINARY videoId=BINARY ?',[from,ids[0]]);
  }
 });
 it('statistics mtime changes do not stale textual matching, but title changes do',async()=>{
  await db.execute("UPDATE urt_video SET mtime='2035-01-08 12:00:00' WHERE BINARY videoId=BINARY ?",[ids[0]]);expect((await homeExploration(reader,now)).keywords.rows[0]?.videoCount).toBe(2);
  await db.execute("UPDATE urt_video SET title='edited' WHERE BINARY videoId=BINARY ?",[ids[0]]);try{const result=await homeExploration(reader,now);expect(result.keywords.rows[0]?.videoCount).toBe(1);expect(result.keywords.staleVideos).toBe(2);}finally{await db.execute('UPDATE urt_video SET title=? WHERE BINARY videoId=BINARY ?',[term,ids[0]]);}
 });
 it('source PK drift stays stale and case-only marker identities never match another video',async()=>{
  const [rows]=await db.query<RowDataPacket[]>('SELECT pk FROM urt_video WHERE BINARY videoId=BINARY ?',[ids[0]]),pk=rows[0]!.pk;
  await db.execute('UPDATE ts_video_tag_matches SET source_pk=0 WHERE video_id=? AND vocabulary_version=?',[ids[0],run]);
  try{const result=await homeExploration(reader,now);expect(result.keywords).toMatchObject({freshVideos:1,staleVideos:2,unprocessedVideos:1});expect(result.keywords.rows[0]?.videoCount).toBe(1);}finally{await db.execute('UPDATE ts_video_tag_matches SET source_pk=? WHERE video_id=? AND vocabulary_version=?',[pk,ids[0],run]);}
  const caseId=ids[0]!.replace('HM','hm');
  await db.execute("INSERT INTO ts_video_tag_matches(video_id,vocabulary_version,source_pk,source_text_sha256,rule_version,evidence_count) VALUES(?,?,?,?,'youtube-quality-v2',1)",[caseId,run,pk,sourceTextFingerprint(term,term)]);
  await db.execute("INSERT INTO ts_video_tag_evidence(video_id,vocabulary_version,term_key,term,source,field_name,start_offset,end_offset,matched_text,snippet,snippet_start,rule_version) VALUES(?,?,?,?,'https://tag.observe.tw','title',0,5,?,?,0,'youtube-quality-v2')",[caseId,run,key,term,term,term]);
  try{const result=await homeExploration(reader,now);expect(result.keywords).toMatchObject({sourceVideos:4,freshVideos:2,staleVideos:1,unprocessedVideos:1});expect(result.keywords.rows[0]?.videoCount).toBe(2);}finally{await db.execute('DELETE FROM ts_video_tag_matches WHERE video_id=? AND vocabulary_version=?',[caseId,run]);}
 });
 it('legacy match rule is explicitly stale even when raw text is unchanged',async()=>{
  await db.execute("UPDATE ts_video_tag_matches SET rule_version='exact-text-v1' WHERE video_id=? AND vocabulary_version=?",[ids[0],run]);
  try{const result=await homeExploration(reader,now);expect(result.keywords).toMatchObject({freshVideos:1,staleVideos:2});expect(result.keywords.rows[0]).toMatchObject({videoCount:1,heatScore:3,knownViews:0,views:null});}finally{await db.execute("UPDATE ts_video_tag_matches SET rule_version='youtube-quality-v2' WHERE video_id=? AND vocabulary_version=?",[ids[0],run]);}
 });
 it('case variants merge only for display and deduplicate a video before channel decay',async()=>{
  const keys=['b'.repeat(64),'c'.repeat(64),'d'.repeat(64)];
  try{
   for(const [i,label] of ['OpenAI','openai','政治'].entries())await db.execute("INSERT INTO ts_video_tag_evidence(video_id,vocabulary_version,term_key,term,source,field_name,start_offset,end_offset,matched_text,snippet,snippet_start,rule_version) VALUES(?,?,?,?,'https://tag.observe.tw','description',0,5,?,?,0,'youtube-quality-v2')",[ids[0],run,keys[i],label,label,label]);
   const result=await homeExploration(reader,now),merged=result.keywords.rows.find(r=>r.term==='OpenAI');
   expect(merged).toMatchObject({videoCount:1,channelCount:1,titleVideos:0,descriptionOnlyVideos:1,heatScore:1,views:100,sourceTerms:[{key:keys[0],term:'OpenAI'},{key:keys[1],term:'openai'}]});
   expect(result.keywords.rows.some(r=>r.term==='政治')).toBe(false);expect(result.keywords.exclusions?.terms).toBe(1);
   expect(result.keywords.rows[0]?.trend).toEqual(Array.from({length:7},(_,i)=>({date:`2035-01-${String(i+2).padStart(2,'0')}`,heat:i===6?null:0})));
   const [evidence]=await db.query<RowDataPacket[]>('SELECT COUNT(*) AS n FROM ts_video_tag_evidence WHERE vocabulary_version=? AND term_key IN (?,?,?)',[run,...keys]);expect(evidence[0]!.n).toBe(3);
  }finally{await db.execute('DELETE FROM ts_video_tag_evidence WHERE vocabulary_version=? AND term_key IN (?,?,?)',[run,...keys]);}
 });
 it('equal-duration comparison appears only with complete current and prior v2 source coverage',async()=>{
  const [source]=await db.query<RowDataPacket[]>('SELECT pk FROM urt_video WHERE BINARY videoId=BINARY ?',[ids[2]]);
  await db.execute("INSERT INTO ts_video_tag_matches(video_id,vocabulary_version,source_pk,source_text_sha256,rule_version,evidence_count) VALUES(?,?,?,?,'youtube-quality-v2',0)",[ids[2],run,source[0]!.pk,sourceTextFingerprint(term,term)]);
  try{
   await db.execute('UPDATE urt_video SET title=? WHERE BINARY videoId=BINARY ?',[term,ids[3]]);
   await db.execute("UPDATE urt_video SET publishedAt='2035-01-01 12:00:00' WHERE BINARY videoId=BINARY ?",[ids[4]]);
   const r=await homeExploration(reader,now);
   expect(r.keywords.comparison).toMatchObject({complete:true,sourceVideos:1,freshVideos:1});expect(r.keywords.rows[0]).toMatchObject({heatScore:5.25,rise:2.25});expect(r.keywords.rows[0]?.trend.at(-1)).toEqual({date:'2035-01-08',heat:5.25});
   expect(r.keywordToday.comparison).toMatchObject({complete:true,sourceVideos:0});expect(r.keywordToday.rows[0]?.rise).toBe(5.25);
   const currentSpan=Date.parse(r.keywords.to)-Date.parse(r.keywords.from),priorSpan=Date.parse(r.keywords.comparison!.to)-Date.parse(r.keywords.comparison!.from);expect(priorSpan).toBe(currentSpan);
   await db.execute("UPDATE ts_video_tag_matches SET rule_version='exact-text-v1' WHERE video_id=? AND vocabulary_version=?",[ids[4],run]);
   const stale=await homeExploration(reader,now);expect(stale.keywords.comparison).toMatchObject({complete:false,staleVideos:1});expect(stale.keywords.rows[0]?.rise).toBeNull();expect(stale.keywordToday.rows[0]?.rise).toBe(5.25);
  }finally{
   await db.execute('DELETE FROM ts_video_tag_matches WHERE video_id=? AND vocabulary_version=?',[ids[2],run]);
   await db.execute("UPDATE urt_video SET title='changed' WHERE BINARY videoId=BINARY ?",[ids[3]]);
   await db.execute("UPDATE urt_video SET publishedAt='2034-12-01 10:00:00' WHERE BINARY videoId=BINARY ?",[ids[4]]);
   await db.execute("UPDATE ts_video_tag_matches SET rule_version='youtube-quality-v2' WHERE video_id=? AND vocabulary_version=?",[ids[4],run]);
  }
 });
 it('materializes fresh videos before evidence fanout and preserves indexed cross-charset coverage lookup',async()=>{
  const dialect=new MySqlDialect(),queries:Array<{sql:string;params:unknown[]}>=[];
  await homeExploration({rows:async query=>{const q=dialect.sqlToQuery(query);if(q.sql.includes('ts_video_tag_matches')||q.sql.includes('JSON_TABLE'))queries.push(q);return reader.rows(query);},close:async()=>{}},now);
  expect(queries).toHaveLength(3);
  for(const query of queries){
   const [plan]=await db.query<RowDataPacket[]>('EXPLAIN '+query.sql,query.params);
   if(query.sql.includes('AS source_videos')){
    expect(plan.find(r=>r.table==='m')).toMatchObject({type:'eq_ref',key:'PRIMARY'});
   }else{
    expect(query.sql).toContain('JSON_TABLE');expect(query.sql).not.toContain('SHA2(');
    expect(plan.find(r=>r.table==='e')).toMatchObject({type:'ref',key:'PRIMARY'});
        expect(query.sql).not.toContain('SELECT DISTINCT v.pk,v.u_id,v.publishedAt,m.video_id');
   }
  }
 });
 it('freshness includes fresh scanned videos without ranked terms and uses exact TIMESTAMP epoch',async()=>{
  const[r]=await db.query<RowDataPacket[]>('SELECT pk FROM urt_video WHERE BINARY videoId=BINARY ?',[ids[2]]);
  await db.execute("INSERT INTO ts_video_tag_matches(video_id,vocabulary_version,source_pk,source_text_sha256,matched_at,rule_version,evidence_count) VALUES(?,?,?,?,'2035-01-08 04:00:00','youtube-quality-v2',0)",[ids[2],run,r[0]!.pk,sourceTextFingerprint(term,term)]);
  try{const result=await homeExploration(reader,now);expect(result.keywords.rows[0]?.videoCount).toBe(2);expect(result.keywords.freshVideos).toBe(3);expect(result.keywords.updatedAt).toBe('2035-01-08T04:00:00.000Z');}finally{await db.execute('DELETE FROM ts_video_tag_matches WHERE video_id=? AND vocabulary_version=?',[ids[2],run]);}
 });
 it('Taipei source DATETIME window includes exact bounds and excludes adjacent seconds',async()=>{
  try{for(const [published,expected] of [['2035-01-01 23:59:59',1],['2035-01-02 00:00:00',2],['2035-01-08 12:00:00',2],['2035-01-08 12:00:01',1]] as const){await db.execute('UPDATE urt_video SET publishedAt=? WHERE BINARY videoId=BINARY ?',[published,ids[0]]);expect((await homeExploration(reader,now)).keywords.rows[0]?.videoCount).toBe(expected);}}finally{await db.execute('UPDATE urt_video SET publishedAt=? WHERE BINARY videoId=BINARY ?',[from,ids[0]]);}
 });
 it('optional matching timeout keeps core homepage but unexpected schema errors remain HTTP500',async()=>{
  const dialect=new MySqlDialect();for(const [error,status] of [[new DataSourceUnavailable(),200],[new DataQueryFailed('ER_BAD_FIELD_ERROR'),500]] as const){const isolated=buildApp({dataset:'fixture',clock:()=>now,reader:{rows:async query=>{if(dialect.sqlToQuery(query).sql.includes('ts_video_tag_matches'))throw error;return reader.rows(query);},close:async()=>{}}});try{const r=await isolated.inject('/api/v1/home');expect(r.statusCode).toBe(status);if(status===200){expect(r.json().data.exploration.keywords).toMatchObject({status:'unavailable',sourceVideos:null});expect(r.json().data.exploration.keywordToday).toMatchObject({status:'unavailable',sourceVideos:null,from:'2035-01-07T16:00:00.000Z'});expect(r.json().data.channels).toBeInstanceOf(Array);expect(r.json().data.exploration.categories.status).toBe('available');expect(r.json().meta.warnings).toContain('關鍵字統計目前無法完整讀取。');}}finally{await isolated.close();}}
 });
 it('invalid aggregate coverage never becomes a fabricated zero',async()=>{
  const dialect=new MySqlDialect();const result=await homeExploration({rows:async query=>dialect.sqlToQuery(query).sql.includes('AS source_videos')?reader.rows(sql`SELECT 'week' AS window_key,'9007199254740993' AS source_videos,0 AS fresh,0 AS stale,0 AS unprocessed`):reader.rows(query),close:async()=>{}},now);expect(result.keywords).toMatchObject({status:'unavailable',reason:'precision',sourceVideos:null,freshVideos:null});
 });
 it('home preserves channels/live/daily fields alongside new exploration panels',async()=>{const r=await app.inject('/api/v1/home');expect(r.statusCode).toBe(200);const d=r.json().data;for(const key of ['channels','live','events','tags'])expect(Array.isArray(d[key])).toBe(true);expect(d.exploration.keywords.rows[0].videoCount).toBe(2);expect(d.exploration.keywordToday.rows[0].videoCount).toBe(2);expect(d.exploration.categories.summary.overlapping).toBe(true);});
 it('unsynchronized vocabulary yields explicit unknown coverage rather than news or legacy keyword substitutes',async()=>{await db.execute("DELETE FROM ts_vocabulary_current WHERE source='https://tag.observe.tw' AND run_id=?",[run]);try{expect((await homeExploration(reader,now)).keywords).toMatchObject({status:'not-synchronized',rows:[],freshVideos:null,sourceVideos:null});}finally{await db.execute("INSERT INTO ts_vocabulary_current(source,run_id) VALUES('https://tag.observe.tw',?)",[run]);}});
});
