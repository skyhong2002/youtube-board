import {describe,it,expect} from 'vitest';
import Fastify from 'fastify';
import {Ajv2020 as Ajv} from 'ajv/dist/2020.js';
import {SCHEMAS} from '../src/public-api/schemas.js';
import {registerPublicApiPolicy,publicApiBudgets,isPublicApiPath} from '../src/public-api/rate-limit.js';
import {buildApp} from '../src/app.js';
import {trustedProxies} from '../src/trusted-proxy.js';
import {markPublicV1Partial,registerPublicV1Cache} from '../src/public-v1-cache.js';
const at=Date.parse('2026-10-12T00:00:00Z');
function appForPolicy(options:Parameters<typeof registerPublicApiPolicy>[1]={}){
 const app=Fastify({trustProxy:trustedProxies('10.0.1.17/32')});
 registerPublicApiPolicy(app,{clock:()=>new Date(at),...options});registerPublicV1Cache(app);
 app.get('/api/v1/videos',async()=>({data:{rows:[]}}));
 return app;
}
describe('public API origin policy',()=>{
 it('limits each IP to60, shares IPv6 /64 and resets the fixed window',()=>{
  const take=publicApiBudgets();
  for(let i=0;i<60;i++)expect(take('2001:db8:1:2::'+(i+1).toString(16),null,false,at).allowed).toBe(true);
  expect(take('2001:db8:1:2::ffff',null,false,at)).toMatchObject({allowed:false,scope:'ip',limit:60,remaining:0});
  expect(take('2001:db8:1:3::1',null,false,at).allowed).toBe(true);
  expect(take('2001:db8:1:2::1',null,false,at+60000).remaining).toBe(59);
 });
 it('bounds the anonymous lane at4000 and keeps internal traffic independent',()=>{
  const take=publicApiBudgets();
  for(let i=0;i<4000;i++)expect(take(`198.18.${Math.floor(i/256)}.${i%256}`,null,false,at).allowed).toBe(true);
  expect(take('192.0.2.1',null,false,at)).toMatchObject({allowed:false,scope:'global',limit:4000});
  for(let i=0;i<3000;i++)expect(take('127.0.0.1',null,true,at).allowed).toBe(true);
  expect(take('127.0.0.1',null,true,at)).toMatchObject({allowed:false,scope:'internal',limit:3000});
 });
 it('without a ready key store every supplied key stays anonymous, private and never queried',async()=>{
  const app=appForPolicy({keys:null});
  try{
   for(let i=0;i<60;i++){
    const response=await app.inject({url:'/api/v1/videos',remoteAddress:'192.0.2.1',headers:{'x-api-key':i%2?'ytb_'+'A'.repeat(43):'arbitrary'}});
    expect(response.statusCode).toBe(200);expect(response.headers['x-ratelimit-limit']).toBe('60');expect(response.headers['cache-control']).toBe('private, no-store');
   }
   const response=await app.inject({url:'/api/v1/videos',remoteAddress:'192.0.2.1'});
   expect(response.statusCode).toBe(429);expect(response.headers['retry-after']).toBe('60');expect(response.json()).toEqual({error:'API rate limit exceeded',code:'RATE_LIMITED'});
  }finally{await app.close();}
 });
 it('buildApp with an unavailable key store keeps keyed callers on the anonymous public quota',async()=>{
  const app=buildApp({dataset:'fixture',reader:{rows:async()=>[],close:async()=>{}},publicApi:{clock:()=>new Date(at),keys:null}});
  try{
   const token='ytb_'+Buffer.alloc(32,7).toString('base64url');
   const keyed=await app.inject({url:'/api/v1/openapi.json',remoteAddress:'192.0.2.40',headers:{'x-api-key':token}});
   expect(keyed.statusCode).toBe(200);expect(keyed.headers['x-ratelimit-limit']).toBe('60');expect(keyed.headers['x-ratelimit-remaining']).toBe('59');expect(keyed.headers['cache-control']).toBe('private, no-store');
   const anonymous=await app.inject({url:'/api/v1/openapi.json',remoteAddress:'192.0.2.40'});
   expect(anonymous.headers['x-ratelimit-limit']).toBe('60');expect(anonymous.headers['x-ratelimit-remaining']).toBe('58');
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

describe('public API quota and cache boundaries',()=>{
 it('uses60anonymous requests,1000 perowner, resets and preserves separate internal lane',()=>{
  const take=publicApiBudgets({globalLimit:5000,internalLimit:2});
  for(let i=0;i<60;i++)expect(take('192.0.2.1',null,false,at).allowed).toBe(true);
  expect(take('192.0.2.1',null,false,at)).toMatchObject({allowed:false,remaining:0,limit:60});
  for(let i=0;i<1000;i++)expect(take('192.0.2.1','key1',false,at).allowed).toBe(true);
  expect(take('192.0.2.2','key1',false,at).allowed).toBe(false);
  expect(take('192.0.2.1',null,false,at+60000).allowed).toBe(true);
  expect(take('127.0.0.1',null,true,at).allowed).toBe(true);expect(take('127.0.0.1',null,true,at).allowed).toBe(true);expect(take('127.0.0.1',null,true,at).allowed).toBe(false);
 });
 it('sharesIPv6/64, caps /48 and keeps global budget acrossLRUevictions',()=>{
  const take=publicApiBudgets({globalLimit:10000,anonymousLimit:10000,keyTrafficLimit:0});for(let i=0;i<60;i++)expect(take('2001:db8:1:2::'+i.toString(16),null,false,at).allowed).toBe(true);
  expect(take('2001:db8:1:2::ffff',null,false,at).allowed).toBe(false);
  for(let i=0;i<4000;i++)take('2001:db8:1:'+ (i+3).toString(16)+'::1',null,false,at);
  expect(take('2001:db8:1:ffff::1',null,false,at)).toMatchObject({allowed:false,scope:'network'});
  const tiny=publicApiBudgets({globalLimit:5000,anonymousLimit:5000,keyTrafficLimit:0});for(let i=0;i<5000;i++)tiny(`10.${Math.floor(i/256)}.${i%256}.1`,null,false,at);
  expect(tiny('192.0.2.100',null,false,at)).toMatchObject({allowed:false,scope:'global'});
 });
 it('publicGET/HEAD exposeCORS+quota; key/Auth/Cookie/SetCookie/errors never shared',async()=>{
  const app=Fastify();let lookups=0;
  registerPublicApiPolicy(app,{clock:()=>new Date(at),keys:{lookup:async()=>{lookups++;return{keyId:'7',userId:'2'};}}});
  app.get('/api/v1/videos',async()=>({data:[]}));app.get('/api/v1/cookie',async(_r,reply)=>reply.header('set-cookie','test=1').send({data:[]}));app.get('/api/v1/error',async(_r,reply)=>reply.code(400).send({error:'Invalid query'}));app.get('/auth/me',async()=>({user:null}));
  try{
   const get=(url='/api/v1/videos',headers:Record<string,string>={})=>app.inject({url,headers,remoteAddress:'192.0.2.1'});
   const publicReply=await get();expect(publicReply.headers['cache-control']).toContain('s-maxage=60');expect(publicReply.headers['access-control-allow-origin']).toBe('*');expect(publicReply.headers['x-ratelimit-limit']).toBe('60');
   const keyed=await get(undefined,{'x-api-key':'ytb_'+'A'.repeat(43)});expect(keyed.headers['x-ratelimit-limit']).toBe('1000');expect(keyed.headers['cache-control']).toBe('private, no-store');expect(lookups).toBe(1);
   for(const headers of [{authorization:'Bearer invalid'},{cookie:'anything=1'},{'x-api-key':'bad'}] as Record<string,string>[])expect((await get(undefined,headers)).headers['cache-control']).toBe('private, no-store');
   expect((await get('/api/v1/cookie')).headers['cache-control']).toBe('private, no-store');expect((await get('/api/v1/error')).headers['cache-control']).toBe('no-store');expect((await get('/auth/me')).headers['access-control-allow-origin']).toBeUndefined();
   const head=await app.inject({method:'HEAD',url:'/api/v1/videos',remoteAddress:'192.0.2.2'});expect(head.statusCode).toBe(200);expect(head.body).toBe('');expect(head.headers['x-ratelimit-limit']).toBe('60');
   const preflight=await app.inject({method:'OPTIONS',url:'/api/v1/videos',headers:{origin:'https://example.org','access-control-request-headers':'x-api-key'},remoteAddress:'192.0.2.2'});expect(preflight.statusCode).toBe(204);expect(preflight.headers['access-control-allow-headers']).toContain('x-api-key');expect(preflight.headers['access-control-allow-credentials']).toBeUndefined();
  }finally{await app.close();}
 });
 it('rejects spoofed internal/CFheaders, throttleskeylookup beforeSQL, returns429no-store',async()=>{
  const app=Fastify();let calls=0;registerPublicApiPolicy(app,{clock:()=>new Date(at),keys:{lookup:async()=>{calls++;return null;}}});app.get('/api/v1/videos',async()=>({data:[]}));
  try{
   for(let i=0;i<60;i++)await app.inject({url:'/api/v1/videos',remoteAddress:'198.51.100.1',headers:{'x-forwarded-for':'127.0.0.1','cf-connecting-ip':'192.0.2.'+i,'x-internal-request':'1'}});
   const denied=await app.inject({url:'/api/v1/videos',remoteAddress:'198.51.100.1'});expect(denied.statusCode).toBe(429);expect(denied.headers['retry-after']).toBe('60');expect(denied.headers['cache-control']).toBe('no-store');
   // Low internal budget remains independently bounded even when public lane is full.
   const local=await app.inject({url:'/api/v1/videos',remoteAddress:'127.0.0.1'});expect(local.statusCode).toBe(200);expect(local.headers['x-ratelimit-limit']).toBe('3000');
   for(let i=0;i<1001;i++)await app.inject({url:'/api/v1/videos',remoteAddress:'198.51.100.2',headers:{'x-api-key':'ytb_'+'A'.repeat(43)}});
   expect(calls).toBe(20);
  }finally{await app.close();}
 });
 it('documents actual quota, key failure and structured report errors as public string errors',async()=>{
  const app=Fastify();registerPublicApiPolicy(app,{clock:()=>new Date(at),keys:{lookup:async()=>{throw new Error('private');}}});
  app.get('/api/v1/videos',async(_r,reply)=>reply.code(400).send({error:{code:'BAD_QUERY',message:'Invalid query'}}));
  const validate=new Ajv().compile(SCHEMAS.ApiError!);
  try{
   const bad=await app.inject({url:'/api/v1/videos',remoteAddress:'192.0.2.1'});expect(bad.json()).toEqual({error:'Invalid query',code:'BAD_QUERY'});expect(validate(bad.json())).toBe(true);
   const unavailable=await app.inject({url:'/api/v1/videos',remoteAddress:'192.0.2.2',headers:{'x-api-key':'ytb_'+'A'.repeat(43)}});expect(unavailable.statusCode).toBe(503);expect(validate(unavailable.json())).toBe(true);expect(unavailable.body).not.toContain('private');
   for(let i=0;i<59;i++)await app.inject({url:'/api/v1/videos',remoteAddress:'192.0.2.1'});
   const denied=await app.inject({url:'/api/v1/videos',remoteAddress:'192.0.2.1'});expect(denied.statusCode).toBe(429);expect(validate(denied.json())).toBe(true);
  }finally{await app.close();}
 });
 it('limits public paths without including auth/ops/privatefeeds',()=>{for(const path of ['/api/v1','/api/v1/videos','/api/status','/api/live.php'])expect(isPublicApiPath(path)).toBe(true);for(const path of ['/api/ops/editorial','/auth/me','/api/','/feeds/u/private.xml'])expect(isPublicApiPath(path)).toBe(false);});
});

it('reserves anonymous and keyed global lanes independently and owner usage survives counter churn',()=>{
 const take=publicApiBudgets();
 for(let owner=0;owner<8;owner++)for(let i=0;i<1000;i++)expect(take(`192.0.2.${owner+1}`,'owner'+owner,false,at).allowed).toBe(true);
 expect(take('192.0.2.99','ninth',false,at)).toMatchObject({allowed:false,scope:'global',limit:8000});
 expect(take('198.51.100.1',null,false,at)).toMatchObject({allowed:true,scope:'ip',limit:60});
 const reverse=publicApiBudgets();for(let i=0;i<4000;i++)expect(reverse(`10.${Math.floor(i/256)}.${i%256}.1`,null,false,at).allowed).toBe(true);
 expect(reverse('192.0.2.9',null,false,at)).toMatchObject({allowed:false,scope:'global',limit:4000});
 expect(reverse('192.0.2.9','owner',false,at).allowed).toBe(true);
 const churn=publicApiBudgets();for(let i=0;i<500;i++)churn('192.0.2.1','first',false,at);
 for(let i=0;i<4200;i++)churn('192.0.2.1','other'+i,false,at);
 for(let i=0;i<500;i++)expect(churn('192.0.2.1','first',false,at).allowed).toBe(true);
 expect(churn('192.0.2.1','first',false,at)).toMatchObject({allowed:false,scope:'key',limit:1000});
});
it('three keys share one private owner quota across networks without exposing identity',async()=>{
 const app=Fastify(),tokens=[1,2,3].map(n=>'ytb_'+Buffer.alloc(32,n).toString('base64url'));
 registerPublicApiPolicy(app,{clock:()=>new Date(at),keys:{lookup:async token=>({keyId:String(tokens.indexOf(String(token))+1),userId:'9007199254740993'})}});
 app.get('/api/v1/videos',async()=>({data:[]}));
 try{
  for(let i=0;i<1000;i++)expect((await app.inject({url:'/api/v1/videos',remoteAddress:`192.0.2.${i%3+1}`,headers:{'x-api-key':tokens[i%3]!}})).statusCode).toBe(200);
  const denied=await app.inject({url:'/api/v1/videos',remoteAddress:'192.0.2.4',headers:{'x-api-key':tokens[0]!}});
  expect(denied.statusCode).toBe(429);expect(denied.headers['x-ratelimit-limit']).toBe('1000');expect(denied.headers['cache-control']).toBe('private, no-store');
  expect(JSON.stringify(denied.headers)+denied.body).not.toContain('9007199254740993');
 }finally{await app.close();}
});
it('bounds DB misses including concurrent bursts, preserves other networks, and resets each minute',async()=>{
 const app=Fastify();let calls=0,now=at,release!:(value:null)=>void;
 const gate=new Promise<null>(resolve=>{release=resolve;});
 const bad='ytb_'+Buffer.alloc(32,1).toString('base64url'),good='ytb_'+Buffer.alloc(32,2).toString('base64url');
 registerPublicApiPolicy(app,{clock:()=>new Date(now),keys:{lookup:async token=>{calls++;return token===good?{keyId:'1',userId:'2'}:gate;}}});
 app.get('/api/v1/videos',async()=>({data:[]}));
 const get=(ip:string,token:string)=>app.inject({url:'/api/v1/videos',remoteAddress:ip,headers:{'x-api-key':token}});
 try{
  const burst=Array.from({length:40},()=>get('198.51.100.1',bad));
  await new Promise(resolve=>setTimeout(resolve,10));expect(calls).toBe(20);
  release(null);expect((await Promise.all(burst)).every(r=>r.statusCode===200)).toBe(true);
  await get('198.51.100.1',bad);expect(calls).toBe(20);
  const valid=await get('198.51.100.2',good);expect(valid.statusCode).toBe(200);expect(valid.headers['x-ratelimit-limit']).toBe('1000');expect(calls).toBe(21);
  now+=60000;await get('198.51.100.1',bad);expect(calls).toBe(22);
 }finally{release?.(null);await app.close();}
});
it('exhausted lookup gate degrades to anonymous private responses; malformed tokens never reach SQL',async()=>{
 const app=Fastify();let calls=0;
 const valid='ytb_'+Buffer.alloc(32,1).toString('base64url');
 registerPublicApiPolicy(app,{clock:()=>new Date(at),lookupGlobalLimit:2,keys:{lookup:async()=>{calls++;return {keyId:'1',userId:'2'};}}});
 app.get('/api/v1/videos',async()=>({data:[]}));
 const get=(token:string,ip='192.0.2.1')=>app.inject({url:'/api/v1/videos',remoteAddress:ip,headers:{'x-api-key':token}});
 try{
  for(const token of ['ytb_'+'A'.repeat(32),'ytb_'+'A'.repeat(42)+'B','ytb_'+'A'.repeat(44)]){const r=await get(token);expect(r.statusCode).toBe(200);expect(r.headers['x-ratelimit-limit']).toBe('60');}
  expect(calls).toBe(0);
  await get(valid);await get(valid);
  const degraded=await get(valid,'192.0.2.2');expect(calls).toBe(2);expect(degraded.statusCode).toBe(200);expect(degraded.headers['x-ratelimit-limit']).toBe('60');expect(degraded.headers['cache-control']).toBe('private, no-store');
 }finally{await app.close();}
});

it('retains a full keyed IPv6 /48 budget through cross-lane anonymous and keyed churn',()=>{
 const take=publicApiBudgets();
 for(let owner=0;owner<4;owner++)for(let i=0;i<1000;i++)expect(take('2001:db8:1:2::1','target'+owner,false,at).allowed).toBe(true);
 expect(take('2001:db8:1:3::1','fresh',false,at)).toMatchObject({allowed:false,scope:'network',limit:4000});
 for(let i=0;i<4000;i++)expect(take(`2001:abcd:${(i+10).toString(16)}:1::1`,null,false,at).allowed).toBe(true);
 for(let i=0;i<96;i++)expect(take(`2001:ef01:${(i+10).toString(16)}:1::1`,'fresh',false,at).allowed).toBe(true);
 expect(take('2001:db8:1:4::1','fresh',false,at)).toMatchObject({allowed:false,scope:'network',remaining:0});
 expect(take('2001:db8:1:4::1','fresh',false,at+60000).allowed).toBe(true);
});
it('bounds /48 bookkeeping per lane without eviction and releases capacity next window',()=>{
 const take=publicApiBudgets({globalLimit:12000,anonymousLimit:6000,keyTrafficLimit:6000});
 for(let i=0;i<4096;i++)expect(take(`2001:abcd:${(i+1).toString(16)}:1::1`,null,false,at).allowed).toBe(true);
 const overflow='2001:abcd:2000:1::1';
 expect(take(overflow,null,false,at)).toMatchObject({allowed:false,scope:'network',remaining:0});
 expect(take('2001:abcd:1:2::1',null,false,at).allowed).toBe(true);
 // Anonymous map capacity cannot consume keyed bookkeeping or allowance.
 expect(take(overflow,'keyed-owner',false,at).allowed).toBe(true);
 expect(take(overflow,null,false,at+60000).allowed).toBe(true);
});
it('late old-window lookup completion cannot delete or charge the new network reservation',async()=>{
 const app=Fastify();let now=at,calls=0;
 const releases:((value:{keyId:string;userId:string}|null)=>void)[]=[];
 registerPublicApiPolicy(app,{clock:()=>new Date(now),keys:{lookup:async()=>{calls++;return new Promise(resolve=>releases.push(resolve));}}});
 app.get('/api/v1/videos',async()=>({data:[]}));
 const get=()=>app.inject({url:'/api/v1/videos',remoteAddress:'198.51.100.1',headers:{'x-api-key':'ytb_'+'A'.repeat(43)}});
 const untilCalls=async(n:number)=>{for(let i=0;i<100&&calls<n;i++)await new Promise(resolve=>setTimeout(resolve,1));expect(calls).toBe(n);};
 try{
  const old=get();await untilCalls(1);
  now+=60000;
  const newer=Array.from({length:20},get);await untilCalls(21);
  // Success would delete the old zero-miss cell; identity guard must preserve
  // the20 pending reservations which now occupy this same network key.
  releases[0]!({keyId:'1',userId:'2'});await old;
  const degraded=await get();expect(degraded.headers['x-ratelimit-limit']).toBe('60');expect(calls).toBe(21);
  for(const release of releases.slice(1))release(null);await Promise.all(newer);
  await get();expect(calls).toBe(21);
 }finally{for(const release of releases)release(null);await app.close();}
});
