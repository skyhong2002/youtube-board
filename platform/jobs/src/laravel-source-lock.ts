import type { Connection, RowDataPacket, ResultSetHeader } from 'mysql2/promise';
import { randomUUID } from 'node:crypto';
/** Laravel DatabaseLock wire format. File-cache locks cannot be shared between containers. */
export async function withLaravelSourceLock<T>(db:Connection,job:string,env:NodeJS.ProcessEnv,work:(assert:()=>Promise<void>)=>Promise<T>):Promise<T> {
  const mode=env.TS_LARAVEL_LOCK_STORE;
  if(mode!=='database') {
    if(env.APP_ENV==='production' && mode!=='stopped')throw new Error('Confirm stopped Laravel writers or configure the exact shared database lock');
    return work(async()=>{});
  }
  const prefix=env.TS_LARAVEL_CACHE_PREFIX;
  if(prefix===undefined || prefix.length>120 || /[\r\n\0]/.test(prefix))throw new Error('Explicit Laravel cache prefix is required');
  const owner=randomUUID(),key=prefix+'ingestion:command:'+job,ttl=900;
  const now=()=>Math.floor(Date.now()/1000);
  await db.execute('INSERT IGNORE INTO cache_locks (`key`,owner,expiration) VALUES (?,?,?)',[key,owner,now()+ttl]);
  await db.execute('UPDATE cache_locks SET owner=?,expiration=? WHERE `key`=? AND expiration <= ?',[owner,now()+ttl,key,now()]);
  const assert=async()=>{
    const[rows]=await db.query<RowDataPacket[]>('SELECT owner,expiration FROM cache_locks WHERE `key`=?',[key]);
    if(rows[0]?.owner!==owner || Number(rows[0]?.expiration)<=now())throw new Error('Laravel command lock not owned');
    const[result]=await db.execute<ResultSetHeader>('UPDATE cache_locks SET expiration=? WHERE `key`=? AND owner=?',[now()+ttl,key,owner]);
    if(result.affectedRows!==1)throw new Error('Laravel command lock lost');
  };
  try {await assert();return await work(assert);} finally {await db.execute('DELETE FROM cache_locks WHERE `key`=? AND owner=?',[key,owner]).catch(()=>undefined);}
}
