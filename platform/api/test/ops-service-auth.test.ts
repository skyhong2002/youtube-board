import {it,expect,vi} from 'vitest';
import Fastify from 'fastify';
import {authorizeOps} from '../src/ops/auth.js';
import {registerEditorialOps} from '../src/ops/editorial.js';
import {registerWorkflowOps} from '../src/ops/workflows.js';
import {registerIngestionOps} from '../src/ops/ingestion.js';
import type {AuthRuntime} from '../src/auth/types.js';
const token='fixture-production-ops-token-not-a-secret',env={APP_ENV:'production',TS_OPS_TOKEN:token,TS_OPS_ACTOR:'ci-release',YOUTUBE_PUBLIC_URL:'https://youtube.observe.tw'};
it('production bearer access requires explicit service mode even with a valid token',async()=>{
 const app=Fastify();app.get('/probe',(req,reply)=>authorizeOps(env,req,reply)?{ok:true}:reply);
 try{const r=await app.inject({url:'/probe',headers:{authorization:'Bearer '+token}});expect(r.statusCode).toBe(403);expect(r.json().error.code).toBe('OPS_SERVICE_AUTH_DISABLED');expect(r.headers['cache-control']).toBe('no-store');}finally{await app.close();}
});
it('NODE_ENV production cannot bypass service mode when APP_ENV is absent',async()=>{
 const app=Fastify();app.get('/probe',(req,reply)=>authorizeOps({NODE_ENV:'production',TS_OPS_TOKEN:token},req,reply)?{ok:true}:reply);
 try{const r=await app.inject({url:'/probe',headers:{authorization:'Bearer '+token}});expect(r.statusCode).toBe(403);expect(r.json().error.code).toBe('OPS_SERVICE_AUTH_DISABLED');}finally{await app.close();}
});
it('explicit production service mode rejects browser credentials and metadata without session fallback',async()=>{
 const app=Fastify();app.get('/probe',(req,reply)=>authorizeOps({...env,TS_OPS_SERVICE_AUTH_ENABLED:'true'},req,reply)?{ok:true}:reply);
 try{
  for(const header of [{cookie:'session=fixture'},{origin:'https://youtube.observe.tw'},{'sec-fetch-site':'same-origin'},{'sec-fetch-mode':'cors'}]){const r=await app.inject({url:'/probe',headers:{authorization:'Bearer '+token,...header}});expect(r.statusCode).toBe(403);expect(r.json().error.code).toBe('OPS_SERVICE_CLIENT_REQUIRED');}
  expect((await app.inject({url:'/probe',headers:{authorization:'Bearer '+token}})).statusCode).toBe(200);
  expect((await app.inject({url:'/probe',headers:{authorization:'Bearer wrong'}})).statusCode).toBe(401);
 }finally{await app.close();}
});
it('production editorial uses admin write guard while authorization never downgrades into cookies',async()=>{
 const requireAdmin=vi.fn<AuthRuntime['requireAdmin']>(async(_req,reply,write)=>{expect(write).toBe(true);reply.code(403).send({error:{code:'ADMIN_REQUIRED'}});return null;});
 const auth:AuthRuntime={enabled:true,origin:env.YOUTUBE_PUBLIC_URL,currentUser:async()=>null,requireReader:async()=>null,requireAdmin,actor:u=>'user:'+u.id};
 const connect=vi.fn(async()=>{throw Error('must not connect');}),app=Fastify();await registerEditorialOps(app,{env,auth,editorialConnect:connect});
 try{
  const session=await app.inject({method:'POST',url:'/api/ops/editorial/execute',headers:{cookie:'fixture-session'},payload:{}});expect(session.json().error.code).toBe('ADMIN_REQUIRED');expect(requireAdmin).toHaveBeenCalledTimes(1);
  for(const authorization of ['Bearer '+token,'Bearer invalid','']){const response=await app.inject({method:'POST',url:'/api/ops/editorial/execute',headers:{authorization,cookie:'fixture-session'},payload:{}});expect(response.statusCode).toBe(403);expect(response.json().error.code).toBe('OPS_SERVICE_AUTH_DISABLED');}
  expect(requireAdmin).toHaveBeenCalledTimes(1);expect(connect).not.toHaveBeenCalled();
 }finally{await app.close();}
});
it('workflow and ingestion APIs do not inherit Google sessions or implicit production token authority',async()=>{
 const app=Fastify(),enqueue=vi.fn(),reader={rows:vi.fn(async()=>[]),close:async()=>{}};
 await registerWorkflowOps(app,{env,enqueueWorkflow:enqueue});await registerIngestionOps(app,{env,reader,enqueue});
 try{for(const url of ['/api/ops/workflows','/api/ops/ingestion'])for(const headers of [{cookie:'fixture-session'},{authorization:'Bearer '+token}]){const r=await app.inject({url,headers});expect(r.statusCode).toBe(403);expect(r.json().error.code).toBe('OPS_SERVICE_AUTH_DISABLED');}expect(enqueue).not.toHaveBeenCalled();expect(reader.rows).not.toHaveBeenCalled();}finally{await app.close();}
});
