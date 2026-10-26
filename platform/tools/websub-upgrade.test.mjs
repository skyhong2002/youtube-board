import {test} from 'node:test';
import assert from 'node:assert/strict';
import {planWebsub,executeWebsub} from './websub-upgrade.mjs';
const env={FRONTEND_ACCOUNT_HOST:'10.0.1.0/255.255.255.0',WORKER_ACCOUNT_HOST:'10.0.1.0/255.255.255.0',FRONTEND_BOOTSTRAP_URL:'mock'};
test('plan adds one append-only table, its youtube-source facade view, web INSERT and worker SELECT/DELETE only',async()=>{
 const p=await planWebsub(env);
 assert.equal(p.facade,'youtube_board_ts_worker_youtube_source');assert.match(p.ddl,/^CREATE TABLE IF NOT EXISTS ts_websub_events \(/);
 assert.deepEqual(p.stateGrants,["GRANT SELECT ON `youtube_board_ts`.`ts_websub_events` TO 'youtube_ts_state'@'10.0.1.0/255.255.255.0'","GRANT INSERT ON `youtube_board_ts`.`ts_websub_events` TO 'youtube_ts_state'@'10.0.1.0/255.255.255.0'"]);
 for(const g of p.stateGrants)assert.doesNotMatch(g,/UPDATE|DELETE|ALL|youtube_ts_report/);
 for(const g of p.workerGrants){assert.match(g,/^GRANT DELETE,SELECT(?:,SHOW VIEW)? ON .* TO 'youtube_ts_w_youtube_source'@'10\.0\.1\.0\/255\.255\.255\.0'$/);assert.doesNotMatch(g,/INSERT|UPDATE|ALL/);}
 assert.match(p.view,/SQL SECURITY INVOKER VIEW `youtube_board_ts_worker_youtube_source`.`ts_websub_events` AS SELECT \* FROM `youtube_board_ts`.`ts_websub_events`$/);
});
test('the web principal cannot read or change anything else through this table plan, and no other worker batch is touched',async()=>{
 const p=await planWebsub(env);
 assert.equal(p.workerUser,'youtube_ts_w_youtube_source');assert.equal(p.stateUser,'youtube_ts_state');
 assert.ok(!/UPDATE|DROP|ALTER|REVOKE/.test(JSON.stringify([p.stateGrants,p.workerGrants,p.view,p.ddl])));
});
test('missing connection input or phase fails before any database connection',async()=>{
 let called=false;const plan=await planWebsub(env);
 await assert.rejects(executeWebsub(plan,{...env,FRONTEND_BOOTSTRAP_URL:''},'prepare',async()=>{called=true;}),/EXPLICIT_UPGRADE/);
 await assert.rejects(executeWebsub(plan,env,'all',async()=>{called=true;}),/INVALID_PHASE/);
 await assert.rejects(executeWebsub({...plan,sha256:'0'.repeat(64)},env,'prepare',async()=>{called=true;}),/PLAN_CHANGED/);
 assert.equal(called,false);
});
test('prepare refuses an existing table; worker phase refuses to grant before prepare',async()=>{
 const plan=await planWebsub(env);
 for(const [phase,rows,error]of [['prepare',[{TABLE_SCHEMA:'youtube_board_ts',TABLE_TYPE:'BASE TABLE'}],/ALREADY_EXIST/],['worker',[],/PREPARE_REQUIRED/]]){
  const sent=[];let ended=false;
  const db={query:async sql=>{sent.push(sql);return [[{ok:1}]];},execute:async sql=>{sent.push(sql);return [rows];},end:async()=>{ended=true;}};
  await assert.rejects(executeWebsub(plan,env,phase,async()=>db),error);
  assert.ok(ended);assert.ok(!sent.some(s=>/^(?:GRANT|CREATE)/.test(s)));
 }
});
