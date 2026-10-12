import {it,expect} from 'vitest';
import type {RowDataPacket} from 'mysql2/promise';
import {randomUUID} from 'node:crypto';
import {isolatedTestEnv} from '../../shared/test-database.js';
import {connectDatabase} from '../../jobs/src/database.js';
import {groupStatus} from '../src/group-status.js';
it.skipIf(process.env.INGESTION_DB_TEST!=='1')('local group status preserves memberships, deleted counts and zero writes even with execute',async()=>{
 const env=isolatedTestEnv(),db=await connectDatabase(env);
 const group='Status_'+randomUUID(),stamp='2026-10-11 18:00:00';
 try{
  for(const flag of [null,'0','1','2'])await db.execute('INSERT INTO tag_group(ctime,latest_time,group_name,tag,del_flag) VALUES(?,?,?,?,?)',[stamp,stamp,group,'測試詞',flag]);
  const [before]=await db.query<RowDataPacket[]>('SELECT * FROM tag_group WHERE group_name=? ORDER BY pk',[group]);
  const result=await groupStatus(db,{group,hours:22,limit:1,offset:'auto',execute:true},new Date('2026-10-11T10:00:00Z'));
  expect(result).toMatchObject({mode:'read-only',requested_mode:'execute',generated_at:stamp,group_count:1,tag_rows:4,active_rows:2,deleted_rows:2,latest_time:stamp,writes:[],external_calls:0,external_sync:'unsupported',rows_truncated:false});
  expect(result.rows).toEqual([{group_name:group,tag_rows:4,active_rows:2,deleted_rows:2,latest_time:stamp}]);
  expect((await db.query('SELECT * FROM tag_group WHERE group_name=? ORDER BY pk',[group]))[0]).toEqual(before);
  expect(await groupStatus(db,{group:group+"' OR 1=1 --",hours:22,limit:1,offset:0,execute:false})).toMatchObject({group_count:0,tag_rows:0,active_rows:0,deleted_rows:0,rows:[]});
 }finally{await db.execute('DELETE FROM tag_group WHERE group_name=?',[group]);await db.end();}
});
