import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import mysql from 'mysql2/promise';

// Reviewed report sources only: never users, sessions, jobs, credentials or Laravel cache.
export const sourceTables=Object.freeze(['tag_group','tags','urt_ai_date','urt_ai_event','urt_ai_hour','urt_ai_period','urt_channel','urt_channel_ai','urt_comment','urt_comment_author','urt_comment_rev','urt_count','urt_log','urt_mayor_person_ai','urt_show_cloud','urt_show_data','urt_show_group','urt_show_live_date','urt_show_live_tag_date','urt_show_photo','urt_show_tag_cloud','urt_show_tag_cloud_tag','urt_show_tag_date','urt_show_tag_month','urt_show_video_live','urt_show_video_tag','urt_show_video_tag_date','urt_show_video_tag_title','urt_tag','urt_video','urt_video_duration','urt_video_live','urt_video_live_log','urt_video_live_log_tvbs','urt_video_live_tvbs','urt_video_log']);
export const accountWrites=Object.freeze({ts_auth_users:['INSERT','UPDATE'],ts_auth_admin_bindings:['INSERT'],ts_auth_sessions:['INSERT','DELETE'],ts_auth_flows:['INSERT','DELETE'],ts_auth_role_audit:['INSERT'],ts_reader_follows:['INSERT','DELETE'],ts_reader_saves:['INSERT','UPDATE','DELETE'],ts_reader_feed_tokens:['INSERT','UPDATE','DELETE'],ts_reader_api_keys:['INSERT','UPDATE'],ts_keyword_reviews:['INSERT','UPDATE'],ts_keyword_review_audit:['INSERT'],ts_keyword_review_requests:['INSERT'],ts_home_keyword_snapshot:['INSERT','UPDATE','DELETE']});
// The report principal reads approved ranking-display decisions for the ranking overlay and observed channel names.
export const reportStateTables=Object.freeze(['ts_keyword_reviews','ts_channel_title_history']);
export const publicStateTables=Object.freeze(['ts_vocabulary_runs','ts_vocabulary_current','ts_vocabulary_terms','ts_video_tag_matches','ts_video_tag_evidence','ts_tag_cache_lineage','ts_live_tag_cache_lineage','ts_report_cache_lineage','ts_ai_runs','ts_editorial_events','ts_editorial_sources','ts_editorial_links','ts_editorial_audit','ts_editorial_audit_events']);
export const accountSourceViews=Object.freeze(['urt_channel','urt_video']);
// Editorial is provisioned separately; frontend-first does not need these writes.
const identifier=value=>{if(typeof value!=='string'||!/^[a-z][a-z0-9_]{0,63}$/.test(value))throw Error('INVALID_IDENTIFIER');return '`'+value+'`';};
const principal=(user,host)=>{if(!/^[a-z][a-z0-9_]{0,31}$/.test(user)||!/^[a-zA-Z0-9_.:%\/-]{1,255}$/.test(host))throw Error('INVALID_PRINCIPAL');return `'${user}'@'${host}'`;};
export function settings(env){
 if(env.APP_ENV!==undefined&&!['production','local','preview','test'].includes(env.APP_ENV))throw Error('INVALID_APPLICATION_ENVIRONMENT');
 const source=env.FRONTEND_SOURCE_SCHEMA??'youtube_board',target=env.FRONTEND_TARGET_SCHEMA??'youtube_board_ts';identifier(source);identifier(target);
 if(source===target||!/^(?:youtube_board_ts)(?:_[a-z0-9_]+)?$/.test(target)||['mysql','information_schema','performance_schema','sys'].includes(source))throw Error('INVALID_SCHEMA_BOUNDARY');
 const reportUser=env.FRONTEND_REPORT_USER??'youtube_ts_report',stateUser=env.FRONTEND_STATE_USER??'youtube_ts_state',accountHost=env.FRONTEND_ACCOUNT_HOST??'%';
 if((env.APP_ENV??env.NODE_ENV)==='production'){
  const parts=accountHost.split('/'),ipv4=value=>/^\d{1,3}(?:\.\d{1,3}){3}$/.test(value)&&value.split('.').every(n=>Number(n)<=255);
  if(!env.FRONTEND_ACCOUNT_HOST||parts.length>2||!parts.every(ipv4))throw Error('RESTRICTED_PRODUCTION_ACCOUNT_HOST_REQUIRED');
  if(parts[1]){const mask=parts[1].split('.').map(n=>Number(n).toString(2).padStart(8,'0')).join('');if(!/^1+0*$/.test(mask))throw Error('RESTRICTED_PRODUCTION_ACCOUNT_HOST_REQUIRED');}
 }
 principal(reportUser,accountHost);principal(stateUser,accountHost);if(reportUser===stateUser)throw Error('PRINCIPALS_MUST_DIFFER');
 return {source,target,reportUser,stateUser,accountHost};
}
/** Dedicated static TS-only DDL. No arbitrary migrations, DML, view alterations or dynamic SQL. */
export function stateStatements(sql){
 const statements=sql.replace(/^\s*--[^\n]*$/gm,'').split(';').map(s=>s.trim()).filter(Boolean),tables=new Set();
 for(const statement of statements){
  let match=/^CREATE TABLE IF NOT EXISTS (ts_[a-z0-9_]+)\s+(?:\(|LIKE\s+ts_[a-z0-9_]+\s*$)/.exec(statement);
  if(match){tables.add(match[1]);continue;}
  match=/^ALTER TABLE (ts_[a-z0-9_]+) ADD (?:COLUMN|INDEX) IF NOT EXISTS\s/.exec(statement);
  if(match&&tables.has(match[1]))continue;
  match=/^CREATE INDEX IF NOT EXISTS [a-z0-9_]+ ON (ts_[a-z0-9_]+)\(/.exec(statement);
  if(match&&tables.has(match[1]))continue;
  match=/^CREATE TRIGGER IF NOT EXISTS (ts_[a-z0-9_]+) BEFORE (?:UPDATE|DELETE) ON (ts_[a-z0-9_]+) FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='[A-Za-z ]+'$/.exec(statement);
  if(match&&tables.has(match[2]))continue;
  throw Error('UNSAFE_FRONTEND_STATE_DDL');
 }
 // All references must be local TS-owned base tables; no schema-qualified/dynamic payload.
 for(const statement of statements){if(/`|\b(?:DEFINER|PREPARE|EXECUTE|INSERT|UPDATE\s+ts_|DELETE\s+FROM|SELECT|DROP|RENAME|GRANT|REVOKE|USE|DATABASE|VIEW)\b/i.test(statement)||/\bREFERENCES\s+(?!ts_)[a-z]/i.test(statement)||/\b(?:LIKE|REFERENCES)\s+ts_[a-z0-9_]+\s*\./i.test(statement))throw Error('UNSAFE_FRONTEND_STATE_DDL');}
 if(!Object.keys(accountWrites).every(t=>tables.has(t)))throw Error('INCOMPLETE_FRONTEND_STATE_DDL');
 return {statements,tables:[...tables]};
}
export function grantStatements(config,tables){
 const {source,target,reportUser,stateUser,accountHost}=config,read=principal(reportUser,accountHost),write=principal(stateUser,accountHost),out=[];
 for(const table of sourceTables){out.push(`GRANT SELECT ON ${identifier(source)}.${identifier(table)} TO ${read}`);out.push(`GRANT SELECT ON ${identifier(target)}.${identifier(table)} TO ${read}`);}
 for(const table of tables)if(!/^ts_[a-z0-9_]+$/.test(table))throw Error('INVALID_STATE_TABLE');
 for(const table of publicStateTables){if(!tables.includes(table))throw Error('MISSING_PUBLIC_TABLE');out.push(`GRANT SELECT ON ${identifier(target)}.${identifier(table)} TO ${read}`);out.push(`GRANT SELECT ON ${identifier(target)}.${identifier(table)} TO ${write}`);}
 for(const table of reportStateTables){if(!tables.includes(table))throw Error('MISSING_REPORT_STATE_TABLE');out.push(`GRANT SELECT ON ${identifier(target)}.${identifier(table)} TO ${read}`);}
 for(const table of Object.keys(accountWrites))out.push(`GRANT SELECT ON ${identifier(target)}.${identifier(table)} TO ${write}`);
 for(const table of accountSourceViews)out.push(`GRANT SELECT ON ${identifier(target)}.${identifier(table)} TO ${write}`);
 for(const [table,rights]of Object.entries(accountWrites)){if(!tables.includes(table))throw Error('MISSING_ACCOUNT_TABLE');out.push(`GRANT ${rights.join(',')} ON ${identifier(target)}.${identifier(table)} TO ${write}`);}
 return out;
}
export async function planFrontend(env={}){
 const config=settings(env),ddl=stateStatements(await readFile(new URL('../migrations/002-frontend-state.sql',import.meta.url),'utf8'));
 const views=sourceTables.map(table=>`CREATE ALGORITHM=MERGE DEFINER=${principal(config.reportUser,config.accountHost)} SQL SECURITY DEFINER VIEW ${identifier(config.target)}.${identifier(table)} AS SELECT * FROM ${identifier(config.source)}.${identifier(table)}`),grants=grantStatements(config,ddl.tables);
 return {...config,...ddl,views,grants,sha256:createHash('sha256').update(JSON.stringify({config,ddl,views,grants})).digest('hex')};
}
export async function executeFrontend(plan,env,connect=mysql.createConnection){
 if(env.FRONTEND_BACKUP_OFFHOST_VERIFIED!=='true'||env.FRONTEND_RESTORE_VERIFIED!=='true')throw Error('VERIFIED_OFFHOST_BACKUP_AND_RESTORE_REQUIRED');
 if(!env.FRONTEND_BOOTSTRAP_URL||![env.FRONTEND_REPORT_PASSWORD,env.FRONTEND_STATE_PASSWORD].every(p=>typeof p==='string'&&p.length>=32)||env.FRONTEND_REPORT_PASSWORD===env.FRONTEND_STATE_PASSWORD)throw Error('EXPLICIT_BOOTSTRAP_CREDENTIALS_REQUIRED');
 // Recompute trusted SQL; never accept a caller-modified plan or arbitrary statements.
 const trusted=await planFrontend(env);if(plan.sha256!==trusted.sha256)throw Error('PLAN_CHANGED');plan=trusted;
 const db=await connect({uri:env.FRONTEND_BOOTSTRAP_URL,multipleStatements:false,connectTimeout:5000});let mutationStarted=false;
 try{
  const [schemas]=await db.execute('SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME=?',[plan.target]);if(schemas.length)throw Error('TARGET_SCHEMA_MUST_BE_NEW');
  const [users]=await db.execute('SELECT User FROM mysql.user WHERE User IN (?,?)',[plan.reportUser,plan.stateUser]);if(users.length)throw Error('RUNTIME_PRINCIPALS_MUST_BE_NEW');
  const [source]=await db.execute("SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA=? AND TABLE_TYPE='BASE TABLE'",[plan.source]);const available=new Set(source.map(r=>r.TABLE_NAME));if(sourceTables.some(t=>!available.has(t)))throw Error('SOURCE_TABLES_INCOMPLETE');
  mutationStarted=true;await db.query(`CREATE DATABASE ${identifier(plan.target)} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);await db.query(`USE ${identifier(plan.target)}`);
  for(const statement of plan.statements)await db.query(statement);
  await db.query(`CREATE USER ${principal(plan.reportUser,plan.accountHost)} IDENTIFIED BY ?`,[env.FRONTEND_REPORT_PASSWORD]);
  await db.query(`CREATE USER ${principal(plan.stateUser,plan.accountHost)} IDENTIFIED BY ?`,[env.FRONTEND_STATE_PASSWORD]);
  for(const view of plan.views)await db.query(view);
  // Verify actual object boundaries and read-only definer before granting access.
  const [objects]=await db.execute('SELECT TABLE_NAME,TABLE_TYPE FROM information_schema.TABLES WHERE TABLE_SCHEMA=?',[plan.target]);
  if(objects.length!==plan.tables.length+sourceTables.length||objects.some(r=>!(plan.tables.includes(r.TABLE_NAME)||sourceTables.includes(r.TABLE_NAME))||r.TABLE_TYPE!==(plan.tables.includes(r.TABLE_NAME)?'BASE TABLE':'VIEW')))throw Error('OBJECT_BOUNDARY_MISMATCH');
  const [views]=await db.execute('SELECT TABLE_NAME,SECURITY_TYPE,DEFINER FROM information_schema.VIEWS WHERE TABLE_SCHEMA=?',[plan.target]);if(views.length!==sourceTables.length||views.some(r=>r.SECURITY_TYPE!=='DEFINER'||r.DEFINER!==`${plan.reportUser}@${plan.accountHost}`||!sourceTables.includes(r.TABLE_NAME)))throw Error('VIEW_SECURITY_MISMATCH');
  for(const grant of plan.grants)await db.query(grant);
  await verifyGrants(db,plan);
  return {mode:'execute',target:plan.target,source:plan.source,baseTables:plan.tables.length,views:views.length,accounts:2,sourceWrites:0,planSha256:plan.sha256};
 }catch(error){const code=error instanceof Error&&/^[A-Z0-9_]{1,80}$/.test(error.message)?error.message:'BOOTSTRAP_FAILED';const failure=new Error(code);failure.partial=mutationStarted;throw failure;}finally{await db.end();}
}
/** Inspect privilege metadata, never SHOW GRANTS (which may contain authentication hashes). */
export async function verifyGrants(db,plan){
 for(const user of [plan.reportUser,plan.stateUser]){
  const grantee=principal(user,plan.accountHost),expected=[];
  for(const statement of plan.grants){const m=/^GRANT ([A-Z ,]+) ON `([a-z0-9_]+)`\.`([a-z0-9_]+)` TO (.+)$/.exec(statement);if(!m)throw Error('INVALID_GRANT_PLAN');if(m[4]===grantee)for(const right of m[1].split(','))expected.push([m[2],m[3],right].join('.'));}
  const [actual]=await db.execute('SELECT TABLE_SCHEMA,TABLE_NAME,PRIVILEGE_TYPE,IS_GRANTABLE FROM information_schema.TABLE_PRIVILEGES WHERE GRANTEE=?',[grantee]);
  if(actual.some(r=>r.IS_GRANTABLE!=='NO')||JSON.stringify(actual.map(r=>[r.TABLE_SCHEMA,r.TABLE_NAME,r.PRIVILEGE_TYPE].join('.')).sort())!==JSON.stringify(expected.sort()))throw Error('RUNTIME_GRANTS_MISMATCH');
  for(const table of ['SCHEMA_PRIVILEGES','COLUMN_PRIVILEGES','USER_PRIVILEGES']){const [extra]=await db.execute(`SELECT PRIVILEGE_TYPE,IS_GRANTABLE FROM information_schema.${table} WHERE GRANTEE=?`,[grantee]);if(extra.some(r=>table!=='USER_PRIVILEGES'||r.PRIVILEGE_TYPE!=='USAGE'||r.IS_GRANTABLE!=='NO'))throw Error('RUNTIME_GRANTS_MISMATCH');}
  const [roles]=await db.execute(`SELECT Role FROM mysql.roles_mapping WHERE (User=? AND Host=?) OR User='PUBLIC'`,[user,plan.accountHost]);if(roles.length)throw Error('RUNTIME_GRANTS_MISMATCH');
  for(const table of ['procs_priv','proxies_priv']){const[extra]=await db.execute(`SELECT User FROM mysql.${table} WHERE (User=? AND Host=?) OR User='PUBLIC'`,[user,plan.accountHost]);if(extra.length)throw Error('RUNTIME_GRANTS_MISMATCH');}
  for(const table of ['TABLE_PRIVILEGES','SCHEMA_PRIVILEGES','COLUMN_PRIVILEGES','USER_PRIVILEGES']){const[implicit]=await db.execute(`SELECT PRIVILEGE_TYPE,IS_GRANTABLE FROM information_schema.${table} WHERE GRANTEE IN (?,?,?)`,["'PUBLIC'@''","'PUBLIC'@'%'","'PUBLIC'"]);if(implicit.some(r=>r.PRIVILEGE_TYPE!=='USAGE'||r.IS_GRANTABLE!=='NO'))throw Error('RUNTIME_GRANTS_MISMATCH');}
 }
}
async function main(){
 const args=process.argv.slice(2);if(args.some(a=>!['--execute','--dry-run'].includes(a))||new Set(args).size!==args.length||args.length>1)throw Error('INVALID_ARGUMENTS');
 const plan=await planFrontend(process.env);
 if(args.includes('--execute'))console.log(JSON.stringify(await executeFrontend(plan,process.env)));
 else console.log(JSON.stringify({mode:'dry-run',source:plan.source,target:plan.target,baseTables:plan.tables.length,sourceViews:sourceTables,readPrincipal:plan.reportUser,statePrincipal:plan.stateUser,accountHost:plan.accountHost,ownStateWrites:accountWrites,sourceWrites:0,externalCalls:0,planSha256:plan.sha256}));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(error=>{console.error(JSON.stringify({error:error instanceof Error&&/^[A-Z0-9_]{1,80}$/.test(error.message)?error.message:'FRONTEND_BOOTSTRAP_FAILED',partial:!!error.partial}));process.exitCode=1;});
