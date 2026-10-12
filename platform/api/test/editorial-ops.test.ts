import {it,expect} from 'vitest';
import Fastify from 'fastify';
import {registerEditorialOps} from '../src/ops/editorial.js';
const token='x'.repeat(40),env={TS_OPS_TOKEN:token,YOUTUBE_PUBLIC_URL:'https://youtube.observe.tw',TS_OPS_ACTOR:'server-editor',APP_ENV:'test'};
it('editorial ops require token and trusted origin before database connection',async()=>{
 let calls=0;const app=Fastify();await registerEditorialOps(app,{env,editorialConnect:async()=>{calls++;throw new Error('unexpected');}});
 try{expect((await app.inject('/api/ops/editorial')).statusCode).toBe(401);expect((await app.inject({method:'POST',url:'/api/ops/editorial/execute',headers:{authorization:'Bearer '+token,origin:'https://evil.example'},payload:{}})).statusCode).toBe(403);expect((await app.inject({method:'POST',url:'/api/ops/editorial/execute',headers:{authorization:'Bearer '+token},payload:{execute:true,command:{}}})).statusCode).toBe(403);expect(calls).toBe(0);}finally{await app.close();}
});
it('editorial preview rejects missing attribution, client actor, and disabled token without writes',async()=>{
 for(const settings of [{...env,TS_OPS_ACTOR:''},{...env,TS_OPS_TOKEN:''},env]){
  let calls=0;const app=Fastify();await registerEditorialOps(app,{env:settings,editorialConnect:async()=>{calls++;throw new Error('unexpected');}});try{const r=await app.inject({method:'POST',url:'/api/ops/editorial/preview',headers:{authorization:'Bearer '+token},payload:{command:{},actor:'forged'}});expect(r.statusCode).toBe(settings.TS_OPS_TOKEN===''?404:settings.TS_OPS_ACTOR===''?503:400);expect(calls).toBe(0);}finally{await app.close();}
 }
});
it('editorial preserves malformed JSON and payload-size client error status',async()=>{
 const app=Fastify({bodyLimit:100});await registerEditorialOps(app,{env});try{
  for(const[payload,status] of [['{bad',400],['x'.repeat(101),413]] as const){const r=await app.inject({method:'POST',url:'/api/ops/editorial/preview',headers:{authorization:'Bearer '+token,'content-type':'application/json'},payload});expect(r.statusCode).toBe(status);}
 }finally{await app.close();}
});
it('production and wildcard gates reject before connecting',async()=>{
 for(const settings of [{TS_INGESTION_PRODUCTION_ENABLED:'false',TS_INGESTION_WRITE_ALLOWLIST:'editorial.registry'},{TS_INGESTION_PRODUCTION_ENABLED:'true',TS_INGESTION_WRITE_ALLOWLIST:''},{TS_INGESTION_PRODUCTION_ENABLED:'true',TS_INGESTION_WRITE_ALLOWLIST:'editorial.registry',TS_OPS_WRITE_ALLOWLIST:'*,editorial.registry'}]){
  let calls=0;const app=Fastify();await registerEditorialOps(app,{env:{...env,APP_ENV:'production',TS_OPS_SERVICE_AUTH_ENABLED:'true',TS_OPS_EXECUTION_ENABLED:'true',TS_OPS_WRITE_ALLOWLIST:'editorial.registry',TS_INGESTION_ENABLED:'true',TS_INGESTION_OWNERS:'editorial.registry',...settings},editorialConnect:async()=>{calls++;throw new Error('unexpected');}});try{const response=await app.inject({method:'POST',url:'/api/ops/editorial/execute',headers:{authorization:'Bearer '+token},payload:{command:{},execute:true,previewHash:'a'.repeat(64)}});expect(response.statusCode).toBe(403);expect(response.json()).toEqual({error:{code:'EXECUTION_GATED'}});expect(calls).toBe(0);}finally{await app.close();}
 }
});
