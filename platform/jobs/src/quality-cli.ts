import {readFile,lstat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {isAbsolute} from 'node:path';
import type {RowDataPacket} from 'mysql2/promise';
import {createQualityReportReader,assertQualityReportIdentity} from './quality-report-reader.js';
import {connectDatabase,withWriterLock} from './database.js';
import {executionPolicy,assertExecute} from './policy.js';
import {VOCABULARY_JOB,SOURCE} from './vocabulary.js';
import {VIDEO_EVIDENCE_JOB} from './video-evidence.js';
import {prepareQualityCandidate,stageQualityCandidate} from './quality-candidate.js';
import {inspectQualityCoverage,activateQualityCandidate,rollbackQualityCandidate,validateActivationSpec} from './quality-activation.js';
const PREFIX='vocabulary:quality:';
export function qualityArguments(args:string[],now=new Date()){
 const action=args[0]?.slice(PREFIX.length);if(!['stage','activate','rollback'].includes(action??''))throw Error('Unknown quality vocabulary action');
 const values=new Map<string,string>();let execute=false;
 for(const arg of args.slice(1)){if(arg==='--execute'){if(execute)throw Error('Duplicate execute option');execute=true;continue;}
  const match=/^--(id|parent|implementation|min-fresh|min-coverage|max-age-hours|backup-proof|backup-sha256)=(.+)$/.exec(arg);if(!match||values.has(match[1]!))throw Error('Invalid quality vocabulary option');values.set(match[1]!,match[2]!);
 }
 const spec={id:values.get('id')??'',parentVersion:values.get('parent')??'',implementationSha:values.get('implementation')??'',preparedAt:now.toISOString()};
 if(!/^youtube-quality-\d{8}-[a-z0-9-]{1,30}$/.test(spec.id)||! /^[A-Za-z0-9_-]{1,100}$/.test(spec.parentVersion)||spec.id===spec.parentVersion||! /^[a-f0-9]{40}$/.test(spec.implementationSha))throw Error('Explicit candidate, parent and implementation identities are required');
 const thresholds=['min-fresh','min-coverage','max-age-hours'];if(action!=='activate'&&thresholds.some(k=>values.has(k)))throw Error('Coverage options apply only to activation');
 const activation={...spec,minFreshVideos:Number(values.get('min-fresh')??500),minCoverage:Number(values.get('min-coverage')??1),maxAgeHours:Number(values.get('max-age-hours')??6)};if(action==='activate')validateActivationSpec(activation);
 return {action:action as 'stage'|'activate'|'rollback',spec,activation,execute,backupProof:values.get('backup-proof'),backupSha256:values.get('backup-sha256')};
}
/** An operator must validate the host-controller backup/restore artifact before
 * invoking this command. This only verifies the bounded receipt contract; it
 * does not claim to restore a database or independently authenticate the host. */
export function validateQualityBackupReceipt(proof:any,sha:string){
 if(!/^[a-f0-9]{64}$/.test(sha)||proof?.status!=='passed'||proof.archiveSha256!==sha||proof.offhost?.archiveSha256Verified!==true||proof.offhost?.host===proof.offhost?.originHost||!proof.offhost?.host||!proof.offhost?.originHost||proof.productionOperations!==false||proof.sourceRowsRestored!==false||proof.rows?.allCountsAndMultisetSha256Exact!==true||proof.principals?.authenticationDefinitionsExact!==true||proof.principals?.grantMultisetsExact!==true||proof.schemaMetadataExact!==true||proof.triggerDefinitionsExact!==true||proof.triggerBehaviorExact!==true||proof.probeRowsRolledBack!==true||proof.cloneRemoved!==true)throw Error('A verified offhost TS backup/restore receipt is required');
 return {archiveSha256:sha,status:'passed' as const};
}
export async function backupReceipt(path:string|undefined,sha:string|undefined,now:Date){
 if(!path||!sha||!isAbsolute(path))throw Error('Execute requires absolute backup proof file and archive SHA256');
 const info=await lstat(path);if(!info.isFile()||info.size>1024*1024||+now-info.mtimeMs>6*3600000||info.mtimeMs>+now+60000)throw Error('Backup receipt must be a recent bounded regular file');
 const body=await readFile(path,'utf8');if(Buffer.byteLength(body)>1024*1024)throw Error('Backup receipt exceeds size cap');let proof:unknown;try{proof=JSON.parse(body);}catch{throw Error('Backup receipt is not valid JSON');}const p=proof as Record<string,unknown>;
 if(typeof p.database!=='string'||typeof p.capturedAt!=='string'||!Number.isFinite(Date.parse(p.capturedAt))||+now-Date.parse(p.capturedAt)>6*3600000||Date.parse(p.capturedAt)>+now+60000||!p.targetServer||typeof p.targetServer!=='object')throw Error('Backup receipt needs a recent capturedAt and exact database/server target');
 return {...validateQualityBackupReceipt(proof,sha),database:p.database,capturedAt:p.capturedAt,targetServer:p.targetServer as Record<string,unknown>,receiptSha256:createHash('sha256').update(body).digest('hex')};
}
export async function runQualityCommand(args:string[],env:NodeJS.ProcessEnv,now=new Date()){
 const options=qualityArguments(args,now),policy=executionPolicy(env,options.execute?'execute':'dry-run');
 if(options.execute&&policy.environment==='production'&&(env.TS_WORKER_SCHEMA_MODE!=='facade'||env.TS_WORKER_WORKFLOW!=='tags.vocabulary.quality'))throw Error('Quality execution requires the dedicated reviewed operator facade');
 if(options.execute){assertExecute(VOCABULARY_JOB,policy);assertExecute('tags.vocabulary.quality-'+options.action,policy);if(options.action==='activate')assertExecute('tags.vocabulary.quality-rollback',policy);}
 const receipt=options.execute&&options.action!=='rollback'?await backupReceipt(options.backupProof,options.backupSha256,now):null;
 if(options.action==='activate'&&!env.QUALITY_REPORT_DATABASE_URL)throw Error('Activation requires the SELECT-only report database URL');
 const db=await connectDatabase(env);let reader:Awaited<ReturnType<typeof createQualityReportReader>>|null=null;
 try{
  if(receipt){const [rows]=await db.query<RowDataPacket[]>('SELECT @@hostname AS host,@@server_id AS server_id,@@port AS port,DATABASE() AS db');const schema=env.TS_WORKER_SCHEMA_MODE==='facade'?(env.TS_STATE_SCHEMA??'youtube_board_ts'):(env.DB_DATABASE??'youtube_board_rewrite');assertQualityReportIdentity(rows[0]??{},{...receipt.targetServer,db:receipt.database},schema);}
  if(options.action==='activate')reader=await createQualityReportReader(env,db);
  if(!options.execute){
   const [parents]=await db.query<RowDataPacket[]>({sql:'SELECT r.snapshot FROM ts_vocabulary_current c JOIN ts_vocabulary_runs r ON r.id=c.run_id WHERE c.source=? AND r.id=? AND r.status=? AND OCTET_LENGTH(r.snapshot)<=8388608',timeout:5000},[SOURCE,options.action==='rollback'?options.spec.id:options.spec.parentVersion,'published']);
   if(!parents[0])throw Error('Expected serving vocabulary is unavailable');
   if(options.action==='stage'){const prepared=prepareQualityCandidate(parents[0].snapshot,options.spec);return {mode:'dry-run',action:options.action,id:options.spec.id,parentVersion:options.spec.parentVersion,termCount:prepared.termCount,servingPointerChanged:false};}
   return {mode:'dry-run',action:options.action,id:options.spec.id,parentVersion:options.spec.parentVersion,...(reader?{coverage:await inspectQualityCoverage(reader,options.activation,now)}:{}),servingPointerChanged:false};
  }
  const audit=async(coverage?:Awaited<ReturnType<typeof inspectQualityCoverage>>)=>{const key=createHash('sha256').update(JSON.stringify([options.action,options.spec.id,now.toISOString()])).digest('hex');
   const data={schemaVersion:1,action:options.action,id:options.spec.id,parentVersion:options.spec.parentVersion,implementationSha:options.spec.implementationSha,executedAt:now.toISOString(),backupReceipt:receipt,...(coverage?{coverage}:{})};
   await db.execute('INSERT INTO ts_job_runs(job_key,execution_key,status,result) VALUES(?,?,?,?)',['tags.vocabulary.quality-'+options.action,key,'complete',JSON.stringify(data)]);
  };
  return await withWriterLock(db,VOCABULARY_JOB,async vocabOwnership=>{
   if(options.action==='stage')return {...await stageQualityCandidate(db,options.spec,vocabOwnership,audit),backupReceipt:receipt};
   if(options.action==='rollback')return {...await rollbackQualityCandidate(db,options.spec,vocabOwnership,audit),backupReceipt:null};
   return withWriterLock(db,VIDEO_EVIDENCE_JOB,async evidenceOwnership=>{
    const ownership=async()=>{await vocabOwnership();await evidenceOwnership();};
    const result=await activateQualityCandidate(db,reader!,options.activation,ownership,now,audit);
    return {...result,backupReceipt:receipt};
   });
  },options.action==='rollback'?10:0);
 }finally{await reader?.close();await db.end();}
}
export async function handleQualityCli(args:string[],env:NodeJS.ProcessEnv){
 if(!args[0]?.startsWith(PREFIX))return false;console.log(JSON.stringify(await runQualityCommand(args,env)));return true;
}
