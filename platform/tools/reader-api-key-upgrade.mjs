import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import mysql from 'mysql2/promise';
import {planFrontend,verifyGrants} from './frontend-schema.mjs';
const table='ts_reader_api_keys';
/** Add one TS-state table and exact account rights. No source DDL, data changes,
 * user creation/password rotation, view changes or downgrade/drop operations. */
export async function planApiKeys(env){
 const frontend=await planFrontend(env);
 const ddl=(await readFile(new URL('../jobs/migrations/016_reader_api_keys.sql',import.meta.url),'utf8')).replace(/^\s*--[^\n]*$/gm,'').trim().replace(/;$/,'');
 if(!ddl.startsWith('CREATE TABLE IF NOT EXISTS ts_reader_api_keys (')||ddl.includes(';'))throw Error('INVALID_API_KEY_MIGRATION');
 const grant=frontend.grants.filter(s=>s.includes('`'+table+'`'));
 if(grant.length!==2||!grant[0].startsWith('GRANT SELECT ON ')||!grant[1].startsWith('GRANT INSERT,UPDATE ON '))throw Error('INVALID_API_KEY_GRANTS');
 const plan={target:frontend.target,ddl,grants:grant};
 return {...plan,sha256:createHash('sha256').update(JSON.stringify(plan)).digest('hex')};
}
export function validateBackup(evidence,now=Date.now(),target='youtube_board_ts'){
 if(!evidence||evidence.schema!==target||!/^[a-f0-9]{64}$/.test(evidence.sha256??'')||!Number.isSafeInteger(evidence.bytes)||evidence.bytes<=0||evidence.offhostVerified!==true||evidence.restoreVerified!==true||evidence.principalsVerified!==true||evidence.manifestMatched!==true)throw Error('VERIFIED_TS_BACKUP_REQUIRED');
 const at=Date.parse(evidence.verifiedAt);if(!Number.isFinite(at)||at>now||now-at>6*3600000)throw Error('FRESH_TS_BACKUP_REQUIRED');
}
export async function executeApiKeys(plan,env,connect=mysql.createConnection){
 if(!env.FRONTEND_BACKUP_EVIDENCE_PATH||!env.FRONTEND_BOOTSTRAP_URL)throw Error('EXPLICIT_UPGRADE_INPUTS_REQUIRED');
 const expected=await planApiKeys(env);if(expected.sha256!==plan.sha256)throw Error('PLAN_CHANGED');plan=expected;
 validateBackup(JSON.parse(await readFile(env.FRONTEND_BACKUP_EVIDENCE_PATH,'utf8')),Date.now(),plan.target);
 const frontend=await planFrontend(env),before={...frontend,grants:frontend.grants.filter(s=>!s.includes('`'+table+'`'))};
 const db=await connect({uri:env.FRONTEND_BOOTSTRAP_URL,multipleStatements:false,connectTimeout:5000});let mutationStarted=false,locked=false;
 try{
  const [locks]=await db.query("SELECT GET_LOCK('youtube-board-api-key-upgrade',0) AS ok");if(Number(locks[0]?.ok)!==1)throw Error('UPGRADE_LOCK_UNAVAILABLE');locked=true;
  const [rows]=await db.execute('SELECT TABLE_NAME,ENGINE FROM information_schema.TABLES WHERE TABLE_SCHEMA=? AND TABLE_NAME IN (?,?)',[plan.target,'ts_auth_users',table]);
  if(!rows.some(r=>r.TABLE_NAME==='ts_auth_users'&&r.ENGINE==='InnoDB'))throw Error('AUTH_TABLE_REQUIRED');
  if(rows.some(r=>r.TABLE_NAME===table))throw Error('API_KEY_TABLE_ALREADY_EXISTS_VERIFY_MANUALLY');
  await verifyGrants(db,before);
  mutationStarted=true;await db.query('USE `'+plan.target+'`');await db.query(plan.ddl);
  await db.query('SELECT id,user_id,key_hash,prefix,label,created_at,last_used_at,revoked_at FROM ts_reader_api_keys LIMIT 0');
  for(const grant of plan.grants)await db.query(grant);await verifyGrants(db,frontend);
  return {target:plan.target,table,sourceWrites:0,sourceDdl:0,grant:'SELECT,INSERT,UPDATE',planSha256:plan.sha256};
 }catch(error){const e=new Error(error instanceof Error&&/^[A-Z0-9_]{1,80}$/.test(error.message)?error.message:'API_KEY_UPGRADE_FAILED');e.partial=mutationStarted;throw e;}
 finally{if(locked)await db.query("SELECT RELEASE_LOCK('youtube-board-api-key-upgrade')").catch(()=>{});await db.end();}
}
async function main(){const args=process.argv.slice(2);if(args.length>1||args.some(a=>!['--execute','--dry-run'].includes(a)))throw Error('INVALID_ARGUMENTS');const plan=await planApiKeys(process.env);console.log(JSON.stringify(args.includes('--execute')?await executeApiKeys(plan,process.env):{mode:'dry-run',target:plan.target,table,grant:'SELECT,INSERT,UPDATE',sourceWrites:0,sourceDdl:0,planSha256:plan.sha256}));}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(e=>{console.error(JSON.stringify({error:e instanceof Error&&/^[A-Z0-9_]{1,80}$/.test(e.message)?e.message:'API_KEY_UPGRADE_FAILED',partial:!!e.partial}));process.exitCode=1;});
