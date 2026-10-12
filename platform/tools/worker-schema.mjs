import mysql from 'mysql2/promise';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {workerSchema,workerTableNames} from '../shared/worker-schema.ts';
import {verifyFacadeTable} from '../shared/physical-tables.ts';
import {settings,verifyGrants} from './frontend-schema.mjs';
const id=v=>{if(!/^[a-z][a-z0-9_]{0,63}$/.test(v))throw Error('INVALID_IDENTIFIER');return '`'+v+'`';};
export function planWorker(env={}){
 const schema=workerSchema({...env,TS_WORKER_SCHEMA_MODE:'facade',DB_DATABASE:env.WORKER_TARGET_SCHEMA??'youtube_board_ts_worker',TS_SOURCE_SCHEMA:env.WORKER_SOURCE_SCHEMA??'youtube_board',TS_STATE_SCHEMA:env.WORKER_STATE_SCHEMA??'youtube_board_ts',TS_WORKER_WORKFLOW:env.WORKER_WORKFLOW});
 const account=settings({...env,FRONTEND_SOURCE_SCHEMA:schema.source,FRONTEND_TARGET_SCHEMA:schema.state,FRONTEND_REPORT_USER:env.WORKER_USER??'youtube_ts_worker',FRONTEND_STATE_USER:'unused_state_validation',FRONTEND_ACCOUNT_HOST:env.WORKER_ACCOUNT_HOST});
 const user=account.reportUser,host=account.accountHost,principal=`'${user}'@'${host}'`,grants=[],views=[];
 for(const [table,rights]of Object.entries(schema.tables).sort(([a],[b])=>a.localeCompare(b))){const target=schema.mapping[table];views.push(`CREATE ALGORITHM=MERGE SQL SECURITY INVOKER VIEW ${id(schema.facade)}.${id(table)} AS SELECT * FROM ${id(target.schema)}.${id(table)}`);grants.push(`GRANT ${rights.join(',')} ON ${id(target.schema)}.${id(table)} TO ${principal}`);grants.push(`GRANT ${[...rights,'SHOW VIEW'].join(',')} ON ${id(schema.facade)}.${id(table)} TO ${principal}`);}
 const plan={...schema,user,host,grants,views};return {...plan,sha256:createHash('sha256').update(JSON.stringify(plan)).digest('hex')};
}
export async function executeWorker(plan,env,connect=mysql.createConnection){
 if(env.WORKER_BACKUP_OFFHOST_VERIFIED!=='true'||env.WORKER_RESTORE_VERIFIED!=='true')throw Error('VERIFIED_OFFHOST_BACKUP_AND_RESTORE_REQUIRED');
 if(!env.WORKER_BOOTSTRAP_URL||typeof env.WORKER_PASSWORD!=='string'||env.WORKER_PASSWORD.length<32)throw Error('EXPLICIT_BOOTSTRAP_CREDENTIALS_REQUIRED');
 const trusted=planWorker(env);if(trusted.sha256!==plan.sha256)throw Error('PLAN_CHANGED');plan=trusted;
 const db=await connect({uri:env.WORKER_BOOTSTRAP_URL,multipleStatements:false,connectTimeout:5000});let mutationStarted=false;
 try{
  const[users]=await db.execute('SELECT User FROM mysql.user WHERE User=?',[plan.user]);if(users.length)throw Error('RUNTIME_PRINCIPAL_MUST_BE_NEW');
  await assertFacadeHasNoExecutableObjects(db,plan.facade);
  const[objects]=await db.execute('SELECT TABLE_NAME,TABLE_TYPE FROM information_schema.TABLES WHERE TABLE_SCHEMA=?',[plan.facade]);
  // Existing facade may contain other explicitly provisioned workflows; validate every
  // existing view to same-name physical source/state. Never replace or ALTER an object.
  for(const row of objects){if(row.TABLE_TYPE!=='VIEW'||!workerTableNames.includes(row.TABLE_NAME)||!/^((urt_|ts_|ingestion_youtube_|telegram_digest_)[a-z0-9_]+|cache|cache_locks|tags|tag_group)$/.test(row.TABLE_NAME)||/^ts_(auth_|reader_)/.test(row.TABLE_NAME))throw Error('WORKER_FACADE_OBJECT_MISMATCH');await verifyFacadeTable(db,plan.facade,row.TABLE_NAME,{schema:row.TABLE_NAME.startsWith('ts_')?plan.state:plan.source,table:row.TABLE_NAME});}
  for(const target of Object.values(plan.mapping)){const[physical]=await db.execute("SELECT TABLE_TYPE FROM information_schema.TABLES WHERE TABLE_SCHEMA=? AND TABLE_NAME=?",[target.schema,target.table]);if(physical.length!==1||physical[0].TABLE_TYPE!=='BASE TABLE')throw Error('WORKER_BACKING_TABLES_INCOMPLETE');}
  const[schemas]=await db.execute('SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME=?',[plan.facade]);
  mutationStarted=true;if(!schemas.length)await db.query(`CREATE DATABASE ${id(plan.facade)} CHARACTER SET utf8mb4 COLLATE utf8mb4_bin`);
  const existing=new Set(objects.map(r=>r.TABLE_NAME));for(const [index,table]of Object.keys(plan.tables).sort((a,b)=>a.localeCompare(b)).entries())if(!existing.has(table))await db.query(plan.views[index]);
  for(const[table,target]of Object.entries(plan.mapping))await verifyFacadeTable(db,plan.facade,table,target);
  await db.query(`CREATE USER '${plan.user}'@'${plan.host}' IDENTIFIED BY ?`,[env.WORKER_PASSWORD]);for(const grant of plan.grants)await db.query(grant);
  await verifyGrants(db,{reportUser:plan.user,stateUser:plan.user,accountHost:plan.host,grants:plan.grants});
  return {workflow:plan.workflow,facade:plan.facade,views:Object.keys(plan.tables).length,sourceDdl:0,sourceWrites:0,planSha256:plan.sha256};
 }catch(error){const failure=new Error(error instanceof Error&&/^[A-Z0-9_]{1,80}$/.test(error.message)?error.message:'WORKER_BOOTSTRAP_FAILED');failure.partial=mutationStarted;throw failure;}finally{await db.end();}
}
export async function assertFacadeHasNoExecutableObjects(db,facade){
 for(const [table,column]of [['ROUTINES','ROUTINE_SCHEMA'],['TRIGGERS','TRIGGER_SCHEMA'],['EVENTS','EVENT_SCHEMA']]){const[rows]=await db.execute(`SELECT COUNT(*) n FROM information_schema.${table} WHERE ${column}=?`,[facade]);if(Number(rows[0]?.n)!==0)throw Error('WORKER_FACADE_EXECUTABLE_OBJECTS_FORBIDDEN');}
}
async function main(){const args=process.argv.slice(2);if(args.length>1||args.some(a=>!['--execute','--dry-run'].includes(a)))throw Error('INVALID_ARGUMENTS');const plan=planWorker(process.env);if(args.includes('--execute'))console.log(JSON.stringify(await executeWorker(plan,process.env)));else console.log(JSON.stringify({mode:'dry-run',workflow:plan.workflow,facade:plan.facade,source:plan.source,state:plan.state,user:plan.user,host:plan.host,permissions:plan.tables,dependencies:plan.dependencies,sourceDdl:0,sourceWrites:0,sha256:plan.sha256}));}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(e=>{console.error(JSON.stringify({error:e instanceof Error&&/^[A-Z0-9_]{1,80}$/.test(e.message)?e.message:'WORKER_BOOTSTRAP_FAILED',partial:!!e.partial}));process.exitCode=1;});
