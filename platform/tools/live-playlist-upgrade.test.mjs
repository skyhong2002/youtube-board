import {test} from 'node:test';
import assert from 'node:assert/strict';
import {planLivePlaylist,executeLivePlaylist,grantsBefore,table} from './live-playlist-upgrade.mjs';
import {planWorker} from './worker-schema.mjs';
const env={WORKER_ACCOUNT_HOST:'10.0.1.0/255.255.255.0',FRONTEND_BOOTSTRAP_URL:'mock'};
const W="TO 'youtube_ts_w_youtube_source'@'10.0.1.0/255.255.255.0'",grantee="'youtube_ts_w_youtube_source'@'10.0.1.0/255.255.255.0'";
test('plan adds only INSERT on the request queue (backing table and facade view) for the youtube-source worker',async()=>{
 const p=await planLivePlaylist(env);
 assert.equal(p.facade,'youtube_board_ts_worker_youtube_source');
 assert.deepEqual(p.mapping,{schema:'youtube_board_ts',table});
 assert.deepEqual(p.workerGrants,[
  "GRANT INSERT,SELECT,UPDATE ON `youtube_board_ts`.`ts_channel_admin_requests` "+W,
  "GRANT INSERT,SELECT,UPDATE,SHOW VIEW ON `youtube_board_ts_worker_youtube_source`.`ts_channel_admin_requests` "+W,
 ]);
 assert.match(p.sha256,/^[0-9a-f]{64}$/);
});
test('the grants before the upgrade differ only by INSERT on the request queue',()=>{
 const planned=planWorker({...env,WORKER_BATCH:'youtube-source'}).grants,before=grantsBefore(planned);
 assert.equal(before.length,planned.length);
 const diff=before.filter(g=>!planned.includes(g));
 assert.deepEqual(diff,[
  "GRANT SELECT,UPDATE ON `youtube_board_ts`.`ts_channel_admin_requests` "+W,
  "GRANT SELECT,UPDATE,SHOW VIEW ON `youtube_board_ts_worker_youtube_source`.`ts_channel_admin_requests` "+W,
 ]);
 for(const g of planned.filter(g=>g.includes('`'+table+'`')))assert.doesNotMatch(g,/DELETE|DROP|ALTER|CREATE|GRANT OPTION|\bALL\b/);
});
test('missing connection input, bad phase or a changed plan fail before any database connection',async()=>{
 let called=false;const plan=await planLivePlaylist(env);
 await assert.rejects(executeLivePlaylist(plan,{...env,FRONTEND_BOOTSTRAP_URL:''},'worker',async()=>{called=true;}),/EXPLICIT_UPGRADE/);
 for(const phase of ['prepare','all',undefined])await assert.rejects(executeLivePlaylist(plan,env,phase,async()=>{called=true;}),/INVALID_PHASE/);
 await assert.rejects(executeLivePlaylist({...plan,sha256:'0'.repeat(64)},env,'worker',async()=>{called=true;}),/PLAN_CHANGED/);
 assert.equal(called,false);
});

/** A fake server holding the worker's table privileges, the request table and its facade view. */
function server({tables=true,grants,locked=false}){
 const planned=planWorker({...env,WORKER_BATCH:'youtube-source'});
 const privileges=new Set();
 const apply=statement=>{const m=/^GRANT (.+?) ON `([a-z0-9_]+)`\.`([a-z0-9_]+)` TO (.+)$/.exec(statement);for(const r of m[1].split(','))privileges.add([m[2],m[3],r].join('.'));};
 for(const g of grants(planned.grants))apply(g);
 const sent=[];let ended=false;
 const columns=['id','request_id','kind','actor','payload','status','error_code','result','created_at','applied_at'];
 const backing='`youtube_board_ts`.`ts_channel_admin_requests`';
 const answer=async(sql,params=[])=>{
  sent.push(sql);
  if(sql.startsWith('SELECT GET_LOCK'))return [[{ok:locked?0:1}]];
  if(sql.startsWith('SELECT RELEASE_LOCK'))return [[{ok:1}]];
  if(sql.startsWith('SELECT TABLE_SCHEMA,TABLE_TYPE FROM information_schema.TABLES'))return [tables?[{TABLE_SCHEMA:'youtube_board_ts',TABLE_TYPE:'BASE TABLE'},{TABLE_SCHEMA:planned.facade,TABLE_TYPE:'VIEW'}]:[]];
  if(sql.includes('FROM information_schema.VIEWS'))return [[{VIEW_DEFINITION:'select '+columns.map(c=>backing+'.`'+c+'` AS `'+c+'`').join(',')+' from '+backing,IS_UPDATABLE:'YES',SECURITY_TYPE:'INVOKER',ALGORITHM:'MERGE',CHECK_OPTION:'NONE'}]];
  if(sql.startsWith('SELECT TABLE_TYPE,ENGINE'))return [[{TABLE_TYPE:'BASE TABLE',ENGINE:'InnoDB'}]];
  if(sql.startsWith('SELECT COLUMN_NAME'))return [columns.map(COLUMN_NAME=>({COLUMN_NAME}))];
  if(sql.includes('information_schema.TABLE_PRIVILEGES WHERE GRANTEE=?'))return [params[0]===grantee?[...privileges].map(p=>{const [s,t,r]=p.split('.');return {TABLE_SCHEMA:s,TABLE_NAME:t,PRIVILEGE_TYPE:r,IS_GRANTABLE:'NO'};}):[]];
  if(sql.includes('information_schema.USER_PRIVILEGES WHERE GRANTEE=?'))return [[{PRIVILEGE_TYPE:'USAGE',IS_GRANTABLE:'NO'}]];
  if(/information_schema\.|mysql\./.test(sql))return [[]];
  if(sql.startsWith('GRANT ')){apply(sql);return [{}];}
  throw Error('UNEXPECTED_SQL '+sql);
 };
 return {db:{query:answer,execute:answer,end:async()=>{ended=true;}},sent,privileges,ended:()=>ended};
}
test('worker phase verifies the old grant set, adds exactly the two INSERT grants and verifies the new set',async()=>{
 const plan=await planLivePlaylist(env),s=server({grants:grantsBefore});
 const result=await executeLivePlaylist(plan,env,'worker',async()=>s.db);
 assert.deepEqual(result,{phase:'worker',facade:plan.facade,table,workerUser:'youtube_ts_w_youtube_source',workerGrant:'INSERT',workerGrants:2,sourceWrites:0,sourceDdl:0,planSha256:plan.sha256});
 assert.deepEqual(s.sent.filter(q=>/^(?:GRANT|CREATE|DROP|REVOKE|ALTER|INSERT|UPDATE|DELETE)/.test(q)),plan.workerGrants);
 assert.ok(s.privileges.has('youtube_board_ts.ts_channel_admin_requests.INSERT')&&s.privileges.has(plan.facade+'.ts_channel_admin_requests.INSERT'));
 assert.ok(s.ended());assert.ok(s.sent.some(q=>q.startsWith('SELECT RELEASE_LOCK')));
});
test('worker phase refuses without the request table, with drifted grants, when already applied or when the lock is held',async()=>{
 const plan=await planLivePlaylist(env);
 for(const [options,error,partial]of [
  [{tables:false,grants:grantsBefore},/CHANNEL_ADMIN_UPGRADE_REQUIRED/,false],
  [{grants:g=>grantsBefore(g).filter(x=>!x.includes('`urt_video_live`'))},/RUNTIME_GRANTS_MISMATCH/,false],
  [{grants:g=>g},/RUNTIME_GRANTS_MISMATCH/,false],
  [{grants:grantsBefore,locked:true},/UPGRADE_LOCK_UNAVAILABLE/,false],
 ]){
  const s=server(options);
  await assert.rejects(executeLivePlaylist(plan,env,'worker',async()=>s.db),e=>error.test(e.message)&&e.partial===partial);
  assert.ok(s.ended());assert.ok(!s.sent.some(q=>q.startsWith('GRANT')));
 }
});
