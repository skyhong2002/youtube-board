import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import mysql from 'mysql2/promise';
import {planFrontend,verifyGrants} from './frontend-schema.mjs';
import {planWorker} from './worker-schema.mjs';
import {verifyFacadeTable} from '../shared/physical-tables.ts';
export const table='ts_channel_admin_requests';
const batch='youtube-source',mentions=statement=>statement.includes('`'+table+'`');
/** Objects this feature adds for the youtube-source worker: two new facade views, and INSERT on two source tables that
 * were already readable. Everything else the worker holds is unchanged and is verified as such. */
export const NEW_TABLES=Object.freeze(['ts_channel_admin_requests','urt_tag_log']);
export const ADDED_RIGHTS=Object.freeze({urt_channel:['INSERT'],urt_tag:['INSERT']});
const grantPattern=/^GRANT (.+?) ON `([a-z0-9_]+)`\.`([a-z0-9_]+)` TO (.+)$/;
const touched=name=>NEW_TABLES.includes(name)||Object.hasOwn(ADDED_RIGHTS,name);
/** The worker's grants before this feature: the planned set minus the new tables and the added INSERT rights. */
export function grantsBefore(grants){
 return grants.flatMap(statement=>{
  const m=grantPattern.exec(statement);if(!m)return [statement];
  const [,rights,,name,principal]=m;if(!touched(name))return [statement];
  if(NEW_TABLES.includes(name))return [];
  const kept=rights.split(',').filter(r=>!ADDED_RIGHTS[name].includes(r));
  return kept.length?[`GRANT ${kept.join(',')} ON ${statement.slice(statement.indexOf(' ON ')+4,statement.indexOf(' TO '))} TO ${principal}`]:[];
 });
}
/** Add the administrator channel-edit table and the worker rights that apply it, in two verified steps.
 * prepare: table, the worker facade views and the web's own-state SELECT/INSERT (the running worker's grants stay unchanged).
 * worker: the youtube-source worker's new rights, applied together with the worker image that runs youtube.channels.admin.
 * No source DDL, data changes, user creation, password rotation or downgrade/drop operations. */
export async function planChannelAdmin(env){
 const frontend=await planFrontend(env),worker=planWorker({...env,WORKER_BATCH:batch});
 const ddl=(await readFile(new URL('../jobs/migrations/020_channel_admin_requests.sql',import.meta.url),'utf8')).replace(/^\s*--[^\n]*$/gm,'').trim().replace(/;$/,'');
 if(!ddl.startsWith(`CREATE TABLE IF NOT EXISTS ${table} (`)||ddl.includes(';')||/`|\b(?:DEFINER|INSERT|UPDATE|DELETE|SELECT|DROP|GRANT|REFERENCES|VIEW)\b/i.test(ddl))throw Error('INVALID_CHANNEL_ADMIN_MIGRATION');
 const stateGrants=frontend.grants.filter(mentions);
 if(stateGrants.length!==2||!stateGrants[0].startsWith('GRANT SELECT ON ')||!stateGrants[1].startsWith('GRANT INSERT ON ')||!stateGrants.every(g=>g.includes(`'${frontend.stateUser}'@`)&&!g.includes(`'${frontend.reportUser}'@`)))throw Error('INVALID_CHANNEL_ADMIN_STATE_GRANT');
 const views=worker.views.filter(v=>NEW_TABLES.some(name=>v.includes('`.`'+name+'` AS SELECT')));
 if(views.length!==NEW_TABLES.length)throw Error('INVALID_CHANNEL_ADMIN_WORKER_VIEWS');
 const before=grantsBefore(worker.grants),changed=worker.grants.filter(g=>!before.includes(g));
 const tablesOf=list=>[...new Set(list.map(g=>grantPattern.exec(g)?.[3]))].sort();
 if(changed.length!==8||tablesOf(changed).join()!==['ts_channel_admin_requests','urt_channel','urt_tag','urt_tag_log'].join())throw Error('INVALID_CHANNEL_ADMIN_WORKER_GRANTS');
 for(const g of changed){const [, rights,, name]=grantPattern.exec(g);const list=rights.split(',');
  if(list.some(r=>['ALL','DELETE','DROP','ALTER','CREATE','GRANT OPTION'].includes(r)||r.startsWith('ALL')))throw Error('INVALID_CHANNEL_ADMIN_WORKER_GRANTS');
  // SELECT is required, not optional: the worker verifies its facade view against the backing table's columns on every connection,
  // and MariaDB hides both from an account that holds only INSERT. The log stays append-only (no UPDATE, no DELETE).
  if(name==='urt_tag_log'&&list.some(r=>!['SELECT','INSERT','SHOW VIEW'].includes(r)))throw Error('INVALID_CHANNEL_ADMIN_WORKER_GRANTS');}
 const mappings=Object.fromEntries(NEW_TABLES.map(name=>[name,worker.mapping[name]]));
 const plan={target:frontend.target,facade:worker.facade,workerUser:worker.user,workerHost:worker.host,stateUser:frontend.stateUser,ddl,views,stateGrants,workerGrants:changed,mappings};
 return {...plan,sha256:createHash('sha256').update(JSON.stringify(plan)).digest('hex')};
}
const workerSet=(worker,grants)=>({reportUser:worker.user,stateUser:worker.user,accountHost:worker.host,grants});
export async function executeChannelAdmin(plan,env,phase,connect=mysql.createConnection){
 if(!['prepare','worker'].includes(phase))throw Error('INVALID_PHASE');
 if(!env.FRONTEND_BOOTSTRAP_URL)throw Error('EXPLICIT_UPGRADE_INPUTS_REQUIRED');
 const expected=await planChannelAdmin(env);if(expected.sha256!==plan.sha256)throw Error('PLAN_CHANGED');plan=expected;
 const frontend=await planFrontend(env),worker=planWorker({...env,WORKER_BATCH:batch});
 const frontendBefore={...frontend,grants:frontend.grants.filter(s=>!mentions(s))},workerBefore=workerSet(worker,grantsBefore(worker.grants)),workerAfter=workerSet(worker,worker.grants);
 const db=await connect({uri:env.FRONTEND_BOOTSTRAP_URL,multipleStatements:false,connectTimeout:5000});let mutationStarted=false,locked=false;
 try{
  const [locks]=await db.query("SELECT GET_LOCK('youtube-board-channel-admin-upgrade',0) AS ok");if(Number(locks[0]?.ok)!==1)throw Error('UPGRADE_LOCK_UNAVAILABLE');locked=true;
  const [tables]=await db.execute('SELECT TABLE_SCHEMA,TABLE_NAME,TABLE_TYPE FROM information_schema.TABLES WHERE TABLE_NAME IN (?,?) AND TABLE_SCHEMA IN (?,?)',[...NEW_TABLES,plan.target,plan.facade]);
  const viewsPresent=tables.filter(r=>r.TABLE_SCHEMA===plan.facade&&r.TABLE_TYPE==='VIEW').length;
  if(phase==='prepare'){
   if(tables.some(r=>r.TABLE_NAME===table))throw Error('CHANNEL_ADMIN_REQUESTS_ALREADY_EXIST_VERIFY_MANUALLY');
   if(tables.some(r=>r.TABLE_SCHEMA===plan.facade))throw Error('CHANNEL_ADMIN_VIEWS_ALREADY_EXIST_VERIFY_MANUALLY');
   await verifyGrants(db,frontendBefore);await verifyGrants(db,workerBefore);
   mutationStarted=true;await db.query('USE `'+plan.target+'`');await db.query(plan.ddl);
   await db.query('SELECT id,request_id,kind,actor,payload,status,error_code,result,created_at,applied_at FROM ts_channel_admin_requests LIMIT 0');
   for(const view of plan.views)await db.query(view);
   for(const name of NEW_TABLES)await verifyFacadeTable(db,plan.facade,name,plan.mappings[name]);
   for(const grant of plan.stateGrants)await db.query(grant);
   await verifyGrants(db,frontend);await verifyGrants(db,workerBefore);
   return {phase,target:plan.target,facade:plan.facade,table,views:NEW_TABLES.length,stateGrants:'SELECT,INSERT',workerGrants:'unchanged',sourceWrites:0,sourceDdl:0,planSha256:plan.sha256};
  }
  if(!tables.some(r=>r.TABLE_SCHEMA===plan.target&&r.TABLE_NAME===table&&r.TABLE_TYPE==='BASE TABLE')||viewsPresent!==NEW_TABLES.length)throw Error('CHANNEL_ADMIN_PREPARE_REQUIRED');
  for(const name of NEW_TABLES)await verifyFacadeTable(db,plan.facade,name,plan.mappings[name]);
  await verifyGrants(db,frontend);await verifyGrants(db,workerBefore);
  mutationStarted=true;for(const grant of plan.workerGrants)await db.query(grant);await verifyGrants(db,workerAfter);
  return {phase,facade:plan.facade,table,workerUser:plan.workerUser,workerGrants:plan.workerGrants.length,sourceWrites:0,sourceDdl:0,planSha256:plan.sha256};
 }catch(error){const e=new Error(error instanceof Error&&/^[A-Z0-9_]{1,80}$/.test(error.message)?error.message:'CHANNEL_ADMIN_UPGRADE_FAILED');e.partial=mutationStarted;throw e;}
 finally{if(locked)await db.query("SELECT RELEASE_LOCK('youtube-board-channel-admin-upgrade')").catch(()=>{});await db.end();}
}
async function main(){
 const args=process.argv.slice(2),phase=args.find(a=>a.startsWith('--phase='))?.slice(8);
 if(args.some(a=>!['--execute','--dry-run'].includes(a)&&!/^--phase=(?:prepare|worker)$/.test(a))||new Set(args).size!==args.length||(args.includes('--execute')&&!phase))throw Error('INVALID_ARGUMENTS');
 const plan=await planChannelAdmin(process.env);
 console.log(JSON.stringify(args.includes('--execute')?await executeChannelAdmin(plan,process.env,phase):{mode:'dry-run',target:plan.target,facade:plan.facade,table,stateGrants:plan.stateGrants,workerGrants:plan.workerGrants,views:plan.views,sourceWrites:0,sourceDdl:0,planSha256:plan.sha256}));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(e=>{console.error(JSON.stringify({error:e instanceof Error&&/^[A-Z0-9_]{1,80}$/.test(e.message)?e.message:'CHANNEL_ADMIN_UPGRADE_FAILED',partial:!!e.partial}));process.exitCode=1;});
