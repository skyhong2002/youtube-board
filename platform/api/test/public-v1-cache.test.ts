import Fastify from 'fastify';
import {it,expect} from 'vitest';
import {registerPublicV1Cache} from '../src/public-v1-cache.js';

it('shares successful v1 JSON reads by route TTL without requiring a catalog, key store or rate limiter',async()=>{
 const app=Fastify();registerPublicV1Cache(app);
 for(const path of ['/api/v1/videos','/api/v1/live/current','/api/v1/groups/:name/live','/api/v1/keywords','/api/v1/vocabulary','/api/v1/keywords/:term/videos'])app.get(path,async(_request,reply)=>reply.header('Cache-Control','public, max-age=15').send({data:[]}));
 try{
  for(const [url,ttl] of [['/api/v1/videos?q=live',60],['/api/v1/live/current',30],['/api/v1/groups/news/live',30],['/api/v1/keywords',300],['/api/v1/vocabulary?q=ai',300],['/api/v1/keywords/%2Flive/videos',60]] as const){
   for(const method of ['GET','HEAD'] as const){const response=await app.inject({method,url});expect(response.statusCode).toBe(200);expect(response.headers['cache-control']).toBe(`public, max-age=0, s-maxage=${ttl}, stale-while-revalidate=${ttl*2}`);expect(response.headers['x-ratelimit-limit']).toBeUndefined();if(method==='HEAD')expect(response.body).toBe('');}
  }
 }finally{await app.close();}
});
it('keeps credentials, Flight, cookies, wildcard Vary, errors and non-JSON/mutations unshared',async()=>{
 const app=Fastify();registerPublicV1Cache(app);
 app.get('/api/v1/videos',async(_request,reply)=>reply.header('Vary','accept-encoding, cookie').send({data:[]}));
 app.get('/api/v1/cookie',async(_request,reply)=>reply.header('Set-Cookie','session=opaque').send({data:[]}));
 app.get('/api/v1/wildcard',async(_request,reply)=>reply.header('Vary','*').send({data:[]}));
 app.get('/api/v1/status',async()=>({readOnly:true}));
 app.get('/api/v1/html',async(_request,reply)=>reply.type('text/html').send('<h1>HTML</h1>'));
 app.get('/api/v1/flight',async(_request,reply)=>reply.type('text/x-component').send('flight'));
 for(const status of [301,400,401,404,429,500,503])app.get(`/api/v1/error${status}`,async(_request,reply)=>reply.header('Cache-Control','public, max-age=999').code(status).send({error:'unavailable'}));
 app.post('/api/v1/mutation',async()=>({data:[]}));
 try{
  for(const headers of [{'x-api-key':'opaque'},{authorization:'Bearer opaque'},{cookie:'session=opaque'},{rsc:'1'},{'x-api-key':''},{rsc:''}] as Record<string,string>[]){
   const response=await app.inject({url:'/api/v1/videos',headers});expect(response.headers['cache-control']).toBe('private, no-store');
   const vary=String(response.headers.vary).toLowerCase().split(',').map(v=>v.trim());for(const name of ['accept','accept-encoding','x-api-key','authorization','cookie','rsc'])expect(vary.filter(v=>v===name)).toHaveLength(1);
  }
  expect((await app.inject('/api/v1/cookie')).headers['cache-control']).toBe('private, no-store');
  for(const path of ['wildcard','status','html','flight',...[301,400,401,404,429,500,503].map(status=>`error${status}`),'unknown'])expect((await app.inject('/api/v1/'+path)).headers['cache-control']).toBe('no-store');
  expect((await app.inject('/api/v1/wildcard')).headers.vary).toBe('*');
  expect((await app.inject({method:'POST',url:'/api/v1/mutation'})).headers['cache-control']).toBe('no-store');
 }finally{await app.close();}
});
it('does not change legacy, auth, operator, private feed, HTML docs or preflight policies',async()=>{
 const app=Fastify();registerPublicV1Cache(app);
 for(const path of ['/api/live.php','/auth/me','/api/ops/editorial','/feeds/u/opaque.xml','/api','/api/status','/api/v10/videos'])app.get(path,async(_request,reply)=>reply.header('Cache-Control','private, max-age=7').header('Vary','Origin').send({data:[]}));
 app.options('/api/v1/videos',async(_request,reply)=>reply.header('Cache-Control','public, max-age=600').code(204).send());
 try{
  for(const url of ['/api/live.php','/auth/me','/api/ops/editorial','/feeds/u/opaque.xml','/api','/api/status','/api/v10/videos']){const response=await app.inject(url);expect(response.headers['cache-control']).toBe('private, max-age=7');expect(response.headers.vary).toBe('Origin');}
  expect((await app.inject({method:'OPTIONS',url:'/api/v1/videos'})).headers['cache-control']).toBe('public, max-age=600');
  expect((await app.inject({method:'OPTIONS',url:'/api/v1/unknown'})).headers['cache-control']).toBe('no-store');
 }finally{await app.close();}
});
