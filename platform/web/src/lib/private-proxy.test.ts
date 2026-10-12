import {test} from 'node:test';import assert from 'node:assert/strict';
import {privateProxy,privateRoute} from './private-proxy';
test('bridge preserves empty Authorization to prevent credential-mode fallback and accepts safe account IDs',async()=>{
 assert.equal(privateRoute('/auth/users/9007199254740991/role','PUT'),true);assert.equal(privateRoute('/auth/users/9007199254740992/role','PUT'),false);
 let called=false;const result=await privateProxy(new Request('http://localhost/api/ops/editorial',{headers:{authorization:'',cookie:'session=opaque'}}),{fetcher:async(_input,init)=>{called=true;const h=new Headers(init?.headers);assert.equal(h.has('authorization'),true);assert.equal(h.get('authorization'),'');return new Response('{}',{status:401});}});assert.equal(called,true);assert.equal(result.status,401);
});
test('private bridge only permits exact owned endpoints and methods',async()=>{
 for(const [p,m]of [['/videos','GET'],['/auth/unknown','GET'],['/auth/google/callback','POST'],['/api/ops/workflows','POST'],['/auth/../up','GET'],['/feeds/u/nope.xml','GET']])assert.equal(privateRoute(p!,m!),false);
 let calls=0;const r=await privateProxy(new Request('http://localhost/videos'),{fetcher:async()=>{calls++;return new Response();}});assert.equal(r.status,404);assert.equal(calls,0);
});
test('bridge preserves cookie/csrf/origin only to configured API and never follows callback redirects',async()=>{
 let seen:RequestInit|undefined,url='';const h=new Headers({'location':'https://accounts.google.com/o/oauth2/v2/auth'});h.append('set-cookie','flow=abc; HttpOnly; Path=/');h.append('set-cookie','old=; Max-Age=0; Path=/');
 const r=await privateProxy(new Request('http://localhost:3100/auth/google?next=%2Fmy',{headers:{cookie:'session=opaque',origin:'http://localhost:3100','x-csrf-token':'csrf','x-forwarded-for':'203.0.113.10','x-forwarded-host':'evil.invalid'}}),{base:'http://127.0.0.1:4100/api/v1',fetcher:async(input,init)=>{url=String(input);seen=init;return new Response(null,{status:302,headers:h});}});
 assert.equal(url,'http://127.0.0.1:4100/auth/google?next=%2Fmy');assert.equal(seen?.redirect,'manual');assert.equal(seen?.cache,'no-store');const headers=new Headers(seen?.headers);assert.equal(headers.get('cookie'),'session=opaque');assert.equal(headers.get('origin'),'http://localhost:3100');assert.equal(headers.get('x-csrf-token'),'csrf');assert.equal(headers.has('x-forwarded-for'),false);assert.equal(headers.has('x-forwarded-host'),false);assert.equal(r.status,302);assert.equal(r.headers.getSetCookie().length,2);assert.equal(r.headers.get('cache-control'),'private, no-store');assert.equal(r.headers.has('access-control-allow-origin'),false);
});
test('bridge bounds mutation payloads and handles logout204 and provider failures without detail',async()=>{
 let calls=0;const fetcher:typeof fetch=async()=>{calls++;return new Response(null,{status:204});};
 const huge=await privateProxy(new Request('http://localhost/auth/me/follows',{method:'PUT',body:'x'.repeat(16385)}),{fetcher});assert.equal(huge.status,413);assert.equal(calls,0);
 const logout=await privateProxy(new Request('http://localhost/auth/logout',{method:'POST'}),{fetcher});assert.equal(logout.status,204);assert.equal(await logout.text(),'');
 const failure=await privateProxy(new Request('http://localhost/auth/me'),{fetcher:async()=>{throw new Error('secret provider body');}});assert.equal(failure.status,503);assert.deepEqual(await failure.json(),{error:{code:'AUTH_UNAVAILABLE'}});
});
test('private feed never accepts upstream cache/CORS policy or leaks URL in a Location rewrite',async()=>{
 const r=await privateProxy(new Request('http://localhost/feeds/u/'+'a'.repeat(43)+'.xml'),{fetcher:async()=>new Response('<rss/>',{headers:{'content-type':'application/rss+xml','cache-control':'public,max-age=300','access-control-allow-origin':'*'}})});
 assert.equal(r.headers.get('cache-control'),'private, no-store');assert.equal(r.headers.get('referrer-policy'),'no-referrer');assert.equal(r.headers.get('x-robots-tag'),'noindex');assert.equal(r.headers.has('access-control-allow-origin'),false);assert.equal(await r.text(),'<rss/>');
});
test('operator bridge forwards only fixed workflow endpoints, bearer and JSON unchanged',async()=>{
 for(const [p,m]of [['/api/ops/ingestion/history','GET'],['/api/ops/ingestion','GET'],['/api/ops/workflows/preview','POST'],['/api/ops/workflows/jobs/'+'a'.repeat(64),'GET']])assert.equal(privateRoute(p!,m!),true);
 for(const [p,m]of [['/api/ops/ingestion/history','POST'],['/api/ops/workflows/run','GET'],['/api/ops/workflows/execute','POST'],['/api/ops/anything','GET']])assert.equal(privateRoute(p!,m!),false);
 let captured:{url:string;headers:Headers;redirect:RequestRedirect|undefined}|undefined;
 const r=await privateProxy(new Request('http://localhost/api/ops/ingestion/history?workflow=ai.daily',{headers:{authorization:'Bearer fixture-operator-token'}}),{base:'http://127.0.0.1:4100/api/v1',fetcher:async(input,init)=>{captured={url:String(input),headers:new Headers(init?.headers),redirect:init?.redirect};return Response.json({rows:[]});}});
 assert.equal(r.status,200);assert.deepEqual(await r.json(),{rows:[]});assert.equal(captured?.url,'http://127.0.0.1:4100/api/ops/ingestion/history?workflow=ai.daily');assert.equal(captured?.headers.get('authorization'),'Bearer fixture-operator-token');assert.equal(captured?.redirect,'manual');assert.equal(r.headers.get('cache-control'),'private, no-store');
});
