import {it,expect} from 'vitest';
import {MySqlDialect} from 'drizzle-orm/mysql-core';
import type {Connection} from 'mysql2/promise';
import type {Reader} from '../src/db/client.js';
import {buildApp} from '../src/app.js';
import {planAi} from '../../ai/src/planner.js';
import {normalizeInput} from '../../ai/src/contracts.js';
const dialect=new MySqlDialect();
const ids=(n:number,seed:string)=>Array.from({length:n},(_,i)=>`${seed}${String(i).padStart(11-seed.length,'0')}`);
const event=(name:string,videos:number,extra:Record<string,unknown>={})=>({事件:name,描述:` ${name}描述 `,關鍵字:['預算',' ','核能'],videoId:ids(videos,'V'+name.codePointAt(0)!.toString(36)),...extra});
const source=[
 {pk:9,u_id:15,title:'少台',result_json:JSON.stringify([event('甲',2)])},
 {pk:8,u_id:7,title:'多台',result_json:JSON.stringify({events:[event('乙',3),event('丙',1),event('丁',2,{關鍵字:'能源'})]})},
 {pk:7,u_id:20,title:'單則台',result_json:JSON.stringify([event('戊',1)])},
 {pk:6,u_id:21,title:'同名台',result_json:JSON.stringify([event('己',2)])},
 {pk:5,u_id:22,title:'同名台',result_json:JSON.stringify([event('庚',2)])},
 {pk:4,u_id:23,title:null,result_json:JSON.stringify([event('辛',2)])},
 {pk:3,u_id:24,title:'壞台',result_json:'broken'},
 {pk:2,u_id:25,title:'平台',result_json:JSON.stringify([event('壬',2)])},
];
function fixture(rows=source){
 const statements:{sql:string;params:unknown[]}[]=[];
 const query=(sql:string,params:unknown[])=>{
  statements.push({sql,params});
  if(sql.includes('SELECT u_id,LEFT(title,256) AS title,flag_del FROM urt_channel'))return [{title:'合成頻道'}];
  if(sql.includes('MAX(a.date_from)'))return [{date:'2038-04-03 00:00:00'}];
  if(sql.includes('MAX(publishedAt)'))return [{date:'2038-04-02 12:00:00'}];
  if(sql.includes('COUNT('))return [{n:new Set(rows.map(r=>r.u_id)).size}];
  if(sql.includes('SELECT a.pk'))return rows.slice(0,Number(params.at(-1)));
  if(sql.includes('SELECT v.pk'))return [];
  throw new Error('Unexpected query');
 };
 const reader={rows:async(q:any)=>{const s=dialect.sqlToQuery(q);return query(s.sql,s.params);},close:async()=>{}} as Reader;
 return {statements,query,app:buildApp({reader,clock:()=>new Date('2038-04-05T01:00:00Z')})};
}
it('daily preview lists each prompt media with its events and the read media it left out, without changing the planner prompt',async()=>{
 const f=fixture();try{
  const r=await f.app.inject('/api/v1/ai/days/2038-04-01/prompt');expect(r.statusCode,r.body).toBe(200);const data=r.json().data;
  expect(data.media.map((m:any)=>[m.title,m.channelId,m.sourcePk,m.videoCount])).toEqual([['多台',7,'8',5],['少台',15,'9',2],['平台',25,'2',2]]);
  expect(data.media[0].events).toEqual([{event:'乙',description:'乙描述',videoCount:3,keywords:['預算','核能']},{event:'丁',description:'丁描述',videoCount:2,keywords:['能源']}]);
  expect(data.omittedMedia).toEqual([
   {channelId:20,title:'單則台',sourcePk:'7',reason:'no_qualifying_events'},{channelId:21,title:'同名台',sourcePk:'6',reason:'duplicate_title'},{channelId:22,title:'同名台',sourcePk:'5',reason:'duplicate_title'},
   {channelId:23,title:null,sourcePk:'4',reason:'missing_title'},{channelId:24,title:'壞台',sourcePk:'3',reason:'invalid_result'},
  ]);
  expect(data.omitted).toBe(data.omittedMedia.length);
  const statements=[...f.statements];f.statements.length=0;
  const plan=await planAi({query:async(sql:string,params:unknown[])=>[f.query(sql,params),[]]} as unknown as Pick<Connection,'query'>,{kind:'daily',from:'2038-04-01 00:00:00',to:'2038-04-01 23:59:59',dataType:'oneday',userToken:'CLI',condition:'all'});
  expect(statements).toEqual(f.statements);expect(data.prompt).toBe(plan.prompt);expect(data.sourceCount).toBe(plan.sourceCount);
  // 「全部」 keeps finance/world channels: no taxonomy clause on the source read.
  expect(statements.every(s=>!s.sql.includes('urt_count'))).toBe(true);
  const green=(await f.app.inject('/api/v1/ai/days/2038-04-01/green/prompt')).json().data;expect(green.media.find((m:any)=>m.title==='單則台')?.videoCount).toBe(1);
 }finally{await f.app.close();}
});
it('media beyond the source cap are counted as omitted but only read media are listed',async()=>{
 const f=fixture();try{const data=(await f.app.inject('/api/v1/ai/days/2038-04-01/prompt?limit=2')).json().data;
  expect(data.blocked).toBe('daily_source_cap_exceeded');expect(data.media.map((m:any)=>m.title)).toEqual(['多台','少台']);expect(data.omittedMedia).toEqual([]);expect(data.omitted).toBe(6);
 }finally{await f.app.close();}
});
it('from/to previews a custom period of complete Taipei days, bounded and validated before reads',async()=>{
 const f=fixture();try{
  const r=await f.app.inject('/api/v1/ai/days/prompt?from=2038-04-01&to=2038-04-07&type=week&condition=blue');expect(r.statusCode,r.body).toBe(200);const data=r.json().data;
  expect(data.period).toEqual({from:'2038-03-31T16:00:00.000Z',to:'2038-04-07T15:59:59.000Z'});expect(data.title).toBe('2038-04-01 – 2038-04-07 彙整提示詞預覽');
  const read=f.statements.find(s=>s.sql.includes('SELECT a.pk'))!;expect(read.params.slice(0,4)).toEqual(['2038-04-01 00:00:00','2038-04-07 23:59:59','week','CLI']);
  expect(f.statements.some(s=>s.sql.includes('MAX(a.date_from)'))).toBe(false);expect(data.media.length).toBeGreaterThan(0);
  f.statements.length=0;
  for(const query of ['from=2038-04-02&to=2038-04-01','from=2038-04-01&to=2038-05-02','from=2038-04-01 00:00:00&to=2038-04-02','from=2038-04-01&to=2038-04-02&date=2038-04-01'])expect((await f.app.inject('/api/v1/ai/days/prompt?'+encodeURI(query))).statusCode,query).toBe(400);
  expect((await f.app.inject('/api/v1/ai/days/2038-04-01/prompt?from=2038-04-01&to=2038-04-02')).statusCode).toBe(400);
  expect(f.statements).toHaveLength(0);
  expect((await f.app.inject('/api/v1/ai/days/prompt?from=2038-04-01&to=2038-05-01')).statusCode).toBe(200);
 }finally{await f.app.close();}
});
it('generation inputs still require one complete day and channel previews keep their shape',async()=>{
 const multi={kind:'daily' as const,from:'2038-04-01 00:00:00',to:'2038-04-02 23:59:59'};
 expect(()=>normalizeInput(multi)).toThrow('complete Taipei day');await expect(planAi({query:async()=>[[],[]]} as unknown as Pick<Connection,'query'>,multi)).rejects.toThrow('complete Taipei day');
 expect(()=>normalizeInput({...multi,to:'2038-04-02 12:00:00'},{dailyDays:true})).toThrow('complete Taipei day');
 const f=fixture();try{const data=(await f.app.inject('/api/v1/channels/8/prompt')).json().data;expect(data).not.toHaveProperty('media');expect(data).not.toHaveProperty('omittedMedia');}finally{await f.app.close();}
});
