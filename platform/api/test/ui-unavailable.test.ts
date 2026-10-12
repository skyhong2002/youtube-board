import Fastify from 'fastify';
import {createServer} from 'node:http';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {it,expect} from 'vitest';
import {registerUiProxy} from '../src/ui-proxy.js';
import {loadUnavailableAssets,unavailableResponder} from '../src/ui-unavailable.js';
const html=Buffer.from('<!doctype html><html><head><link rel="stylesheet" href="/errors/unavailable.css"></head><body><h1>資料暫時無法讀取</h1><a href="">重新讀取</a><a href="/">總覽</a></body></html>');
const css=Buffer.from('body{color:red}');
const security={assets:new Map<string,string>(),themeScript:'void 0',unavailableHtml:html,unavailableCss:css};

it('serves owned fallback for plain or HTML 5xx, broken streams and rejected scripts, preserving healthy output',async()=>{
  const ui=createServer((request,response)=>{
    if(request.url==='/channels/stream'){
      response.writeHead(200,{'Content-Type':'text/html'});response.write('<!doctype html><html><body>private partial');
      setTimeout(()=>response.destroy(),10);return;
    }
    if(request.url==='/channels/healthy'){response.writeHead(200,{'Content-Type':'text/html','Cache-Control':'public, s-maxage=60','x-youtube-board-public-render':'report'});response.end('<!doctype html><html><body>healthy</body></html>');return;}
    if(request.url==='/channels/injected'){response.writeHead(200,{'Content-Type':'text/html'});response.end('<html><body><script>privateFailure()</script></body></html>');return;}
    response.writeHead(request.url==='/channels/503'?503:500,{'Content-Type':request.url==='/channels/html'?'text/html':'text/plain','Cache-Control':'public, max-age=999','Set-Cookie':'private=value','ETag':'private-etag','Age':'999','Location':'https://private.example','Content-Security-Policy-Report-Only':'private-report'});
    response.end('private diagnostic and Internal Server Error');
  });
  await new Promise<void>(resolve=>ui.listen(0,'127.0.0.1',resolve));
  const address=ui.address();if(!address||typeof address==='string')throw Error('Missing port');
  const app=Fastify();await registerUiProxy(app,{origin:`http://127.0.0.1:${address.port}`,htmlSecurity:security});
  try{
    for(const path of ['/channels/plain','/channels/html','/channels/503','/channels/stream','/channels/injected']){
      const response=await app.inject(path);
      expect(response.statusCode).toBe(503);expect(response.body).toBe(html.toString());
      expect(response.headers['cache-control']).toBe('private, no-store, no-transform');
      expect(response.headers['content-security-policy']).toContain("script-src 'none'");
      expect(response.headers['content-security-policy']).not.toContain('unsafe-inline');
      for(const name of ['set-cookie','etag','age','location','content-security-policy-report-only'])expect(response.headers[name]).toBeUndefined();
    }
    const head=await app.inject({method:'HEAD',url:'/channels/plain'});expect(head.statusCode).toBe(503);expect(head.body).toBe('');
    const flight=await app.inject({url:'/channels/plain',headers:{rsc:'1'}});expect(flight.statusCode).toBe(503);expect(flight.body).not.toContain('<html>');
    for(const url of ['/robots.txt','/manifest.webmanifest','/brand/generation.json','/feeds/videos.xml','/feeds/opaque','/media/opaque','/_next/static/a.js','/image.jpg','/image.webp','/image.avif','/font.ttf','/font.woff2','/bundle.js.map']){
      const response=await app.inject(url);expect(response.statusCode).toBe(503);expect(response.headers['content-type']).toBe('text/plain; charset=utf-8');expect(response.body).not.toContain('<html>');expect(response.body).not.toContain('private diagnostic');
    }
    for(const url of ['/channels?q=x.css','/groups/topic.json','/ai/days/2026-10-12/topic.txt']){
      const response=await app.inject(url);expect(response.statusCode).toBe(503);expect(response.headers['content-type']).toBe('text/html; charset=utf-8');expect(response.body).toBe(html.toString());
    }
    const healthy=await app.inject('/channels/healthy');expect(healthy.statusCode).toBe(200);expect(healthy.body).toContain('healthy');expect(healthy.headers['cache-control']).toContain('public');
    // No Next process is needed for either the owned CSS or network-failure page.
    await new Promise<void>(resolve=>ui.close(()=>resolve()));
    const offlineCss=await app.inject('/errors/unavailable.css');expect(offlineCss.statusCode).toBe(200);expect(offlineCss.body).toBe(css.toString());
    const offline=await app.inject('/channels/plain');expect(offline.statusCode).toBe(503);expect(offline.body).toBe(html.toString());
  }finally{await app.close();if(ui.listening)await new Promise<void>(resolve=>ui.close(()=>resolve()));}
});
it('validates bounded trusted fallback assets before serving',async()=>{
  expect(()=>unavailableResponder({...security,unavailableHtml:Buffer.alloc(0)})).toThrow('cap');
  expect(()=>unavailableResponder({...security,unavailableHtml:Buffer.alloc(65537)})).toThrow('cap');
  expect(()=>unavailableResponder({...security,unavailableHtml:Buffer.from('<script>alert(1)</script>')})).toThrow();
  expect(()=>unavailableResponder({...security,unavailableHtml:Buffer.from('<script>/* unused static fallback */</script>')})).toThrow('scriptless');
  expect(()=>unavailableResponder({...security,unavailableCss:Buffer.alloc(65537)})).toThrow('cap');
});
it('loads fixed packaged files with bounded reads',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'youtube-unavailable-'));
  try{
    await writeFile(join(directory,'unavailable.html'),html);await writeFile(join(directory,'unavailable.css'),css);
    expect(await loadUnavailableAssets(pathToFileURL(directory+'/'))).toEqual({unavailableHtml:html,unavailableCss:css});
    await writeFile(join(directory,'unavailable.css'),Buffer.alloc(65537));
    await expect(loadUnavailableAssets(pathToFileURL(directory+'/'))).rejects.toThrow('size');
  }finally{await rm(directory,{recursive:true,force:true});}
});
