import {test} from 'node:test';
import assert from 'node:assert/strict';
import {planTitleHistory,executeTitleHistory} from './channel-title-history-upgrade.mjs';
const env={FRONTEND_ACCOUNT_HOST:'10.0.1.0/255.255.255.0',WORKER_ACCOUNT_HOST:'10.0.1.0/255.255.255.0',FRONTEND_BOOTSTRAP_URL:'mock'};
test('plan adds one append-only table, its stats-worker facade view, report SELECT and worker SELECT/INSERT only',async()=>{
 const p=await planTitleHistory(env);
 assert.equal(p.facade,'youtube_board_ts_worker_youtube_source');assert.match(p.ddl,/^CREATE TABLE IF NOT EXISTS ts_channel_title_history \(/);
 assert.deepEqual(p.reportGrants,["GRANT SELECT ON `youtube_board_ts`.`ts_channel_title_history` TO 'youtube_ts_report'@'10.0.1.0/255.255.255.0'"]);
 for(const g of p.workerGrants){assert.match(g,/^GRANT INSERT,SELECT(?:,SHOW VIEW)? ON .* TO 'youtube_ts_w_youtube_source'@'10\.0\.1\.0\/255\.255\.255\.0'$/);assert.doesNotMatch(g,/UPDATE|DELETE|ALL/);}
 assert.match(p.view,/SQL SECURITY INVOKER VIEW `youtube_board_ts_worker_youtube_source`.`ts_channel_title_history` AS SELECT \* FROM `youtube_board_ts`.`ts_channel_title_history`$/);
});
test('missing connection input or phase fails before any database connection',async()=>{
 let called=false;const plan=await planTitleHistory(env);
 await assert.rejects(executeTitleHistory(plan,{...env,FRONTEND_BOOTSTRAP_URL:''},'prepare',async()=>{called=true;}),/EXPLICIT_UPGRADE/);
 await assert.rejects(executeTitleHistory(plan,env,'all',async()=>{called=true;}),/INVALID_PHASE/);
 await assert.rejects(executeTitleHistory({...plan,sha256:'0'.repeat(64)},env,'prepare',async()=>{called=true;}),/PLAN_CHANGED/);
 assert.equal(called,false);
});
test('prepare refuses an existing table; worker phase refuses to grant before prepare',async()=>{
 const plan=await planTitleHistory(env);
 for(const [phase,rows,error]of [['prepare',[{TABLE_SCHEMA:'youtube_board_ts',TABLE_TYPE:'BASE TABLE'}],/ALREADY_EXISTS/],['worker',[],/PREPARE_REQUIRED/]]){
  const sent=[];let ended=false;
  const db={query:async sql=>{sent.push(sql);return [[{ok:1}]];},execute:async sql=>{sent.push(sql);return [rows];},end:async()=>{ended=true;}};
  await assert.rejects(executeTitleHistory(plan,env,phase,async()=>db),error);
  assert.ok(ended);assert.ok(!sent.some(s=>/^(?:GRANT|CREATE)/.test(s)));
 }
});
