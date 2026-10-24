import mysql from 'mysql2/promise';
import type {KeywordWindowStore} from './home-keyword-cache.js';
import {frontendDatabases} from '../db/frontend.js';
/** One-row copy of the last successful homepage keyword windows (public ranking data only) in
 * ts_home_keyword_snapshot, written by the own-state principal. Production web deliberately has
 * no Redis (it holds the job queues). Enabled only when TS_DATABASE_URL is configured, so tests
 * and local runs never restore a ranking computed elsewhere. Every failure, including a missing
 * table or grant, degrades to "no shared copy": short timeouts and errors left to the cache. */
export function sqlKeywordWindowStore<T>(env:NodeJS.ProcessEnv):(KeywordWindowStore<T>&{close():Promise<void>})|undefined{
 if(!env.TS_DATABASE_URL)return undefined;
 let uri:string|undefined;try{uri=frontendDatabases(env).state;}catch{return undefined;}
 if(!uri)return undefined;
 const pool=mysql.createPool({uri,connectionLimit:1,connectTimeout:2000,queueLimit:4,supportBigNumbers:true,bigNumberStrings:true,multipleStatements:false});
 const query={timeout:5000};
 return {
  async read(){
   const [rows]=await pool.query({...query,sql:'SELECT computed_at_ms,payload FROM ts_home_keyword_snapshot WHERE id=1'}) as [Array<{computed_at_ms:string;payload:string}>,unknown];
   const row=rows[0];if(!row)return null;const at=Number(row.computed_at_ms);
   return Number.isSafeInteger(at)?{at,value:JSON.parse(row.payload) as T}:null;
  },
  async write(entry){await pool.query({...query,sql:'INSERT INTO ts_home_keyword_snapshot (id,computed_at_ms,payload) VALUES (1,?,?) ON DUPLICATE KEY UPDATE computed_at_ms=VALUES(computed_at_ms),payload=VALUES(payload)'},[entry.at,JSON.stringify(entry.value)]);},
  async clear(){await pool.query({...query,sql:'DELETE FROM ts_home_keyword_snapshot WHERE id=1'});},
  close:()=>pool.end(),
 };
}
