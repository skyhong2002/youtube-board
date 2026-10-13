import {expect,it} from 'vitest';
import mysql,{type Connection,type RowDataPacket} from 'mysql2/promise';
import {randomBytes,createHash} from 'node:crypto';
import {readFile,writeFile,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {connectDatabase} from '../src/database.js';
import {runQualityCommand} from '../src/quality-cli.js';
import {SOURCE,termKey} from '../src/vocabulary.js';
import {sourceTextFingerprint} from '../../shared/video-fingerprint.js';
import {taipeiSql} from '@youtube-board/ingestion';
// Deliberately opt-in: creates ONLY fresh random schemas/principals on loopback23306.
it.skipIf(process.env.QUALITY_OPERATOR_DB_TEST!=='1')('restricted quality facade stages, activates, audits and rolls back with exact production-form rights',async()=>{
 const port=Number(process.env.QUALITY_TEST_PORT??23306);if(![23306,23316].includes(port))throw Error('Invalid isolated test port');
 const password=process.env.QUALITY_TEST_ROOT_PASSWORD;if(!password)throw Error('Explicit isolated root credential required');
 const suffix=randomBytes(5).toString('hex'),source='youtube_board_quality_source_'+suffix,state='youtube_board_ts_quality_'+suffix,facade='youtube_board_ts_worker_'+suffix,user='yt_quality_'+suffix,reportUser='yt_qreport_'+suffix;
 const fixture=process.env.DB_DATABASE;if(!fixture?.endsWith('_rewrite'))throw Error('Requires isolated fixture schema');
 const root=await mysql.createConnection({host:'127.0.0.1',port,user:'root',password,dateStrings:true,multipleStatements:false});
 let worker:Connection|undefined,phase='setup';const dir=await mkdtemp(join(tmpdir(),'yt-quality-operator-test-'));
 const rights=['tags.vocabulary.sync','tags.vocabulary.quality-stage','tags.vocabulary.quality-activate','tags.vocabulary.quality-rollback'].join(','),secret=randomBytes(32).toString('hex'),reportSecret=randomBytes(32).toString('hex');
 const runtime={APP_ENV:'production',DB_HOST:'127.0.0.1',DB_PORT:String(port),DB_DATABASE:facade,DB_USERNAME:user,DB_PASSWORD:secret,TS_WORKER_DATABASE_HOST:'127.0.0.1',TS_WORKER_SCHEMA_MODE:'facade',TS_WORKER_WORKFLOW:'tags.vocabulary.quality',TS_SOURCE_SCHEMA:source,TS_STATE_SCHEMA:state,TS_INGESTION_ENABLED:'true',TS_INGESTION_PRODUCTION_ENABLED:'true',TS_INGESTION_OWNERS:rights,TS_INGESTION_WRITE_ALLOWLIST:rights,QUALITY_REPORT_DATABASE_URL:`mysql://${reportUser}:${reportSecret}@127.0.0.1:${port}/${state}`};
 const parent='quality-parent-'+suffix,id='youtube-quality-20261013-'+suffix,sha='a'.repeat(64),proofPath=join(dir,'proof.json'),now=new Date();let tick=0;
 const args=(action:string,custom=id)=>['vocabulary:quality:'+action,'--id='+custom,'--parent='+parent,'--implementation='+'a'.repeat(40),'--execute',...(action==='activate'?['--min-fresh=1','--min-coverage=1']:[]),...(action==='rollback'?[]:['--backup-proof='+proofPath,'--backup-sha256='+sha])];
 const run=(action:string,custom=id)=>runQualityCommand(args(action,custom),runtime,new Date(+now+(++tick)));
 const principal=root.escape(user)+"@'%'",reportPrincipal=root.escape(reportUser)+"@'%'";
 const q=(schema:string,table:string)=>'`'+schema+'`.`'+table+'`';
 const counts=async()=>{const [[r]]=await root.query<RowDataPacket[]>('SELECT (SELECT COUNT(*) FROM '+q(state,'ts_vocabulary_runs')+') runs,(SELECT COUNT(*) FROM '+q(state,'ts_job_runs')+') audits,(SELECT run_id FROM '+q(state,'ts_vocabulary_current')+' WHERE source=?) current',[SOURCE]);return r;};
 try{
  // The existing bootstrap tool is reused, rather than bypassing its facade/grant checks.
  // @ts-expect-error The existing reviewed bootstrap tool is JavaScript without declarations.
  const {planWorker,executeWorker}=await import('../../tools/worker-schema.mjs');
  // @ts-expect-error The existing reviewed schema parser is JavaScript without declarations.
  const {stateStatements}=await import('../../tools/frontend-schema.mjs');
  await root.query('CREATE DATABASE `'+source+'`');await root.query('USE `'+source+'`');const baseline=await readFile(new URL('../../../database/schema/legacy-dashboard-baseline.sql',import.meta.url),'utf8');const videoDdl=baseline.split(';').find(statement=>/^\s*CREATE TABLE IF NOT EXISTS `urt_video` \(/.test(statement));if(!videoDdl)throw Error('Missing source fixture DDL');await root.query(videoDdl);
  await root.query('CREATE DATABASE `'+state+'`');await root.query('USE `'+state+'`');for(const sql of stateStatements(await readFile(new URL('../../migrations/002-frontend-state.sql',import.meta.url),'utf8')).statements)await root.query(sql);
  const bootstrap=new URL('mysql://127.0.0.1:'+port);bootstrap.username='root';bootstrap.password=password;
  const setup={WORKER_WORKFLOW:'tags.vocabulary.quality',WORKER_SOURCE_SCHEMA:source,WORKER_STATE_SCHEMA:state,WORKER_TARGET_SCHEMA:facade,WORKER_USER:user,WORKER_ACCOUNT_HOST:'%',WORKER_PASSWORD:secret,WORKER_BOOTSTRAP_URL:bootstrap.toString(),WORKER_BACKUP_OFFHOST_VERIFIED:'true',WORKER_RESTORE_VERIFIED:'true'};
  await executeWorker(planWorker(setup),setup);worker=await connectDatabase(runtime);
  await root.query('CREATE ALGORITHM=MERGE SQL SECURITY INVOKER VIEW '+q(state,'urt_video')+' AS SELECT * FROM '+q(source,'urt_video'));
  await root.query('CREATE USER '+reportPrincipal+' IDENTIFIED BY ?',[reportSecret]);
  for(const table of ['urt_video','ts_video_tag_matches','ts_video_tag_evidence'])await root.query('GRANT SELECT ON '+q(state,table)+' TO '+reportPrincipal);
  await root.query('GRANT SELECT ON '+q(source,'urt_video')+' TO '+reportPrincipal);
  const [[identity]]=await root.query<RowDataPacket[]>('SELECT @@hostname host,@@server_id server_id,@@port port,VERSION() version');
  const proof={status:'passed',archiveSha256:sha,database:state,capturedAt:now.toISOString(),targetServer:{host:identity!.host,server_id:identity!.server_id,port:identity!.port},offhost:{host:'fixture-offhost',originHost:'fixture-origin',archiveSha256Verified:true},productionOperations:false,sourceRowsRestored:false,rows:{allCountsAndMultisetSha256Exact:true},principals:{authenticationDefinitionsExact:true,grantMultisetsExact:true},schemaMetadataExact:true,triggerDefinitionsExact:true,triggerBehaviorExact:true,probeRowsRolledBack:true,cloneRemoved:true};
  await writeFile(proofPath,JSON.stringify(proof));
  const snapshot={id:parent,source:SOURCE,window:{since:new Date(+now-86400000).toISOString(),until:now.toISOString()},publishedAt:now.toISOString(),coverage:'observed-article-window',upstreamSnapshotConsistent:false,terms:[{term:'AI',key:termKey('AI'),articleCount:3,media:[],provenance:'upstream-article-tag-origin-unspecified'}]};
  await root.query('INSERT INTO '+q(state,'ts_vocabulary_runs')+'(id,window_since,window_until,status,pages,snapshot) VALUES(?,?,?,?,?,?)',[parent,snapshot.window.since,snapshot.window.until,'published',1,JSON.stringify(snapshot)]);
  await root.query('INSERT INTO '+q(state,'ts_vocabulary_current')+'(source,run_id) VALUES(?,?)',[SOURCE,parent]);
  phase='stage';expect(await run('stage')).toMatchObject({status:'staged'});expect(await run('stage')).toMatchObject({status:'already-staged'});expect(Number((await counts())!.audits)).toBe(2);
  await worker.beginTransaction();await worker.query('SELECT * FROM ts_job_runs LIMIT 1 FOR UPDATE');await worker.rollback();
  await root.query('INSERT INTO '+q(source,'urt_video')+"(pk,videoId,u_id,title,description,ctime,mtime,publishedAt,id,channelId,thumbnails,channelTitle,playlistId,position) VALUES(1,'Quality0001',1,'fixture','',?,?,?,?,?,'','fixture','fixture',0)",[taipeiSql(now),taipeiSql(now),taipeiSql(new Date(+now-3600000)),'fixture','fixture']);
  await root.query('INSERT INTO '+q(state,'ts_video_tag_matches')+"(video_id,vocabulary_version,source_pk,source_text_sha256,rule_version,evidence_count) VALUES('Quality0001',?,1,?,'youtube-quality-v2',0)",[id,sourceTextFingerprint('fixture','')]);
  phase='activate';expect(await run('activate')).toMatchObject({status:'activated',coverage:{sourceVideos:1,freshVideos:1}});
  const [[audit]]=await root.query<RowDataPacket[]>('SELECT result FROM '+q(state,'ts_job_runs')+" WHERE job_key='tags.vocabulary.quality-activate'");expect(JSON.parse(audit!.result).coverage).toMatchObject({scope:'rolling-7d-observed',sourceVideos:1,freshVideos:1});
  const evidenceLock='yt-ts-'+createHash('sha256').update('tags.videos.match').digest('hex').slice(0,48);await root.query('SELECT GET_LOCK(?,0)',[evidenceLock]);
  phase='rollback with worker lock';expect(await run('rollback')).toMatchObject({status:'rolled-back',backupReceipt:null});await root.query('SELECT RELEASE_LOCK(?)',[evidenceLock]);
  phase='negative grants';
  for(const [table,privilege,actions]of [['ts_job_runs','INSERT',['stage','activate']],['ts_vocabulary_current','UPDATE',['activate']]] as const){
   await root.query('REVOKE '+privilege+' ON '+q(state,table)+' FROM '+principal);const before=await counts();
   for(const action of actions)await expect(run(action,action==='stage'?id+'-denied':id)).rejects.toThrow('effective grants');expect(await counts()).toEqual(before);
   await root.query('GRANT '+privilege+' ON '+q(state,table)+' TO '+principal);
  }
  for(const sql of ['UPDATE '+q(state,'ts_job_runs')+" SET status='unsafe'",'DELETE FROM '+q(state,'ts_job_runs'),'UPDATE '+q(state,'ts_video_tag_matches')+" SET rule_version='unsafe'",'DELETE FROM '+q(state,'ts_video_tag_evidence')])await expect(worker.query(sql)).rejects.toMatchObject({errno:1142});
  for(const scope of ['*.*','`mysql`.`user`','`information_schema`.*']){
   // information_schema cannot be explicitly GRANTed on MariaDB; use an unrelated real fixture schema.
   const actual=scope==='`information_schema`.*'?'`'+fixture+'`.*':scope;
   await root.query('GRANT SELECT ON '+actual+' TO '+reportPrincipal);const before=await counts();await expect(run('activate')).rejects.toThrow('read-only grants');expect(await counts()).toEqual(before);await root.query('REVOKE SELECT ON '+actual+' FROM '+reportPrincipal);
  }
  phase='bounded rollback lock';expect(await run('activate')).toMatchObject({status:'activated'});
  const vocabularyLock='yt-ts-'+createHash('sha256').update('tags.vocabulary.sync').digest('hex').slice(0,48);await root.query('SELECT GET_LOCK(?,0)',[vocabularyLock]);
  const started=Date.now();await expect(run('rollback')).rejects.toThrow('Another TypeScript writer');expect(Date.now()-started).toBeGreaterThanOrEqual(9500);expect(Date.now()-started).toBeLessThan(13000);expect((await counts())!.current).toBe(id);
  const release=new Promise<void>((resolve,reject)=>setTimeout(()=>{root.query('SELECT RELEASE_LOCK(?)',[vocabularyLock]).then(()=>resolve(),reject);},250));expect(await run('rollback')).toMatchObject({status:'rolled-back'});await release;
  const sanitize=(rows:RowDataPacket[])=>rows.map(r=>String(Object.values(r)[0]).replace(/ IDENTIFIED BY PASSWORD '[^']*'/," IDENTIFIED BY PASSWORD '[REDACTED]'"));
  const [writerGrants]=await root.query<RowDataPacket[]>('SHOW GRANTS FOR '+principal),[readerGrants]=await root.query<RowDataPacket[]>('SHOW GRANTS FOR '+reportPrincipal);
  console.log(JSON.stringify({qualityRestrictedProof:true,mariaDbVersion:identity!.version,writerGrants:sanitize(writerGrants),readerGrants:sanitize(readerGrants),sourceViewResolved:true,localOnly:true,productionWrites:false}));
 }catch(error){if(error instanceof Error&&error.name==='AssertionError')throw error;const code=(error as {code?:unknown})?.code;throw Error('Restricted quality fixture failed in '+phase+(typeof code==='string'&&/^[A-Z0-9_]+$/.test(code)?' ['+code+']':''));}
 finally{await worker?.end();await root.query('DROP USER IF EXISTS '+principal);await root.query('DROP USER IF EXISTS '+reportPrincipal);for(const schema of [facade,state,source])await root.query('DROP DATABASE IF EXISTS `'+schema+'`');await root.end();await rm(dir,{recursive:true,force:true});}
},45000);
