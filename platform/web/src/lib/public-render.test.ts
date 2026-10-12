import {test} from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {publicRenderDecision,queryVariantRobots,withoutTransportParams,ISR_HOME_PATH,ISR_EVENTS_PATH,FILTERED_REPORT_PREFIX} from './public-render';
import {PUBLIC_DATA_REVALIDATE,PublicDataError,deterministicPartial,publicApiUrl,publicDataClass,readPublicResponse,requireSuccess} from './public-data';
import {tagEvidenceRenderable} from './evidence';
import {INTERNAL_RENDER_HEADER,PUBLIC_RENDER_REVALIDATE_SECONDS,REPORT_FAMILIES,THEME_SCRIPT,internalRenderRewrites,isInternalRenderPath} from '../../../shared/public-render-contract';
import {resolveRoute} from './routes';
const decide=(path:string,method?:string)=>publicRenderDecision(new URL(path,'http://local'),method);
const source=(file:string)=>{for(const root of [process.cwd(),join(process.cwd(),'web'),join(process.cwd(),'platform/web')]){const path=join(root,file);if(existsSync(path))return readFileSync(path,'utf8');}throw new Error('missing '+file);};
test('every real query variant gets X-Robots-Tag noindex, including pages that ignore the query',()=>{
 const robots=(path:string)=>queryVariantRobots(new URL(path,'http://local'));
 for(const path of ['/?a=1','/events/9b2e3c1a-0000-4000-8000-000000000001?page=2','/videos?q=a','/events?page=2','/channels?sort=x&_rsc=abc'])assert.equal(robots(path),'noindex, follow',path);
 for(const path of ['/','/videos','/channels?_rsc=abc'])assert.equal(robots(path),null,path);
 assert.match(source('src/proxy.ts'),/queryVariantRobots\(request\.nextUrl\)[\s\S]*X-Robots-Tag/);
});
test('route decisions: canonical eligible, every query variant dynamic, internals blocked',()=>{
 assert.deepEqual(decide('/'),{kind:'render',target:'home',eligible:'home'});
 assert.deepEqual(decide('/?a=1'),{kind:'render',target:'home',eligible:null});
 assert.deepEqual(decide('/events'),{kind:'render',target:'events',eligible:'events'});
 assert.deepEqual(decide('/events?page=2'),{kind:'render',target:null,eligible:null});
 assert.deepEqual(decide('/mayor/cities/taipei/people/%E7%8E%8B'),{kind:'render',target:null,eligible:'report'});
 assert.deepEqual(decide('/tags/8/videos?or=1,2'),{kind:'render',target:'filtered',eligible:null});
 assert.deepEqual(decide('/videos','POST'),{kind:'render',target:null,eligible:null});
 // Unknown, malformed or non-report paths are never eligible.
 for(const path of ['/videos/','/keywords/%E4%ZZ/videos','/arbitrary','/feeds/videos.xml','/boards','/my/saved','/compare/titles'])assert.equal((decide(path) as {eligible?:unknown}).eligible??null,null,path);
 for(const path of ['/render-isr','/render-isr/home/x','/RENDER-FILTERED/report/videos','/render%2Dfiltered/report/videos'])assert.equal(decide(path).kind,'blocked',path);
 assert.equal(isInternalRenderPath('/render-isr-extra'),false);assert.equal(isInternalRenderPath('/rendering'),false);
 assert.deepEqual(PUBLIC_RENDER_REVALIDATE_SECONDS,{home:60,events:60,event:60,report:60});
});
/** Replays next.config beforeFiles rewrites with the pinned Next router helpers
 * (filesystem.js getPathMatch options, matchHas, prepareDestination) on the raw request
 * path, after the proxy's request-header override has been applied. */
async function routed(path:string,header:string|null){
 const {getPathMatch}=await import('next/dist/shared/lib/router/utils/path-match.js');
 const {matchHas,prepareDestination}=await import('next/dist/shared/lib/router/utils/prepare-destination.js');
 const {modifyRouteRegex}=await import('next/dist/lib/redirect-status.js');
 const url=new URL(path,'http://127.0.0.1:38111'),query:Record<string,string>=Object.fromEntries(url.searchParams);
 const req={headers:header===null?{}:{[INTERNAL_RENDER_HEADER]:header}};
 for(const rule of internalRenderRewrites()){
  const params=getPathMatch(rule.source,{strict:true,removeUnnamedParams:true,regexModifier:(regex:string)=>modifyRouteRegex(regex)})(url.pathname);
  if(!params)continue;
  const has=matchHas(req as never,query,rule.has,[]);if(!has)continue;
  const {parsedDestination}=prepareDestination({appendParamsToQuery:true,destination:rule.destination,params:{...params,...has},query});
  // Relative destination: Next keeps it inside the same router pass (no protocol, no re-entry).
  assert.equal(parsedDestination.protocol??null,null);
  return {pathname:parsedDestination.pathname as string,query:parsedDestination.query as Record<string,unknown>};
 }
 return {pathname:url.pathname,query};
}
test('proxy targets resolve through Next rewrites to the right route tree with the original query',async()=>{
 const via=async(path:string)=>{const decision=decide(path);assert.equal(decision.kind,'render');return routed(path,(decision as {target:string|null}).target);};
 const cases:[string,string,Record<string,string>][]=[
  ['/',ISR_HOME_PATH,{}],
  ['/?utm=x',ISR_HOME_PATH,{utm:'x'}],
  ['/?_rsc=abc',ISR_HOME_PATH,{_rsc:'abc'}],
  ['/events',ISR_EVENTS_PATH,{}],
  ['/events?_rsc=abc',ISR_EVENTS_PATH,{_rsc:'abc'}],
  ['/events?q=a&_rsc=abc','/events',{q:'a',_rsc:'abc'}],
  ['/channels','/channels',{}],
  ['/channels?_rsc=abc','/channels',{_rsc:'abc'}],
  ['/channels?limit=5',FILTERED_REPORT_PREFIX+'/channels',{limit:'5'}],
  ['/channels?sort=x&_rsc=abc',FILTERED_REPORT_PREFIX+'/channels',{sort:'x',_rsc:'abc'}],
  ['/vocabulary?q=a',FILTERED_REPORT_PREFIX+'/vocabulary',{q:'a'}],
  ['/keywords/%E4%BA%A4%E9%80%9A/videos?days=7',FILTERED_REPORT_PREFIX+'/keywords/%E4%BA%A4%E9%80%9A/videos',{days:'7'}],
  // Literal percent and encoded slash terms stay byte-identical (decoded once by the page).
  ['/keywords/%2541/videos?days=7',FILTERED_REPORT_PREFIX+'/keywords/%2541/videos',{days:'7'}],
  ['/keywords/A%2FB/days?x=1',FILTERED_REPORT_PREFIX+'/keywords/A%2FB/days',{x:'1'}],
  ['/mayor/cities/taipei/people/%E7%8E%8B/days/2026-10-11?type=tags_video',FILTERED_REPORT_PREFIX+'/mayor/cities/taipei/people/%E7%8E%8B/days/2026-10-11',{type:'tags_video'}],
  ['/events/0d4c9e8a-1b2c-4d5e-8f90-123456789abc?utm=x','/events/0d4c9e8a-1b2c-4d5e-8f90-123456789abc',{utm:'x'}],
 ];
 for(const [path,pathname,query] of cases){const result=await via(path);assert.equal(result.pathname,pathname,path);assert.deepEqual({...result.query},query,path);}
 // Every report family the proxy can mark as filtered has a matching rewrite source.
 for(const family of REPORT_FAMILIES)assert.equal((await routed(`/${family}?x=1`,'filtered')).pathname,`${FILTERED_REPORT_PREFIX}/${family}`,family);
 // Without the proxy's header (or with the wrong value) nothing is rewritten.
 for(const [path,header] of [['/',null],['/',"filtered"],['/events','home'],['/channels?x=1',null],['/channels?x=1','home'],['/api/ops/x','filtered'],['/auth/me','filtered']] as const)
  assert.equal((await routed(path,header)).pathname,new URL(path,'http://n').pathname,`${path} ${header}`);
});
test('next.config carries exactly the contract rewrites in beforeFiles',async()=>{
 const {default:config}=await import('../../next.config');
 const rewrites=await config.rewrites!() as {beforeFiles:unknown[];afterFiles:unknown[];fallback:unknown[]};
 assert.deepEqual(rewrites.beforeFiles,internalRenderRewrites());
 assert.deepEqual(rewrites.fallback,[]);
 assert.ok(REPORT_FAMILIES.every(family=>(resolveRoute([family])??resolveRoute([family,'1'])??resolveRoute([family,'x','videos'])??resolveRoute([family,'days'])??resolveRoute([family,'current'])??resolveRoute([family,'authors','x']))!==null),'every contract family resolves a report');
});
test('event detail is eligible only as a bare lowercase UUID and never rewritten',()=>{
 const id='0d4c9e8a-1b2c-4d5e-8f90-123456789abc';
 assert.deepEqual(decide('/events/'+id),{kind:'render',target:null,eligible:'event'});
 assert.deepEqual(decide('/events/'+id+'?page=2'),{kind:'render',target:null,eligible:null});
 assert.deepEqual(decide('/events/'+id,'POST'),{kind:'render',target:null,eligible:null});
 for(const path of ['/events/'+id.toUpperCase(),'/events/123','/events/'+id+'/extra'])assert.equal((decide(path) as {eligible?:unknown}).eligible??null,null,path);
});
test('_rsc is transport only: same route tree as the canonical URL, never eligible, never an API filter',()=>{
 assert.deepEqual(decide('/channels?_rsc=abc'),{kind:'render',target:null,eligible:null});
 assert.deepEqual(decide('/channels?sort=x&_rsc=abc'),{kind:'render',target:'filtered',eligible:null});
 assert.deepEqual(decide('/?_rsc=abc'),{kind:'render',target:'home',eligible:null});
 assert.deepEqual(decide('/events?_rsc=abc'),{kind:'render',target:'events',eligible:null});
 assert.deepEqual(decide('/events?q=a&_rsc=abc'),{kind:'render',target:null,eligible:null});
 // Only the exact transport key is ignored.
 assert.equal((decide('/channels?_RSC=abc') as {target:string|null}).target,'filtered');
 assert.deepEqual(withoutTransportParams({_rsc:'abc',sort:'x',tag:['1','2']}),{sort:'x',tag:['1','2']});
 assert.equal(publicApiUrl('http://api/api/v1','channels',{_rsc:'abc',sort:'x'}),'http://api/api/v1/channels?sort=x');
 assert.equal(publicApiUrl('http://api/api/v1','channels',{_rsc:'abc'}),'http://api/api/v1/channels');
});
test('optional sections keep partial notices only for deterministic failures',()=>{
 for(const [status,code] of [[404,'NOT_FOUND'],[400,'BAD_QUERY'],[410,'GONE'],[422,'CAPACITY'],[502,'INVALID_RESPONSE'],[404,'NOT_PUBLIC']] as const)assert.equal(deterministicPartial(status,code),true,`${status} ${code}`);
 for(const [status,code] of [[503,'API_UNAVAILABLE'],[500,'INTERNAL'],[502,'API_UNAVAILABLE'],[504,'TIMEOUT'],[408,'TIMEOUT'],[429,'RATE_LIMITED'],[409,'RETRY']] as const)assert.equal(deterministicPartial(status,code),false,`${status} ${code}`);
});
test('video tag evidence renders only a usable payload; anything else is its own partial note',()=>{
 const row={key:'k',term:'交通',field:'title',start:0,end:2,text:'交通',snippet:'交通新聞',snippetStart:0,ruleVersion:'1'};
 assert.equal(tagEvidenceRenderable({status:'matched',rows:[row]}),true);
 assert.equal(tagEvidenceRenderable({status:'not-synchronized',rows:[]}),true);
 for(const data of [null,'x',{},{rows:null},{rows:{}},{rows:[null]},{rows:[{...row,term:1}]},{rows:[{...row,snippet:undefined}]}])assert.equal(tagEvidenceRenderable(data),false,JSON.stringify(data));
});
test('public data TTL classes: live 30s, current 60s, date-pinned and history 300s',()=>{
 assert.deepEqual(PUBLIC_DATA_REVALIDATE,{live:30,current:60,history:300});
 for(const path of ['live/current','live/walls/news','ai/events/3/wall'])assert.equal(publicDataClass(path),'live',path);
 for(const path of ['home','videos','channels/12','editorial/events','ai/days','live/days','vocabulary'])assert.equal(publicDataClass(path),'current',path);
 for(const path of ['live/days/2026-10-10','ai/days/2026-10-10/blue/prompt','ai/events/3/history','ai/days/9/events/history'])assert.equal(publicDataClass(path),'history',path);
 assert.equal(publicDataClass('ai/days',{date:'2026-10-10'}),'history');assert.equal(publicDataClass('channels/8/ai/days',{date:'2026-10-10'}),'history');
});
test('public API helper only builds URLs under the read-only public base',()=>{
 const base='http://127.0.0.1:4100/api/v1/';
 assert.equal(publicApiUrl(base,'home'),'http://127.0.0.1:4100/api/v1/home');
 assert.equal(publicApiUrl(base,'keywords/%E4%BA%A4/videos',{days:'7',tag:['a','b']}),'http://127.0.0.1:4100/api/v1/keywords/%E4%BA%A4/videos?days=7&tag=a&tag=b');
 assert.equal(publicApiUrl(base,'editorial/events/'+encodeURIComponent('x y')),'http://127.0.0.1:4100/api/v1/editorial/events/x%20y');
 for(const path of ['','auth/me','ops/ingestion','../auth/me','videos/..','videos/%2e%2e','videos/.','videos//x','//evil.test/x','https://evil.test','videos/a?b=1','videos/a#b','videos\\..','videos/%E4%ZZ','status'])
  assert.throws(()=>publicApiUrl(base,path),(error:unknown)=>error instanceof PublicDataError&&error.status===404,path);
});
const json=(body:unknown,status=200)=>new Response(typeof body==='string'?body:JSON.stringify(body),{status,headers:{'content-type':'application/json'}});
const meta={schemaVersion:1,requestedAt:'2026-10-12T00:00:00Z',updatedAt:null,timezone:'Asia/Taipei',source:'mariadb',dataset:'unknown',coverage:{},warnings:[]};
test('non-2xx and malformed payloads fail; degraded but successful DTOs pass through unchanged',async()=>{
 assert.deepEqual(await readPublicResponse(json({error:{code:'DATA_SOURCE_UNAVAILABLE'}},503)),{ok:false,status:503,code:'DATA_SOURCE_UNAVAILABLE'});
 assert.deepEqual(await readPublicResponse(new Response('<html>',{status:502})),{ok:false,status:502,code:'API_UNAVAILABLE'});
 assert.deepEqual(await readPublicResponse(json({error:{code:'NOT_FOUND'}},404)),{ok:false,status:404,code:'NOT_FOUND'});
 for(const body of ['not json','null','[]',{meta},{data:{},meta:{...meta,schemaVersion:2}},{data:{}}])
  assert.deepEqual(await readPublicResponse(json(body)),{ok:false,status:502,code:'INVALID_RESPONSE'},JSON.stringify(body));
 const degraded={data:{exploration:{categories:{status:'unavailable'}}},meta:{...meta,warnings:['分類統計目前無法完整讀取。']}};
 const ok=await readPublicResponse(json(degraded));assert.deepEqual(ok,{ok:true,response:degraded});
 assert.deepEqual(requireSuccess(ok),degraded);
 for(const failed of [{ok:false,status:503,code:'API_UNAVAILABLE'},{ok:false,status:502,code:'INVALID_RESPONSE'},{ok:false,status:404,code:'NOT_FOUND'}] as const)
  assert.throws(()=>requireSuccess(failed),(error:unknown)=>error instanceof PublicDataError&&error.status===failed.status&&error.code===failed.code);
});
test('ISR route files use literal segment config, no request data and no build-time params',()=>{
 for(const file of ['src/app/[...segments]/page.tsx','src/app/render-isr/home/[edition]/page.tsx','src/app/render-isr/events/[edition]/page.tsx','src/app/events/[id]/page.tsx']){
  const text=source(file);
  assert.match(text,/^export const revalidate ?= ?60;$/m,file);assert.match(text,/^export const dynamicParams ?= ?true;$/m,file);
  assert.match(text,/export async function generateStaticParams\(\) ?\{[^}]*return \[\];/,file);
  assert.match(text,/enablePublicRevalidation\(\)/,file);
  assert.doesNotMatch(text,/searchParams|next\/headers|cookies\(|headers\(|force-dynamic|connection\(/,file);
 }
 for(const file of ['src/app/render-filtered/report/[...segments]/page.tsx','src/app/events/page.tsx','src/app/page.tsx','src/app/compare/titles/page.tsx','src/app/boards/page.tsx','src/app/boards/view/page.tsx','src/app/login/page.tsx','src/app/my/layout.tsx','src/app/manage/page.tsx','src/app/manage/editorial/page.tsx','src/app/manage/users/page.tsx','src/app/ops/ingestion/page.tsx']){
  const text=source(file);assert.match(text,/^export const dynamic ?= ?['"]force-dynamic['"];$/m,file);assert.doesNotMatch(text,/enablePublicRevalidation|export const revalidate/,file);
 }
});
test('root layout emits the exact contract theme script without request reads or nonce',()=>{
 const layout=source('src/app/layout.tsx');
 assert.doesNotMatch(layout,/next\/headers|headers\(\)|nonce=|x-nonce/);
 assert.match(layout,/<script dangerouslySetInnerHTML=\{\{ __html: THEME_SCRIPT \}\} \/>/);
 assert.match(layout,/import \{ THEME_SCRIPT \} from '\.\.\/\.\.\/\.\.\/shared\/public-render-contract';/);
 assert.ok(THEME_SCRIPT.startsWith('(function(){try{')&&THEME_SCRIPT.endsWith('}catch(e){}})()'));assert.doesNotMatch(THEME_SCRIPT,/<\/script|[\r\n]/);
 const config=source('next.config.ts');assert.match(config,/isrFlushToDisk: false/);assert.match(config,/cacheMaxMemorySize: \d/);assert.match(config,/Strict-Transport-Security/);
});
