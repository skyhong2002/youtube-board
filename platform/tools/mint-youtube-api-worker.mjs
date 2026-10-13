/** OPS-only isolated fixture worker. Importing this file never connects or starts a server.
 * The supervisor supplies a fresh private datadir and owns the common Mint flock.
 * No auth runtime, OAuth, jobs, production env or external API is installed here. */
import {readFile,stat} from 'node:fs/promises';
import {fstatSync,lstatSync,readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';
import path from 'node:path';

export const APP_SHA='70529cff13b6b7f5b3e0571a229e2b61660f9df4';
export const LOCK_PATH='/run/lock/mint-global-build.lock';
export const DB_NAME='youtube_board_test_rewrite';
export const VERSION='mint-synthetic-v1';
const terms=['合成焦點甲','合成焦點乙','合成焦點丙','合成焦點丁','合成焦點戊','合成焦點己'];
const fail=code=>{throw new Error(code);};
export function validateWorkerConfig(c){
 if(!c||c.appSha!==APP_SHA||! /^[a-f0-9]{40}$/.test(c.opsSha??'')||c.opsSha===APP_SHA)fail('EXACT_SOURCE_REQUIRED');
 for(const key of ['appRoot','datadir','socket','admissionPath'])if(typeof c[key]!=='string'||!path.isAbsolute(c[key])||path.normalize(c[key])!==c[key])fail('PRIVATE_PATH_REQUIRED');
 if(c.bindAddress!=='127.0.0.1'||c.databasePort!==23306||c.apiPort!==23800||c.database!==DB_NAME||c.dataset!=='fixture')fail('ISOLATED_ENDPOINT_REQUIRED');
 if(c.socket!==path.join(path.dirname(c.datadir),'mysql.sock')||path.basename(c.datadir)!=='db')fail('PRIVATE_DATADIR_REQUIRED');
 if(!Number.isInteger(c.lockFd)||c.lockFd<3||!Number.isInteger(c.lockHolderPid)||c.lockHolderPid<1||!Number.isInteger(c.supervisorPid)||c.supervisorPid<1||!Number.isInteger(c.lockInode)||c.lockInode<1)fail('LIVE_LOCK_REQUIRED');
 if(typeof c.lockKernelKey!=='string'||! /^[a-f0-9]+:[a-f0-9]+:\d+$/.test(c.lockKernelKey)||!c.lockKernelKey.endsWith(':'+c.lockInode))fail('LIVE_LOCK_REQUIRED');
 if(typeof c.fixtureClock!=='string'||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(c.fixtureClock)||!Number.isFinite(Date.parse(c.fixtureClock)))fail('FIXTURE_CLOCK_REQUIRED');
 if(![c.owner,c.generation].every(v=>typeof v==='string'&&/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(v))||! /^[a-f0-9]{64}$/.test(c.lockfileSha256??'')||! /^sha256:[a-f0-9]{64}$/.test(c.baseDigest??''))fail('EXACT_BINDING_REQUIRED');
 return c;
}
export function checkWorkerAdmission(c,packet,now=Date.now()){
 const permit=packet?.bootstrap,age=now-Date.parse(permit?.observedAt);
 if(!Number.isFinite(age)||age<0||age>30000||permit.schema!=='yt-fixture-bootstrap-admission-v1'||permit.scope!=='mint-youtube-synthetic-fixture'||permit.state!=='admitted'||permit.operatorExecutionAuthorized!==true)fail('BOOTSTRAP_ADMISSION_LOST');
 for(const key of ['appSha','opsSha','owner','generation','lockfileSha256','baseDigest'])if(permit[key]!==c[key])fail('BOOTSTRAP_BINDING_CHANGED');
 if(c.servingAuthorized===true&&permit.servingAuthorized!==true)fail('SERVING_ADMISSION_REVOKED');
}
export function checkWorkerGuard(c){
 validateWorkerConfig(c);
 const fd=fstatSync(c.lockFd),lock=lstatSync(LOCK_PATH);
 if(process.ppid!==c.supervisorPid||lock.isSymbolicLink()||fd.ino!==c.lockInode||fd.ino!==lock.ino||fd.dev!==lock.dev)fail('GUARD_CUSTODY_LOST');
 const locks=readFileSync('/proc/locks','utf8');
 if(!locks.split('\n').some(line=>{const parts=line.trim().split(/\s+/);return parts[1]==='FLOCK'&&parts[3]==='WRITE'&&Number(parts[4])===c.lockHolderPid&&parts[5]===c.lockKernelKey;}))fail('KERNEL_FLOCK_REQUIRED');
 const s=lstatSync(c.admissionPath);if(!s.isFile()||s.uid!==process.getuid()||(s.mode&0o077)!==0||s.size>1024*1024)fail('PRIVATE_ADMISSION_REQUIRED');
 checkWorkerAdmission(c,JSON.parse(readFileSync(c.admissionPath,'utf8')));
}
/** Only semicolons outside literals delimit these pinned schema files. Comment
 * semicolons never become SQL; executable comments/custom delimiters are rejected. */
export function statements(source){
 const result=[];let value='',quote=null,comment=null;
 for(let i=0;i<source.length;i++){
  const ch=source[i],next=source[i+1];
  if(comment==='line'){if(ch==='\n'){comment=null;value+='\n';}continue;}
  if(comment==='block'){if(ch==='*'&&next==='/'){comment=null;i++;value+=' ';}continue;}
  if(quote){value+=ch;if(ch==='\\'&&next!==undefined){value+=next;i++;}else if(ch===quote){if(next===quote){value+=next;i++;}else quote=null;}continue;}
  if(ch==='-'&&next==='-'&&/\s/.test(source[i+2]??'')){comment='line';i++;continue;}
  if(ch==='#'){comment='line';continue;}
  if(ch==='/'&&next==='*'){if(source[i+2]==='!')fail('EXECUTABLE_SQL_COMMENT_FORBIDDEN');comment='block';i++;continue;}
  if(['\'','"','`'].includes(ch)){quote=ch;value+=ch;continue;}
  if(ch===';'){if(value.trim())result.push(value.trim());value='';}else value+=ch;
 }
 if(quote||comment==='block')fail('UNTERMINATED_SCHEMA_SQL');
 if(value.trim())result.push(value.trim());
 if(result.some(s=>/^DELIMITER\b/i.test(s)))fail('CUSTOM_SQL_DELIMITER_FORBIDDEN');
 return result;
}
export async function verifyDatabaseIdentity(db,c){
 const [rows]=await db.query('SELECT VERSION() version,@@datadir datadir,@@socket socket,@@port port,@@bind_address bindAddress');
 const r=rows[0];
 if(!r||!String(r.version).startsWith('10.11.14-MariaDB')||path.normalize(r.datadir.replace(/\/$/,''))!==c.datadir||r.socket!==c.socket||Number(r.port)!==23306||r.bindAddress!=='127.0.0.1')fail('MARIADB_IDENTITY_MISMATCH');
 return {version:r.version,privateDatadir:true,privateSocket:true,loopbackOnly:true};
}
export async function seedRanking(db,stamp,clock,policy,fingerprint){
 if(policy.MATCH_RULE!=='youtube-quality-v2')fail('MATCH_POLICY_CHANGED');
 const snapshot={termsStoredSeparately:true,coverage:'observed-article-window',matchingRule:policy.MATCH_RULE,synthetic:true,
  upstreamSnapshotConsistent:false,publishedAt:clock.toISOString(),window:{since:new Date(+clock-6*86400000).toISOString(),until:clock.toISOString()}};
 await db.execute('INSERT INTO ts_vocabulary_runs(id,window_since,window_until,status,snapshot) VALUES(?,?,?,\'published\',?)',[VERSION,snapshot.window.since,snapshot.window.until,JSON.stringify(snapshot)]);
 await db.execute('INSERT INTO ts_vocabulary_current(source,run_id) VALUES(\'https://tag.observe.tw\',?)',[VERSION]);
 for(const term of terms){const key=createHash('sha256').update('https://tag.observe.tw\0'+term).digest('hex');await db.execute('INSERT INTO ts_vocabulary_terms(run_id,term_key,term,article_count,payload) VALUES(?,?,?,?,?)',[VERSION,key,term,1,JSON.stringify({key,term,articleCount:1,media:['合成媒體'],synthetic:true})]);}
 const [videos]=await db.query("SELECT pk,videoId,title,description FROM urt_video ORDER BY pk");
 for(const v of videos){
  const description='合成 fixture，非真實新聞詞彙或來源資料。'+terms.join('、');
  await db.execute('UPDATE urt_video SET description=? WHERE pk=?',[description,v.pk]);
  await db.execute('INSERT INTO ts_video_tag_matches(video_id,vocabulary_version,source_pk,source_text_sha256,source_observed_at,matched_at,rule_version,evidence_count) VALUES(?,?,?,?,?,?,?,?)',[v.videoId,VERSION,v.pk,fingerprint(v.title,description),stamp,stamp,policy.MATCH_RULE,terms.length]);
  for(const term of terms){const start=description.indexOf(term),key=createHash('sha256').update('https://tag.observe.tw\0'+term).digest('hex');await db.execute('INSERT INTO ts_video_tag_evidence(video_id,vocabulary_version,term_key,term,source,field_name,start_offset,end_offset,matched_text,snippet,snippet_start,rule_version) VALUES(?,?,?,?,\'https://tag.observe.tw\',\'description\',?,?,?,?,0,?)',[v.videoId,VERSION,key,term,start,start+term.length,term,description,policy.MATCH_RULE]);}
 }
 return {version:VERSION,terms:terms.length,videos:videos.length,rule:policy.MATCH_RULE,synthetic:true};
}
export async function sqlSemantics(db,c,sqlDigest,fingerprint){
 await verifyDatabaseIdentity(db,c);
 const [[schema]]=await db.query('SELECT DATABASE() name');if(schema?.name!==DB_NAME)fail('WRONG_DATABASE');
 const [ids]=await db.execute("SELECT videoId,viewCount FROM urt_video WHERE BINARY videoId=BINARY ?",['FixtureAa01']);
 const [lower]=await db.execute("SELECT videoId,viewCount FROM urt_video WHERE BINARY videoId=BINARY ?",['Fixtureaa01']);
 if(ids.length!==1||lower.length!==1||Number(ids[0].viewCount)!==200||Number(lower[0].viewCount)!==100)fail('BYTE_EXACT_ID_SEMANTICS_FAILED');
 const [[j]]=await db.query("SELECT SUM(n) n FROM JSON_TABLE('[1,2,3]','$[*]' COLUMNS(n INT PATH '$')) AS j");if(Number(j?.n)!==6)fail('JSON_TABLE_SEMANTICS_FAILED');
 for(const [title,description] of [['台灣😀','é與é'],['"quoted"\\slash','new\nline']]){const digest=await sqlDigest(title,description);if(digest!==fingerprint(title,description))fail('SQL_DIGEST_SEMANTICS_FAILED');}
 const [[counts]]=await db.query('SELECT (SELECT COUNT(*) FROM ts_vocabulary_terms) terms,(SELECT COUNT(*) FROM ts_video_tag_matches) matches,(SELECT COUNT(*) FROM ts_video_tag_evidence) evidence');
 if(Number(counts.terms)!==6||Number(counts.matches)!==4||Number(counts.evidence)!==24)fail('RANKING_FIXTURE_INCOMPLETE');
 return {actualMariaDB:true,byteExactIds:true,jsonTable:true,unicodeDigest:true,rankingEvidence:true};
}
export async function fixtureDigest(db,c){
 const rows={};
 for(const [name,query]of Object.entries({channels:'SELECT u_id,title FROM urt_channel ORDER BY u_id',videos:'SELECT videoId,title,description,publishedAt,viewCount FROM urt_video ORDER BY BINARY videoId',terms:'SELECT term_key,term,payload FROM ts_vocabulary_terms ORDER BY term_key',matches:'SELECT video_id,source_pk,source_text_sha256,rule_version FROM ts_video_tag_matches ORDER BY BINARY video_id',evidence:'SELECT video_id,term_key,field_name,start_offset,end_offset,matched_text,rule_version FROM ts_video_tag_evidence ORDER BY BINARY video_id,term_key'})){
  [rows[name]]=await db.query(query);if(rows[name].length>64)fail('FIXTURE_DIGEST_ROW_CAP');
 }
 return createHash('sha256').update(JSON.stringify({appSha:c.appSha,opsSha:c.opsSha,fixtureClock:c.fixtureClock,rows})).digest('hex');
}
/** Injection and loopback HTTP both use this semantic validator; their receipts stay separate. */
export function checkApiPayloads(rows){
 const home=rows.home,keywords=rows.keywords,support=rows.support;
 if(Object.values(rows).some(r=>r?.meta?.dataset!=='fixture'))fail('FIXTURE_LABEL_MISSING');
 for(const window of ['keywords','keywordToday'])if(home?.data?.exploration?.[window]?.status!=='synchronized'||!home.data.exploration[window].rows.length)fail('HOME_RANKING_EMPTY_OR_UNAVAILABLE');
 if(!keywords?.data?.rows?.length||!support?.data?.rows?.length||support.data.rows[0].id!=='FixtureAa01')fail('KEYWORD_SUPPORT_EMPTY');
 if(rows.upper?.data?.video?.id!=='FixtureAa01'||rows.lower?.data?.video?.id!=='Fixtureaa01'||rows.upper.data.video.views!==200||rows.lower.data.video.views!==100)fail('API_ID_SEMANTICS_FAILED');
 if(rows.relations?.data?.status!=='disabled')fail('UPSTREAM_RELATIONS_NOT_DISABLED');
 return {homeTodayNonempty:true,homeWeekNonempty:true,keywordsNonempty:true,keywordVideoSupport:true,byteExactIds:true,relationsDisabled:true};
}
const probePaths={home:'/api/v1/home',keywords:'/api/v1/keywords',support:'/api/v1/keywords/'+encodeURIComponent(terms[0])+'/videos?channelId=990001&column=viewCount&limit=1',upper:'/api/v1/videos/FixtureAa01',lower:'/api/v1/videos/Fixtureaa01',relations:'/api/v1/keywords/'+encodeURIComponent(terms[0])+'/relations'};
export async function probeApi(request){
 const rows={};for(const [key,url]of Object.entries(probePaths)){const result=await request(url);if(result.status!==200)fail('API_PROBE_FAILED');rows[key]=result.body;}
 return checkApiPayloads(rows);
}
export function appDependencies(c){
 const require=createRequire(path.join(c.appRoot,'platform/package.json'));
 return {mysql:require('mysql2/promise'),sql:require('drizzle-orm').sql};
}
export function readinessState(checks,liveSql){
 return checks.sql!==null&&checks.injection!==null&&checks.http!==null&&liveSql?.ok===true;
}
export async function liveSqlProbe(reader,query){
 try{const rows=await reader.rows(query);return {ok:rows.length===1&&Number(rows[0].available)===1,observedAt:new Date().toISOString()};}
 catch{return {ok:false,observedAt:new Date().toISOString()};}
}
export async function runWorker(c){
 validateWorkerConfig(c);checkWorkerGuard(c);
 if(process.version!=='v24.15.0'||process.versions.modules!=='137')fail('NODE_RUNTIME_MISMATCH');
 // Runtime dependencies belong to the unchanged APP tree; OPS needs no install.
 const {mysql,sql}=appDependencies(c);
 const load=relative=>import(pathToFileURL(path.join(c.appRoot,relative)).href);
 const [{buildApp},{createReader},{seedFixture},{seedExtendedFixture},normalize,policy,{sourceTextFingerprint},{videoTextDigest}]=await Promise.all([
  load('platform/api/src/app.ts'),load('platform/api/src/db/client.ts'),load('platform/api/test/fixture.ts'),load('platform/api/test/extended-fixture.ts'),load('platform/api/src/reports/normalize.ts'),load('platform/shared/youtube-match-policy.ts'),load('platform/shared/video-fingerprint.ts'),load('platform/api/src/reports/video-digest.ts')]);
 const databaseUrl='mysql://root@127.0.0.1:23306/'+DB_NAME,clock=new Date(c.fixtureClock);
 let db,reader,app,monitor;
 const checks={sql:null,injection:null,http:null};let fixtureSha256,liveSql={ok:false},monitorBusy=false;
 const ready=()=>readinessState(checks,liveSql);
 try{
  db=await mysql.createConnection({socketPath:c.socket,user:'root',multipleStatements:false,connectTimeout:3000});
  await verifyDatabaseIdentity(db,c);checkWorkerGuard(c);
  const [[existing]]=await db.execute('SELECT COUNT(*) n FROM information_schema.SCHEMATA WHERE SCHEMA_NAME=?',[DB_NAME]);if(Number(existing?.n)!==0)fail('FRESH_DATABASE_REQUIRED');
  await db.query('CREATE DATABASE '+DB_NAME+' CHARACTER SET utf8mb4 COLLATE utf8mb4_bin');await db.query('USE '+DB_NAME);
  for(const file of ['database/schema/legacy-dashboard-baseline.sql','platform/migrations/001-local-adoption.sql','platform/migrations/002-frontend-state.sql'])for(const statement of statements(await readFile(path.join(c.appRoot,file),'utf8'))){checkWorkerGuard(c);await db.query(statement);}
  const identifiers=await readFile(path.join(c.appRoot,'app/Support/YoutubeIdentifierSchema.php'),'utf8');let table;
  for(const line of identifiers.split('\n')){const t=line.match(/^        '(\w+)' => \[/);if(t)table=t[1];const col=line.match(/^            '(\w+)' => \['length'/);if(!col||!table)continue;const [columns]=await db.execute('SELECT DATA_TYPE,CHARACTER_MAXIMUM_LENGTH,IS_NULLABLE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND COLUMN_NAME=?',[table,col[1]]);if(columns.length!==1||columns[0].DATA_TYPE!=='varchar')fail('IDENTIFIER_SCHEMA_CHANGED');checkWorkerGuard(c);await db.query('ALTER TABLE `'+table+'` MODIFY `'+col[1]+'` VARCHAR('+Number(columns[0].CHARACTER_MAXIMUM_LENGTH)+') CHARACTER SET utf8mb4 COLLATE utf8mb4_bin '+(columns[0].IS_NULLABLE==='YES'?'NULL':'NOT NULL'));}
  // Existing helpers only accept this exact isolated loopback DB, never production/preview.
  const tcp=await mysql.createConnection(databaseUrl);try{await verifyDatabaseIdentity(tcp,c);}finally{await tcp.end();}
  checkWorkerGuard(c);await seedFixture(databaseUrl,clock);checkWorkerGuard(c);await seedExtendedFixture(databaseUrl);
  const fixture=await seedRanking(db,normalize.taipeiSql(clock),clock,policy,sourceTextFingerprint);
  reader=createReader(databaseUrl);
  checks.sql=await sqlSemantics(db,c,async(title,description)=>{const r=await reader.rows(sql`SELECT ${videoTextDigest()} AS digest FROM (SELECT ${title} AS title,${description} AS description) v`);return r[0]?.digest;},sourceTextFingerprint);
  fixtureSha256=await fixtureDigest(db,c);
  await db.end();db=undefined;
  app=buildApp({reader,dataset:'fixture',clock:()=>new Date(c.fixtureClock),tagRelations:{env:{TS_TAG_RELATIONS_ENABLED:'false'}}});
  app.addHook('onRequest',async(req,reply)=>{if(['/ready','/runtime/ready'].includes(req.url.split('?')[0])){
   try{checkWorkerGuard(c);liveSql=await liveSqlProbe(reader,sql`SELECT 1 AS available`);}catch{liveSql={ok:false};}
   return reply.code(ready()?200:503).header('Cache-Control','no-store').send({schema:'yt-isolated-readiness-v1',appSha:c.appSha,opsSha:c.opsSha,owner:c.owner,generation:c.generation,lockfileSha256:c.lockfileSha256,baseDigest:c.baseDigest,isolated:true,ready:ready(),sourceWritesDisabled:true,productionApi:false,dataset:'fixture',fixtureClock:c.fixtureClock,fixtureSha256,observedAt:new Date().toISOString(),checks,liveSql});
  }});
  app.get('/runtime/ready',async()=>({ready:false}));
  checks.injection=await probeApi(async url=>{const r=await app.inject(url);return {status:r.statusCode,body:r.json()};});
  checkWorkerGuard(c);await app.listen({host:'127.0.0.1',port:23800});
  checks.http=await probeApi(async url=>{const r=await fetch('http://127.0.0.1:23800'+url,{signal:AbortSignal.timeout(5000),redirect:'error',headers:{DNT:'1','Sec-GPC':'1'}});const text=await r.text();if(Buffer.byteLength(text)>1024*1024)fail('HTTP_PROBE_TOO_LARGE');return {status:r.status,body:JSON.parse(text)};});
  liveSql=await liveSqlProbe(reader,sql`SELECT 1 AS available`);if(!liveSql.ok)fail('LIVE_SQL_READINESS_FAILED');
  checkWorkerGuard(c);process.stdout.write(JSON.stringify({schema:'yt-fixture-startup-v1',appSha:c.appSha,opsSha:c.opsSha,owner:c.owner,generation:c.generation,ready:true,fixture,fixtureSha256,checks,actualRuntimeReceipt:true})+'\n');
  monitor=setInterval(async()=>{
   if(monitorBusy)return;monitorBusy=true;
   try{checkWorkerGuard(c);liveSql=await liveSqlProbe(reader,sql`SELECT 1 AS available`);if(!liveSql.ok)fail('LIVE_SQL_READINESS_FAILED');}
   catch{checks.http=null;liveSql={ok:false};process.exitCode=1;clearInterval(monitor);void app.close();}
   finally{monitorBusy=false;}
  },1000);
  for(const signal of ['SIGTERM','SIGINT'])process.once(signal,()=>{checks.http=null;clearInterval(monitor);void app.close();});
 }catch(error){checks.http=null;if(monitor)clearInterval(monitor);if(app)await app.close();else if(reader)await reader.close();if(db)await db.end();throw error;}
}
async function main(){
 if(process.argv.length!==3)fail('PRIVATE_WORKER_CONFIG_REQUIRED');
 const p=process.argv[2],s=await stat(p);if(!s.isFile()||s.uid!==process.getuid()||(s.mode&0o077)!==0||s.size>65536)fail('PRIVATE_WORKER_CONFIG_REQUIRED');
 await runWorker(JSON.parse(await readFile(p,'utf8')));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(()=>{process.stderr.write('{"error":"ISOLATED_FIXTURE_WORKER_FAILED"}\n');process.exitCode=1;});
