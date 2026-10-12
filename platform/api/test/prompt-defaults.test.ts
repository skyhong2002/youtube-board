import {it,expect} from 'vitest';
import {MySqlDialect} from 'drizzle-orm/mysql-core';
import {buildApp} from '../src/app.js';
import type {Reader} from '../src/db/client.js';
const dialect=new MySqlDialect();
it('preview uses channel generator default120 and keeps explicit bounded overrides',async()=>{
 const captured:unknown[][]=[];const reader={rows:async(q:any)=>{const s=dialect.sqlToQuery(q);if(s.sql.includes('SELECT u_id,LEFT(title,256) AS title,flag_del FROM urt_channel'))return [{title:'合成頻道'}];if(s.sql.includes('COUNT(DISTINCT'))return [{n:0}];if(s.sql.includes('SELECT a.pk'))return [];if(s.sql.includes('COUNT(*)'))return [{n:140}];if(s.sql.includes('SELECT v.pk')){captured.push(s.params);return [];}throw new Error('Unexpected query');},close:async()=>{}} as Reader;
 const app=buildApp({reader});try{
  for(const [suffix,limit]of [['',120],['&limit=1',1],['&limit=500',500],['&limit=300',300]] as const){const r=await app.inject('/api/v1/channels/1/prompt?date=2026-10-10'+suffix);expect(r.statusCode,r.body).toBe(200);expect(r.json().data.sourceLimit).toBe(limit);expect(captured.at(-1)?.at(-1)).toBe(limit);}
  for(const limit of ['501','0','abc','','1&limit=2'])expect((await app.inject('/api/v1/channels/1/prompt?date=2026-10-10&limit='+limit)).statusCode).toBe(400);const daily=await app.inject('/api/v1/ai/days/2026-10-10/prompt');expect(daily.statusCode,daily.body).toBe(200);expect(daily.json().data.sourceLimit).toBe(1000);expect((await app.inject('/api/v1/ai/days/2026-10-10/prompt?limit=1001')).statusCode).toBe(400);
 }finally{await app.close();}
});
