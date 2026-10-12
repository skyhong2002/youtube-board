import {beforeAll,afterAll,describe,it,expect} from 'vitest';
import Fastify,{type FastifyInstance} from 'fastify';
import mysql,{type Connection,type RowDataPacket} from 'mysql2/promise';
import {randomBytes,randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {assertTestDatabaseUrl} from '../../shared/test-database.js';
import {registerAuth} from '../src/auth/index.js';
import {createAuthStore} from '../src/auth/store.js';
import {registerEditorialOps} from '../src/ops/editorial.js';
import {authEnv} from './auth-fixture.js';
const url=process.env.TEST_DATABASE_URL?assertTestDatabaseUrl(process.env.TEST_DATABASE_URL):undefined;
const cookie=(headers:Record<string,any>,name:string)=>{const values=headers['set-cookie'];return(Array.isArray(values)?values:[values]).find((v:string)=>v?.startsWith(name+'='))?.split(';')[0] as string;};
describe.skipIf(!url)('editorial individual accounts with real auth and MariaDB transactions',()=>{
 let db:Connection,app:FastifyInstance,adminA:{id:number;headers:Record<string,string>},adminB:{id:number;headers:Record<string,string>},reader:{id:number;headers:Record<string,string>},identityName='adminA',connects=0;
 const prefix='editorial_accounts_'+randomBytes(6).toString('hex'),userIds:number[]=[],candidateIds:string[]=[],clock=()=>new Date('2032-08-08T04:00:00Z'),token='fixture-service-token-'+randomBytes(16).toString('hex');
 const mail=(name:string)=>name+'_'+prefix+'@example.test';
 const env:NodeJS.ProcessEnv={...authEnv,APP_ENV:'test',AUTH_ADMIN_EMAILS:[mail('adminA'),mail('adminB')].join(','),TS_OPS_TOKEN:token,TS_OPS_ACTOR:'fixture-editorial-service',YOUTUBE_PUBLIC_URL:authEnv.AUTH_PUBLIC_ORIGIN,TS_OPS_EXECUTION_ENABLED:'true',TS_OPS_WRITE_ALLOWLIST:'editorial.registry',TS_INGESTION_ENABLED:'true',TS_INGESTION_OWNERS:'editorial.registry'};
 const command=()=>{const id=randomUUID();candidateIds.push(id);return{action:'candidate.submit',id,requestId:randomUUID(),reason:'Synthetic account integration review',channelId:'UC'+randomBytes(11).toString('hex'),proposedName:'Account fixture '+prefix};};
 const post=(mode:'preview'|'execute',headers:Record<string,string>,payload:Record<string,unknown>)=>app.inject({method:'POST',url:'/api/ops/editorial/'+mode,headers,payload});
 const login=async(name:string)=>{identityName=name;const start=await app.inject('/auth/google'),state=new URL(start.headers.location!).searchParams.get('state'),done=await app.inject({url:'/auth/google/callback?state='+state+'&code=fixture',headers:{cookie:cookie(start.headers,'yt_dev_oauth')}});expect(done.statusCode,done.body).toBe(303);const session=cookie(done.headers,'yt_dev_session'),me=await app.inject({url:'/auth/me',headers:{cookie:session}}),value=me.json();expect(value.user).toBeTruthy();userIds.push(value.user.id);return{id:value.user.id,headers:{cookie:session,origin:authEnv.AUTH_PUBLIC_ORIGIN,'sec-fetch-site':'same-origin','x-csrf-token':value.csrfToken}};};
 beforeAll(async()=>{
  db=await mysql.createConnection({uri:url!,dateStrings:true,timezone:'Z'});for(const file of ['010_editorial.sql','011_editorial_audit_events.sql','012_accounts.sql']){const text=await readFile(new URL('../../jobs/migrations/'+file,import.meta.url),'utf8');for(const statement of text.split(';').map(s=>s.trim()).filter(Boolean))await db.query(statement);}
  app=Fastify({logger:false});const auth=await registerAuth(app,{env,store:createAuthStore(url!),clock,provider:{authenticate:async()=>({sub:prefix+'_'+identityName,email:mail(identityName).toLowerCase(),name:identityName,picture:null})}});
  await registerEditorialOps(app,{env,auth,editorialConnect:async()=>{connects++;return mysql.createConnection({uri:url!,dateStrings:true,timezone:'Z'});}});adminA=await login('adminA');adminB=await login('adminB');reader=await login('reader');
 });
 afterAll(async()=>{if(app)await app.close();if(db){for(const id of candidateIds)await db.execute('DELETE FROM ts_editorial_candidates WHERE id=?',[id]);for(const id of userIds){await db.execute('DELETE FROM ts_auth_sessions WHERE user_id=?',[id]);await db.execute('UPDATE ts_auth_users SET disabled_at=? WHERE id=?',['2032-08-08 04:00:00.000',id]);}await db.end();}});
 it('admin A preview cannot be executed by admin B; A succeeds with user:id attribution',async()=>{
  const c=command(),preview=await post('preview',adminA.headers,{command:c});expect(preview.statusCode,preview.body).toBe(200);expect(preview.json()).toMatchObject({actor:'user:'+adminA.id,writes:0,externalCalls:0});
  const other=await post('execute',adminB.headers,{command:c,previewHash:preview.json().previewHash,execute:true});expect(other.statusCode,other.body).toBe(409);expect(other.json()).toEqual({error:{code:'PREVIEW_CHANGED'}});
  const[before]=await db.execute<RowDataPacket[]>('SELECT id FROM ts_editorial_candidates WHERE id=?',[c.id]);expect(before).toEqual([]);
  const executed=await post('execute',adminA.headers,{command:c,previewHash:preview.json().previewHash,execute:true});expect(executed.statusCode,executed.body).toBe(200);expect(executed.json().replayed).toBe(false);
  const[audit]=await db.execute<RowDataPacket[]>('SELECT actor,action FROM ts_editorial_audit WHERE request_id=?',[c.requestId]);expect(audit).toHaveLength(1);expect(audit[0]).toMatchObject({actor:'user:'+adminA.id,action:'candidate.submit'});
  const[stored]=await db.execute<RowDataPacket[]>('SELECT submitted_by FROM ts_editorial_candidates WHERE id=?',[c.id]);expect(stored[0]?.submitted_by).toBe('user:'+adminA.id);
 });
 it('successful request replay remains bound to the same actor and appends no duplicate audit',async()=>{
  const c=command(),preview=await post('preview',adminA.headers,{command:c}),payload={command:c,previewHash:preview.json().previewHash,execute:true};expect((await post('execute',adminA.headers,payload)).statusCode).toBe(200);
  const replay=await post('execute',adminA.headers,payload);expect(replay.statusCode,replay.body).toBe(200);expect(replay.json().replayed).toBe(true);const other=await post('execute',adminB.headers,payload);expect(other.statusCode).toBe(409);expect(other.json()).toEqual({error:{code:'REQUEST_ID_CONFLICT'}});const[audit]=await db.execute<RowDataPacket[]>('SELECT COUNT(*) AS n FROM ts_editorial_audit WHERE request_id=?',[c.requestId]);expect(Number(audit[0]?.n)).toBe(1);
 });
 it('invalid Bearer with a valid admin cookie never falls back to session and never connects',async()=>{const before=connects;const r=await post('preview',{...adminA.headers,authorization:'Bearer wrong'},{command:command()});expect(r.statusCode).toBe(401);expect(r.json()).toEqual({error:{code:'UNAUTHORIZED'}});expect(connects).toBe(before);});
 it('reader role, missing Origin/CSRF and client actor fields fail before connecting',async()=>{
  const before=connects;expect((await post('preview',reader.headers,{command:command()})).statusCode).toBe(403);
  const noOrigin={...adminA.headers};delete noOrigin.origin;const noCsrf={...adminA.headers};delete noCsrf['x-csrf-token'];for(const headers of [noOrigin,noCsrf,{...adminA.headers,origin:'https://elsewhere.test'}]){const r=await post('preview',headers,{command:command()});expect(r.statusCode).toBe(403);expect(r.json()).toEqual({error:{code:'CSRF_REJECTED'}});}
  const forged=await post('preview',adminA.headers,{command:command(),actor:'user:'+adminB.id});expect(forged.statusCode).toBe(400);expect(connects).toBe(before);
 });
 it('every execution gate still applies to session admins, including ownership and production allowlists',async()=>{
  const c=command(),preview=await post('preview',adminA.headers,{command:c}),payload={command:c,previewHash:preview.json().previewHash,execute:true};const variants=[{TS_OPS_EXECUTION_ENABLED:'false'},{TS_OPS_WRITE_ALLOWLIST:''},{TS_OPS_WRITE_ALLOWLIST:'*,editorial.registry'},{TS_INGESTION_ENABLED:'false'},{TS_INGESTION_OWNERS:''},{APP_ENV:'production',TS_INGESTION_PRODUCTION_ENABLED:'false',TS_INGESTION_WRITE_ALLOWLIST:'editorial.registry'},{APP_ENV:'production',TS_INGESTION_PRODUCTION_ENABLED:'true',TS_INGESTION_WRITE_ALLOWLIST:''},{APP_ENV:'production',TS_INGESTION_PRODUCTION_ENABLED:'true',TS_INGESTION_WRITE_ALLOWLIST:'*,editorial.registry'}];
  for(const variation of variants){const saved={...env};try{Object.assign(env,variation);const before=connects,r=await post('execute',adminA.headers,payload);expect(r.statusCode,r.body).toBe(403);expect(r.json()).toEqual({error:{code:'EXECUTION_GATED'}});expect(connects).toBe(before);}finally{for(const key of Object.keys(env))delete env[key];Object.assign(env,saved);}}
  const[r]=await db.execute<RowDataPacket[]>('SELECT id FROM ts_editorial_candidates WHERE id=?',[c.id]);expect(r).toEqual([]);
 });
 it('service tokens get a distinct service: actor and cannot execute a personal preview',async()=>{
  const c=command(),personal=await post('preview',adminA.headers,{command:c}),headers={authorization:'Bearer '+token};const mixed=await post('execute',headers,{command:c,previewHash:personal.json().previewHash,execute:true});expect(mixed.statusCode,mixed.body).toBe(409);expect(mixed.json()).toEqual({error:{code:'PREVIEW_CHANGED'}});
  const preview=await post('preview',headers,{command:c});expect(preview.statusCode,preview.body).toBe(200);expect(preview.json().actor).toBe('service:fixture-editorial-service');const done=await post('execute',headers,{command:c,previewHash:preview.json().previewHash,execute:true});expect(done.statusCode,done.body).toBe(200);const[audit]=await db.execute<RowDataPacket[]>('SELECT actor FROM ts_editorial_audit WHERE request_id=?',[c.requestId]);expect(audit[0]?.actor).toBe('service:fixture-editorial-service');
 });
 it('service actor configuration cannot masquerade as a user actor',async()=>{const previous=env.TS_OPS_ACTOR;env.TS_OPS_ACTOR='user:'+adminA.id;try{const preview=await post('preview',{authorization:'Bearer '+token},{command:command()});expect(preview.statusCode,preview.body).toBe(200);expect(preview.json().actor).toBe('service:user:'+adminA.id);}finally{env.TS_OPS_ACTOR=previous;}});
});
