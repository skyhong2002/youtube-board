import {it,expect} from 'vitest';
import {MySqlDialect} from 'drizzle-orm/mysql-core';
import type {SQL} from 'drizzle-orm';
import type {Reader,Row} from '../src/db/client.js';
import {buildApp} from '../src/app.js';
const id='a1234567-1234-4123-8123-123456789abc';
it.each(['aliases','sources','history'])('public editorial %s capacity rejects before reading large payloads',async mode=>{
 const statements:string[]=[];
 const reader:Reader={rows:async<T extends Row>(q:SQL)=>{
  const sql=new MySqlDialect().sqlToQuery(q).sql;statements.push(sql);let rows:Row[]=[];
  if(sql.includes('SELECT id,title,version,merged_into'))rows=[{id,title:'fixture',version:1,merged_into:null,created_at:'2026-10-12 00:00:00',updated_at:'2026-10-12 00:00:00'}];
  if(sql.includes('SELECT s.id,OCTET_LENGTH')&&mode==='sources')rows=[{id,payload_bytes:17*1024*1024}];
  if(sql.includes('WHERE merged_into=')&&mode==='aliases')rows=Array.from({length:501},()=>({id}));
  if(sql.includes('SELECT a.sequence')&&mode==='history')rows=[{sequence:1,payload_bytes:17*1024*1024}];
  return rows as T[];
 },close:async()=>{}};
 const app=buildApp({reader});try{expect((await app.inject('/api/v1/editorial/events/'+id)).statusCode).toBe(422);expect(statements.some(s=>s.includes('SELECT action,created_at,before_json,after_json'))).toBe(false);if(mode==='sources')expect(statements.some(s=>s.includes('SELECT id,kind,source_id'))).toBe(false);}finally{await app.close();}
});
