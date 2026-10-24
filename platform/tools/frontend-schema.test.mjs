import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {planFrontend,settings,stateStatements,grantStatements,sourceTables,publicStateTables,reportStateTables,executeFrontend,verifyGrants} from './frontend-schema.mjs';
test('frontend dry-run needs no DB credentials and cannot mutate or connect',()=>{
 const out=JSON.parse(execFileSync(process.execPath,['tools/frontend-schema.mjs'],{cwd:new URL('..',import.meta.url),env:{PATH:process.env.PATH},encoding:'utf8'}));assert.equal(out.mode,'dry-run');assert.equal(out.sourceWrites,0);assert.equal(out.externalCalls,0);assert.equal(out.target,'youtube_board_ts');assert.ok(out.baseTables>20);
});
test('new schema and principals must be distinct and identifiers cannot inject SQL',()=>{
 for(const env of [{FRONTEND_SOURCE_SCHEMA:'youtube_board_ts'},{FRONTEND_TARGET_SCHEMA:'youtube_board'},{FRONTEND_TARGET_SCHEMA:'mysql'},{FRONTEND_SOURCE_SCHEMA:'x`; DROP TABLE urt_video'},{FRONTEND_REPORT_USER:'same',FRONTEND_STATE_USER:'same'},{FRONTEND_ACCOUNT_HOST:"%' OR 1=1"}])assert.throws(()=>settings(env));
});
test('dedicated state migration never touches source schemas and grants cannot write sources/views',async()=>{
 const plan=await planFrontend();assert.ok(plan.statements.length>30);assert.ok(plan.views.every(v=>v.includes("DEFINER='youtube_ts_report'@'%' SQL SECURITY DEFINER")&&v.includes('`youtube_board_ts`.')&&v.includes('FROM `youtube_board`.')));
 assert.ok(plan.tables.every(t=>t.startsWith('ts_')));assert.equal(new Set(plan.tables).size,plan.tables.length);
 for(const grant of plan.grants){assert.doesNotMatch(grant,/\b(?:ALL|CREATE|ALTER|DROP|TRIGGER|GRANT OPTION)\b/);if(!grant.startsWith('GRANT SELECT ON')){assert.match(grant,/ON `youtube_board_ts`\.`ts_(?:auth_|reader_|keyword_review)/);assert.doesNotMatch(grant,/'youtube_ts_report'/);}}
 assert.throws(()=>grantStatements(settings({}),[...plan.tables,'urt_video']));assert.ok(!sourceTables.includes('users'));assert.ok(!sourceTables.includes('cache'));
});
test('DDL guard rejects source DML/DDL, views, cross-schema references and dynamic SQL',()=>{
 for(const sql of ['ALTER TABLE urt_video ADD COLUMN unsafe INT;','CREATE TABLE IF NOT EXISTS ts_test LIKE youtube_board.urt_video;','CREATE VIEW ts_fake AS SELECT * FROM urt_video;','DROP TABLE ts_auth_users;','CREATE TABLE IF NOT EXISTS ts_test AS SELECT * FROM urt_video;','PREPARE stmt FROM @sql;','INSERT INTO ts_auth_users VALUES (1);'])assert.throws(()=>stateStatements(sql));
});
test('backup attestations and runtime secrets are mandatory before opening bootstrap connection',async()=>{
 const plan=await planFrontend(),connect=()=>{throw Error('unexpected connection');};
 await assert.rejects(executeFrontend(plan,{},connect),/VERIFIED_OFFHOST_BACKUP_AND_RESTORE_REQUIRED/);
 await assert.rejects(executeFrontend(plan,{FRONTEND_BACKUP_OFFHOST_VERIFIED:'true',FRONTEND_RESTORE_VERIFIED:'true'},connect),/EXPLICIT_BOOTSTRAP_CREDENTIALS_REQUIRED/);
});
test('existing target or runtime account refuses every mutation',async()=>{
 for(const existing of ['schema','user']){const writes=[];let reads=0,closed=false;
  const env={FRONTEND_BOOTSTRAP_URL:'mysql://operator:fixture@localhost',FRONTEND_BACKUP_OFFHOST_VERIFIED:'true',FRONTEND_RESTORE_VERIFIED:'true',FRONTEND_REPORT_PASSWORD:'r'.repeat(32),FRONTEND_STATE_PASSWORD:'s'.repeat(32)};
  const db={execute:async()=>[++reads===(existing==='schema'?1:2)?[{present:true}]:[]],query:async q=>writes.push(q),end:async()=>{closed=true;}};
  await assert.rejects(executeFrontend(await planFrontend(env),env,async()=>db),new RegExp(existing==='schema'?'TARGET_SCHEMA_MUST_BE_NEW':'RUNTIME_PRINCIPALS_MUST_BE_NEW'));assert.deepEqual(writes,[]);assert.equal(closed,true);
 }
});

test('production requires explicit restricted IPv4 account host and a contiguous nonzero mask',()=>{
 for(const host of [undefined,'%', '10.%','0.0.0.0/0.0.0.0','10.0.0.0/255.0.255.0','10.0.0.256','localhost'])assert.throws(()=>settings({APP_ENV:'production',FRONTEND_ACCOUNT_HOST:host}),/RESTRICTED/);
 for(const host of ['10.0.1.12','10.0.1.0/255.255.255.0'])assert.equal(settings({APP_ENV:'production',FRONTEND_ACCOUNT_HOST:host}).accountHost,host);
 assert.throws(()=>settings({NODE_ENV:'production'}),/RESTRICTED/);
});
test('public report grants exclude private identities, saved items and operational queues',async()=>{
 const plan=await planFrontend();
 for(const grant of plan.grants.filter(g=>g.endsWith("TO 'youtube_ts_report'@'%'"))){assert.doesNotMatch(grant,/ts_(?:auth_|reader_|notification_|job_|comment_stage|youtube_item)/);if(grant.includes('`.`ts_'))assert.ok([...publicStateTables,...reportStateTables].some(t=>grant.includes('`'+t+'`')));}
 assert.deepEqual(reportStateTables,['ts_keyword_reviews','ts_channel_title_history']);
 for(const grant of plan.grants.filter(g=>g.endsWith("TO 'youtube_ts_state'@'%'")))assert.ok(grant.includes('ON `youtube_board_ts`.'));
});
test('postcreate privilege inspection fails closed on unexpected grants',async()=>{
 const plan=await planFrontend();const db={execute:async()=>[[{TABLE_SCHEMA:'youtube_board',TABLE_NAME:'users',PRIVILEGE_TYPE:'SELECT',IS_GRANTABLE:'NO'}]]};
 await assert.rejects(verifyGrants(db,plan),/RUNTIME_GRANTS_MISMATCH/);
});

test('explicit invalid application environment cannot suppress NODE_ENV production safeguards',()=>{
 for(const APP_ENV of ['prod','staging',''])assert.throws(()=>settings({APP_ENV,NODE_ENV:'production'}),/INVALID_APPLICATION_ENVIRONMENT/);
 for(const APP_ENV of ['local','test','preview'])assert.equal(settings({APP_ENV,NODE_ENV:'production'}).accountHost,'%');
});

test('global USAGE cannot hide GRANT OPTION or PUBLIC delegation rights',async()=>{
 const plan=await planFrontend();for(const publicRole of [false,true]){
  const db={execute:async(statement,args)=>{
   if(statement.includes('TABLE_PRIVILEGES')&&statement.includes('GRANTEE=?'))return [plan.grants.filter(g=>g.endsWith('TO '+args[0])).flatMap(g=>{const m=/^GRANT ([A-Z,]+) ON `([^`]+)`\.`([^`]+)`/.exec(g);return m[1].split(',').map(PRIVILEGE_TYPE=>({TABLE_SCHEMA:m[2],TABLE_NAME:m[3],PRIVILEGE_TYPE,IS_GRANTABLE:'NO'}));})];
   if(statement.includes('USER_PRIVILEGES')&&(publicRole?statement.includes('GRANTEE IN'):statement.includes('GRANTEE=?')))return [[{PRIVILEGE_TYPE:'USAGE',IS_GRANTABLE:'YES'}]];
   return [[]];
  }};await assert.rejects(verifyGrants(db,plan),/RUNTIME_GRANTS_MISMATCH/);
 }
});
test('keyword review upgrade adds only the reviewed tables, append-only triggers and exact grants',async()=>{
 const {planKeywordReviews}=await import('./keyword-review-upgrade.mjs'),plan=await planKeywordReviews({});
 assert.equal(plan.statements.length,7);assert.ok(plan.statements.slice(3).every(s=>/^CREATE TRIGGER IF NOT EXISTS ts_keyword_review_(?:audit|requests)_no_(?:update|delete) BEFORE/.test(s)));
 assert.deepEqual(plan.grants.filter(g=>g.includes("'youtube_ts_report'")),["GRANT SELECT ON `youtube_board_ts`.`ts_keyword_reviews` TO 'youtube_ts_report'@'%'"]);
 assert.ok(plan.grants.every(g=>!/\b(?:DELETE|DROP|ALTER|TRIGGER)\b/.test(g)));assert.ok(!plan.grants.some(g=>/UPDATE ON `youtube_board_ts`\.`ts_keyword_review_(?:audit|requests)`/.test(g)));
});
