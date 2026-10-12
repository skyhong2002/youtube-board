import {describe,it,expect} from 'vitest';
import mysql,{type RowDataPacket} from 'mysql2/promise';
import {randomBytes} from 'node:crypto';
import {assertTestDatabaseUrl} from '../../shared/test-database.js';
import {createAuthStore,utcSql} from '../src/auth/store.js';
import type {OAuthFlow} from '../src/auth/types.js';
const url=process.env.TEST_DATABASE_URL?assertTestDatabaseUrl(process.env.TEST_DATABASE_URL):undefined;
describe.skipIf(!url)('OAuth flow capacity on isolated MariaDB',()=>{
 it('saturation evicts only oldest flows, concurrent starts recover and same-binding renewal keeps the bound',async()=>{
  const db=await mysql.createConnection({uri:url!,dateStrings:true,timezone:'Z'}),store=createAuthStore(url!),prefix=randomBytes(16).toString('hex'),at=new Date('2038-10-12T00:00:00Z');
  const id=(i:number)=>prefix+i.toString(16).padStart(32,'0'),count=async()=>Number((await db.query<RowDataPacket[]>('SELECT COUNT(*) AS n FROM ts_auth_flows'))[0][0]?.n);
  const next=(i:number):OAuthFlow=>({bindingHash:id(i),stateHash:'a'.repeat(64),nonce:'n'.repeat(43),verifier:'v'.repeat(43),next:'/my',createdAt:new Date(+at+10001),expiresAt:new Date(+at+600000)});
  try{
   expect(await store.ready()).toBe(true);
   // Fail before modifying anything if another test/fixture has active flow rows.
   expect(await count(),'Run in the serialized isolated test lane with no other flow fixtures').toBe(0);
   for(let start=0;start<10000;start+=500){const rows=Array.from({length:500},(_,j)=>{const i=start+j;return[id(i),'a'.repeat(64),'n'.repeat(43),'v'.repeat(43),'/my',utcSql(new Date(+at+i)),utcSql(new Date(+at+600000))];});await db.query('INSERT INTO ts_auth_flows(binding_hash,state_hash,nonce,verifier,next_path,created_at,expires_at) VALUES ?',[rows]);}
   expect(await count()).toBe(10000);expect(await Promise.all([store.putFlow(next(10000)),store.putFlow(next(10001))])).toEqual([true,true]);expect(await count()).toBe(10000);
   const [retained]=await db.execute<RowDataPacket[]>('SELECT binding_hash FROM ts_auth_flows WHERE binding_hash IN (?,?,?,?,?)',[id(0),id(1),id(2),id(10000),id(10001)]);expect(retained.map(r=>r.binding_hash).sort()).toEqual([id(2),id(10000),id(10001)].sort());
   expect(await store.putFlow({...next(10000),stateHash:'b'.repeat(64)})).toBe(true);expect(await count()).toBe(10000);
   expect(await store.consumeFlow(id(0),'a'.repeat(64),new Date(+at+10001))).toBeNull();expect(await store.consumeFlow(id(10000),'b'.repeat(64),new Date(+at+10001))).toMatchObject({bindingHash:id(10000),stateHash:'b'.repeat(64)});
   expect((await db.execute<RowDataPacket[]>('SELECT binding_hash FROM ts_auth_flows WHERE binding_hash=?',[id(2)]))[0]).toHaveLength(1);
  }finally{await db.execute('DELETE FROM ts_auth_flows WHERE binding_hash LIKE ?',[prefix+'%']);await store.close();await db.end();}
 },20000);
});
