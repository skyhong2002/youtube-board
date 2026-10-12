import {expect,it} from 'vitest';
import type {Connection,RowDataPacket,ResultSetHeader} from 'mysql2/promise';
import {randomUUID} from 'node:crypto';
import {inspectQualityCoverage,activateQualityCandidate,rollbackQualityCandidate} from '../src/quality-activation.js';
import {qualityArguments,validateQualityBackupReceipt,runQualityCommand} from '../src/quality-cli.js';
import {stageQualityCandidate} from '../src/quality-candidate.js';
import {SOURCE,termKey} from '../src/vocabulary.js';
import {connectDatabase} from '../src/database.js';
import {isolatedTestEnv,assertTestDatabaseUrl} from '../../shared/test-database.js';
import {createReader,type Reader} from '../../api/src/db/client.js';
import {sourceTextFingerprint} from '../../shared/video-fingerprint.js';
const now=new Date('2037-01-10T04:00:00.000Z'),spec={id:'youtube-quality-20261013-unit',parentVersion:'parent',implementationSha:'a'.repeat(40),minFreshVideos:500,minCoverage:1,maxAgeHours:6};
const fakeReader=(source:number,fresh:number)=>({rows:async()=>[{source_videos:source,fresh_videos:fresh}],close:async()=>{}} as Reader);
it('requires explicit immutable identities, bounds activation and rejects unknown/duplicate options',()=>{
 const base=['vocabulary:quality:activate','--id='+spec.id,'--parent=parent','--implementation='+spec.implementationSha];
 expect(qualityArguments(base,now).activation).toMatchObject({minFreshVideos:500,minCoverage:1,maxAgeHours:6});
 for(const extra of [['--id=x'],['--min-coverage=0.1'],['--max-age-hours=25'],['--execute','--execute'],['--unknown=x']])expect(()=>qualityArguments([...base,...extra],now)).toThrow();
});
it('keeps partial coverage explicit and fails bounded unavailable counts',async()=>{
 expect(await inspectQualityCoverage(fakeReader(1000,700),{...spec,minCoverage:.5},now)).toMatchObject({ready:true,partial:true,coverageFraction:.7});
 expect(await inspectQualityCoverage(fakeReader(1000,700),spec,now)).toMatchObject({ready:false,partial:true});
 for(const counts of [[0,0],[100001,100001],[1,2],[NaN,0]])await expect(inspectQualityCoverage(fakeReader(counts[0]!,counts[1]!),spec,now)).rejects.toThrow();
});
it('refuses execution at standard gates before any file or DB access',async()=>{
 await expect(runQualityCommand(['vocabulary:quality:stage','--id='+spec.id,'--parent=parent','--implementation='+spec.implementationSha,'--execute'],{APP_ENV:'test'},now)).rejects.toThrow('disabled');
});
it('requires the completed offhost restore receipt, never an export-only success',()=>{
 const sha='b'.repeat(64),proof={status:'passed',archiveSha256:sha,offhost:{host:'local',originHost:'prod',archiveSha256Verified:true},productionOperations:false,sourceRowsRestored:false,rows:{allCountsAndMultisetSha256Exact:true},principals:{authenticationDefinitionsExact:true,grantMultisetsExact:true},schemaMetadataExact:true,triggerDefinitionsExact:true,triggerBehaviorExact:true,probeRowsRolledBack:true,cloneRemoved:true};
 expect(validateQualityBackupReceipt(proof,sha)).toEqual({archiveSha256:sha,status:'passed'});
 for(const patch of [{status:'exported'},{cloneRemoved:false},{archiveSha256:'c'.repeat(64)},{offhost:{...proof.offhost,host:'prod'}},{schemaMetadataExact:false}])expect(()=>validateQualityBackupReceipt({...proof,...patch},sha)).toThrow();
});
it('insufficient coverage does not open a pointer transaction',async()=>{
 let began=false;const db={beginTransaction:async()=>{began=true;}} as Connection;
 await expect(activateQualityCandidate(db,fakeReader(1000,20),spec,async()=>{},now)).rejects.toThrow('threshold');expect(began).toBe(false);
});
it.skipIf(process.env.JOBS_DB_TEST!=='1'||!process.env.TEST_DATABASE_URL)('real coverage, atomic activation, competing-parent rejection and conditional rollback',async()=>{
 const db=await connectDatabase(isolatedTestEnv()),reader=createReader(assertTestDatabaseUrl(process.env.TEST_DATABASE_URL!)),suffix=randomUUID().replaceAll('-','').slice(0,12),parent='activation-parent-'+suffix,id='youtube-quality-20261013-'+suffix,videoId='Q'+suffix.slice(0,10);
 const raw={id:parent,source:SOURCE,window:{since:'2037-01-09T00:00:00.000Z',until:now.toISOString()},publishedAt:now.toISOString(),coverage:'observed-article-window',terms:[{key:termKey('AI'),term:'AI',articleCount:3,media:[]}]};
 const localSpec={...spec,id,parentVersion:parent,minFreshVideos:1,preparedAt:now.toISOString()};
 const [saved]=await db.query<RowDataPacket[]>('SELECT run_id FROM ts_vocabulary_current WHERE source=?',[SOURCE]);
 try{
  await db.execute('INSERT INTO ts_vocabulary_runs(id,window_since,window_until,status,pages,snapshot) VALUES(?,?,?,?,?,?)',[parent,raw.window.since,raw.window.until,'published',1,JSON.stringify(raw)]);
  await db.execute('INSERT INTO ts_vocabulary_current(source,run_id) VALUES(?,?) ON DUPLICATE KEY UPDATE run_id=VALUES(run_id)',[SOURCE,parent]);
  await stageQualityCandidate(db,localSpec,async()=>{});
  const [insert]=await db.execute<ResultSetHeader>("INSERT INTO urt_video(videoId,u_id,title,ctime,publishedAt,description,viewCount,id,channelId,thumbnails,channelTitle,playlistId,position) VALUES(?,1,'fixture','2037-01-10 11:00:00','2037-01-10 11:00:00','',NULL,'fixture','fixture','','fixture','fixture',0)",[videoId]);
  await db.execute("INSERT INTO ts_video_tag_matches(video_id,vocabulary_version,source_pk,source_text_sha256,rule_version,evidence_count,matched_at) VALUES(?,?,?,?,'youtube-quality-v2',0,'2037-01-10 04:00:00')",[videoId,id,insert.insertId,sourceTextFingerprint('fixture','')]);
  expect(await inspectQualityCoverage(reader,localSpec,now)).toMatchObject({ready:true,sourceVideos:1,freshVideos:1,partial:false});
  await expect(activateQualityCandidate(db,reader,{...localSpec,implementationSha:'b'.repeat(40)},async()=>{},now)).rejects.toThrow('immutable payload');
  const active=await activateQualityCandidate(db,reader,localSpec,async()=>{},now);expect(active).toMatchObject({status:'activated',previousVersion:parent,version:id,servingPointerChanged:true});
  await expect(activateQualityCandidate(db,reader,localSpec,async()=>{},now)).rejects.toThrow('Serving vocabulary changed');
  expect(await rollbackQualityCandidate(db,localSpec,async()=>{})).toMatchObject({status:'rolled-back'});
  await expect(rollbackQualityCandidate(db,localSpec,async()=>{})).rejects.toThrow('Serving vocabulary changed');
  await db.execute('UPDATE ts_video_tag_matches SET evidence_count=1 WHERE video_id=? AND vocabulary_version=?',[videoId,id]);
  expect(await inspectQualityCoverage(reader,localSpec,now)).toMatchObject({ready:false,freshVideos:0});
  await db.execute("UPDATE ts_video_tag_matches SET evidence_count=0,matched_at='2037-01-09 04:00:00' WHERE video_id=? AND vocabulary_version=?",[videoId,id]);
  expect(await inspectQualityCoverage(reader,localSpec,now)).toMatchObject({ready:false,freshVideos:0});
  const [pointer]=await db.query<RowDataPacket[]>('SELECT run_id FROM ts_vocabulary_current WHERE source=?',[SOURCE]);expect(pointer[0]?.run_id).toBe(parent);
 }finally{
  if(saved[0])await db.execute('UPDATE ts_vocabulary_current SET run_id=? WHERE source=?',[saved[0].run_id,SOURCE]);else await db.execute('DELETE FROM ts_vocabulary_current WHERE source=?',[SOURCE]);
  await db.execute('DELETE FROM ts_video_tag_matches WHERE vocabulary_version=?',[id]);await db.execute('DELETE FROM urt_video WHERE BINARY videoId=BINARY ?',[videoId]);await db.execute('DELETE FROM ts_vocabulary_runs WHERE id IN (?,?)',[id,parent]);await reader.close();await db.end();
 }
});
