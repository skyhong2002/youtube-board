import Fastify from 'fastify';
import { it, expect } from 'vitest';
import { registerUiProxy } from '../src/ui-proxy.js';
import {createHash} from 'node:crypto';
import {gunzipSync,brotliDecompressSync} from 'node:zlib';
import {Readable} from 'node:stream';
import {setTimeout as delay} from 'node:timers/promises';
import {readFileSync} from 'node:fs';
it('serves API locally and forwards UI/assets without forwarding ops credentials', async () => {
  const ui = Fastify(); ui.get('/page', request => ({ auth: request.headers.authorization ?? null, cookie: request.headers.cookie ?? null, render: request.headers['x-youtube-board-render'] ?? null }));
  ui.get('/ops/ingestion', request => ({ console: true, auth: request.headers.authorization ?? null }));
  ui.get('/auth/unknown',()=>({unexpectedPrivateForward:true}));
  ui.get('/feeds/u/unknown.xml',()=>({unexpectedPrivateForward:true}));
  await ui.listen({ port: 0, host: '127.0.0.1' });
  const address = ui.server.address(); if (!address || typeof address === 'string') throw new Error('Missing port');
  const app = Fastify(); app.get('/api/v1/test', () => ({ local: true }));
  await registerUiProxy(app, { origin: `http://127.0.0.1:${address.port}` });
  expect((await app.inject('/api/v1/test')).json()).toEqual({ local: true });
  expect((await app.inject('/api/unknown')).statusCode).toBe(404);
  expect((await app.inject('/ops/unknown')).statusCode).toBe(404);
  for(const path of ['/auth/unknown','/%61uth/unknown','/feeds/u/unknown.xml','/feeds%2Fu%2Funknown.xml'])expect((await app.inject(path)).statusCode).toBe(404);
  expect((await app.inject({ url: '/ops/ingestion', headers: { authorization: 'Bearer secret' } })).json()).toEqual({ console: true, auth: null });
  expect((await app.inject({ method: 'POST', url: '/ops/ingestion' })).statusCode).toBe(405);
  expect((await app.inject('/ops/ingestion/run')).statusCode).toBe(404);
  expect((await app.inject({ method: 'POST', url: '/page', headers: { 'next-action': 'test' } })).statusCode).toBe(405);
  for (const path of ['/%6fps/ingestion/run', '/ops%2Fingestion%2Frun', '/%252e%252e/ops']) expect([400, 404]).toContain((await app.inject(path)).statusCode);
  expect((await app.inject({ method: 'HEAD', url: '/ops/ingestion' })).statusCode).toBe(200);
  expect((await app.inject({ url: '/page', headers: { authorization: 'Bearer secret', cookie: 'session=secret', 'x-youtube-board-render':'home' } })).json()).toEqual({ auth: null, cookie: null, render:null });
  await app.close(); await ui.close();
});

it('publishes atomic hash CSP HTML but keeps credentials, Flight, Set-Cookie, errors and query variants private',async()=>{
  const ui=Fastify();
  const themeScript='window.themeReady=true';
  const scriptPath='/_next/static/chunks/app.js';
  const hash='sha256-'+createHash('sha256').update('window.appReady=true').digest('base64');
  const html=`<!doctype html><html><head><script>${themeScript}</script><script src="${scriptPath}" async></script></head><body>public</body></html>`;
  ui.get('/*',(request,reply)=>{
    reply.header('x-youtube-board-public-render','report').header('Cache-Control','public, max-age=0, s-maxage=60, stale-while-revalidate=60').header('Vary','RSC, Accept-Encoding');
    if(request.url==='/channels/cookie')reply.header('Set-Cookie','sample=value; HttpOnly');
    if(request.url==='/channels/error')reply.code(500);
    if(request.url==='/channels/wildcard')reply.header('Vary','*');
    if(request.url==='/channels/private')reply.header('Cache-Control','private, no-store');
    if(request.url.startsWith('/channels/stale'))reply.header('x-nextjs-cache','STALE');
    if(request.url==='/channels/stale-aged')reply.header('Age','100');
    if(request.url==='/channels/stale-expired')reply.header('Age','120');
    if(request.url==='/channels/stale-private')reply.header('Cache-Control','private, s-maxage=60, stale-while-revalidate=60');
    if(request.url==='/channels/stale-revalidate')reply.header('Cache-Control','s-maxage=60, stale-while-revalidate=60, must-revalidate');
    if(request.url==='/channels/stale-missing-marker')reply.removeHeader('x-youtube-board-public-render');
    if(request.url==='/channels/stale-cookie')reply.header('Set-Cookie','sample=value');
    if(request.url==='/channels/stale-wildcard')reply.header('Vary','*');
    if(request.url==='/channels/failed-boundary')return reply.type('text/html').send(readFileSync(new URL('./fixtures/react-production-failed-boundary.html',import.meta.url)));
    if(request.headers.rsc)return reply.type('text/x-component').send('flight');
    if(request.url==='/channels/burst')return reply.type('text/html').send(Readable.from((async function*(){yield html.slice(0,20);await delay(40);yield html.slice(20);})()));
    return reply.type('text/html').send(request.url==='/channels/injected'?html.replace('</body>','<script>alert(1)</script></body>'):html);
  });
  await ui.listen({port:0,host:'127.0.0.1'});
  const addr=ui.server.address();if(!addr||typeof addr==='string')throw new Error('No port');
  const app=Fastify();await registerUiProxy(app,{origin:`http://127.0.0.1:${addr.port}`,htmlSecurity:{themeScript,assets:new Map([[scriptPath,hash]])}});
  try {
    const publicPage=await app.inject('/channels');
    expect(publicPage.statusCode).toBe(200);
    expect(publicPage.headers['cache-control']).toBe('public, max-age=0, s-maxage=60, stale-while-revalidate=60, no-transform');
    expect(publicPage.headers['content-security-policy']).toContain("'strict-dynamic'");
    expect(publicPage.headers['content-security-policy']).toContain(hash);
    expect(publicPage.body).toContain(`integrity="${hash}"`);
    expect(publicPage.headers['x-youtube-board-public-render']).toBeUndefined();
    const failedBoundary=await app.inject('/channels/failed-boundary');
    expect(failedBoundary.statusCode).toBe(200);
    expect(failedBoundary.body).toContain('$RX(');
    expect(failedBoundary.headers['content-security-policy']).toContain("'strict-dynamic'");
    expect(failedBoundary.headers['cache-control']).toBe('private, no-store, no-transform');
    for(const url of ['/channels?sort=view','/my','/manage','/login','/channels/cookie','/channels/error','/channels/wildcard','/channels/private','/channels/stale-expired','/channels/stale-private','/channels/stale-revalidate','/channels/stale-missing-marker','/channels/stale-cookie','/channels/stale-wildcard','/channels/stale?q=1']) {
      const response=await app.inject(url);expect(response.headers['cache-control']).toBe('private, no-store, no-transform');
    }
    for(const headers of [{cookie:'session=value'},{authorization:'Bearer value'},{'x-api-key':''},{rsc:'1'},{'next-router-prefetch':'1'}]) {
      const response=await app.inject({url:'/channels',headers});expect(response.headers['cache-control']).toBe('private, no-store, no-transform');
    }
    const denied=await app.inject('/channels/injected');
    expect(denied.statusCode).toBe(503);expect(denied.body).not.toContain('alert(1)');
    expect(denied.headers['cache-control']).toBe('private, no-store, no-transform');
    expect((await app.inject('/render-filtered/channels')).statusCode).toBe(404);
    expect((await app.inject('/%63hannels?limit=5')).statusCode).toBe(404);
    expect((await app.inject('/render-isr/home/current')).statusCode).toBe(404);
    const compressed=await app.inject({url:'/channels',headers:{'accept-encoding':'br, gzip;q=0.8'}});
    expect(compressed.headers['content-encoding']).toBe('br');
    expect(brotliDecompressSync(compressed.rawPayload).toString()).toBe(publicPage.body);
    expect(compressed.headers['content-security-policy']).toBe(publicPage.headers['content-security-policy']);
    expect(compressed.headers['cache-control']).toContain('no-transform');expect(compressed.headers.vary).toContain('Accept-Encoding');
    const gzipped=await app.inject({url:'/channels',headers:{'accept-encoding':'br;q=0.3, gzip;q=0.8'}});
    expect(gzipped.headers['content-encoding']).toBe('gzip');expect(gunzipSync(gzipped.rawPayload).toString()).toBe(publicPage.body);
    const refused=await app.inject({url:'/channels',headers:{'accept-encoding':'*;q=0'}});expect(refused.statusCode).toBe(406);expect(refused.body).toBe('');expect(refused.headers['cache-control']).toContain('private, no-store');
    expect((await app.inject({url:'/channels',headers:{'accept-encoding':'gzip;q=0'}})).headers['content-encoding']).toBeUndefined();
    for(const [url,stale]of [['/channels/stale',59],['/channels/stale-aged',19]] as const){
      const response=await app.inject({url,headers:{'accept-encoding':'br'}});
      expect(response.headers['cache-control']).toBe(`public, max-age=0, s-maxage=1, stale-while-revalidate=${stale}, no-transform`);
      expect(response.headers.age).toBeUndefined();expect(response.headers['content-security-policy']).toBe(publicPage.headers['content-security-policy']);expect(brotliDecompressSync(response.rawPayload).toString()).toBe(publicPage.body);
    }
    for(const headers of [{cookie:'session=value'},{authorization:'Bearer value'},{'x-api-key':'private'},{rsc:'1'},{'next-router-prefetch':'1'}])expect((await app.inject({url:'/channels/stale',headers})).headers['cache-control']).toBe('private, no-store, no-transform');
    const burst=await Promise.all(Array.from({length:10},()=>app.inject({url:'/channels/burst',headers:{'accept-encoding':'br'}})));
    expect(burst.every(response=>response.statusCode===200)).toBe(true);
    expect(burst.every(response=>brotliDecompressSync(response.rawPayload).toString()===publicPage.body)).toBe(true);
  }finally {await app.close();await ui.close();}
});
