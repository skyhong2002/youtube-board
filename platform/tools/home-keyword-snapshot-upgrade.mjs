import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import mysql from 'mysql2/promise';
import {planFrontend,verifyGrants} from './frontend-schema.mjs';
export const table='ts_home_keyword_snapshot';
const mentions=statement=>statement.includes('`'+table+'`');
/** Add the one-row homepage keyword snapshot table and the own-state principal's SELECT and
 * INSERT/UPDATE/DELETE on it, verified against the full reviewed frontend grant set before and
 * after. No source DDL, data changes, user creation, password rotation or drop operations. */
export async function planHomeSnapshot(env){
 const frontend=await planFrontend(env);
 const ddl=(await readFile(new URL('../jobs/migrations/018_home_keyword_snapshot.sql',import.meta.url),'utf8')).replace(/^\s*--[^\n]*$/gm,'').trim().replace(/;$/,'');
 if(!ddl.startsWith(`CREATE TABLE IF NOT EXISTS ${table} (`)||ddl.includes(';')||/`|\b(?:DEFINER|INSERT|UPDATE|DELETE|SELECT|DROP|GRANT|REFERENCES|VIEW)\b/i.test(ddl))throw Error('INVALID_HOME_SNAPSHOT_MIGRATION');
 const grants=frontend.grants.filter(mentions);
 if(grants.length!==2||!grants[0].startsWith('GRANT SELECT ON ')||!grants[1].startsWith('GRANT INSERT,UPDATE,DELETE ON ')||grants.some(g=>!g.includes(`'${frontend.stateUser}'@`)))throw Error('INVALID_HOME_SNAPSHOT_GRANTS');
 const plan={target:frontend.target,ddl,grants};
 return {...plan,sha256:createHash('sha256').update(JSON.stringify(plan)).digest('hex')};
}
export async function executeHomeSnapshot(plan,env,connect=mysql.createConnection){
 if(!env.FRONTEND_BOOTSTRAP_URL)throw Error('EXPLICIT_UPGRADE_INPUTS_REQUIRED');
 const expected=await planHomeSnapshot(env);if(expected.sha256!==plan.sha256)throw Error('PLAN_CHANGED');plan=expected;
 const frontend=await planFrontend(env),before={...frontend,grants:frontend.grants.filter(s=>!mentions(s))};
 const db=await connect({uri:env.FRONTEND_BOOTSTRAP_URL,multipleStatements:false,connectTimeout:5000});let mutationStarted=false,locked=false;
 try{
  const [locks]=await db.query("SELECT GET_LOCK('youtube-board-home-snapshot-upgrade',0) AS ok");if(Number(locks[0]?.ok)!==1)throw Error('UPGRADE_LOCK_UNAVAILABLE');locked=true;
  const [rows]=await db.execute('SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA=? AND TABLE_NAME=?',[plan.target,table]);
  if(rows.length)throw Error('HOME_SNAPSHOT_TABLE_ALREADY_EXISTS_VERIFY_MANUALLY');
  await verifyGrants(db,before);
  mutationStarted=true;await db.query('USE `'+plan.target+'`');await db.query(plan.ddl);
  await db.query('SELECT id,computed_at_ms,payload FROM ts_home_keyword_snapshot LIMIT 0');
  for(const grant of plan.grants)await db.query(grant);await verifyGrants(db,frontend);
  return {target:plan.target,table,grant:'SELECT,INSERT,UPDATE,DELETE to own-state',sourceWrites:0,sourceDdl:0,planSha256:plan.sha256};
 }catch(error){const e=new Error(error instanceof Error&&/^[A-Z0-9_]{1,80}$/.test(error.message)?error.message:'HOME_SNAPSHOT_UPGRADE_FAILED');e.partial=mutationStarted;throw e;}
 finally{if(locked)await db.query("SELECT RELEASE_LOCK('youtube-board-home-snapshot-upgrade')").catch(()=>{});await db.end();}
}
async function main(){const args=process.argv.slice(2);if(args.length>1||args.some(a=>!['--execute','--dry-run'].includes(a)))throw Error('INVALID_ARGUMENTS');const plan=await planHomeSnapshot(process.env);console.log(JSON.stringify(args.includes('--execute')?await executeHomeSnapshot(plan,process.env):{mode:'dry-run',target:plan.target,table,grants:plan.grants,sourceWrites:0,sourceDdl:0,planSha256:plan.sha256}));}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(e=>{console.error(JSON.stringify({error:e instanceof Error&&/^[A-Z0-9_]{1,80}$/.test(e.message)?e.message:'HOME_SNAPSHOT_UPGRADE_FAILED',partial:!!e.partial}));process.exitCode=1;});
