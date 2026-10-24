import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import mysql from 'mysql2/promise';
import {planFrontend,verifyGrants} from './frontend-schema.mjs';
import {planWorker} from './worker-schema.mjs';
import {verifyFacadeTable} from '../shared/physical-tables.ts';
export const table='ts_channel_title_history';
const batch='youtube-source',mentions=statement=>statement.includes('`'+table+'`');
/** Add the observed channel-name table in two steps, each verified against the full reviewed grant sets.
 * prepare: table, worker facade view and report SELECT (the running worker's grants stay unchanged).
 * worker: the stats worker's SELECT/INSERT, applied together with the worker image that writes the table.
 * No source DDL, data changes, user creation, password rotation or downgrade/drop operations. */
export async function planTitleHistory(env){
 const frontend=await planFrontend(env),worker=planWorker({...env,WORKER_BATCH:batch});
 const ddl=(await readFile(new URL('../jobs/migrations/017_channel_title_history.sql',import.meta.url),'utf8')).replace(/^\s*--[^\n]*$/gm,'').trim().replace(/;$/,'');
 if(!ddl.startsWith(`CREATE TABLE IF NOT EXISTS ${table} (`)||ddl.includes(';')||/`|\b(?:DEFINER|INSERT|UPDATE|DELETE|SELECT|DROP|GRANT|REFERENCES|VIEW)\b/i.test(ddl))throw Error('INVALID_TITLE_HISTORY_MIGRATION');
 const reportGrants=frontend.grants.filter(mentions),workerGrants=worker.grants.filter(mentions),view=worker.views.filter(mentions);
 if(reportGrants.length!==1||!reportGrants[0].startsWith('GRANT SELECT ON ')||!reportGrants[0].includes(`'${frontend.reportUser}'@`))throw Error('INVALID_TITLE_HISTORY_REPORT_GRANT');
 if(workerGrants.length!==2||!workerGrants[0].startsWith('GRANT INSERT,SELECT ON ')||!workerGrants[1].startsWith('GRANT INSERT,SELECT,SHOW VIEW ON ')||view.length!==1)throw Error('INVALID_TITLE_HISTORY_WORKER_GRANTS');
 const plan={target:frontend.target,facade:worker.facade,workerUser:worker.user,workerHost:worker.host,ddl,view:view[0],reportGrants,workerGrants};
 return {...plan,sha256:createHash('sha256').update(JSON.stringify(plan)).digest('hex')};
}
const workerSet=(worker,grants)=>({reportUser:worker.user,stateUser:worker.user,accountHost:worker.host,grants});
export async function executeTitleHistory(plan,env,phase,connect=mysql.createConnection){
 if(!['prepare','worker'].includes(phase))throw Error('INVALID_PHASE');
 if(!env.FRONTEND_BOOTSTRAP_URL)throw Error('EXPLICIT_UPGRADE_INPUTS_REQUIRED');
 const expected=await planTitleHistory(env);if(expected.sha256!==plan.sha256)throw Error('PLAN_CHANGED');plan=expected;
 const frontend=await planFrontend(env),worker=planWorker({...env,WORKER_BATCH:batch});
 const frontendBefore={...frontend,grants:frontend.grants.filter(s=>!mentions(s))},workerBefore=workerSet(worker,worker.grants.filter(s=>!mentions(s))),workerAfter=workerSet(worker,worker.grants);
 const db=await connect({uri:env.FRONTEND_BOOTSTRAP_URL,multipleStatements:false,connectTimeout:5000});let mutationStarted=false,locked=false;
 try{
  const [locks]=await db.query("SELECT GET_LOCK('youtube-board-title-history-upgrade',0) AS ok");if(Number(locks[0]?.ok)!==1)throw Error('UPGRADE_LOCK_UNAVAILABLE');locked=true;
  const [rows]=await db.execute('SELECT TABLE_SCHEMA,TABLE_TYPE FROM information_schema.TABLES WHERE TABLE_NAME=? AND TABLE_SCHEMA IN (?,?)',[table,plan.target,plan.facade]);
  if(phase==='prepare'){
   if(rows.length)throw Error('TITLE_HISTORY_ALREADY_EXISTS_VERIFY_MANUALLY');
   await verifyGrants(db,frontendBefore);await verifyGrants(db,workerBefore);
   mutationStarted=true;await db.query('USE `'+plan.target+'`');await db.query(plan.ddl);
   await db.query('SELECT id,u_id,title,observed_at,origin FROM ts_channel_title_history LIMIT 0');
   await db.query(plan.view);await verifyFacadeTable(db,plan.facade,table,{schema:plan.target,table});
   for(const grant of plan.reportGrants)await db.query(grant);
   await verifyGrants(db,frontend);await verifyGrants(db,workerBefore);
   return {phase,target:plan.target,facade:plan.facade,table,reportGrant:'SELECT',workerGrants:'unchanged',sourceWrites:0,sourceDdl:0,planSha256:plan.sha256};
  }
  if(rows.length!==2||!rows.some(r=>r.TABLE_SCHEMA===plan.target&&r.TABLE_TYPE==='BASE TABLE')||!rows.some(r=>r.TABLE_SCHEMA===plan.facade&&r.TABLE_TYPE==='VIEW'))throw Error('TITLE_HISTORY_PREPARE_REQUIRED');
  await verifyFacadeTable(db,plan.facade,table,{schema:plan.target,table});await verifyGrants(db,frontend);await verifyGrants(db,workerBefore);
  mutationStarted=true;for(const grant of plan.workerGrants)await db.query(grant);await verifyGrants(db,workerAfter);
  return {phase,facade:plan.facade,table,workerUser:plan.workerUser,workerGrant:'SELECT,INSERT',sourceWrites:0,sourceDdl:0,planSha256:plan.sha256};
 }catch(error){const e=new Error(error instanceof Error&&/^[A-Z0-9_]{1,80}$/.test(error.message)?error.message:'TITLE_HISTORY_UPGRADE_FAILED');e.partial=mutationStarted;throw e;}
 finally{if(locked)await db.query("SELECT RELEASE_LOCK('youtube-board-title-history-upgrade')").catch(()=>{});await db.end();}
}
async function main(){
 const args=process.argv.slice(2),phase=args.find(a=>a.startsWith('--phase='))?.slice(8);
 if(args.some(a=>!['--execute','--dry-run'].includes(a)&&!/^--phase=(?:prepare|worker)$/.test(a))||new Set(args).size!==args.length||(args.includes('--execute')&&!phase))throw Error('INVALID_ARGUMENTS');
 const plan=await planTitleHistory(process.env);
 console.log(JSON.stringify(args.includes('--execute')?await executeTitleHistory(plan,process.env,phase):{mode:'dry-run',target:plan.target,facade:plan.facade,table,reportGrants:plan.reportGrants,workerGrants:plan.workerGrants,view:plan.view,sourceWrites:0,sourceDdl:0,planSha256:plan.sha256}));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(e=>{console.error(JSON.stringify({error:e instanceof Error&&/^[A-Z0-9_]{1,80}$/.test(e.message)?e.message:'TITLE_HISTORY_UPGRADE_FAILED',partial:!!e.partial}));process.exitCode=1;});
