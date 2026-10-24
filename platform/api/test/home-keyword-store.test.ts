import {readFile} from 'node:fs/promises';
import {afterAll,describe,expect,it} from 'vitest';
import mysql from 'mysql2/promise';
import {sqlKeywordWindowStore} from '../src/reports/home-keyword-store.js';
import {assertTestDatabaseUrl} from '../../shared/test-database.js';
it('is disabled without an explicit own-state database URL',()=>{
 expect(sqlKeywordWindowStore({APP_ENV:'test',DATABASE_URL:'mysql://u:p@127.0.0.1/x'})).toBeUndefined();
});
const url=process.env.TEST_DATABASE_URL?assertTestDatabaseUrl(process.env.TEST_DATABASE_URL):undefined;
describe.skipIf(!url)('own-state keyword snapshot on isolated MariaDB',()=>{
 let db:mysql.Connection|undefined;
 afterAll(async()=>{await db?.query('DROP TABLE IF EXISTS ts_home_keyword_snapshot');await db?.end();});
 it('round-trips one row, overwrites it and clears it; a missing table reads as an error the cache treats as cold',async()=>{
  db=await mysql.createConnection(url!);await db.query('DROP TABLE IF EXISTS ts_home_keyword_snapshot');
  const store=sqlKeywordWindowStore<{rows:string[]}>({APP_ENV:'test',TS_DATABASE_URL:url})!;
  try{
   await expect(store.read()).rejects.toThrow();
   await db.query((await readFile(new URL('../../jobs/migrations/018_home_keyword_snapshot.sql',import.meta.url),'utf8')).replace(/^\s*--[^\n]*$/gm,''));
   expect(await store.read()).toBeNull();
   await store.write({at:1_790_000_000_000,value:{rows:['颱風 🌀']}});await store.write({at:1_790_000_000_500,value:{rows:['地震']}});
   expect(await store.read()).toEqual({at:1_790_000_000_500,value:{rows:['地震']}});
   const [count]=await db.query('SELECT COUNT(*) AS n FROM ts_home_keyword_snapshot') as [Array<{n:number}>,unknown];expect(Number(count[0]!.n)).toBe(1);
   await store.clear();expect(await store.read()).toBeNull();
  }finally{await store.close();}
 });
});
