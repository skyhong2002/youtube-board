import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {planWorker,executeWorker} from './worker-schema.mjs';
import {batchProfile,workerProfile} from '../shared/worker-schema.ts';
import {workerBatchIds,workerBatches} from '../shared/worker-batches.ts';

// Per-batch facades (shared/worker-batches.ts): one facade schema + one principal per handoff batch, holding
// the union of the batch's permission profiles. Preview only; no database connection.
const production={APP_ENV:'production',WORKER_ACCOUNT_HOST:'10.0.1.0/255.255.255.0'};

test('each batch previews one facade and one principal with exactly the batch rights union',()=>{
 const hashes=new Set();
 for(const batch of workerBatchIds){
  const plan=planWorker({...production,WORKER_BATCH:batch}),suffix=batch.replace(/-/g,'_');
  assert.equal(plan.facade,'youtube_board_ts_worker_'+suffix);assert.equal(plan.user,'youtube_ts_w_'+suffix);assert.equal(plan.host,production.WORKER_ACCOUNT_HOST);
  assert.equal(plan.batch,batch);assert.equal(plan.workflow,null);assert.deepEqual(plan.workflows,[...workerBatches[batch]]);
  assert.deepEqual(plan.tables,batchProfile(batch).tables);
  for(const workflow of workerBatches[batch])for(const [table,rights] of Object.entries(workerProfile(workflow).tables))for(const right of rights)assert.ok(plan.tables[table].includes(right),`${batch}: ${workflow} ${table} ${right}`);
  const tables=Object.keys(plan.tables);assert.equal(plan.views.length,tables.length);assert.equal(plan.grants.length,2*tables.length);
  for(const view of plan.views)assert.match(view,new RegExp('^CREATE ALGORITHM=MERGE SQL SECURITY INVOKER VIEW `'+plan.facade+'`\\.`[a-z0-9_]+` AS SELECT \\* FROM `youtube_board(?:_ts)?`\\.`[a-z0-9_]+`$'));
  for(const grant of plan.grants){
   assert.match(grant,new RegExp("^GRANT (?:SELECT|INSERT|UPDATE|DELETE|SHOW VIEW)(?:,(?:SELECT|INSERT|UPDATE|DELETE|SHOW VIEW))* ON `(?:youtube_board|youtube_board_ts|"+plan.facade+")`\\.`[a-z0-9_]+` TO '"+plan.user+"'@'10\\.0\\.1\\.0/255\\.255\\.255\\.0'$"));
   assert.doesNotMatch(grant,/ALL|CREATE|ALTER|DROP|TRIGGER|GRANT OPTION|\*|ts_auth_|ts_reader_/);
  }
  hashes.add(plan.sha256);
 }
 assert.equal(hashes.size,workerBatchIds.length);
 // Cross-batch dependencies: ai.daily runs the tag-video backfill whose schedule belongs to youtube-source.
 const daily=planWorker({...production,WORKER_BATCH:'ai-daily'});
 for(const [table,rights] of Object.entries(workerProfile('youtube.tag_videos.backfill').tables))for(const right of rights)assert.ok(daily.tables[table].includes(right),table);
 assert.ok(daily.dependencies.includes('youtube.tag_videos.backfill'));
});

test('batch preview CLI is offline and reports the batch scope',()=>{
 const output=JSON.parse(execFileSync(process.execPath,['tools/worker-schema.mjs'],{cwd:new URL('..',import.meta.url),env:{PATH:process.env.PATH,...production,WORKER_BATCH:'cache'},encoding:'utf8'}));
 assert.equal(output.mode,'dry-run');assert.equal(output.batch,'cache');assert.deepEqual(output.workflows,[...workerBatches.cache]);
 assert.equal(output.facade,'youtube_board_ts_worker_cache');assert.equal(output.user,'youtube_ts_w_cache');assert.equal(output.sourceDdl,0);assert.equal(output.sourceWrites,0);
 assert.equal(output.sha256,planWorker({...production,WORKER_BATCH:'cache'}).sha256);assert.equal(output.workflow,undefined);
});

test('batch planning fails closed on ambiguous or unknown scope, foreign facades and unrestricted hosts',async()=>{
 assert.throws(()=>planWorker({...production,WORKER_BATCH:'cache',WORKER_WORKFLOW:'reports.counts.build'}),/WORKER_SCOPE_AMBIGUOUS/);
 for(const batch of ['','unknown','__proto__','Cache'])assert.throws(()=>planWorker({...production,WORKER_BATCH:batch}),/UNKNOWN_WORKER_BATCH/);
 assert.throws(()=>planWorker({...production,WORKER_BATCH:'cache',WORKER_TARGET_SCHEMA:'youtube_board_ts_worker_comments'}),/does not belong/);
 for(const host of [undefined,'%'])assert.throws(()=>planWorker({...production,WORKER_BATCH:'cache',WORKER_ACCOUNT_HOST:host}),/RESTRICTED_PRODUCTION_ACCOUNT_HOST_REQUIRED/);
 // An explicit isolated target and principal remain possible (restore-copy rehearsal).
 assert.equal(planWorker({...production,WORKER_BATCH:'cache',WORKER_TARGET_SCHEMA:'youtube_board_ts_worker_cache_drill',WORKER_USER:'yt_w_cache_drill'}).facade,'youtube_board_ts_worker_cache_drill');
 const plan=planWorker({...production,WORKER_BATCH:'telegram'}),never=()=>{throw Error('unexpected connection');};
 await assert.rejects(executeWorker(plan,{...production,WORKER_BATCH:'telegram'},never),/VERIFIED_OFFHOST_BACKUP_AND_RESTORE_REQUIRED/);
 await assert.rejects(executeWorker(plan,{...production,WORKER_BATCH:'comments',WORKER_BACKUP_OFFHOST_VERIFIED:'true',WORKER_RESTORE_VERIFIED:'true',WORKER_BOOTSTRAP_URL:'mysql://unused',WORKER_PASSWORD:'x'.repeat(32)},never),/PLAN_CHANGED/);
});

test('single-workflow facades used by the ts-worker.py timers keep their plans',()=>{
 for(const [workflow,facade,user] of [['tags.videos.match.recent','youtube_board_ts_worker_recent','youtube_ts_recent'],['channels.avatars.refresh','youtube_board_ts_worker_avatars','youtube_ts_avatars']]){
  const plan=planWorker({...production,WORKER_WORKFLOW:workflow,WORKER_TARGET_SCHEMA:facade,WORKER_USER:user});
  assert.equal(plan.workflow,workflow);assert.equal(plan.batch,undefined);assert.deepEqual(plan.tables,workerProfile(workflow).tables);assert.equal(plan.user,user);
 }
});
