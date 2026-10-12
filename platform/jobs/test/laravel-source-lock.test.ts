import { it,expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { connectDatabase } from '../src/database.js';
import { withLaravelSourceLock } from '../src/laravel-source-lock.js';
import { isolatedTestEnv } from '../../shared/test-database.js';
import type { Connection } from 'mysql2/promise';
it('production requires an explicit writer-stop record when no interoperable database lock is configured',async()=>{
  await expect(withLaravelSourceLock({} as Connection,'youtube.comments.fetch',{APP_ENV:'production'},async()=>true)).rejects.toThrow('Confirm stopped');
  expect(await withLaravelSourceLock({} as Connection,'youtube.comments.fetch',{APP_ENV:'production',TS_LARAVEL_LOCK_STORE:'stopped'},async()=>true)).toBe(true);
});
it.skipIf(process.env.JOBS_DB_TEST!=='1')('Laravel database-cache lock coordinates connections and detects lost ownership without deleting replacement owner',async()=>{
  const db=await connectDatabase(isolatedTestEnv()),other=await connectDatabase(isolatedTestEnv()),prefix='test-'+randomUUID()+'-',job='youtube.comments.fetch',key=prefix+'ingestion:command:'+job;
  const env={APP_ENV:'test',TS_LARAVEL_LOCK_STORE:'database',TS_LARAVEL_CACHE_PREFIX:prefix};
  try{
    await db.query('CREATE TABLE IF NOT EXISTS cache_locks (`key` VARCHAR(255) PRIMARY KEY, owner VARCHAR(255) NOT NULL, expiration BIGINT NOT NULL) ENGINE=InnoDB');
    await withLaravelSourceLock(db,job,env,async assert=>{
      await assert();await expect(withLaravelSourceLock(other,job,env,async()=>true)).rejects.toThrow('not owned');
      await db.execute('UPDATE cache_locks SET owner=? WHERE `key`=?',['replacement',key]);await expect(assert()).rejects.toThrow('not owned');
    });
    const[rows]=await db.query<any[]>('SELECT owner FROM cache_locks WHERE `key`=?',[key]);expect(rows[0]?.owner).toBe('replacement');
  }finally{await db.execute('DELETE FROM cache_locks WHERE `key`=?',[key]);await db.end();await other.end();}
});
