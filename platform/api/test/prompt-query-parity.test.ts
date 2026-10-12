import {it,expect} from 'vitest';
import {MySqlDialect} from 'drizzle-orm/mysql-core';
import type {Connection} from 'mysql2/promise';
import type {Reader} from '../src/db/client.js';
import {buildApp} from '../src/app.js';
import {planAi} from '../../ai/src/planner.js';
import type {Condition} from '../../ai/src/contracts.js';
const dialect=new MySqlDialect();
function fixture(){
 const statements:{sql:string;params:unknown[]}[]=[];
 const query=(sql:string,params:unknown[])=>{
  statements.push({sql,params});
  if(sql.includes('SELECT u_id,LEFT(title,256) AS title,flag_del FROM urt_channel'))return [{title:'合成頻道'}];
  if(sql.includes('MAX(a.date_from)'))return [{date:params.includes('%[3]%')?'2038-04-01 00:00:00':'2038-04-03 00:00:00'}];
  if(sql.includes('MAX(publishedAt)'))return [{date:'2038-04-02 12:00:00'}];
  if(sql.includes('COUNT('))return [{n:0}];
  if(sql.includes('SELECT a.pk')||sql.includes('SELECT v.pk'))return [];
  throw new Error('Unexpected query');
 };
 const reader={rows:async(q:any)=>{const s=dialect.sqlToQuery(q);return query(s.sql,s.params);},close:async()=>{}} as Reader;
 return {statements,query,app:buildApp({reader,clock:()=>new Date('2038-04-05T01:00:00Z')})};
}
it('rejects legacy taxonomy scopes and unsupported/duplicate scalars before source reads',async()=>{
 const f=fixture();try{
  for(const query of ['tagid=3','or=3','not=3','tagid=','condition=all&tagid=3','type=oneday&type=week','condition=all&condition=blue','date=2038-04-01&date=2038-04-02','from=2038-04-02&to=2038-04-01','from=2038-04-01&to=2038-04-02','user_token=someone','limit=1001']){
   const r=await f.app.inject('/api/v1/ai/days/prompt?'+query);expect(r.statusCode,query+' '+r.body).toBe(400);
   if(query.includes('tagid')||query.startsWith('or=')||query.startsWith('not='))expect(r.json().error.message).toContain('not automatically converted');
  }
  for(const query of ['condition=all','condition=blue','condition=','limit=501'])expect((await f.app.inject('/api/v1/channels/8/prompt?'+query)).statusCode).toBe(400);
  expect((await f.app.inject('/api/v1/ai/days/2038-04-01/blue/prompt?condition=all')).statusCode).toBe(400);
  expect((await f.app.inject('/api/v1/ai/days/2038-04-01/prompt?date=2038-04-01&date=2038-04-01')).statusCode).toBe(400);
  expect(f.statements).toHaveLength(4);expect(f.statements.every(s=>s.sql.includes('SELECT u_id,LEFT(title,256) AS title,flag_del FROM urt_channel'))).toBe(true);
 }finally{await f.app.close();}
});
it('omitted daily date is condition-scoped, complete-day and byte-exact CLI',async()=>{
 const f=fixture();try{
  const r=await f.app.inject('/api/v1/ai/days/prompt?condition=blue&type=week');expect(r.statusCode,r.body).toBe(200);
  expect(r.json().data.period).toEqual({from:'2038-04-01 00:00:00',to:'2038-04-01 23:59:59'});
  const latest=f.statements[0]!;expect(latest.sql).toContain('BINARY a.user_token=BINARY ?');expect(latest.sql).toContain("TIME(a.date_from)='00:00:00'");expect(latest.sql).toContain('a.date_to=DATE(a.date_from)+INTERVAL 1 DAY-INTERVAL 1 SECOND');expect(latest.sql).toContain('ct.u_id=a.u_id');expect(latest.params).toEqual(['week','CLI','%[3]%']);
  expect(r.json().data.blocked).toBe('no_source_events');
 }finally{await f.app.close();}
});
it('accepted daily scopes use exactly the generator planner source queries',async()=>{
 const f=fixture();try{
  for(const condition of ['all','green','blue','neutral','finance','world'] as Condition[]){
   f.statements.length=0;
   const r=await f.app.inject('/api/v1/ai/days/prompt?date=2038-04-01&condition='+condition);expect(r.statusCode,r.body).toBe(200);
   const actual=[...f.statements];f.statements.length=0;
   const db={query:async(sql:string,params:unknown[])=>[f.query(sql,params),[]]} as unknown as Pick<Connection,'query'>;
   const plan=await planAi(db,{kind:'daily',from:'2038-04-01 00:00:00',to:'2038-04-01 23:59:59',dataType:'oneday',userToken:'CLI',condition});
   expect(actual).toEqual(f.statements);expect(r.json().data.prompt).toBe(plan.prompt);expect(r.json().data.schema).toEqual(plan.schema);
  }
  const omitted=await f.app.inject('/api/v1/ai/days/prompt?date=2038-04-01');
  const explicit=await f.app.inject('/api/v1/ai/days/prompt?date=2038-04-01&condition=all');expect(omitted.json().data).toEqual(explicit.json().data);
 }finally{await f.app.close();}
});
it('explicit endpoints avoid latest lookup and lone to denotes one complete day',async()=>{
 const f=fixture();try{
  for(const query of ['to=2038-04-01','from=2038-04-01','date=2038-04-01','from=2038-04-01&to=2038-04-01']){
   const r=await f.app.inject('/api/v1/ai/days/prompt?'+query);expect(r.statusCode,r.body).toBe(200);expect(r.json().data.period.from).toBe('2038-04-01 00:00:00');expect(r.json().data.period.to).toBe('2038-04-01 23:59:59');
  }
  expect(f.statements.some(s=>s.sql.includes('MAX(a.date_from)')||s.sql.includes('MAX(publishedAt)'))).toBe(false);
 }finally{await f.app.close();}
});

it('a selected prompt date cannot be silently replaced by conflicting endpoints',async()=>{
 const f=fixture();try{
  for(const path of ['/api/v1/ai/days/2038-04-01/prompt?from=2038-04-02&to=2038-04-02','/api/v1/ai/days/prompt?date=2038-04-01&from=2038-04-02&to=2038-04-02','/api/v1/ai/days/2038-04-01/blue/prompt?to=2038-04-02'])expect((await f.app.inject(path)).statusCode).toBe(400);
  expect(f.statements).toHaveLength(0);
  const same=await f.app.inject('/api/v1/ai/days/2038-04-01/prompt?from=2038-04-01&to=2038-04-01');expect(same.statusCode).toBe(200);
 }finally{await f.app.close();}
});
it('channel source dates already use Taipei wall time and are not shifted twice',async()=>{
 const f=fixture();try{const r=await f.app.inject('/api/v1/channels/8/prompt');expect(r.statusCode,r.body).toBe(200);expect(r.json().data.period).toEqual({from:'2038-04-02 00:00:00',to:'2038-04-02 23:59:59'});}finally{await f.app.close();}
});
