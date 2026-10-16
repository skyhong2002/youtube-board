import {describe,it,expect,vi} from 'vitest';
import Fastify from 'fastify';
import {MySqlDialect} from 'drizzle-orm/mysql-core';
import {workflowHistory} from '../src/ops/history.js';
import {registerIngestionOps} from '../src/ops/ingestion.js';
import {DataSourceUnavailable,type Reader} from '../src/db/client.js';
const dialect=new MySqlDialect();
const token='fixture-ops-history-token-not-production';
const auth={authorization:'Bearer '+token};
function reader(rows:Record<string,unknown>[]=[]){const calls:{sql:string;params:unknown[]}[]=[];return {calls,rows:async(query:any)=>{calls.push(dialect.sqlToQuery(query));return rows;},close:async()=>{}} as Reader&{calls:{sql:string;params:unknown[]}[]};}
describe('bounded operator history',()=>{
 it('rejects unsupported, repeated and unbounded input before reading',async()=>{
  const db=reader();for(const q of [{workflow:'unknown'},{workflow:['ai.daily']},{workflow:'ai.daily',limit:'51'},{workflow:'ai.daily',limit:'0'},{workflow:'ai.daily',limit:'2.5'},{workflow:'ai.daily',sql:'SELECT anything'}])await expect(workflowHistory(db,q)).rejects.toThrow();expect(db.calls).toHaveLength(0);
 });
 it('reads fixed metadata columns only and preserves each journal timestamp convention',async()=>{
  for(const [workflow,table,updated,expected]of [['youtube.videos.stats','ts_job_runs',1791763200,'2026-10-12T00:00:00.000Z'],['ai.daily','ts_ai_runs','2026-10-12 08:00:00','2026-10-12T00:00:00.000Z'],['notify.telegram.hourly','ts_notification_runs','2026-10-12 00:00:00','2026-10-12T00:00:00.000Z'],['tags.vocabulary.import','ts_vocabulary_runs',1791763200,'2026-10-12T00:00:00.000Z']]as const){
   const db=reader([{id:'safe-run-1',status:'running',updated,result:'secret-content',input_json:'secret-prompt'},{id:'safe-run-2',status:'failed',updated}]);const out=await workflowHistory(db,{workflow,limit:'1'});expect(out.source).toBe(table);expect(out.rows).toEqual([{id:'safe-run-1',status:'running',updatedAt:expected}]);expect(out.hasMore).toBe(true);expect(JSON.stringify(out)).not.toContain('secret');expect(db.calls).toHaveLength(1);expect(db.calls[0]!.params.at(-1)).toBe(2);expect(db.calls[0]!.sql).not.toMatch(/SELECT \*|input_json|result_json|provider_json|failure_code/);
  }
 });
 it('distinguishes empty, no-run-journal and child orchestration without false success',async()=>{
  const db=reader();expect(await workflowHistory(db,{workflow:'ai.daily'})).toMatchObject({rows:[],source:'ts_ai_runs',scope:'exact-workflow',queueState:'not-inspected'});
  expect(await workflowHistory(db,{workflow:'tags.videos.match'})).toMatchObject({source:null,scope:'no-run-journal'});
  expect(await workflowHistory(db,{workflow:'ai.days_refresh'})).toMatchObject({source:null,scope:'child-workflow-journals',relatedWorkflows:expect.arrayContaining(['ai.period'])});expect(db.calls).toHaveLength(1);
 });
 it('does not echo arbitrary persisted status or invalid identity values',async()=>{const out=await workflowHistory(reader([{id:'secret?url=value',status:'secret-provider-body',updated:null}]),{workflow:'ai.daily'});expect(out.rows).toEqual([{id:null,status:'unknown',updatedAt:null}]);});
 it('guards history with the existing bearer boundary, even for cookies and empty authorization',async()=>{
  const app=Fastify(),db=reader();await registerIngestionOps(app,{reader:db,env:{TS_OPS_TOKEN:token}});
  try{for(const headers of [{},{cookie:'session=anything'},{authorization:''},{authorization:'Bearer wrong'}])expect((await app.inject({url:'/api/ops/ingestion/history?workflow=ai.daily',headers})).statusCode).toBe(401);expect(db.calls).toHaveLength(0);const good=await app.inject({url:'/api/ops/ingestion/history?workflow=ai.daily',headers:auth});expect(good.statusCode).toBe(200);expect(good.headers['cache-control']).toBe('no-store');expect((await app.inject({url:'/api/ops/ingestion/history?workflow=ai.daily&limit=51',headers:auth})).statusCode).toBe(400);}finally{await app.close();}
 });
 it('disabled and unavailable reads cannot enqueue or expose connection details',async()=>{
  const enqueue=vi.fn(),db:Reader={rows:async()=>{throw new DataSourceUnavailable();},close:async()=>{}};
  for(const enabled of [false,true]){const app=Fastify();await registerIngestionOps(app,{reader:db,env:enabled?{TS_OPS_TOKEN:token}:{},enqueue});try{const r=await app.inject({url:'/api/ops/ingestion/history?workflow=ai.daily',headers:auth});expect(r.statusCode).toBe(enabled?503:404);}finally{await app.close();}}expect(enqueue).not.toHaveBeenCalled();
 });
});
