import {it,expect} from 'vitest';
import Fastify from 'fastify';
import {MySqlDialect} from 'drizzle-orm/mysql-core';
import type {SQL} from 'drizzle-orm';
import {registerAuth} from '../src/auth/index.js';
import {accountActivity,channelStatus,editorialKind,registerManage,type ActivityStore} from '../src/manage/routes.js';
import type {Reader,Row} from '../src/db/client.js';
import {authEnv,memoryAuthStore} from './auth-fixture.js';
const now=new Date('2026-10-17T04:00:00Z'),dialect=new MySqlDialect();
const cookie=(headers:Record<string,any>,name:string)=>{const values=headers['set-cookie'];return(Array.isArray(values)?values:[values]).find((v:string)=>v?.startsWith(name+'='))?.split(';')[0] as string;};
function fakeReader(tables:Record<string,Row[]>):Reader&{queries:string[]}{const queries:string[]=[];return {queries,close:async()=>{},rows:async<T extends Row>(query:SQL)=>{const text=dialect.sqlToQuery(query).sql;queries.push(text);const key=Object.keys(tables).find(k=>text.includes(k));return (key?tables[key]:[]) as T[];}};}
async function setup(reader:Reader,store:ActivityStore|null){
 let person={sub:'admin',email:'admin@example.test',name:'Admin',picture:null};const data=memoryAuthStore(),app=Fastify({logger:false});
 const auth=await registerAuth(app,{env:authEnv,store:data.store,provider:{authenticate:async()=>person},clock:()=>now});await registerManage(app,auth,{store,reader,clock:()=>now});
 const login=async()=>{const r=await app.inject('/auth/google?next=/manage'),url=new URL(r.headers.location!),cb=await app.inject({url:'/auth/google/callback?state='+url.searchParams.get('state')+'&code=x',headers:{cookie:cookie(r.headers,'yt_dev_oauth')}});return cookie(cb.headers,'yt_dev_session');};
 const admin=await login();person={sub:'reader',email:'reader@example.test',name:'Reader',picture:null};const reader2=await login();
 return {app,admin,reader:reader2};
}
it('groups account activity per user and keeps logins out of the last-action time',()=>{
 const rows=accountActivity({follows:[{id:'1',n:'3',at:'2026-10-10 01:00:00.000'}],saves:[{id:2,n:1,at:'2026-10-11 01:00:00.000'}],apiKeys:[{id:1,n:'1',at:'2026-10-12 02:00:00.000'}],feeds:[{id:1,at:'2026-10-01 00:00:00.000'}],sessions:[{id:2,n:'2'}],roles:[{id:1,n:1,at:'2026-10-09 00:00:00.000'}],editorial:[{id:'1',action:'create',n:2,at:'2026-10-13 00:00:00.000'},{id:'1',action:'rename',n:1,at:'2026-10-08 00:00:00.000'},{id:'1',action:'candidate.submit',n:1},{id:'2',action:'candidate.approve',n:4},{id:'x',action:'create',n:9}]});
 expect(rows).toEqual([
  {userId:1,follows:3,saves:0,apiKeys:1,feed:true,sessions:0,editorial:{event:3,nomination:1,decision:0},roleChanges:1,lastActiveAt:'2026-10-13T00:00:00.000Z'},
  {userId:2,follows:0,saves:1,apiKeys:0,feed:false,sessions:2,editorial:{event:0,nomination:0,decision:4},roleChanges:0,lastActiveAt:'2026-10-11T01:00:00.000Z'},
 ]);
 expect(['candidate.reject','candidate.adopt'].map(editorialKind)).toEqual(['decision','decision']);expect(['merge','split','refresh'].map(editorialKind)).toEqual(['event','event','event']);
});
it('channel status prefers archived, then never collected, stale statistics and quiet uploads',()=>{
 const recent='2026-10-16T00:00:00.000Z';
 expect(channelStatus({archived:true,latestVideoAt:recent,statsAt:recent},now)).toBe('archived');
 expect(channelStatus({archived:false,latestVideoAt:null,statsAt:recent},now)).toBe('empty');
 expect(channelStatus({archived:false,latestVideoAt:recent,statsAt:'2026-10-13T00:00:00.000Z'},now)).toBe('stale');
 expect(channelStatus({archived:false,latestVideoAt:'2026-09-01T00:00:00.000Z',statsAt:recent},now)).toBe('quiet');
 expect(channelStatus({archived:false,latestVideoAt:recent,statsAt:recent},now)).toBe('active');
});
it('admin overview routes are session-admin only and list archived channels with Taipei times',async()=>{
 const reader=fakeReader({
  'FROM urt_channel c':[{u_id:7,youtube_id:'UCaaaaaaaaaaaaaaaaaaaaaa',title:'甲台',flag_del:null,ctime:'2020-01-01 08:00:00',stime:'2026-10-17 10:00:00',subscriberCount:'1200',videoCount:'50',tags:'[3][12]'},{u_id:8,youtube_id:'UCbbbbbbbbbbbbbbbbbbbbbb',title:'乙台',flag_del:1,ctime:null,stime:null,subscriberCount:null,videoCount:null,tags:null}],
  'MAX(publishedAt)':[{u_id:7,latest:'2026-10-16 20:00:00'},{u_id:8,latest:'2025-01-01 00:00:00'}],
  'COUNT(*) AS n FROM urt_video':[{u_id:7,n:'4'}],
  'FROM urt_tag':[{tag_id:3,tag_name:'泛藍'},{tag_id:12,tag_name:'電視台'},{tag_id:99,tag_name:'沒用到'}],
 });
 const store:ActivityStore={activity:async()=>[{userId:1,follows:1,saves:0,apiKeys:0,feed:false,sessions:1,editorial:{event:0,nomination:0,decision:0},roleChanges:0,lastActiveAt:null}],close:async()=>{}};
 const s=await setup(reader,store);try{
  for(const url of ['/auth/admin/user-activity','/auth/admin/channels']){
   expect((await s.app.inject(url)).statusCode).toBe(401);
   expect((await s.app.inject({url,headers:{cookie:s.reader}})).json()).toEqual({error:{code:'ADMIN_REQUIRED'}});
   expect((await s.app.inject({url,headers:{cookie:s.admin,authorization:'Bearer x'}})).statusCode).toBe(401);
  }
  const activity=await s.app.inject({url:'/auth/admin/user-activity',headers:{cookie:s.admin}});expect(activity.headers['cache-control']).toBe('private, no-store');expect(activity.json()).toMatchObject({activity:[{userId:1,follows:1}],generatedAt:now.toISOString()});
  const list=(await s.app.inject({url:'/auth/admin/channels',headers:{cookie:s.admin}})).json();
  expect(list.tags).toEqual([{id:3,name:'泛藍'},{id:12,name:'電視台'}]);
  expect(list.channels).toMatchObject([
   {channelId:7,channelTitle:'甲台',status:'active',tags:[3,12],subscribers:1200,videos:50,weekVideos:4,latestVideoAt:'2026-10-16T12:00:00.000Z',statsAt:'2026-10-17T02:00:00.000Z',addedAt:'2020-01-01T00:00:00.000Z'},
   {channelId:8,channelTitle:'乙台',status:'archived',tags:[],subscribers:null,weekVideos:0,statsAt:null},
  ]);
  expect(reader.queries.find(q=>q.includes('COUNT(*) AS n FROM urt_video'))).toContain('publishedAt>=?');
 }finally{await s.app.close();}
});
it('a missing activity store or failing source reads answer 503 without detail',async()=>{
 const failing:Reader={close:async()=>{},rows:async()=>{throw Object.assign(new Error('secret sql'),{code:'ER_TABLEACCESS_DENIED_ERROR'});}};
 const s=await setup(failing,null);try{
  expect((await s.app.inject({url:'/auth/admin/user-activity',headers:{cookie:s.admin}})).statusCode).toBe(503);
  const r=await s.app.inject({url:'/auth/admin/channels',headers:{cookie:s.admin}});expect(r.statusCode).toBe(503);expect(r.body).not.toContain('secret');
 }finally{await s.app.close();}
});
