import {test} from 'node:test';
import assert from 'node:assert/strict';
import {planHomeSnapshot,executeHomeSnapshot} from './home-keyword-snapshot-upgrade.mjs';
const env={FRONTEND_ACCOUNT_HOST:'10.0.1.0/255.255.255.0',FRONTEND_BOOTSTRAP_URL:'mock'};
test('plan adds one own-state table with SELECT and INSERT/UPDATE/DELETE for the state principal only',async()=>{
 const p=await planHomeSnapshot(env);
 assert.match(p.ddl,/^CREATE TABLE IF NOT EXISTS ts_home_keyword_snapshot \(/);
 assert.deepEqual(p.grants,["GRANT SELECT ON `youtube_board_ts`.`ts_home_keyword_snapshot` TO 'youtube_ts_state'@'10.0.1.0/255.255.255.0'","GRANT INSERT,UPDATE,DELETE ON `youtube_board_ts`.`ts_home_keyword_snapshot` TO 'youtube_ts_state'@'10.0.1.0/255.255.255.0'"]);
});
test('missing connection input or a changed plan fails before any connection; an existing table fails closed',async()=>{
 let called=false;const plan=await planHomeSnapshot(env);
 await assert.rejects(executeHomeSnapshot(plan,{...env,FRONTEND_BOOTSTRAP_URL:''},async()=>{called=true;}),/EXPLICIT_UPGRADE/);
 await assert.rejects(executeHomeSnapshot({...plan,sha256:'0'.repeat(64)},env,async()=>{called=true;}),/PLAN_CHANGED/);
 assert.equal(called,false);
 const sent=[];let ended=false;
 const db={query:async sql=>{sent.push(sql);return [[{ok:1}]];},execute:async sql=>{sent.push(sql);return [[{TABLE_NAME:'ts_home_keyword_snapshot'}]];},end:async()=>{ended=true;}};
 await assert.rejects(executeHomeSnapshot(plan,env,async()=>db),/ALREADY_EXISTS/);assert.ok(ended);assert.ok(!sent.some(s=>/^(?:GRANT|CREATE)/.test(s)));
});
