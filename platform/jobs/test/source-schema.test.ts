import { expect,it } from 'vitest';
import { connectDatabase } from '../src/database.js';
import { assertSourceCountSchema } from '../src/source-schema.js';
import { isolatedTestEnv } from '../../shared/test-database.js';
import type { Connection,RowDataPacket } from 'mysql2/promise';
it.skipIf(process.env.JOBS_DB_TEST!=='1')('source migration preflight accepts reviewed widened schema and rejects attribute drift before any ALTER',async()=>{
  const db=await connectDatabase(isolatedTestEnv());
  try{
    await expect(assertSourceCountSchema(db)).resolves.toBeUndefined();
    const[rows]=await db.query<RowDataPacket[]>('SELECT TABLE_NAME,COLUMN_NAME,DATA_TYPE,COLUMN_TYPE,IS_NULLABLE,COLUMN_DEFAULT,EXTRA,CHARACTER_MAXIMUM_LENGTH FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE()');
    for(const patch of [{COLUMN_DEFAULT:'0'},{COLUMN_TYPE:'bigint unsigned'},{IS_NULLABLE:'NO'},{DATA_TYPE:'decimal'}]){
      const changed=rows.map(r=>r.TABLE_NAME==='urt_video_schedule'&&r.COLUMN_NAME==='viewCount'?{...r,...patch}:r);
      const fixture={query:async()=>[changed,[]]} as unknown as Pick<Connection,'query'>;
      await expect(assertSourceCountSchema(fixture)).rejects.toThrow('urt_video_schedule.viewCount');
    }
  }finally{await db.end();}
});
