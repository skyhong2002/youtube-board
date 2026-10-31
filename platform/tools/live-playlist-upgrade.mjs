import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import mysql from 'mysql2/promise';
import {verifyGrants} from './frontend-schema.mjs';
import {planWorker} from './worker-schema.mjs';
import {verifyFacadeTable} from '../shared/physical-tables.ts';
export const table='ts_channel_admin_requests';
const batch='youtube-source',ADDED='INSERT';
const grantPattern=/^GRANT (.+?) ON `([a-z0-9_]+)`\.`([a-z0-9_]+)` TO (.+)$/;
/** The youtube-source worker's grants before youtube.live.playlist: the planned set without INSERT on the request queue. */
export function grantsBefore(grants){
 return grants.flatMap(statement=>{
  const m=grantPattern.exec(statement);if(!m||m[3]!==table)return [statement];
  const kept=m[1].split(',').filter(r=>r!==ADDED);
  return kept.length?[`GRANT ${kept.join(',')} ON \`${m[2]}\`.\`${m[3]}\` TO ${m[4]}`]:[];
 });
}
/** youtube.live.playlist (加入直播) queues add-channel requests for channels it does not track yet, so the youtube-source worker
 * gains INSERT on ts_channel_admin_requests (backing table and facade view). One `worker` phase, applied together with the worker
 * image that runs the job. The table and the view already exist (tools/channel-admin-upgrade.mjs): no DDL, no new views, no source
 * writes, user creation, password rotation or downgrade/drop operations. */
export async function planLivePlaylist(env){
 const worker=planWorker({...env,WORKER_BATCH:batch});
 if(!worker.workflows.includes('youtube.live.playlist'))throw Error('INVALID_LIVE_PLAYLIST_BATCH');
 const before=grantsBefore(worker.grants),changed=worker.grants.filter(g=>!before.includes(g));
 if(changed.length!==2||before.length!==worker.grants.length)throw Error('INVALID_LIVE_PLAYLIST_WORKER_GRANTS');
 for(const g of changed){const m=grantPattern.exec(g);const rights=m?m[1].split(','):[];
  if(!m||m[3]!==table||!rights.includes(ADDED)||rights.some(r=>!['SELECT','INSERT','UPDATE','SHOW VIEW'].includes(r)))throw Error('INVALID_LIVE_PLAYLIST_WORKER_GRANTS');}
 if(!worker.views.some(v=>v.includes('`.`'+table+'` AS SELECT')))throw Error('INVALID_LIVE_PLAYLIST_WORKER_VIEWS');
 const plan={facade:worker.facade,workerUser:worker.user,workerHost:worker.host,workerGrants:changed,mapping:worker.mapping[table]};
 return {...plan,sha256:createHash('sha256').update(JSON.stringify(plan)).digest('hex')};
}
const workerSet=(worker,grants)=>({reportUser:worker.user,stateUser:worker.user,accountHost:worker.host,grants});
export async function executeLivePlaylist(plan,env,phase,connect=mysql.createConnection){
 if(phase!=='worker')throw Error('INVALID_PHASE');
 if(!env.FRONTEND_BOOTSTRAP_URL)throw Error('EXPLICIT_UPGRADE_INPUTS_REQUIRED');
 const expected=await planLivePlaylist(env);if(expected.sha256!==plan.sha256)throw Error('PLAN_CHANGED');plan=expected;
 const worker=planWorker({...env,WORKER_BATCH:batch});
 const workerBefore=workerSet(worker,grantsBefore(worker.grants)),workerAfter=workerSet(worker,worker.grants);
 const db=await connect({uri:env.FRONTEND_BOOTSTRAP_URL,multipleStatements:false,connectTimeout:5000});let mutationStarted=false,locked=false;
 try{
  const [locks]=await db.query("SELECT GET_LOCK('youtube-board-live-playlist-upgrade',0) AS ok");if(Number(locks[0]?.ok)!==1)throw Error('UPGRADE_LOCK_UNAVAILABLE');locked=true;
  const [tables]=await db.execute('SELECT TABLE_SCHEMA,TABLE_TYPE FROM information_schema.TABLES WHERE TABLE_NAME=? AND TABLE_SCHEMA IN (?,?)',[table,plan.mapping.schema,plan.facade]);
  if(!tables.some(r=>r.TABLE_SCHEMA===plan.mapping.schema&&r.TABLE_TYPE==='BASE TABLE')||!tables.some(r=>r.TABLE_SCHEMA===plan.facade&&r.TABLE_TYPE==='VIEW'))throw Error('CHANNEL_ADMIN_UPGRADE_REQUIRED');
  await verifyFacadeTable(db,plan.facade,table,plan.mapping);await verifyGrants(db,workerBefore);
  mutationStarted=true;for(const grant of plan.workerGrants)await db.query(grant);await verifyGrants(db,workerAfter);
  return {phase,facade:plan.facade,table,workerUser:plan.workerUser,workerGrant:ADDED,workerGrants:plan.workerGrants.length,sourceWrites:0,sourceDdl:0,planSha256:plan.sha256};
 }catch(error){const e=new Error(error instanceof Error&&/^[A-Z0-9_]{1,80}$/.test(error.message)?error.message:'LIVE_PLAYLIST_UPGRADE_FAILED');e.partial=mutationStarted;throw e;}
 finally{if(locked)await db.query("SELECT RELEASE_LOCK('youtube-board-live-playlist-upgrade')").catch(()=>{});await db.end();}
}
async function main(){
 const args=process.argv.slice(2),phase=args.find(a=>a.startsWith('--phase='))?.slice(8);
 if(args.some(a=>!['--execute','--dry-run'].includes(a)&&a!=='--phase=worker')||new Set(args).size!==args.length||(args.includes('--execute')&&!phase))throw Error('INVALID_ARGUMENTS');
 const plan=await planLivePlaylist(process.env);
 console.log(JSON.stringify(args.includes('--execute')?await executeLivePlaylist(plan,process.env,phase):{mode:'dry-run',facade:plan.facade,table,workerUser:plan.workerUser,workerGrants:plan.workerGrants,sourceWrites:0,sourceDdl:0,planSha256:plan.sha256}));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(e=>{console.error(JSON.stringify({error:e instanceof Error&&/^[A-Z0-9_]{1,80}$/.test(e.message)?e.message:'LIVE_PLAYLIST_UPGRADE_FAILED',partial:!!e.partial}));process.exitCode=1;});
