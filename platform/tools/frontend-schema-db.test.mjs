import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {readFile,readdir} from 'node:fs/promises';
import mysql from 'mysql2/promise';
import {planFrontend,executeFrontend,sourceTables,verifyGrants} from './frontend-schema.mjs';

test('isolated MariaDB views preserve cross-schema reads while every runtime legacy write is denied',{skip:process.env.FRONTEND_DB_TEST!=='1'},async()=>{
 // Fixed existing Compose endpoint and committed fixture credential only. No runtime URLs.
 const suffix=randomBytes(6).toString('hex'),source='youtube_board_frontend_source_'+suffix,target='youtube_board_ts_test_'+suffix,canonical='youtube_board_frontend_canonical_'+suffix,reportUser='yt_report_'+suffix,stateUser='yt_state_'+suffix;
 const root=await mysql.createConnection({host:'127.0.0.1',port:23306,user:'root',password:'youtube_rewrite_root_local',multipleStatements:false});
 let report,state;
 try{
  const [[version]]=await root.query('SELECT VERSION() version');assert.match(version.version,/^11\.4\..*MariaDB/);
  await root.query('CREATE DATABASE `'+source+'`');
  for(const table of sourceTables)await root.query('CREATE TABLE `'+source+'`.`'+table+'` (id BIGINT PRIMARY KEY,label VARCHAR(60)) ENGINE=InnoDB');
  await root.query('INSERT INTO `'+source+'`.urt_video VALUES (1,?)',['synthetic video']);
  const env={FRONTEND_SOURCE_SCHEMA:source,FRONTEND_TARGET_SCHEMA:target,FRONTEND_REPORT_USER:reportUser,FRONTEND_STATE_USER:stateUser,FRONTEND_ACCOUNT_HOST:'%',FRONTEND_REPORT_PASSWORD:randomBytes(32).toString('hex'),FRONTEND_STATE_PASSWORD:randomBytes(32).toString('hex'),FRONTEND_BOOTSTRAP_URL:'mysql://root:youtube_rewrite_root_local@127.0.0.1:23306',FRONTEND_BACKUP_OFFHOST_VERIFIED:'true',FRONTEND_RESTORE_VERIFIED:'true'};
  const plan=await planFrontend(env),result=await executeFrontend(plan,env);assert.equal(result.sourceWrites,0);assert.equal(result.views,sourceTables.length);
  report=await mysql.createConnection({host:'127.0.0.1',port:23306,user:reportUser,password:env.FRONTEND_REPORT_PASSWORD,database:target});
  state=await mysql.createConnection({host:'127.0.0.1',port:23306,user:stateUser,password:env.FRONTEND_STATE_PASSWORD,database:target});
  await state.query("INSERT INTO ts_auth_users (google_sub,email,created_at,last_login_at) VALUES ('fixture','fixture@example.invalid',UTC_TIMESTAMP(),UTC_TIMESTAMP())");
  await state.query("INSERT INTO ts_reader_follows VALUES (1,'channel','1',UTC_TIMESTAMP())");
  const [joined]=await state.query('SELECT v.label FROM urt_video v JOIN ts_reader_follows f ON f.target=CAST(v.id AS CHAR) WHERE f.user_id=1');assert.equal(joined[0].label,'synthetic video');
  const [[triggers]]=await state.query("SELECT COUNT(*) n FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA=DATABASE() AND EVENT_OBJECT_TABLE='ts_auth_role_audit'");assert.equal(Number(triggers.n),2);
  const denied=async(db,sql)=>{await assert.rejects(db.query(sql),e=>['ER_TABLEACCESS_DENIED_ERROR','ER_DBACCESS_DENIED_ERROR','ER_SPECIFIC_ACCESS_DENIED_ERROR'].includes(e.code));};
  for(const db of [report,state]){await denied(db,'UPDATE urt_video SET label=\'bad\' WHERE id=1');await denied(db,'UPDATE `'+source+'`.urt_video SET label=\'bad\' WHERE id=1');await denied(db,'CREATE TABLE unsafe (id INT)');await denied(db,'DROP TRIGGER ts_auth_role_audit_no_delete');}
  for(const table of ['ts_auth_users','ts_auth_sessions','ts_auth_flows','ts_auth_admin_bindings','ts_auth_role_audit','ts_reader_follows','ts_reader_saves','ts_reader_feed_tokens','ts_notification_runs','ts_job_runs'])await denied(report,'SELECT * FROM '+table);
  await denied(state,'SELECT * FROM `'+source+'`.urt_video');
  await denied(state,'SELECT * FROM urt_comment');
  const [publicRows]=await report.query('SELECT * FROM urt_video');assert.equal(publicRows[0].label,'synthetic video');
  await denied(report,'DELETE FROM ts_reader_follows');await denied(state,'DELETE FROM ts_auth_role_audit');await denied(state,'UPDATE ts_auth_admin_bindings SET email=\'bad\'');
  const [unchanged]=await root.query('SELECT label FROM `'+source+'`.urt_video');assert.equal(unchanged[0].label,'synthetic video');
  const [actualViews]=await root.query('SELECT SECURITY_TYPE,DEFINER FROM information_schema.VIEWS WHERE TABLE_SCHEMA=?',[target]);assert.ok(actualViews.every(v=>v.SECURITY_TYPE==='DEFINER'&&v.DEFINER===reportUser+'@%'));
  await root.query('GRANT SELECT ON `'+target+'`.ts_auth_sessions TO '+root.escape(reportUser)+"@'%'");
  await assert.rejects(verifyGrants(root,plan),/RUNTIME_GRANTS_MISMATCH/);
  await root.query('REVOKE SELECT ON `'+target+'`.ts_auth_sessions FROM '+root.escape(reportUser)+"@'%'");
  await verifyGrants(root,plan);
  await root.query('GRANT PROCESS ON *.* TO '+root.escape(reportUser)+"@'%'");
  await assert.rejects(verifyGrants(root,plan),/RUNTIME_GRANTS_MISMATCH/);
  await root.query('REVOKE PROCESS ON *.* FROM '+root.escape(reportUser)+"@'%'");
  await verifyGrants(root,plan);
  await root.query('GRANT USAGE ON *.* TO '+root.escape(reportUser)+"@'%' WITH GRANT OPTION");
  await assert.rejects(verifyGrants(root,plan),/RUNTIME_GRANTS_MISMATCH/);
  await root.query('REVOKE GRANT OPTION ON *.* FROM '+root.escape(reportUser)+"@'%'");
  await verifyGrants(root,plan);
  await root.query('CREATE FUNCTION `'+target+'`.fixture_function() RETURNS INT DETERMINISTIC RETURN 1');
  await root.query('GRANT EXECUTE ON FUNCTION `'+target+'`.fixture_function TO '+root.escape(reportUser)+"@'%'");
  await assert.rejects(verifyGrants(root,plan),/RUNTIME_GRANTS_MISMATCH/);
  await root.query('REVOKE EXECUTE ON FUNCTION `'+target+'`.fixture_function FROM '+root.escape(reportUser)+"@'%'");
  await root.query('DROP FUNCTION `'+target+'`.fixture_function');
  await root.query('GRANT PROXY ON '+root.escape(stateUser)+"@'%' TO "+root.escape(reportUser)+"@'%'");
  await assert.rejects(verifyGrants(root,plan),/RUNTIME_GRANTS_MISMATCH/);
  await root.query('REVOKE PROXY ON '+root.escape(stateUser)+"@'%' FROM "+root.escape(reportUser)+"@'%'");
  await verifyGrants(root,plan);
  // Compare with a fresh full canonical migration chain in a third disposable
  // schema, not a long-lived fixture DB whose CREATE IF NOT EXISTS can drift.
  if(process.env.FRONTEND_CANONICAL_CHECK==='1'){
   await root.query('CREATE DATABASE `'+canonical+'` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci');await root.query('USE `'+canonical+'`');
   const migrationDir=new URL('../jobs/migrations/',import.meta.url),files=[new URL('../../database/schema/legacy-dashboard-baseline.sql',import.meta.url),new URL('../migrations/001-local-adoption.sql',import.meta.url),...(await readdir(migrationDir)).filter(n=>n.endsWith('.sql')).sort().map(n=>new URL(n,migrationDir))];
   for(const file of files){const sql=await readFile(file,'utf8');for(const statement of sql.replace(/^[ \t]*--.*$/gm,'').split(';').map(s=>s.trim()).filter(Boolean))await root.query(statement);}
   const [canonicalTables]=await root.query("SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA=? AND LEFT(TABLE_NAME,3)='ts_' ORDER BY TABLE_NAME",[canonical]);assert.deepEqual(canonicalTables.map(t=>t.TABLE_NAME).sort(),[...plan.tables].sort());
   for(const table of plan.tables){
    for(const statement of [
     'SELECT COLUMN_NAME,COLUMN_TYPE,IS_NULLABLE,COLUMN_DEFAULT,EXTRA,CHARACTER_SET_NAME,COLLATION_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=? AND TABLE_NAME=? ORDER BY ORDINAL_POSITION',
     'SELECT INDEX_NAME,NON_UNIQUE,SEQ_IN_INDEX,COLUMN_NAME,SUB_PART,INDEX_TYPE FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=? AND TABLE_NAME=? ORDER BY INDEX_NAME,SEQ_IN_INDEX',
     'SELECT TRIGGER_NAME,EVENT_MANIPULATION,ACTION_TIMING,ACTION_STATEMENT FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA=? AND EVENT_OBJECT_TABLE=? ORDER BY TRIGGER_NAME',
    ]){const [expected]=await root.query(statement,[canonical,table]),[actual]=await root.query(statement,[target,table]);assert.deepEqual(actual,expected,'canonical metadata mismatch: '+table);}
   }
  }
 }finally{
  await report?.end();await state?.end();
  for(const user of [reportUser,stateUser])await root.query("DROP USER IF EXISTS '"+user+"'@'%'");
  for(const schema of [target,source,canonical])await root.query('DROP DATABASE IF EXISTS `'+schema+'`');await root.end();
 }
});
