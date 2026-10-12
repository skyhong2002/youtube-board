import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {NextRequest} from 'next/server';
import {proxy} from '../proxy';
import {PUBLIC_RENDER_HEADER,THEME_SCRIPT} from '../../../shared/public-render-contract';
const origin='http://localhost:3100';
const call=(path:string,init:{method?:string;headers?:Record<string,string>}={})=>proxy(new NextRequest(origin+path,init));
const spoofed={'x-nonce':'attacker-controlled','content-security-policy':"script-src 'nonce-attacker'",'content-security-policy-report-only':"script-src 'unsafe-inline'",[PUBLIC_RENDER_HEADER]:'report','x-forwarded-host':'evil.test'};
test('HTML CSP is deterministic, nonce-free and never allows inline script; spoofed request headers are dropped',()=>{
 const a=call('/keywords/traffic/videos',{headers:spoofed}),b=call('/keywords/traffic/videos',{headers:spoofed});
 const policy=a.headers.get('content-security-policy')!,report=a.headers.get('content-security-policy-report-only')!;
 assert.equal(policy,b.headers.get('content-security-policy'));assert.equal(report,b.headers.get('content-security-policy-report-only'));
 for(const value of [policy,report]){assert.doesNotMatch(value,/nonce-/);assert.doesNotMatch(value.match(/script-src[^;]*/)?.[0]??'',/unsafe-inline/);assert.match(value,/object-src 'none'/);assert.match(value,/frame-ancestors 'self'/);assert.match(value,/form-action 'self'/);assert.match(value,/base-uri 'self'/);}
 // The enforced fallback must not restrict scripts (the gateway owns script-src).
 assert.doesNotMatch(policy,/script-src|default-src/);
 const hash=createHash('sha256').update(THEME_SCRIPT).digest('base64');
 assert.match(report,new RegExp(`script-src 'self' 'sha256-${hash.replace(/[+/=]/g,c=>'\\'+c)}' 'strict-dynamic'`));assert.doesNotMatch(report.match(/script-src[^;]*/)![0],/unsafe-inline/);
 for(const name of ['x-nonce','content-security-policy','content-security-policy-report-only',PUBLIC_RENDER_HEADER])assert.equal(a.headers.get('x-middleware-request-'+name),null,name);
 assert.doesNotMatch(a.headers.get('x-middleware-override-headers')??'',/x-nonce|content-security-policy|x-youtube-board-public-render/);
});
test('image optimization does not inherit HTML CSP, eligibility or no-store policy',()=>{
 const request=new NextRequest(origin+'/_next/image?'+new URLSearchParams({url:'https://i.ytimg.com/vi/AbCdEfGh123/mqdefault.jpg',w:'96',q:'75'}));const response=proxy(request);assert.equal(response.headers.get('content-security-policy'),null);assert.equal(response.headers.get(PUBLIC_RENDER_HEADER),null);assert.equal(response.headers.get('cache-control'),null);
});
test('canonical query-free public routes are marked eligible and keep Next ISR cache headers',()=>{
 for(const [path,route,rewrite] of [['/keywords/traffic/videos','report',null],['/videos','report',null],['/channels/12','report',null],['/live/current','report',null],['/','home',origin+'/render-isr/home/current'],['/events','events',origin+'/render-isr/events/current'],['/events/0d4c9e8a-1b2c-4d5e-8f90-123456789abc','event',null]] as const){
  const response=call(path);assert.equal(response.headers.get(PUBLIC_RENDER_HEADER),route,path);assert.equal(response.headers.get('cache-control'),null,path);assert.equal(response.headers.get('x-middleware-rewrite'),rewrite,path);
 }
 assert.equal(call('/keywords/traffic/videos',{method:'HEAD'}).headers.get(PUBLIC_RENDER_HEADER),'report');
});
test('query variants rewrite to dynamic routes with the original path and query, never eligible',()=>{
 const cases:[string,string|null][]=[
  ['/keywords/traffic/videos?days=7&q=%E4%BA%A4',origin+'/render-filtered/report/keywords/traffic/videos?days=7&q=%E4%BA%A4'],
  ['/keywords/%E4%BA%A4%E9%80%9A/videos?days=7',origin+'/render-filtered/report/keywords/%E4%BA%A4%E9%80%9A/videos?days=7'],
  ['/ai/days/12/events?event=x',origin+'/render-filtered/report/ai/days/12/events?event=x'],
  ['/?utm_source=x',origin+'/render-isr/home/current?utm_source=x'],
  ['/events?q=a&page=2',null],
  ['/channels?sort=x&_rsc=abc',origin+'/render-filtered/report/channels?sort=x&_rsc=abc'],
  ['/events?q=a&_rsc=abc',null],
  // Event detail has no query semantics: same ISR page, never the report filter route.
  ['/events/0d4c9e8a-1b2c-4d5e-8f90-123456789abc?utm=x',null],
 ];
 for(const [path,rewrite] of cases){const response=call(path,{headers:{[PUBLIC_RENDER_HEADER]:'report'}});assert.equal(response.headers.get('x-middleware-rewrite'),rewrite,path);assert.equal(response.headers.get(PUBLIC_RENDER_HEADER),null,path);assert.equal(response.headers.get('cache-control'),'private, no-store',path);}
});
test('_rsc alone keeps the canonical route tree but is never shared-cache eligible',()=>{
 // Real Next strips _rsc before the proxy runs; these cover the unnormalized case.
 const cases:[string,string|null][]=[
  ['/channels?_rsc=abc',null],
  ['/keywords/%E4%BA%A4/videos?_rsc=abc',null],
  ['/?_rsc=abc',origin+'/render-isr/home/current?_rsc=abc'],
  ['/events?_rsc=abc',origin+'/render-isr/events/current?_rsc=abc'],
  ['/events/0d4c9e8a-1b2c-4d5e-8f90-123456789abc?_rsc=abc',null],
 ];
 for(const [path,rewrite] of cases){const response=call(path,{headers:{[PUBLIC_RENDER_HEADER]:'report'}});assert.equal(response.headers.get('x-middleware-rewrite'),rewrite,path);assert.equal(response.headers.get(PUBLIC_RENDER_HEADER),null,path);assert.equal(response.headers.get('cache-control'),'private, no-store',path);}
});
test('private, account and query-dependent routes stay private no-store even with a spoofed marker',()=>{
 for(const path of ['/my','/my/following','/login?next=/my','/boards','/boards/view?q=a','/manage/users','/manage/editorial','/compare/titles?left=AbC_123xYz9','/compare/titles','/events/not-a-uuid','/events/0D4C9E8A-1B2C-4D5E-8F90-123456789ABC','/about','/not-a-report']){
  const response=call(path,{headers:{[PUBLIC_RENDER_HEADER]:'report'}});assert.equal(response.headers.get(PUBLIC_RENDER_HEADER),null,path);assert.equal(response.headers.get('cache-control'),'private, no-store',path);assert.equal(response.headers.get('x-middleware-rewrite'),null,path);
 }
 assert.equal(call('/videos',{method:'POST'}).headers.get(PUBLIC_RENDER_HEADER),null);
});
test('internal render targets are not directly reachable',()=>{
 for(const path of ['/render-filtered/report/videos','/render-filtered/report/videos?q=a','/render-isr/home/current','/render-isr/events/current','/Render-ISR/home/current','/render%2Disr/home/current','/render-filtered']){
  const response=call(path);assert.equal(response.status,404,path);assert.equal(response.headers.get('x-middleware-rewrite'),null,path);assert.equal(response.headers.get(PUBLIC_RENDER_HEADER),null,path);
 }
 assert.equal(call('/render-isrx').status,200);
});
test('legacy redirects and request validation run before any rewrite',()=>{
 const legacy=call('/live.php?x=1');assert.equal(legacy.status,308);assert.equal(new URL(legacy.headers.get('location')!).pathname+new URL(legacy.headers.get('location')!).search,'/live/current?x=1');assert.equal(legacy.headers.get('x-middleware-rewrite'),null);assert.equal(legacy.headers.get(PUBLIC_RENDER_HEADER),null);
 assert.equal(call('/ch/12/videos').status,308);
 const invalid=call('/videos?limit=0');assert.equal(invalid.status,400);assert.equal(invalid.headers.get('x-middleware-rewrite'),null);assert.equal(invalid.headers.get('cache-control'),'no-store');
});
