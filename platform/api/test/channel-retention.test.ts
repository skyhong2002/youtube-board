import {it,expect} from 'vitest';
import type {SQL} from 'drizzle-orm';
import {MySqlDialect} from 'drizzle-orm/mysql-core';
import type {Reader,Row} from '../src/db/client.js';
import {buildApp} from '../src/app.js';
import {readChannelIdentity,channelHistoryPaths} from '../src/reports/channel-identity.js';
const dialect=new MySqlDialect();
const identitySql='SELECT u_id,LEFT(title,256) AS title,flag_del FROM urt_channel';
const paths=[...channelHistoryPaths].map(path=>path.replace(':id','8'));
function fixture(flag:number|null|'missing'){
 const statements:string[]=[];
 const reader:Reader={close:async()=>{},rows:async<T extends Row>(query:SQL)=>{
  const {sql}=dialect.sqlToQuery(query);statements.push(sql);
  if(sql.includes(identitySql))return (flag==='missing'?[]:[{u_id:8,title:'保留頻道',flag_del:flag}]) as unknown as T[];
  if(sql.includes('MIN(boundary.'))return [{selected:0,nulls:0,cutoff:null}] as unknown as T[];
  if(sql.includes('COUNT('))return [{total:0,n:0}] as unknown as T[];
  return [];
 }};
 return {reader,statements};
}
it.each([null,0,-1,1,2])('retention identity treats flag_del=%s consistently with active profiles',async flag=>{
 const {reader}=fixture(flag),active=flag===null||flag<1;
 expect(await readChannelIdentity(reader,8)).toEqual({id:8,title:'保留頻道',status:active?'active':'archived',profileAvailable:active});
});
it.each([null,0,1])('all eight historical children retain existing channel flag=%s with one identity read',async flag=>{
 const {reader,statements}=fixture(flag),app=buildApp({reader,clock:()=>new Date('2026-10-12T01:00:00Z')});
 try{for(const path of paths){
  statements.length=0;const response=await app.inject('/api/v1'+path);
  expect(response.statusCode,path+' '+response.body).toBe(200);
  expect(response.json().meta.coverage).toMatchObject({channelId:8,channelTitle:'保留頻道',channelStatus:flag===1?'archived':'active',channelProfileAvailable:flag!==1});
  expect(statements.filter(sql=>sql.includes(identitySql)),path).toHaveLength(1);
 }}finally{await app.close();}
});
it('unknown channel children return 404 before querying retained sources',async()=>{
 const {reader,statements}=fixture('missing'),app=buildApp({reader});
 try{for(const path of paths){statements.length=0;expect((await app.inject('/api/v1'+path)).statusCode,path).toBe(404);expect(statements).toHaveLength(1);expect(statements[0]).toContain(identitySql);}}finally{await app.close();}
});
it('profile and directory keep their active-only SQL and are outside archival route policy',async()=>{
 const {reader,statements}=fixture(1),app=buildApp({reader});
 try{
  expect((await app.inject('/api/v1/channels/8')).statusCode).toBe(404);
  expect((await app.inject('/api/v1/channels')).statusCode).toBe(200);
  expect(statements.filter(sql=>sql.includes('FROM urt_channel c')).every(sql=>sql.includes('(c.flag_del IS NULL OR c.flag_del<1)'))).toBe(true);
  expect(statements.some(sql=>sql.includes(identitySql))).toBe(false);
 }finally{await app.close();}
});
