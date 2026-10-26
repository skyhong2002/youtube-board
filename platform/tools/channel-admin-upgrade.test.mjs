import {test} from 'node:test';
import assert from 'node:assert/strict';
import {planChannelAdmin,executeChannelAdmin,grantsBefore,NEW_TABLES} from './channel-admin-upgrade.mjs';
import {planWorker} from './worker-schema.mjs';
const env={FRONTEND_ACCOUNT_HOST:'10.0.1.0/255.255.255.0',WORKER_ACCOUNT_HOST:'10.0.1.0/255.255.255.0',FRONTEND_BOOTSTRAP_URL:'mock'};
const W="TO 'youtube_ts_w_youtube_source'@'10.0.1.0/255.255.255.0'";
test('plan adds one table with web SELECT/INSERT, two worker facade views and only the reviewed worker rights',async()=>{
 const p=await planChannelAdmin(env);
 assert.equal(p.facade,'youtube_board_ts_worker_youtube_source');assert.match(p.ddl,/^CREATE TABLE IF NOT EXISTS ts_channel_admin_requests \(/);
 assert.deepEqual(p.stateGrants,["GRANT SELECT ON `youtube_board_ts`.`ts_channel_admin_requests` TO 'youtube_ts_state'@'10.0.1.0/255.255.255.0'","GRANT INSERT ON `youtube_board_ts`.`ts_channel_admin_requests` TO 'youtube_ts_state'@'10.0.1.0/255.255.255.0'"]);
 for(const g of p.stateGrants)assert.doesNotMatch(g,/UPDATE|DELETE|ALL|youtube_ts_report/);
 assert.equal(p.views.length,2);
 assert.deepEqual(p.views.map(v=>/`\.`(\w+)` AS SELECT/.exec(v)[1]).sort(),[...NEW_TABLES].sort());
 for(const v of p.views)assert.match(v,/SQL SECURITY INVOKER VIEW `youtube_board_ts_worker_youtube_source`\./);
 assert.deepEqual(p.workerGrants.sort(),[
  "GRANT INSERT ON `youtube_board`.`urt_tag_log` "+W,
  "GRANT INSERT,SELECT ON `youtube_board`.`urt_tag` "+W,
  "GRANT INSERT,SELECT,SHOW VIEW ON `youtube_board_ts_worker_youtube_source`.`urt_tag` "+W,
  "GRANT INSERT,SELECT,UPDATE ON `youtube_board`.`urt_channel` "+W,
  "GRANT INSERT,SELECT,UPDATE,SHOW VIEW ON `youtube_board_ts_worker_youtube_source`.`urt_channel` "+W,
  "GRANT INSERT,SHOW VIEW ON `youtube_board_ts_worker_youtube_source`.`urt_tag_log` "+W,
  "GRANT SELECT,UPDATE ON `youtube_board_ts`.`ts_channel_admin_requests` "+W,
  "GRANT SELECT,UPDATE,SHOW VIEW ON `youtube_board_ts_worker_youtube_source`.`ts_channel_admin_requests` "+W,
 ].sort());
});
test('the worker never gains DELETE, DDL or any right on another table, and urt_tag_log is insert-only',async()=>{
 const p=await planChannelAdmin(env);
 for(const g of p.workerGrants){assert.doesNotMatch(g,/DELETE|DROP|ALTER|CREATE|ALL|GRANT OPTION/);assert.match(g,/urt_channel|urt_tag_log|urt_tag|ts_channel_admin_requests/);}
 assert.ok(p.workerGrants.filter(g=>g.includes('`urt_tag_log`')).every(g=>!/SELECT|UPDATE/.test(g)));
});
test('the grants before the upgrade are the planned set minus the new tables and the added INSERT rights, and nothing else',async()=>{
 const planned=planWorker({...env,WORKER_BATCH:'youtube-source'}).grants,before=grantsBefore(planned);
 assert.ok(before.length<planned.length);
 assert.ok(before.includes("GRANT SELECT,UPDATE ON `youtube_board`.`urt_channel` "+W));
 assert.ok(before.includes("GRANT SELECT,UPDATE,SHOW VIEW ON `youtube_board_ts_worker_youtube_source`.`urt_channel` "+W));
 assert.ok(before.includes("GRANT SELECT ON `youtube_board`.`urt_tag` "+W));
 assert.ok(before.includes("GRANT SELECT,SHOW VIEW ON `youtube_board_ts_worker_youtube_source`.`urt_tag` "+W));
 assert.ok(!before.some(g=>g.includes('urt_tag_log')||g.includes('ts_channel_admin_requests')));
 const unchanged=planned.filter(g=>!/`(?:urt_channel|urt_tag|urt_tag_log|ts_channel_admin_requests)`/.test(g));
 assert.deepEqual(before.filter(g=>!/`(?:urt_channel|urt_tag)`/.test(g)),unchanged);
});
test('missing connection input, bad phase or a changed plan fail before any database connection',async()=>{
 let called=false;const plan=await planChannelAdmin(env);
 await assert.rejects(executeChannelAdmin(plan,{...env,FRONTEND_BOOTSTRAP_URL:''},'prepare',async()=>{called=true;}),/EXPLICIT_UPGRADE/);
 await assert.rejects(executeChannelAdmin(plan,env,'all',async()=>{called=true;}),/INVALID_PHASE/);
 await assert.rejects(executeChannelAdmin({...plan,sha256:'0'.repeat(64)},env,'prepare',async()=>{called=true;}),/PLAN_CHANGED/);
 assert.equal(called,false);
});
test('prepare refuses an existing table or views; worker phase refuses to grant before prepare',async()=>{
 const plan=await planChannelAdmin(env);
 for(const [phase,rows,error]of [
  ['prepare',[{TABLE_SCHEMA:'youtube_board_ts',TABLE_NAME:'ts_channel_admin_requests',TABLE_TYPE:'BASE TABLE'}],/ALREADY_EXIST/],
  ['prepare',[{TABLE_SCHEMA:'youtube_board_ts_worker_youtube_source',TABLE_NAME:'urt_tag_log',TABLE_TYPE:'VIEW'}],/ALREADY_EXIST/],
  ['worker',[],/PREPARE_REQUIRED/],
  ['worker',[{TABLE_SCHEMA:'youtube_board_ts',TABLE_NAME:'ts_channel_admin_requests',TABLE_TYPE:'BASE TABLE'}],/PREPARE_REQUIRED/],
 ]){
  const sent=[];let ended=false;
  const db={query:async sql=>{sent.push(sql);return [[{ok:1}]];},execute:async sql=>{sent.push(sql);return [rows];},end:async()=>{ended=true;}};
  await assert.rejects(executeChannelAdmin(plan,env,phase,async()=>db),error);
  assert.ok(ended);assert.ok(!sent.some(s=>/^(?:GRANT|CREATE)/.test(s)));
 }
});
