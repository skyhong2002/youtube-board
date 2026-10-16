import {test} from 'node:test';
import assert from 'node:assert/strict';
import {planApiKeys,validateBackup,executeApiKeys} from './reader-api-key-upgrade.mjs';
const at=Date.parse('2026-10-12T14:00:00Z');
const evidence={schema:'youtube_board_ts',sha256:'a'.repeat(64),bytes:12345,offhostVerified:true,restoreVerified:true,principalsVerified:true,manifestMatched:true,verifiedAt:new Date(at-1000).toISOString()};
test('upgrade plan only creates the own-state key table and its three account rights',async()=>{
 const p=await planApiKeys({});assert.equal(p.target,'youtube_board_ts');assert.equal(p.grants.length,2);assert.match(p.ddl,/REFERENCES ts_auth_users/);
 for(const g of p.grants){assert.match(g,/ON `youtube_board_ts`.`ts_reader_api_keys` TO 'youtube_ts_state'/);assert.doesNotMatch(g,/report|DELETE|ALL|GRANT OPTION/);}
 assert.doesNotMatch(p.ddl,/\b(DROP|TRUNCATE|ALTER|UPDATE|DELETE)\b(?! CASCADE)/);
});
test('backup proof requires recent restored offhost state with accounts and exact manifests',()=>{
 assert.doesNotThrow(()=>validateBackup(evidence,at));
 for(const key of ['offhostVerified','restoreVerified','principalsVerified','manifestMatched'])assert.throws(()=>validateBackup({...evidence,[key]:false},at),/VERIFIED/);
 for(const delta of [1,-6*3600000-1])assert.throws(()=>validateBackup({...evidence,verifiedAt:new Date(at+delta).toISOString()},at),/FRESH/);
 assert.throws(()=>validateBackup(evidence,at,'youtube_board_ts_other'),/VERIFIED/);
});
test('missing backup or explicit connection inputs fails before database connection',async()=>{
 let called=false;await assert.rejects(executeApiKeys(await planApiKeys({}),{},async()=>{called=true;}),/EXPLICIT_UPGRADE/);assert.equal(called,false);
});

import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {planFrontend} from './frontend-schema.mjs';
test('trusted target precedes backup validation even if caller tampers target with an unchanged digest',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'yt-api-upgrade-'));try{
  const file=join(dir,'proof.json');await writeFile(file,JSON.stringify({...evidence,schema:'youtube_board_ts_other',verifiedAt:new Date().toISOString()}));
  const env={FRONTEND_BACKUP_EVIDENCE_PATH:file,FRONTEND_BOOTSTRAP_URL:'mock'};let connected=false;
  await assert.rejects(executeApiKeys({...await planApiKeys(env),target:'youtube_board_ts_other'},env,async()=>{connected=true;}),/VERIFIED_TS_BACKUP/);assert.equal(connected,false);
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('execute verifies prior rights then adds only table and account grants; existing table and partial failure fail closed',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'yt-api-upgrade-'));try{
  const file=join(dir,'proof.json');await writeFile(file,JSON.stringify({...evidence,verifiedAt:new Date().toISOString()}));
  const env={FRONTEND_BACKUP_EVIDENCE_PATH:file,FRONTEND_BOOTSTRAP_URL:'mock'},plan=await planApiKeys(env),full=await planFrontend(env);
  for(const mode of ['success','existing','ddl-failure']){
   let granted=false,closed=false;const events=[];
   const db={query:async sql=>{events.push(sql);if(sql.includes('GET_LOCK'))return [[{ok:1}]];if(sql.startsWith('CREATE TABLE')&&mode==='ddl-failure')throw Error('driver text not public');if(sql.startsWith('GRANT INSERT'))granted=true;return [[]];},execute:async(sql,args)=>{
    events.push(sql);
    if(sql.includes('information_schema.TABLES'))return [[{TABLE_NAME:'ts_auth_users',ENGINE:'InnoDB'},...(mode==='existing'?[{TABLE_NAME:'ts_reader_api_keys',ENGINE:'InnoDB'}]:[])]];
    if(sql.includes('TABLE_PRIVILEGES')&&sql.includes('GRANTEE=?'))return [full.grants.filter(g=>(granted||!g.includes('`ts_reader_api_keys`'))&&g.endsWith('TO '+args[0])).flatMap(g=>{const m=/^GRANT ([A-Z,]+) ON `([^`]+)`\.`([^`]+)`/.exec(g);return m[1].split(',').map(PRIVILEGE_TYPE=>({TABLE_SCHEMA:m[2],TABLE_NAME:m[3],PRIVILEGE_TYPE,IS_GRANTABLE:'NO'}));})];
    return [[]];},end:async()=>{closed=true;}};
   if(mode==='success'){const result=await executeApiKeys(plan,env,async()=>db);assert.equal(result.sourceWrites,0);assert.equal(events.filter(s=>s.startsWith('CREATE TABLE')).length,1);assert.equal(events.filter(s=>s.startsWith('GRANT ')).length,2);assert.ok(events.findIndex(s=>s.includes('TABLE_PRIVILEGES'))<events.findIndex(s=>s.startsWith('CREATE TABLE')));}
   else await assert.rejects(executeApiKeys(plan,env,async()=>db),e=>{assert.equal(e.partial,mode==='ddl-failure');return /API_KEY_TABLE_ALREADY_EXISTS|API_KEY_UPGRADE_FAILED/.test(e.message);});
   if(mode==='existing')assert.equal(events.filter(s=>/^(USE|CREATE|GRANT)/.test(s)).length,0);
   if(mode==='ddl-failure')assert.equal(events.filter(s=>s.startsWith('GRANT ')).length,0);
   assert.ok(closed);assert.ok(events.some(s=>s.includes('RELEASE_LOCK')));
  }
 }finally{await rm(dir,{recursive:true,force:true});}
});
