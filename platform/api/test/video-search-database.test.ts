import {beforeAll,afterAll,describe,it,expect} from 'vitest';
import mysql,{type Connection,type RowDataPacket} from 'mysql2/promise';
import {randomInt,randomUUID} from 'node:crypto';
import {MySqlDialect} from 'drizzle-orm/mysql-core';
import {buildApp} from '../src/app.js';
import {assertTestDatabaseUrl} from '../../shared/test-database.js';
const url=process.env.TEST_DATABASE_URL?assertTestDatabaseUrl(process.env.TEST_DATABASE_URL):undefined;
describe.skipIf(!url)('single-scan video text search on isolated MariaDB',()=>{
 const uid=randomInt(510000000,520000000),prefix=randomUUID().replaceAll('-','').slice(0,8),term='search-'+randomUUID(),app=buildApp({databaseUrl:url,dataset:'fixture',clock:()=>new Date('2034-07-12T04:00:00Z')});let db:Connection;
 beforeAll(async()=>{db=await mysql.createConnection({uri:url!,dateStrings:true});await db.execute("INSERT INTO urt_count(u_id,ctime,tags) VALUES(?,'2034-07-12','[1][999]')",[uid]);
  const values=Array.from({length:1010},(_,i)=>[uid,prefix+(i===0?'Aa01':i===1?'aa01':String(i).padStart(4,'0')),i===0?'description-only':term, i===0?term+' %_=':'plain description',i%2?'2034-07-12 09:00:00':'2034-07-11 09:00:00',i%3===0?null:i%31,i%7,i%5]);
  await db.query("INSERT INTO urt_video(u_id,videoId,title,description,publishedAt,viewCount,likeCount,commentCount,ctime,id,channelId,channelTitle,thumbnails,playlistId,position) VALUES "+values.map(()=>"(?,?,?,?,?,?,?,?,'2034-07-12','fixture','fixture','fixture','','fixture',0)").join(','),values.flat());
 });
 afterAll(async()=>{await app.close();if(db){await db.execute('DELETE FROM urt_video WHERE u_id=?',[uid]);await db.execute('DELETE FROM urt_count WHERE u_id=?',[uid]);await db.end();}});
 const get=async(query:Record<string,string>)=>{const response=await app.inject('/api/v1/videos?'+new URLSearchParams({q:term,...query}));expect(response.statusCode,response.body).toBe(200);return response.json().data;};
 it('preserves 1000-row pages, all four sort metrics, null ordering and primary-key tie breaks',async()=>{
  for(const column of ['publishedAt','viewCount','likeCount','commentCount']){const data=await get({column,limit:'1000'}),[expected]=await db.query<RowDataPacket[]>('SELECT videoId FROM urt_video WHERE u_id=? ORDER BY `'+column+'` DESC,pk DESC LIMIT 1000',[uid]);expect(data.total).toBe(1010);expect(data.rows.map((row:any)=>row.id)).toEqual(expected.map(row=>row.videoId));}
 });
 it('preserves default 50, title or description membership, binary IDs, offsets beyond total and zero matches',async()=>{
  expect((await get({})).rows).toHaveLength(50);const data=await get({limit:'1000',offset:'10'}),[expected]=await db.query<RowDataPacket[]>('SELECT videoId FROM urt_video WHERE u_id=? ORDER BY publishedAt DESC,pk DESC LIMIT 1000 OFFSET 10',[uid]);expect(data.rows.map((row:any)=>row.id)).toEqual(expected.map(row=>row.videoId));expect(await get({offset:'100000'})).toMatchObject({rows:[],total:1010});expect(await get({q:term+'absent'})).toMatchObject({rows:[],total:0});
  const literal=await get({q:'%_=',channelIds:String(uid)});expect(literal.total).toBe(1);expect(literal.rows[0].id).toBe(prefix+'Aa01');
  const all=await get({limit:'1000',offset:'10',column:'likeCount'});expect(all.rows.map((row:any)=>row.id)).toEqual((await db.query<RowDataPacket[]>('SELECT videoId FROM urt_video WHERE u_id=? ORDER BY likeCount DESC,pk DESC LIMIT 1000 OFFSET 10',[uid]))[0].map(row=>row.videoId));
 });
 it('retains channel/date/hours/min and intersecting taxonomy filters before exact count/pagination',async()=>{
  const query={channelIds:String(uid),tagid:'1',or:'999,888',not:'77',from:'2034-07-12',to:'2034-07-12',hours:'24',min:'12',column:'viewCount',limit:'50',offset:'3'},data=await get(query),[expected]=await db.query<RowDataPacket[]>("SELECT videoId FROM urt_video WHERE u_id=? AND publishedAt>='2034-07-12 00:00:00' AND publishedAt<='2034-07-12 23:59:59' AND publishedAt>='2034-07-11 12:00:00' AND viewCount>=12 ORDER BY viewCount DESC,pk DESC",[uid]);expect(data.total).toBe(expected.length);expect(data.rows.map((row:any)=>row.id)).toEqual(expected.slice(3,53).map(row=>row.videoId));expect(await get({channelId:String(uid),not:'1'})).toMatchObject({rows:[],total:0});
 });
 it('rechecks text membership on selected primary keys when the writer changes text between statements',async()=>{
  const connection=await mysql.createConnection({uri:url!,dateStrings:true}),dialect=new MySqlDialect();let changed=false;
  const racing=buildApp({reader:{rows:async query=>{const q=dialect.sqlToQuery(query),rows=(await connection.execute('SET STATEMENT max_statement_time=5 FOR '+q.sql,q.params as any))[0] as any[];if(q.sql.includes('GROUP_CONCAT')&&!changed){changed=true;const key=String(rows[0].pageKeys).split(',')[0]!.slice(0,-1);await connection.execute("UPDATE urt_video SET title='changed out of search',description='changed' WHERE pk=?",[key]);}return rows as any;},close:async()=>{await connection.end();}}});
  try{const response=await racing.inject('/api/v1/videos?'+new URLSearchParams({q:term,limit:'1'}));expect(response.statusCode,response.body).toBe(200);expect(response.json().data).toMatchObject({rows:[],total:1010});}finally{await racing.close();await db.execute('UPDATE urt_video SET title=? WHERE u_id=? AND title=?',[term,uid,'changed out of search']);}
 });
 it('fails closed on real GROUP_CONCAT truncation rather than returning a wrong or short page',async()=>{
  const connection=await mysql.createConnection({uri:url!,dateStrings:true}),dialect=new MySqlDialect();await connection.query('SET SESSION group_concat_max_len=20');let statements=0;
  const capped=buildApp({reader:{rows:async query=>{statements++;const q=dialect.sqlToQuery(query);return (await connection.execute('SET STATEMENT max_statement_time=5 FOR '+q.sql,q.params as any))[0] as any;},close:async()=>{await connection.end();}}});
  try{const response=await capped.inject('/api/v1/videos?'+new URLSearchParams({q:term,limit:'1000'}));expect(response.statusCode).toBe(500);expect(statements).toBe(1);expect(response.body).not.toContain(term);}finally{await capped.close();}
 });
});
