import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {planWorker,executeWorker} from './worker-schema.mjs';
import {workerProfile,workerSchema} from '../shared/worker-schema.ts';
test('worker plan is offline and limits workflow grants to views and backing objects',()=>{
 const result=JSON.parse(execFileSync(process.execPath,['tools/worker-schema.mjs'],{cwd:new URL('..',import.meta.url),env:{PATH:process.env.PATH,WORKER_WORKFLOW:'youtube.videos.stats'},encoding:'utf8'}));assert.equal(result.sourceDdl,0);assert.equal(result.sourceWrites,0);
 const plan=planWorker({WORKER_WORKFLOW:'youtube.videos.stats'});assert.ok(plan.views.every(v=>v.includes('SQL SECURITY INVOKER')));assert.ok(plan.grants.every(v=>!/(?:ALL|CREATE|ALTER|DROP|TRIGGER|GRANT OPTION|ts_auth_|ts_reader_)/.test(v)));assert.ok(!Object.hasOwn(plan.tables,'urt_comment'));
 assert.ok(workerProfile('ai.daily').tables.ingestion_youtube_quota_daily.includes('UPDATE'));assert.ok(workerProfile('ai.daily').tables.urt_channel_ai.includes('INSERT'));for(const workflow of ['unknown','*','__proto__'])assert.throws(()=>workerProfile(workflow));
});
test('worker boundaries fail closed',()=>{for(const patch of [{DB_DATABASE:'youtube_board'},{TS_SOURCE_SCHEMA:'youtube_board_ts'},{TS_STATE_SCHEMA:'youtube_board'},{TS_WORKER_SCHEMA_MODE:'typo'}])assert.throws(()=>workerSchema({TS_WORKER_SCHEMA_MODE:'facade',DB_DATABASE:'youtube_board_ts_worker',TS_WORKER_WORKFLOW:'youtube.videos.stats',...patch}));});
test('worker provisioning requires verified backup and restore before connection',async()=>{await assert.rejects(executeWorker(planWorker({WORKER_WORKFLOW:'youtube.videos.stats'}),{},()=>{throw Error('unexpected');}),/VERIFIED_OFFHOST_BACKUP/);});
test('every profile references reviewed physical source or own-state tables',async()=>{
 const {readFile}=await import('node:fs/promises'),{stateStatements}=await import('./frontend-schema.mjs'),manifest=JSON.parse(await readFile(new URL('../shared/worker-permissions.json',import.meta.url),'utf8'));
 const own=new Set(stateStatements(await readFile(new URL('../migrations/002-frontend-state.sql',import.meta.url),'utf8')).tables),sources=new Set();
 for(const file of ['../../database/schema/legacy-dashboard-baseline.sql','../migrations/001-local-adoption.sql']){const sql=await readFile(new URL(file,import.meta.url),'utf8');for(const match of sql.matchAll(/CREATE TABLE IF NOT EXISTS `?([a-z0-9_]+)`?\s*\(/g))sources.add(match[1]);}
 // Shared Laravel cache tables are defined in the framework migration, not the legacy dashboard baseline.
 const cacheMigration=await readFile(new URL('../../database/migrations/0001_01_01_000001_create_cache_table.php',import.meta.url),'utf8');for(const match of cacheMigration.matchAll(/Schema::create\('(cache(?:_locks)?)'/g))sources.add(match[1]);
 for(const workflow of Object.keys(manifest.profiles)){const plan=planWorker({WORKER_WORKFLOW:workflow,TS_LARAVEL_LOCK_STORE:'database'});for(const table of Object.keys(plan.tables))assert.ok((table.startsWith('ts_')?own:sources).has(table),workflow+': missing '+table);assert.equal(plan.mapping.cache_locks.schema,plan.source);}
});
test('facade routines, triggers and events are rejected before provisioning',async()=>{
 const {assertFacadeHasNoExecutableObjects}=await import('./worker-schema.mjs');for(const kind of ['ROUTINES','TRIGGERS','EVENTS'])await assert.rejects(assertFacadeHasNoExecutableObjects({execute:async statement=>[[{n:statement.includes('.'+kind)?1:0}]]},'youtube_board_ts_worker'),/EXECUTABLE_OBJECTS/);
});
