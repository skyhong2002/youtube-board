import {beforeAll,afterAll,describe,it,expect} from 'vitest';
import mysql,{type Connection,type RowDataPacket} from 'mysql2/promise';
import {readFile} from 'node:fs/promises';
import {randomBytes} from 'node:crypto';
import {assertTestDatabaseUrl} from '../../shared/test-database.js';
import {createAuthStore,utcSql} from '../src/auth/store.js';
import {authConfig,tokenDigest} from '../src/auth/config.js';
import {sessionView,type StoredUser,type OAuthFlow} from '../src/auth/types.js';
import {authEnv} from './auth-fixture.js';
const url=process.env.TEST_DATABASE_URL?assertTestDatabaseUrl(process.env.TEST_DATABASE_URL):undefined;
describe.skipIf(!url)('Google account own MariaDB store',()=>{
 let db:Connection;const store=url?createAuthStore(url):null,at=new Date('2026-10-12T01:02:03.456Z'),config=authConfig(authEnv).config!,prefix='auth_fixture_'+randomBytes(6).toString('hex'),ids:number[]=[],flowHashes:string[]=[];
 const email=(name:string)=>name+'_'+prefix+'@example.test',identity=(name:string,mail=email(name))=>({sub:prefix+'_'+name,email:mail,name:'Auth fixture '+name,picture:null});
 const create=async(name:string,admins:ReadonlySet<string>=new Set())=>{const u=await store!.upsertUser(identity(name),admins,at);ids.push(u.id);return u;};
 beforeAll(async()=>{db=await mysql.createConnection({uri:url!,dateStrings:true,timezone:'Z'});const migration=await readFile(new URL('../../jobs/migrations/012_accounts.sql',import.meta.url),'utf8');for(const statement of migration.split(';').map(s=>s.trim()).filter(Boolean))await db.query(statement);expect(await store!.ready()).toBe(true);});
 afterAll(async()=>{if(db){for(const hash of flowHashes)await db.execute('DELETE FROM ts_auth_flows WHERE binding_hash=?',[hash]);for(const id of ids){await db.execute('DELETE FROM ts_auth_sessions WHERE user_id=?',[id]);await db.execute('UPDATE ts_auth_users SET disabled_at=? WHERE id=?',[utcSql(at),id]);}await db.end();}await store?.close();});
 it('schema preflight requires the append-only audit protection, without applying migrations',async()=>{
  await db.query('DROP TRIGGER ts_auth_role_audit_no_delete');try{expect(await store!.ready()).toBe(false);}finally{await db.query("CREATE TRIGGER ts_auth_role_audit_no_delete BEFORE DELETE ON ts_auth_role_audit FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Auth role audit is append only'");}expect(await store!.ready()).toBe(true);
 });
 it('upserts byte-exact Google sub, updates verified email and stores UTC milliseconds',async()=>{const u=await create('caseA'),again=await store!.upsertUser({...identity('caseA'),email:email('changed')},new Set(),at),other=await create('casea');expect(again.id).toBe(u.id);expect(other.id).not.toBe(u.id);expect(again.email).toBe(email('changed'));expect(again.createdAt).toBe('2026-10-12 01:02:03.456');});
 it('concurrent callbacks atomically consume a flow once and invalid state consumes its binding',async()=>{
  const flow:OAuthFlow={bindingHash:tokenDigest(config,'flow',prefix),stateHash:tokenDigest(config,'state','state'),nonce:'n'.repeat(43),verifier:'v'.repeat(43),next:'/my',createdAt:at,expiresAt:new Date(+at+600000)};flowHashes.push(flow.bindingHash);expect(await store!.putFlow(flow)).toBe(true);const results=await Promise.all([store!.consumeFlow(flow.bindingHash,flow.stateHash,at),store!.consumeFlow(flow.bindingHash,flow.stateHash,at)]);expect(results.filter(Boolean)).toHaveLength(1);expect(results.find(Boolean)?.next).toBe('/my');
  await store!.putFlow(flow);expect(await store!.consumeFlow(flow.bindingHash,'0'.repeat(64),at)).toBeNull();expect(await store!.consumeFlow(flow.bindingHash,flow.stateHash,at)).toBeNull();await store!.putFlow(flow);expect(await store!.consumeFlow(flow.bindingHash,flow.stateHash,new Date(+at+600001))).toBeNull();
 });
 it('same browser binding replaces its prior flow and preserves no previous verifier',async()=>{const bindingHash=tokenDigest(config,'flow',prefix+'replace'),flow={bindingHash,stateHash:tokenDigest(config,'state','a'),nonce:'a'.repeat(43),verifier:'b'.repeat(43),next:'/my',createdAt:at,expiresAt:new Date(+at+600000)};flowHashes.push(bindingHash);await store!.putFlow(flow);await store!.putFlow({...flow,verifier:'c'.repeat(43)});expect((await store!.consumeFlow(bindingHash,flow.stateHash,at))?.verifier).toBe('c'.repeat(43));});
 it('first configured email binds one sub; account recycling neither merges nor inherits administration',async()=>{
  const mail=email('admin'),admins=new Set([mail]),first=await store!.upsertUser(identity('originalAdmin',mail),admins,at),second=await store!.upsertUser(identity('recycledAdmin',mail),admins,at);ids.push(first.id,second.id);expect(first.id).not.toBe(second.id);expect(sessionView(first,admins)?.adminSource).toBe('config');expect(sessionView(second,admins)?.role).toBe('reader');expect(sessionView(first,new Set())?.role).toBe('reader');const[audit]=await db.execute<RowDataPacket[]>('SELECT action FROM ts_auth_role_audit WHERE user_id=?',[second.id]);expect(audit[0]?.action).toBe('config_binding_conflict');
 });
 it('session rotation persists only HMACs, expires absolutely and immediately respects disabled users',async()=>{
  const u=await create('session'),old=tokenDigest(config,'session',prefix+'old'),fresh=tokenDigest(config,'session',prefix+'fresh');expect(await store!.rotateSession(old,u.id,new Date(+at+1000),null,at)).toBe(true);expect(await store!.sessionUser(old,at)).toMatchObject({id:u.id});expect(await store!.rotateSession(fresh,u.id,new Date(+at+1000),old,at)).toBe(true);expect(await store!.sessionUser(old,at)).toBeNull();expect(await store!.sessionUser(fresh,new Date(+at+1000))).toBeNull();await db.execute('UPDATE ts_auth_users SET disabled_at=? WHERE id=?',[utcSql(at),u.id]);expect(await store!.sessionUser(fresh,at)).toBeNull();expect(await store!.rotateSession(old,u.id,new Date(+at+1000),null,at)).toBe(false);
 });
 it('role mutations lock and recheck the actor, append audit, reject self/config targets and apply next request',async()=>{
  const adminMail=email('grantAdmin'),admins=new Set([adminMail]),admin=await store!.upsertUser(identity('grantAdmin',adminMail),admins,at),target=await create('grantee'),third=await create('third');ids.push(admin.id);expect(await store!.setAdmin(admin.id,false,admin.id,admins,at)).toBe('self');expect(await store!.setAdmin(target.id,true,admin.id,admins,at)).toBe('ok');
  expect(await store!.setAdmin(admin.id,false,target.id,admins,at)).toBe('config');expect(await store!.setAdmin(target.id,false,admin.id,admins,at)).toBe('ok');expect(await store!.setAdmin(third.id,true,target.id,admins,at)).toBe('forbidden');
  const[audit]=await db.execute<RowDataPacket[]>('SELECT actor_id,action FROM ts_auth_role_audit WHERE user_id=? ORDER BY id',[target.id]);expect(audit.map(r=>r.action)).toEqual(['admin_grant','admin_revoke']);expect(audit.every(r=>Number(r.actor_id)===admin.id)).toBe(true);
  await expect(db.execute('UPDATE ts_auth_role_audit SET action=? WHERE user_id=?',['admin_grant',target.id])).rejects.toThrow();
 });
 it('concurrent session creation honors the per-account20session bound',async()=>{const u=await create('sessionCap');for(let offset=0;offset<24;offset+=3)await Promise.all(Array.from({length:3},(_,i)=>store!.rotateSession(tokenDigest(config,'session',prefix+'cap'+(offset+i)),u.id,new Date(+at+86400000),null,at)));const[r]=await db.execute<RowDataPacket[]>('SELECT COUNT(*) AS n FROM ts_auth_sessions WHERE user_id=?',[u.id]);expect(Number(r[0]?.n)).toBe(20);});
});
