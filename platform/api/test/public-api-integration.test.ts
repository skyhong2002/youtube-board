import {it,expect} from 'vitest';
import Fastify from 'fastify';
import {buildApp} from '../src/app.js';
import {registerUiProxy} from '../src/ui-proxy.js';
import {DataSourceUnavailable} from '../src/db/client.js';
it('public documentation/status route exactly while private namespaces remain gateway-owned',async()=>{
 const upstream=Fastify();upstream.get('/api',async(req,reply)=>reply.header('x-youtube-board-public-render','api').header('Cache-Control','s-maxage=3600').type('text/html').send('<html><body>API docs '+JSON.stringify({key:req.headers['x-api-key']??null,auth:req.headers.authorization??null,cookie:req.headers.cookie??null})+'</body></html>'));
 upstream.get('/api/status',async(_req,reply)=>reply.type('text/html').send('<html><body>API status</body></html>'));
 await upstream.listen({port:0,host:'127.0.0.1'});const addr=upstream.server.address();if(!addr||typeof addr==='string')throw Error('Missing port');
 let reads=0;const app=buildApp({dataset:'fixture',reader:{rows:async()=>{reads++;return[];},close:async()=>{}}});await registerUiProxy(app,{origin:`http://127.0.0.1:${addr.port}`,htmlSecurity:{assets:new Map(),themeScript:'void 0'}});
 try{
  const spec=await app.inject('/api/v1/openapi.json');expect(spec.statusCode).toBe(200);expect(spec.json().openapi).toBe('3.1.0');expect(spec.headers['cache-control']).toContain('s-maxage=3600');
  const docs=await app.inject({url:'/api',headers:{accept:'text/html'}});expect(docs.statusCode).toBe(200);expect(docs.headers['cache-control']).toContain('s-maxage=3600');expect(docs.headers['content-security-policy']).toContain("script-src 'none'");
  const privateDocs=await app.inject({url:'/api',headers:{accept:'text/html','x-api-key':'private',authorization:'Bearer private',cookie:'private=1'}});expect(privateDocs.body).toContain('"key":null');expect(privateDocs.body).toContain('"auth":null');expect(privateDocs.body).toContain('"cookie":null');expect(privateDocs.headers['cache-control']).toContain('private, no-store');
  const status=await app.inject({url:'/api/status',headers:{accept:'application/json'}});expect(status.statusCode).toBe(200);expect(status.json()).toMatchObject({scope:'api_availability',status:'ok'});expect(status.headers.vary).toContain('Accept');expect(status.headers['cache-control']).toBe('no-store');expect(reads).toBe(1);
  const html=await app.inject({url:'/api/status',headers:{accept:'text/html'}});expect(html.headers['content-type']).toContain('text/html');expect(html.headers.vary).toContain('Accept');expect(html.headers['cache-control']).toContain('no-store');expect(reads).toBe(1);
  const excludedJson=await app.inject({url:'/api/status',headers:{accept:'application/json;q=0,text/html;q=1'}});expect(excludedJson.headers['content-type']).toContain('text/html');expect(reads).toBe(1);
  const unacceptable=await app.inject({url:'/api/status',headers:{accept:'application/json;q=0,text/html;q=0'}});expect(unacceptable.statusCode).toBe(406);expect(reads).toBe(1);
  const rsc=await app.inject({url:'/api/status',headers:{accept:'text/x-component',rsc:'1'}});expect(rsc.body).toContain('API status');expect(rsc.headers['cache-control']).toContain('no-store');expect(reads).toBe(1);
  const head=await app.inject({method:'HEAD',url:'/api/status',headers:{accept:'application/json'}});expect(head.statusCode).toBe(200);expect(head.body).toBe('');expect(head.headers['cache-control']).toBe('no-store');expect(reads).toBe(2);
  for(const path of ['/api/ops/editorial','/api/auth/me','/api/status/private','/%61pi','/api/unknown'])expect((await app.inject({url:path,headers:{accept:'text/html'}})).statusCode).toBe(404);
 }finally{await app.close();await upstream.close();}
});
it('degraded APIstatus exposes public availability only',async()=>{
 const app=buildApp({reader:{rows:async()=>{throw new DataSourceUnavailable();},close:async()=>{}}});
 try{const r=await app.inject({url:'/api/status',headers:{accept:'application/json'}});expect(r.statusCode).toBe(503);expect(r.json()).toMatchObject({status:'degraded',services:[{id:'reports',status:'unavailable'}]});expect(r.body).not.toMatch(/database|password|provider|mysql|SELECT|youtube_board/i);}finally{await app.close();}
});
