import Fastify from 'fastify';
import {it,expect,vi} from 'vitest';
import {registerUiProxy} from '../src/ui-proxy.js';
import {publicCacheDiagnostics,type PublicCacheDiagnosticSnapshot} from '../src/public-cache-diagnostics.js';

async function upstream(){
 const ui=Fastify();ui.get('/*',async(request,reply)=>{
  reply.header('x-youtube-board-public-render','report').header('Cache-Control','s-maxage=60, stale-while-revalidate=60');
  if(request.url.includes('stale'))reply.header('x-nextjs-cache','STALE');
  if(request.url==='/channels/stale-expired')reply.header('Age','120');
  return reply.type('text/html').send('<!doctype html><html><body>public</body></html>');
 });
 await ui.listen({host:'127.0.0.1',port:0});const address=ui.server.address();if(!address||typeof address==='string')throw Error('Missing port');
 return {ui,origin:`http://127.0.0.1:${address.port}`};
}
const htmlSecurity={assets:new Map<string,string>(),themeScript:'void 0'};
it('observes healthy/private/legal and expired STALE without changing cache authorization or logging request fields',async()=>{
 const {ui,origin}=await upstream();let now=0;const logs:PublicCacheDiagnosticSnapshot[]=[];
 const diagnostics=publicCacheDiagnostics({now:()=>now,intervalMs:1000,emit:record=>logs.push(record)});
 const app=Fastify({logger:false});await registerUiProxy(app,{origin,htmlSecurity,cacheDiagnostics:diagnostics});
 try{
  expect((await app.inject('/channels')).headers['cache-control']).toContain('s-maxage=60');
  expect((await app.inject({url:'/channels',headers:{cookie:'session=SECRET'}})).headers['cache-control']).toBe('private, no-store, no-transform');
  const keyed=await app.inject({url:'/channels',headers:{'x-api-key':'SECRET'}});expect(keyed.headers['cache-control']).toBe('private, no-store, no-transform');expect(keyed.headers.vary).toContain('X-Api-Key');
  expect((await app.inject('/channels/stale')).headers['cache-control']).toContain('s-maxage=1, stale-while-revalidate=59');
  expect((await app.inject('/channels/stale-expired')).headers['cache-control']).toBe('private, no-store, no-transform');
  now=1000;expect((await app.inject('/channels?private=SECRET')).headers['cache-control']).toBe('private, no-store, no-transform');
  expect(diagnostics.snapshot()).toMatchObject({privateFraction:4/6,total:{total:6,shareable:2,private:4,stale:2,staleShareable:1,unexplainedPrivate:0,decisionMismatch:0,reasons:{'ttl-null':3,'private-request':2,'upstream-policy-null':1,'marker-mismatch':1}}});
  expect(logs).toHaveLength(2);expect(JSON.stringify(logs)).not.toMatch(/SECRET|\/channels|session|private=/);
 }finally{await app.close();await ui.close();}
});
it('default sink writes only aggregate JSON with logger:false and drops output under stderr backpressure',async()=>{
 const {ui,origin}=await upstream();const apps:ReturnType<typeof Fastify>[]=[];
 const write=vi.spyOn(process.stderr,'write').mockImplementation(()=>true);
 const drain=vi.spyOn(process.stderr,'writableNeedDrain','get').mockReturnValue(true);
 try{
  const blocked=Fastify({logger:false});apps.push(blocked);await registerUiProxy(blocked,{origin,htmlSecurity});await blocked.inject('/channels');expect(write).not.toHaveBeenCalled();
  drain.mockReturnValue(false);
  const visible=Fastify({logger:false});apps.push(visible);await registerUiProxy(visible,{origin,htmlSecurity});await visible.inject('/channels');await visible.inject('/channels/stale');
  expect(write).toHaveBeenCalledTimes(1);const line=write.mock.calls[0]![0];expect(typeof line).toBe('string');
  expect(JSON.parse(String(line))).toMatchObject({code:'PUBLIC_HTML_CACHE_DECISIONS',total:{total:1,shareable:1}});expect(String(line).endsWith('\n')).toBe(true);
 }finally{write.mockRestore();drain.mockRestore();for(const app of apps)await app.close();await ui.close();}
});
