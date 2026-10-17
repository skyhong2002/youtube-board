import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import mysql from 'mysql2/promise';
import {planFrontend,verifyGrants} from './frontend-schema.mjs';
import {validateBackup} from './reader-api-key-upgrade.mjs';
export const tables=Object.freeze(['ts_keyword_reviews','ts_keyword_review_audit','ts_keyword_review_requests']);
const triggers=Object.freeze(['ts_keyword_review_audit_no_update','ts_keyword_review_audit_no_delete','ts_keyword_review_requests_no_update','ts_keyword_review_requests_no_delete']);
const mentions=statement=>tables.some(t=>statement.includes('`'+t+'`'));
/** Add the three keyword review tables, their append-only triggers and exact grants
 * (state writer: reviews SELECT/INSERT/UPDATE, audit and requests SELECT/INSERT;
 * report reader: reviews SELECT). No source DDL, data changes, user creation,
 * password rotation, view changes or downgrade/drop operations. */
export async function planKeywordReviews(env){
 const frontend=await planFrontend(env);
 const statements=(await readFile(new URL('../jobs/migrations/015_keyword_reviews.sql',import.meta.url),'utf8')).replace(/^\s*--[^\n]*$/gm,'').split(';').map(s=>s.trim()).filter(Boolean);
 const created=statements.map(s=>/^CREATE TABLE IF NOT EXISTS (ts_[a-z_]+) \(/.exec(s)?.[1]),fired=statements.map(s=>/^CREATE TRIGGER IF NOT EXISTS (ts_[a-z_]+) BEFORE (?:UPDATE|DELETE) ON (ts_keyword_review_audit|ts_keyword_review_requests) FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='[A-Za-z ]+'$/.exec(s)?.[1]);
 if(JSON.stringify(created.filter(Boolean))!==JSON.stringify(tables)||JSON.stringify(fired.filter(Boolean))!==JSON.stringify(triggers)||statements.length!==7||statements.some((s,i)=>!created[i]&&!fired[i])||statements.some(s=>/`|\b(?:DEFINER|INSERT|UPDATE\s+ts_|DELETE\s+FROM|SELECT|DROP|GRANT|USE|VIEW)\b/i.test(s)))throw Error('INVALID_KEYWORD_REVIEW_MIGRATION');
 const grants=frontend.grants.filter(mentions);
 if(grants.length!==7)throw Error('INVALID_KEYWORD_REVIEW_GRANTS');
 const plan={target:frontend.target,statements,grants};
 return {...plan,sha256:createHash('sha256').update(JSON.stringify(plan)).digest('hex')};
}
export async function executeKeywordReviews(plan,env,connect=mysql.createConnection){
 if(!env.FRONTEND_BACKUP_EVIDENCE_PATH||!env.FRONTEND_BOOTSTRAP_URL)throw Error('EXPLICIT_UPGRADE_INPUTS_REQUIRED');
 const expected=await planKeywordReviews(env);if(expected.sha256!==plan.sha256)throw Error('PLAN_CHANGED');plan=expected;
 validateBackup(JSON.parse(await readFile(env.FRONTEND_BACKUP_EVIDENCE_PATH,'utf8')),Date.now(),plan.target);
 const frontend=await planFrontend(env),before={...frontend,grants:frontend.grants.filter(s=>!mentions(s))};
 const db=await connect({uri:env.FRONTEND_BOOTSTRAP_URL,multipleStatements:false,connectTimeout:5000});let mutationStarted=false,locked=false;
 try{
  const [locks]=await db.query("SELECT GET_LOCK('youtube-board-keyword-review-upgrade',0) AS ok");if(Number(locks[0]?.ok)!==1)throw Error('UPGRADE_LOCK_UNAVAILABLE');locked=true;
  const [rows]=await db.execute('SELECT TABLE_NAME,ENGINE FROM information_schema.TABLES WHERE TABLE_SCHEMA=? AND TABLE_NAME IN (?,?,?,?)',[plan.target,'ts_vocabulary_runs',...tables]);
  if(!rows.some(r=>r.TABLE_NAME==='ts_vocabulary_runs'&&r.ENGINE==='InnoDB'))throw Error('VOCABULARY_TABLE_REQUIRED');
  if(rows.some(r=>tables.includes(r.TABLE_NAME)))throw Error('KEYWORD_REVIEW_TABLE_ALREADY_EXISTS_VERIFY_MANUALLY');
  await verifyGrants(db,before);
  mutationStarted=true;await db.query('USE `'+plan.target+'`');for(const statement of plan.statements)await db.query(statement);
  const [made]=await db.execute("SELECT COUNT(*) AS n FROM information_schema.TABLES WHERE TABLE_SCHEMA=? AND TABLE_NAME IN (?,?,?) AND ENGINE='InnoDB'",[plan.target,...tables]);
  const [fired]=await db.execute('SELECT TRIGGER_NAME,DEFINER FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA=? AND TRIGGER_NAME IN (?,?,?,?)',[plan.target,...triggers]);
  if(Number(made[0]?.n)!==3||fired.length!==4)throw Error('KEYWORD_REVIEW_SCHEMA_INCOMPLETE');
  for(const grant of plan.grants)await db.query(grant);await verifyGrants(db,frontend);
  return {target:plan.target,tables:[...tables],triggers:fired.length,triggerDefiners:[...new Set(fired.map(r=>r.DEFINER))],sourceWrites:0,sourceDdl:0,planSha256:plan.sha256};
 }catch(error){const e=new Error(error instanceof Error&&/^[A-Z0-9_]{1,80}$/.test(error.message)?error.message:'KEYWORD_REVIEW_UPGRADE_FAILED');e.partial=mutationStarted;throw e;}
 finally{if(locked)await db.query("SELECT RELEASE_LOCK('youtube-board-keyword-review-upgrade')").catch(()=>{});await db.end();}
}
async function main(){const args=process.argv.slice(2);if(args.length>1||args.some(a=>!['--execute','--dry-run'].includes(a)))throw Error('INVALID_ARGUMENTS');const plan=await planKeywordReviews(process.env);console.log(JSON.stringify(args.includes('--execute')?await executeKeywordReviews(plan,process.env):{mode:'dry-run',target:plan.target,tables,triggers:triggers.length,grants:plan.grants,sourceWrites:0,sourceDdl:0,planSha256:plan.sha256}));}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(e=>{console.error(JSON.stringify({error:e instanceof Error&&/^[A-Z0-9_]{1,80}$/.test(e.message)?e.message:'KEYWORD_REVIEW_UPGRADE_FAILED',partial:!!e.partial}));process.exitCode=1;});
