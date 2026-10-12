import {describe,it,expect} from 'vitest';
import Fastify from 'fastify';
import {registerPublicApiPolicy,publicApiBudgets,isPublicApiPath} from '../src/public-api/rate-limit.js';
import {trustedProxies} from '../src/trusted-proxy.js';
import {markPublicV1Partial,registerPublicV1Cache} from '../src/public-v1-cache.js';
const at=Date.parse('2026-10-12T00:00:00Z');
function appForPolicy(){
 const app=Fastify({trustProxy:trustedProxies('10.0.1.17/32')});
 registerPublicApiPolicy(app,{clock:()=>new Date(at)});registerPublicV1Cache(app);
 app.get('/api/v1/videos',async()=>({data:{rows:[]}}));
 return app;
}
describe('anonymous public API release policy',()=>{
 it('limits each IP to60, shares IPv6 /64 and resets the fixed window',()=>{
  const take=publicApiBudgets();
  for(let i=0;i<60;i++)expect(take('2001:db8:1:2::'+(i+1).toString(16),false,at).allowed).toBe(true);
  expect(take('2001:db8:1:2::ffff',false,at)).toMatchObject({allowed:false,scope:'ip',limit:60,remaining:0});
  expect(take('2001:db8:1:3::1',false,at).allowed).toBe(true);
  expect(take('2001:db8:1:2::1',false,at+60000).remaining).toBe(59);
 });
 it('bounds anonymous origin traffic at4000 and keeps internal traffic independent',()=>{
  const take=publicApiBudgets();
  for(let i=0;i<4000;i++)expect(take(`198.18.${Math.floor(i/256)}.${i%256}`,false,at).allowed).toBe(true);
  expect(take('192.0.2.1',false,at)).toMatchObject({allowed:false,scope:'global',limit:4000});
  for(let i=0;i<3000;i++)expect(take('127.0.0.1',true,at).allowed).toBe(true);
  expect(take('127.0.0.1',true,at)).toMatchObject({allowed:false,scope:'internal',limit:3000});
 });
 it('treats every supplied key as anonymous without importing or querying any key store',async()=>{
  const app=appForPolicy();
  try{
   for(let i=0;i<60;i++){
    const response=await app.inject({url:'/api/v1/videos',remoteAddress:'192.0.2.1',headers:{'x-api-key':i%2?'ytb_'+'A'.repeat(43):'arbitrary'}});
    expect(response.statusCode).toBe(200);expect(response.headers['x-ratelimit-limit']).toBe('60');expect(response.headers['cache-control']).toBe('private, no-store');
   }
   const response=await app.inject({url:'/api/v1/videos',remoteAddress:'192.0.2.1'});
   expect(response.statusCode).toBe(429);expect(response.headers['retry-after']).toBe('60');expect(response.json()).toEqual({error:'API rate limit exceeded',code:'RATE_LIMITED'});
  }finally{await app.close();}
 });
 it('cannot reset quotas with forged CF/XFF or request internal quota using headers',async()=>{
  const app=appForPolicy();
  try{
   for(let i=0;i<60;i++)expect((await app.inject({url:'/api/v1/videos',remoteAddress:'198.51.100.5',headers:{'x-forwarded-for':'127.0.0.1, 104.16.0.1','cf-connecting-ip':'192.0.2.'+i}})).statusCode).toBe(200);
   expect((await app.inject({url:'/api/v1/videos',remoteAddress:'198.51.100.5',headers:{'x-forwarded-for':'127.0.0.1','cf-connecting-ip':'192.0.2.100'}})).statusCode).toBe(429);
   // A trusted ingress only trusts CF headers when its nearest untrusted hop is CF.
   expect((await app.inject({url:'/api/v1/videos',remoteAddress:'10.0.1.17',headers:{'x-forwarded-for':'104.16.0.1, 198.51.100.5','cf-connecting-ip':'192.0.2.101'}})).statusCode).toBe(429);
   const cf=await app.inject({url:'/api/v1/videos',remoteAddress:'10.0.1.17',headers:{'x-forwarded-for':'198.51.100.5, 104.16.0.1','cf-connecting-ip':'192.0.2.102'}});
   expect(cf.statusCode).toBe(200);expect(cf.headers['x-ratelimit-limit']).toBe('60');
   for(let i=0;i<80;i++){const local=await app.inject({url:'/api/v1/videos',remoteAddress:'127.0.0.1'});expect(local.statusCode).toBe(200);expect(local.headers['x-ratelimit-limit']).toBe('3000');}
  }finally{await app.close();}
 });
 it('preserves partial no-store, v1 and legacy error boundaries, and credential cache exclusion',async()=>{
  const app=appForPolicy();
  app.get('/api/v1/partial',async(_r,reply)=>{markPublicV1Partial(reply);return {data:{partial:true}};});
  app.get('/api/v1/failure',async(_r,reply)=>reply.code(400).send({error:{code:'BAD_QUERY',message:'Invalid query.'}}));
  app.get('/api/failure.php',async(_r,reply)=>reply.code(400).send({error:{code:'BAD_QUERY',message:'Invalid query.'}}));
  try{
   expect((await app.inject('/api/v1/partial')).headers['cache-control']).toBe('private, no-store');
   expect((await app.inject('/api/v1/failure')).json()).toEqual({error:'Invalid query.',code:'BAD_QUERY'});
   expect((await app.inject('/api/failure.php')).json()).toEqual({error:{code:'BAD_QUERY',message:'Invalid query.'}});
   const publicResponse=await app.inject('/api/v1/videos');expect(publicResponse.headers['cache-control']).toContain('s-maxage=60');
   for(const headers of [{authorization:'Bearer test'},{cookie:'session=test'},{'x-api-key':'test'},{'x-service-token':'test'},{'x-service-token':''},{rsc:'1'}])expect((await app.inject({url:'/api/v1/videos',headers})).headers['cache-control']).toBe('private, no-store');
  }finally{await app.close();}
 });
 it('offers read-only noncredentialed CORS and leaves private namespaces outside the policy',async()=>{
  const app=appForPolicy();
  try{
   const response=await app.inject({method:'OPTIONS',url:'/api/v1/videos',headers:{origin:'https://example.org','access-control-request-method':'GET'}});
   expect(response.statusCode).toBe(204);expect(response.headers['access-control-allow-origin']).toBe('*');expect(response.headers['access-control-allow-credentials']).toBeUndefined();expect(response.headers['access-control-allow-methods']).toBe('GET, HEAD, OPTIONS');
   for(const path of ['/api/ops/x','/api/auth/me','/auth/me','/feeds/u/private'])expect(isPublicApiPath(path)).toBe(false);
   expect((await app.inject({method:'OPTIONS',url:'/api/ops/x'})).statusCode).toBe(404);
  }finally{await app.close();}
 });
});
