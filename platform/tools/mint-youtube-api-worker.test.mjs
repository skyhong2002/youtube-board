import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,mkdir,rm,readFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {APP_SHA,validateWorkerConfig,runWorker,statements,verifyDatabaseIdentity,sqlSemantics,checkApiPayloads,probeApi,appDependencies,readinessState,liveSqlProbe,checkWorkerAdmission} from './mint-youtube-api-worker.mjs';
const config={appSha:APP_SHA,opsSha:'a'.repeat(40),owner:'yt-owner',generation:'fixture-01',lockfileSha256:'b'.repeat(64),baseDigest:'sha256:'+'c'.repeat(64),appRoot:'/isolated/app',datadir:'/isolated/youtube/db',socket:'/isolated/youtube/mysql.sock',admissionPath:'/isolated/admission.json',bindAddress:'127.0.0.1',databasePort:23306,apiPort:23800,database:'youtube_board_test_rewrite',dataset:'fixture',fixtureClock:'2026-10-13T10:00:00.000Z',lockFd:999999,lockHolderPid:1,supervisorPid:1,lockInode:123,lockKernelKey:'00:01:123'};
const meta={dataset:'fixture'};
function payloads(){return {home:{meta,data:{exploration:{keywords:{status:'synchronized',rows:[{term:'合成焦點甲'}]},keywordToday:{status:'synchronized',rows:[{term:'合成焦點甲'}]}}}},keywords:{meta,data:{rows:[{term:'合成焦點甲'}]}},support:{meta,data:{rows:[{id:'FixtureAa01'}]}},upper:{meta,data:{video:{id:'FixtureAa01',views:200}}},lower:{meta,data:{video:{id:'Fixtureaa01',views:100}}},relations:{meta,data:{status:'disabled'}}};}
test('worker rejects null/external/unbound config before dependency resolution or SQL start',async()=>{
 for(const c of [null,{...config,appSha:null},{...config,opsSha:APP_SHA},{...config,bindAddress:'0.0.0.0'},{...config,database:'youtube_board'},{...config,databasePort:3306},{...config,apiPort:3111},{...config,dataset:'live'},{...config,socket:'/tmp/mysql.sock'},{...config,fixtureClock:null}])await assert.rejects(runWorker(c));
});
test('even valid-shaped config cannot launch without actual inherited kernel lock/supervisor',async()=>{assert.equal(validateWorkerConfig(config),config);await assert.rejects(runWorker(config));});
test('fresh binding and continuing serving permission are mandatory; revocation denies',()=>{
 const now=Date.parse(config.fixtureClock),permit={...config,schema:'yt-fixture-bootstrap-admission-v1',scope:'mint-youtube-synthetic-fixture',state:'admitted',operatorExecutionAuthorized:true,servingAuthorized:true,observedAt:config.fixtureClock};
 checkWorkerAdmission({...config,servingAuthorized:true},{bootstrap:permit},now);
 assert.throws(()=>checkWorkerAdmission({...config,servingAuthorized:true},{bootstrap:{...permit,servingAuthorized:false}},now),/SERVING_ADMISSION_REVOKED/);
 assert.throws(()=>checkWorkerAdmission(config,{bootstrap:{...permit,opsSha:null}},now),/BOOTSTRAP_BINDING_CHANGED/);
 assert.throws(()=>checkWorkerAdmission(config,{bootstrap:permit},now+30001),/BOOTSTRAP_ADMISSION_LOST/);
});
test('dependencies resolve from separate APP root; OPS needs no package installation',async()=>{
 const temp=await mkdtemp(path.join(os.tmpdir(),'yt-app-deps-'));
 try{
  const root=path.join(temp,'app');await mkdir(path.join(root,'platform/node_modules/mysql2'),{recursive:true});await mkdir(path.join(root,'platform/node_modules/drizzle-orm'),{recursive:true});
  await writeFile(path.join(root,'platform/package.json'),'{}');
  await writeFile(path.join(root,'platform/node_modules/mysql2/package.json'),JSON.stringify({name:'mysql2',exports:{'./promise':'./promise.cjs'}}));
  await writeFile(path.join(root,'platform/node_modules/mysql2/promise.cjs'),'module.exports={marker:"app-root",createConnection(){throw Error("NO_CONNECT_IN_MOCK")}}');
  await writeFile(path.join(root,'platform/node_modules/drizzle-orm/package.json'),JSON.stringify({name:'drizzle-orm',main:'index.cjs'}));
  await writeFile(path.join(root,'platform/node_modules/drizzle-orm/index.cjs'),'module.exports={sql:"app-sql"}');
  const deps=appDependencies({...config,appRoot:root});assert.equal(deps.mysql.marker,'app-root');assert.equal(deps.sql,'app-sql');
 }finally{await rm(temp,{recursive:true,force:true});}
});
test('SQL splitter preserves quoted semicolons and strips comment semicolons',()=>{
 assert.deepEqual(statements("-- header; must not execute\nCREATE TABLE x(a TEXT DEFAULT 'a;b'); /* not; SQL */ SELECT 'it''s;ok', `a;b`; # tail;\n"),["CREATE TABLE x(a TEXT DEFAULT 'a;b')","SELECT 'it''s;ok', `a;b`"]);
 for(const bad of ["SELECT 'open",'/* open','/*! SELECT 1 */;','DELIMITER $$'])assert.throws(()=>statements(bad));
});
test('all actual APP bootstrap schema bytes split into complete CREATE/ALTER statements',async()=>{
 for(const relative of ['../../database/schema/legacy-dashboard-baseline.sql','../migrations/001-local-adoption.sql','../migrations/002-frontend-state.sql']){
  const rows=statements(await readFile(new URL(relative,import.meta.url),'utf8'));assert.ok(rows.length>0);assert.ok(rows.every(row=>/^(?:CREATE (?:TABLE|TRIGGER|INDEX)|ALTER TABLE)\b/i.test(row)),rows.filter(row=>!/^(?:CREATE |ALTER TABLE)/i.test(row)).join('\n'));
 }
});
test('database identity refuses foreign version/port/datadir/socket before writes',async()=>{
 let writes=0;
 const row={version:'10.11.14-MariaDB-0ubuntu0.24.04.1',datadir:config.datadir+'/',socket:config.socket,port:23306,bindAddress:'127.0.0.1'};
 const db={query:async()=>[[row]],execute:async()=>{writes++;}};assert.equal((await verifyDatabaseIdentity(db,config)).privateDatadir,true);
 for(const delta of [{version:'10.11.13-MariaDB'},{port:3306},{datadir:'/var/lib/mysql/'},{socket:'/run/mysqld/mysqld.sock'},{bindAddress:'0.0.0.0'}])await assert.rejects(verifyDatabaseIdentity({...db,query:async()=>[[{...row,...delta}]]},config));
 assert.equal(writes,0);
});
test('SQL semantic mock distinguishes actual checks from an API status200',async()=>{
 const db={query:async query=>{
  if(query.startsWith('SELECT VERSION()'))return [[{version:'10.11.14-MariaDB',datadir:config.datadir,socket:config.socket,port:23306,bindAddress:'127.0.0.1'}]];
  if(query==='SELECT DATABASE() name')return [[{name:config.database}]];
  if(query.includes('JSON_TABLE'))return [[{n:6}]];
  return [[{terms:6,matches:4,evidence:24}]];
 },execute:async(_q,[id])=>[[{videoId:id,viewCount:id==='FixtureAa01'?200:100}]]};
 const result=await sqlSemantics(db,config,async(a,b)=>a+b,(a,b)=>a+b);assert.equal(result.rankingEvidence,true);
 await assert.rejects(sqlSemantics(db,config,async()=> 'wrong',(a,b)=>a+b),/SQL_DIGEST_SEMANTICS_FAILED/);
});
test('ranking/API semantic mock requires Today AND Week, vocabulary and supported video identity',()=>{
 assert.equal(checkApiPayloads(payloads()).homeTodayNonempty,true);
 for(const mutate of [r=>r.home.data.exploration.keywordToday.rows=[],r=>r.home.data.exploration.keywords.status='unavailable',r=>r.keywords.data.rows=[],r=>r.support.data.rows=[],r=>r.upper.meta={dataset:'live'},r=>r.lower.data.video.id='FixtureAa01',r=>r.relations.data.status='available']){const rows=payloads();mutate(rows);assert.throws(()=>checkApiPayloads(rows));}
});
test('API probe is bounded to six local paths and explicitly sorts supported video by views',async()=>{
 const rows=Object.values(payloads()),urls=[];let index=0;
 const result=await probeApi(async url=>{urls.push(url);return {status:200,body:rows[index++]};});
 assert.equal(result.keywordVideoSupport,true);assert.equal(urls.length,6);assert.ok(urls.every(url=>url.startsWith('/api/v1/')));assert.match(urls[2],/column=viewCount&limit=1$/);
 await assert.rejects(probeApi(async()=>({status:503,body:{}})),/API_PROBE_FAILED/);
});
test('readiness stays false until separate SQL/injection/HTTP proofs and current actual SQL liveness',async()=>{
 const complete={sql:{actualMariaDB:true},injection:{passed:true},http:{passed:true}};
 for(const field of ['sql','injection','http'])assert.equal(readinessState({...complete,[field]:null},{ok:true}),false);
 assert.equal(readinessState(complete,{ok:false}),false);assert.equal(readinessState(complete,{ok:true}),true);
 const alive=await liveSqlProbe({rows:async()=>[{available:1}]},{});assert.equal(alive.ok,true);
 const dead=await liveSqlProbe({rows:async()=>{throw Error('PRIVATE_DRIVER_MESSAGE');}},{});assert.equal(dead.ok,false);assert.ok(!JSON.stringify(dead).includes('PRIVATE_DRIVER'));
 assert.equal(readinessState(complete,dead),false);
});
