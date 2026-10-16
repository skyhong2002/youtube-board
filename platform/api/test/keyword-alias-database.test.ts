import {afterAll,beforeAll,describe,expect,it} from 'vitest';
import mysql,{type Connection,type ResultSetHeader,type RowDataPacket} from 'mysql2/promise';
import {randomInt,randomUUID} from 'node:crypto';
import {buildApp} from '../src/app.js';
import {createReader} from '../src/db/client.js';
import {maintainedKeywordIdentities,keywordTextContains} from '../src/reports/keyword-alias.js';
import {loadDerivedSource,derivedRow,keywordDayFromEvidence} from '../src/reports/derived-cache.js';
import {sql} from 'drizzle-orm';
import {assertTestDatabaseUrl} from '../../shared/test-database.js';
import {storeVideoEvidence,VIDEO_QUALITY_JOB,MATCH_RULE} from '../../jobs/src/video-evidence.js';
import {buildDescriptionTemplateProfile} from '../../jobs/src/description-templates.js';
import {aggregateTerms,SOURCE,type VocabularySnapshot} from '../../jobs/src/vocabulary.js';
const url=process.env.TEST_DATABASE_URL?assertTestDatabaseUrl(process.env.TEST_DATABASE_URL):undefined;
describe.skipIf(!url)('canonical matcher evidence is reachable through every maintained alias URL',()=>{
 let db:Connection,previous:string|undefined;const uid=randomInt(500000000,600000000),version='alias-'+randomUUID(),prefix=randomUUID().replaceAll('-','').slice(0,7),ids=[prefix+'Aa01',prefix+'aa01'],now=new Date('2038-05-12T04:00:00Z');
 const reader=createReader(url),app=buildApp({reader,clock:()=>now,dataset:'fixture'}),terms=aggregateTerms([{id:'1',media:'test',publishedAt:'',tags:['AI','ai','Ai','記者','交通','交通 ','İ','i','ß','SS']}]);
 const snapshot:VocabularySnapshot={id:version,source:SOURCE,coverage:'observed-article-window',window:null,publishedAt:now.toISOString(),upstreamSnapshotConsistent:false,matchingRule:MATCH_RULE,terms};
 beforeAll(async()=>{
  db=await mysql.createConnection({uri:url!,dateStrings:true});const[p]=await db.query<RowDataPacket[]>('SELECT run_id FROM ts_vocabulary_current WHERE source=?',[SOURCE]);previous=p[0]?.run_id;
  await db.execute("INSERT INTO ts_vocabulary_runs(id,window_since,window_until,status,snapshot) VALUES(?,'','','published',?)",[version,JSON.stringify(snapshot)]);
  await db.execute('INSERT INTO ts_vocabulary_current(source,run_id) VALUES(?,?) ON DUPLICATE KEY UPDATE run_id=VALUES(run_id)',[SOURCE,version]);
  await db.execute("INSERT INTO urt_channel(u_id,ctime,youtube_id,title,flag_del) VALUES(?,'2038-05-12',?,'alias fixture',0)",[uid,'alias-channel-'+prefix]);
  await db.execute("INSERT INTO urt_count(u_id,ctime,tags) VALUES(?,'2038-05-12',?)",[uid,'['+uid+']']);
  for(const[i,id]of ids.entries()){
   const title=i?'交通':'😀aI 記者';
   const[result]=await db.execute<ResultSetHeader>("INSERT INTO urt_video(videoId,u_id,id,title,description,ctime,mtime,publishedAt,viewCount,channelId,channelTitle,thumbnails,playlistId,position) VALUES(?,?,?,?,?,'2038-05-12','2038-05-12','2038-05-12 10:00:00',100,'fixture','fixture','','fixture',0)",[id,uid,id,title,'']);
   await storeVideoEvidence(db,{pk:result.insertId,channelId:uid,videoId:id,title,description:'',observedAt:'2038-05-12 00:00:00'},snapshot,buildDescriptionTemplateProfile(uid,[]));
  }
 });
 afterAll(async()=>{await app.close();if(!db)return;
  await db.execute("DELETE FROM ts_job_runs WHERE job_key=? AND JSON_UNQUOTE(JSON_EXTRACT(result,'$.vocabularyVersion'))=?",[VIDEO_QUALITY_JOB,version]);
  await db.execute('DELETE FROM ts_video_tag_matches WHERE vocabulary_version=?',[version]);
  if(previous)await db.execute('UPDATE ts_vocabulary_current SET run_id=? WHERE source=? AND run_id=?',[previous,SOURCE,version]);else await db.execute('DELETE FROM ts_vocabulary_current WHERE source=? AND run_id=?',[SOURCE,version]);
  await db.execute('DELETE FROM ts_vocabulary_runs WHERE id=?',[version]);
  for(const id of ids)await db.execute('DELETE FROM urt_video WHERE BINARY videoId=BINARY ?',[id]);
  await db.execute('DELETE FROM urt_count WHERE u_id=?',[uid]);await db.execute('DELETE FROM urt_channel WHERE u_id=?',[uid]);await db.end();
 });
 it('each AI/ai/Ai URL returns the single byte-exact video and keeps canonical evidence counts',async()=>{
  for(const keyword of ['AI','ai','Ai','aI','交通','交通 ','ＡＩ','İ']){
   const response=await app.inject('/api/v1/keywords/'+encodeURIComponent(keyword)+'/videos?channelId='+uid);
   expect(response.statusCode,response.body).toBe(200);
   const expected=['AI','ai','Ai','aI'].includes(keyword)?[ids[0]]:keyword==='交通'?[ids[1]]:[];
   expect(response.json().data.rows.map((row:{id:string})=>row.id)).toEqual(expected);expect(response.json().data.total).toBe(expected.length);
  }
  const[rows]=await db.query<RowDataPacket[]>('SELECT term_key FROM ts_video_tag_evidence WHERE video_id=? AND vocabulary_version=?',[ids[0],version]);
  expect(rows).toHaveLength(2);const canonical=terms.filter(t=>t.term.toLowerCase()==='ai').map(t=>t.key).sort()[0];expect(rows.some(row=>row.term_key===canonical)).toBe(true);
 });
 it('derived keyword selection and metrics accept every alias without widening CJK or Unicode equivalence',async()=>{
  for(const keyword of ['AI','ai','Ai']){
   const source=await loadDerivedSource(reader,{tagid:String(uid)},'2038-05-10','2038-05-12',now,keyword);
   expect(source.coverage).toMatchObject({status:'ready',sourceVideos:1,freshVideos:1});expect(source.videos.map(v=>v.videoId)).toEqual([ids[0]]);
   expect(derivedRow(source,'2038-05-10','2038-05-12',now,keyword).reason).toBe('ready');expect(keywordDayFromEvidence(source.videos,keyword).count_videos).toBe(1);
  }
  const absent=await loadDerivedSource(reader,{tagid:String(uid)},'2038-05-10','2038-05-12',now,'交通 ');expect(absent.coverage).toMatchObject({status:'no-source',sourceVideos:0});
  for(const[text,keyword,expected]of [['ai.交通','AI.交通',1],['AIx交通','AI.交通',0],['İ','i',0],['ß','SS',0],['a%_','A%_',1],['abc','A%_',0]] as const){
   const result=await reader.rows(sql`SELECT ${keywordTextContains(sql`${text}`,keyword)} AS matched`);expect(Number(result[0]!.matched)).toBe(expected);
  }
 });
 it('video tag evidence reads the byte-exact videoId, never a case-insensitive sibling',async()=>{
  for(const[i,id]of ids.entries()){
   const response=await app.inject('/api/v1/videos/'+id+'/tags');expect(response.statusCode,response.body).toBe(200);
   const data=response.json().data;expect(data.videoId).toBe(id);expect(data.status).toBe('matched');
   expect(data.rows.map((row:{text:string})=>row.text)).toContain(i?'交通':'aI');
  }
 });
 it('full-table vocabulary aliases choose existing original key and byte-exact label',async()=>{
  try{
   for(const term of terms)await db.execute('INSERT INTO ts_vocabulary_terms(run_id,term_key,term,article_count,payload) VALUES(?,?,?,?,?)',[version,term.key,term.term,term.articleCount,JSON.stringify(term)]);
   await db.execute('UPDATE ts_vocabulary_runs SET snapshot=? WHERE id=?',[JSON.stringify({...snapshot,terms:undefined,termsStoredSeparately:true}),version]);
   const aliases=[...terms].filter(t=>['AI','ai','Ai'].includes(t.term)).sort((a,b)=>a.key<b.key?-1:1).map(({key,term})=>({key,term}));
   for(const alias of ['AI','ai','Ai'])expect(await maintainedKeywordIdentities(reader,version,alias)).toEqual(aliases);
   expect((await maintainedKeywordIdentities(reader,version,'交通 '))[0]?.term).toBe('交通 ');
   expect((await maintainedKeywordIdentities(reader,version,'İ'))[0]?.term).toBe('İ');expect((await maintainedKeywordIdentities(reader,version,'i'))[0]?.term).toBe('i');
  }finally{await db.execute('UPDATE ts_vocabulary_runs SET snapshot=? WHERE id=?',[JSON.stringify(snapshot),version]);await db.execute('DELETE FROM ts_vocabulary_terms WHERE run_id=?',[version]);}
 });
 it('all retained alias keys are readable and duplicate same-span aliases count once in derived metrics',async()=>{
  const aliases=terms.filter(t=>['AI','ai','Ai'].includes(t.term)).sort((a,b)=>a.key<b.key?-1:1),alternative=aliases.at(-1)!;
  try{
   await db.execute('UPDATE ts_video_tag_evidence SET term_key=?,term=? WHERE video_id=? AND vocabulary_version=? AND term_key=?',[alternative.key,alternative.term,ids[0],version,aliases[0]!.key]);
   for(const keyword of ['AI','ai','Ai']){const response=await app.inject('/api/v1/keywords/'+keyword+'/videos?channelId='+uid);expect(response.statusCode,response.body).toBe(200);expect(response.json().data.rows.map((row:{id:string})=>row.id)).toEqual([ids[0]]);}
   await db.execute('INSERT INTO ts_video_tag_evidence(video_id,vocabulary_version,term_key,term,source,field_name,start_offset,end_offset,matched_text,snippet,snippet_start,rule_version) SELECT video_id,vocabulary_version,?,?,source,field_name,start_offset,end_offset,matched_text,snippet,snippet_start,rule_version FROM ts_video_tag_evidence WHERE video_id=? AND vocabulary_version=? AND term_key=?',[aliases[0]!.key,aliases[0]!.term,ids[0],version,alternative.key]);
   await db.execute('UPDATE ts_video_tag_matches SET evidence_count=3 WHERE video_id=? AND vocabulary_version=?',[ids[0],version]);
   const source=await loadDerivedSource(reader,{tagid:String(uid)},'2038-05-10','2038-05-12',now,'AI');expect(source.coverage.status).toBe('ready');expect(source.videos[0]!.matches).toHaveLength(2);
   const response=await app.inject('/api/v1/keywords/ai/videos?channelId='+uid);expect(response.json().data.total).toBe(1);
  }finally{await db.execute('DELETE FROM ts_video_tag_evidence WHERE video_id=? AND vocabulary_version=? AND term_key=?',[ids[0],version,alternative.key]);await db.execute('UPDATE ts_video_tag_matches SET evidence_count=2 WHERE video_id=? AND vocabulary_version=?',[ids[0],version]);}
 });
});
