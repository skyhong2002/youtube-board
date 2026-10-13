import assert from 'node:assert/strict';
import test from 'node:test';
import {existsSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {createElement,type ReactNode} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {ImageConfigContext} from 'next/dist/shared/lib/image-config-context.shared-runtime';
import {imageConfigDefault} from 'next/dist/shared/lib/image-config';
import config from '../../next.config';
import type {ReportMeta,VideoRow} from '../../../api/src/contracts';
import {INITIAL_RETRY_STATE,MAX_MANUAL_RETRIES,RELATIONS_MAX_ROWS,expectedSourceUrl,fetchKeywordRelations,isSupportedKeyword,parseRelationsPayload,recordFailure,relationsPath,retryAfterSeconds,retryDecision,safeTargetHref,waitText,type RelationsResult,type RelationsView} from './keyword-relations';
import KeywordRelations,{KeywordRelationsView,RELATION_GROUP_MAX,RELATION_PREVIEW} from '../components/KeywordRelations';
import {KeywordProfile} from '../components/KeywordProfile';

/* Offline checks of the optional Y2 keyword relations panel: pure parsing, an injected fetch and
 * server markup only. Synthetic test data, no network, no DB, no browser. They do not prove
 * hydration, the real gateway response, timing in a browser, contrast or visual acceptance. */

type Init=RequestInit&{headers?:Record<string,string>};
const json=(body:unknown,init:{status?:number;headers?:Record<string,string>}={})=>new Response(JSON.stringify(body),{status:init.status??200,headers:{'content-type':'application/json; charset=utf-8',...init.headers}});
const mockFetch=(respond:(url:string,init:Init)=>Response|Promise<Response>)=>{
 const calls:{url:string;init:Init}[]=[];
 const fn=(async(url:unknown,init?:RequestInit)=>{calls.push({url:String(url),init:(init??{}) as Init});return respond(String(url),(init??{}) as Init);}) as typeof fetch;
 return {fn,calls};
};
const tagHref=(label:string)=>`/tag/${encodeURIComponent(label)}/`;
type Raw=Record<string,unknown>;
const rel=(type:'is-a'|'related'|'alias',label:string,patch:Raw={},target:Raw={}):Raw=>({id:`rel-${type}-${label}`,type,target:{id:'a'.repeat(64),label,href:tagHref(label),...target},source:'editor',sourceDetail:'人工審核',createdAt:'2026-10-01T08:00:00+08:00',status:'approved',inherited:false,depth:1,...patch});
const envelope=(keyword:string,data:Raw={},meta:Raw={})=>({data:{keyword,source:'https://tag.observe.tw',sourceUrl:expectedSourceUrl(keyword),status:'available',reason:null,tagId:'b'.repeat(64),truncated:false,relations:[],retryAfterSeconds:null,...data},meta:{schemaVersion:1,requestedAt:'2026-10-13T00:00:00Z',updatedAt:null,timezone:'Asia/Taipei',source:'tag.observe.tw',dataset:'fixture',coverage:{},warnings:[],...meta}});
const view=(keyword:string,v:RelationsView,extra:Raw={})=>renderToStaticMarkup(createElement(KeywordRelationsView,{keyword,view:v,...extra}));
const anchors=(markup:string)=>(markup.match(/<a\s[^>]*href="([^"]*)"/g)??[]).map(a=>a.match(/href="([^"]*)"/)![1]!);
const available=(keyword:string,relations:Raw[],data:Raw={})=>{const r=parseRelationsPayload(envelope(keyword,{relations,...data}),keyword);assert.equal(r.kind,'available');return r;};

test('keyword support, exact single encoding and the fixed source URL',()=>{
 for(const ok of ['交通','a/b%41','100%','x'.repeat(60),'𠀋'.repeat(60)])assert.ok(isSupportedKeyword(ok),ok);
 for(const bad of ['',' 交通','交通 ','x'.repeat(61),'a\u0000b','a\nb','\ud800',null,42])assert.ok(!isSupportedKeyword(bad),String(bad));
 assert.equal(relationsPath('a/b%41'),'/api/v1/keywords/a%2Fb%2541/relations');
 assert.equal(relationsPath('交通'),'/api/v1/keywords/%E4%BA%A4%E9%80%9A/relations');
 assert.equal(expectedSourceUrl('a/b%41'),'https://tag.observe.tw/tag/a%2Fb%2541/');
});

test('the request is same-origin, relative, uncredentialed, uncached, redirect-refusing and header-minimal',async()=>{
 const {fn,calls}=mockFetch(()=>json(envelope('a/b%41')));
 const result=await fetchKeywordRelations('a/b%41',{fetch:fn});
 assert.equal(calls.length,1);
 const [{url,init}]=calls as [{url:string;init:Init}];
 assert.equal(url,'/api/v1/keywords/a%2Fb%2541/relations');assert.doesNotMatch(url,/^https?:|^\/\/|tag\.observe\.tw/);
 assert.equal(init.credentials,'omit');assert.equal(init.cache,'no-store');assert.equal(init.redirect,'error');assert.equal(init.mode,'same-origin');assert.equal(init.method,'GET');
 assert.deepEqual(Object.keys(init.headers??{}).map(k=>k.toLowerCase()),['accept']);
 assert.ok(init.signal instanceof AbortSignal);
 assert.equal(result?.kind,'available');
});

test('a clearly unsupported keyword never fetches and is unavailable, not disabled or empty',async()=>{
 const {fn,calls}=mockFetch(()=>json(envelope('x')));
 for(const bad of ['',' 交通','x'.repeat(61),'a\u0007b']){
  const r=await fetchKeywordRelations(bad,{fetch:fn});
  assert.deepEqual(r,{kind:'unavailable',reason:'invalid-keyword',retryAfterSeconds:null,retryable:false});
  const markup=view(bad,r!,{onRetry:()=>{},retriesLeft:3});
  assert.match(markup,/data-relations-state="invalid-keyword"/);assert.match(markup,/格式無法查詢關聯/);assert.doesNotMatch(markup,/<button|尚未開放|沒有此標籤已核准/);
 }
 assert.equal(calls.length,0);
});

test('default disabled differs from a successful empty read and from unavailable',()=>{
 const disabled=parseRelationsPayload(envelope('交通',{status:'disabled',reason:'disabled',tagId:null}),'交通');
 assert.deepEqual(disabled,{kind:'disabled'});
 const off=view('交通',disabled);
 assert.match(off,/data-relations-state="disabled"/);assert.match(off,/標籤關聯尚未開放，目前未向來源查詢；這不表示此標籤沒有關聯/);
 assert.doesNotMatch(off,/筆|沒有此標籤已核准|<button|<a |TS_TAG|enabled|env/i);
 const empty=available('交通',[]);
 const none=view('交通',empty);
 assert.match(none,/data-relations-state="available"/);assert.match(none,/新文易數目前沒有此標籤已核准的關聯紀錄；僅指來源的已核准關聯，不代表沒有相關影片/);
 assert.doesNotMatch(none,/尚未開放|無法讀取|已截斷/);
 assert.deepEqual(anchors(none),['https://tag.observe.tw/tag/%E4%BA%A4%E9%80%9A/']);
 // Truncated with no rows is incomplete, never a complete absence.
 const cut=view('交通',available('交通',[],{truncated:true}));
 assert.match(cut,/結果不完整（已截斷），無法確認/);assert.doesNotMatch(cut,/沒有此標籤已核准/);
});

test('available: three relation types, is-a direction, provenance, inherited depth, IDs verbatim and escaped text',()=>{
 const r=available('交通',[
  rel('related','捷運'),
  rel('is-a','公共政策',{inherited:true,depth:2,createdAt:null,id:'rel-ORIGINAL-Id'}),
  rel('alias','<b>交通運輸</b>',{sourceDetail:'見 https://evil.example/x <script>'}),
  rel('is-a','政治人物',{},{id:'group:12',href:'/group/12/'}),
 ],{truncated:true});
 const markup=view('交通',r);
 // Groups appear is-a → related → alias; API order kept inside a group.
 const order=['data-relation-group="is-a"','data-relation-group="related"','data-relation-group="alias"'].map(s=>markup.indexOf(s));
 assert.ok(order.every(i=>i>=0)&&order[0]!<order[1]!&&order[1]!<order[2]!);
 assert.ok(markup.indexOf('公共政策')<markup.indexOf('政治人物'));
 assert.match(markup,/「交通」→ 上位：單一方向，不代表兩者相同/);
 assert.match(markup,/不是 YouTube 影片共同出現的統計/);assert.match(markup,/不會自動合併影片、去除重複或視為同一人物/);
 assert.match(markup,/關聯不改變本頁影片的排名、數量或篩選範圍/);
 assert.match(markup,/已讀取 4 筆新文易數已核准的關聯；來源只回傳部分結果（已截斷），以下不是完整清單/);
 assert.match(markup,/繼承・第 2 層/);assert.match(markup,/<dt>建立時間<\/dt><dd>未記錄<\/dd>/);assert.match(markup,/<dt>狀態<\/dt><dd>已核准<\/dd>/);
 assert.match(markup,/<dt>關聯 ID<\/dt><dd class="break-all">rel-ORIGINAL-Id<\/dd>/);
 assert.match(markup,/<dt>群組 ID<\/dt><dd class="break-all">group:12<\/dd>/);assert.match(markup,new RegExp(`<dt>標籤 ID</dt><dd class="break-all">${'a'.repeat(64)}</dd>`));
 assert.match(markup,/&lt;b&gt;交通運輸&lt;\/b&gt;/);assert.match(markup,/見 https:\/\/evil\.example\/x &lt;script&gt;/);assert.doesNotMatch(markup,/<script|<b>/);
 // Only validated tag.observe.tw targets plus the fixed source URL are links; sourceDetail never is.
 assert.deepEqual(anchors(markup).sort(),[
  'https://tag.observe.tw/group/12/','https://tag.observe.tw/tag/%3Cb%3E%E4%BA%A4%E9%80%9A%E9%81%8B%E8%BC%B8%3C%2Fb%3E/',`https://tag.observe.tw${tagHref('公共政策')}`,`https://tag.observe.tw${tagHref('捷運')}`,expectedSourceUrl('交通'),
 ].sort());
 assert.match(markup,/rel="noopener noreferrer external"/);
 assert.match(markup,/<details[^>]*><summary[^>]*>來源與紀錄<\/summary>/);
 assert.doesNotMatch(markup,/sameAs|同一人(?!物)|共現次數/);
});

test('unsafe or mismatched target URLs keep the row as plain text without a fabricated link',()=>{
 const target=(href:string,id='a'.repeat(64))=>({id,label:'捷運',href});
 for(const href of ['javascript:alert(1)','https://evil.example/tag/%E6%8D%B7%E9%81%8B/','//evil.example/tag/%E6%8D%B7%E9%81%8B/','https://user@tag.observe.tw/tag/%E6%8D%B7%E9%81%8B/','http://tag.observe.tw/tag/%E6%8D%B7%E9%81%8B/','/tag/%E6%8D%B7%E9%81%8B/?q=1','/tag/%E6%8D%B7%E9%81%8B/#x','/tag/捷運/','/tag/%25E6%258D%25B7/','/group/12/',' /tag/%E6%8D%B7%E9%81%8B/'])
  assert.equal(safeTargetHref(target(href)),null,href);
 assert.equal(safeTargetHref(target('/tag/%E6%8D%B7%E9%81%8B/')),'https://tag.observe.tw/tag/%E6%8D%B7%E9%81%8B/');
 assert.equal(safeTargetHref(target('https://tag.observe.tw/tag/%E6%8D%B7%E9%81%8B/')),'https://tag.observe.tw/tag/%E6%8D%B7%E9%81%8B/');
 // Group and tag identities stay separate.
 assert.equal(safeTargetHref({id:'group:12',label:'捷運',href:'/group/12/'}),'https://tag.observe.tw/group/12/');
 assert.equal(safeTargetHref({id:'group:12',label:'捷運',href:'/tag/%E6%8D%B7%E9%81%8B/'}),null);
 for(const id of ['group:0','group:012','group:x','group:1234567890123456'])assert.equal(safeTargetHref({id,label:'捷運',href:'/group/12/'}),null,id);
 const markup=view('交通',available('交通',[rel('related','捷運',{},{href:'javascript:alert(1)'}),rel('alias','台鐵',{},{href:'https://evil.example/'})]));
 assert.deepEqual(anchors(markup),[expectedSourceUrl('交通')]);
 assert.ok(markup.includes('捷運')&&markup.includes('台鐵'));assert.doesNotMatch(markup,/javascript:|evil\.example/);
});

test('forward-compatible: unknown envelope, data and row fields are ignored and never copied',()=>{
 const body=envelope('交通',{debugUpstream:'SECRET-token',relations:[{...rel('related','捷運',{score:99,internalNote:'SECRET-note'},{extra:'SECRET-target'})}]},{futureField:{x:1}});
 const r=parseRelationsPayload(body,'交通');
 assert.equal(r.kind,'available');
 const serialized=JSON.stringify(r);
 assert.doesNotMatch(serialized,/SECRET|score|internalNote|futureField|debugUpstream/);
 assert.doesNotMatch(view('交通',r),/SECRET|99/);
});

test('invalid payloads are unavailable, never empty or disabled',()=>{
 const bad:unknown[]=[
  null,'text',[],{data:envelope('交通').data},{...envelope('交通'),meta:{schemaVersion:2}},
  envelope('別的詞'),envelope('交通',{keyword:'別的詞'}),envelope('交通',{source:'https://evil.example'}),envelope('交通',{sourceUrl:'https://tag.observe.tw/tag/交通/'}),
  envelope('交通',{status:'enabled'}),envelope('交通',{truncated:'false'}),envelope('交通',{relations:{}}),envelope('交通',{tagId:42}),
  envelope('交通',{relations:Array.from({length:RELATIONS_MAX_ROWS+1},(_,i)=>rel('related',`詞${i}`))}),
  envelope('交通',{relations:[rel('same-as' as 'alias','捷運')]}),envelope('交通',{relations:[rel('related','捷運',{status:'pending'})]}),
  envelope('交通',{relations:[rel('related','捷運',{depth:0})]}),envelope('交通',{relations:[rel('related','捷運',{createdAt:'yesterday'})]}),
  envelope('交通',{relations:[rel('related','',{})]}),envelope('交通',{relations:[rel('related','捷運',{source:'a\nb'})]}),
 ];
 for(const body of bad){const r=parseRelationsPayload(body,'交通');assert.equal(r.kind,'unavailable',JSON.stringify(body)?.slice(0,120));assert.equal((r as {reason:string}).reason,'invalid-response');}
});

test('HTTP failures, 429 Retry-After, upstream holds, timeouts, size and content-type bounds are unavailable',async()=>{
 const run=async(response:()=>Response|Promise<Response>,opts:{maxBytes?:number}={})=>fetchKeywordRelations('交通',{fetch:mockFetch(response).fn,now:()=>Date.parse('2026-10-13T00:00:00Z'),...opts});
 assert.deepEqual(await run(()=>new Response('{"error":{"code":"NOT_FOUND","message":"SECRET"}}',{status:404})),{kind:'unavailable',reason:'not-found',retryAfterSeconds:null,retryable:true});
 assert.deepEqual(await run(()=>new Response('',{status:429,headers:{'retry-after':'120'}})),{kind:'unavailable',reason:'rate-limited',retryAfterSeconds:120,retryable:true});
 assert.equal((await run(()=>new Response('',{status:429,headers:{'retry-after':'Tue, 13 Oct 2026 00:10:00 GMT'}})))?.kind,'unavailable');
 assert.equal(((await run(()=>new Response('',{status:429,headers:{'retry-after':'Tue, 13 Oct 2026 00:10:00 GMT'}}))) as {retryAfterSeconds:number}).retryAfterSeconds,600);
 assert.equal(((await run(()=>new Response('',{status:429}))) as {retryAfterSeconds:number}).retryAfterSeconds,60);
 assert.equal(((await run(()=>new Response('',{status:500}))) as {reason:string}).reason,'http');
 // A 200 envelope that says unavailable keeps its upstream hold in full, including the backend's max-Date range.
 const held=await run(()=>json(envelope('交通',{status:'unavailable',reason:'rate-limited',tagId:null,retryAfterSeconds:300})));
 assert.deepEqual(held,{kind:'unavailable',reason:'rate-limited',retryAfterSeconds:300,retryable:true});
 const huge=await run(()=>json(envelope('交通',{status:'unavailable',reason:'rate-limited',tagId:null,retryAfterSeconds:8.64e12})));
 assert.deepEqual(huge,{kind:'unavailable',reason:'rate-limited',retryAfterSeconds:8.64e12,retryable:true});
 assert.match(view('交通',huge!,{onRetry:()=>{},retriesLeft:3}),/請於約 273973 年（8640000000000 秒）後再試；本頁不會自動重試/);
 // Header holds above the old 1e9 cap are kept exactly, as delta seconds or as the latest IMF date.
 for(const s of ['1000000001','8640000000000'])assert.equal(((await run(()=>new Response('',{status:429,headers:{'retry-after':s}}))) as {retryAfterSeconds:number}).retryAfterSeconds,Number(s));
 assert.equal(((await run(()=>new Response('',{status:429,headers:{'retry-after':'Fri, 31 Dec 9999 23:59:59 GMT'}}))) as {retryAfterSeconds:number}).retryAfterSeconds,(Date.parse('9999-12-31T23:59:59Z')-Date.parse('2026-10-13T00:00:00Z'))/1000);
 assert.equal(((await run(()=>new Response(JSON.stringify(envelope('交通')),{status:200,headers:{'content-type':'text/html'}}))) as {reason:string}).reason,'invalid-response');
 assert.equal(((await run(()=>new Response('{not json',{status:200,headers:{'content-type':'application/json'}}))) as {reason:string}).reason,'invalid-response');
 assert.equal(((await run(()=>json(envelope('交通'),{headers:{'content-length':'999999999'}}))) as {reason:string}).reason,'too-large');
 assert.equal(((await run(()=>json(envelope('交通',{relations:Array.from({length:20},(_,i)=>rel('related',`詞${i}`))})),{maxBytes:256})) as {reason:string}).reason,'too-large');
 assert.equal(((await run(()=>{throw new TypeError('SECRET network detail 10.0.0.1');})) as {reason:string}).reason,'network');
 const hanging=(_url:string,init:Init)=>new Promise<Response>((_,reject)=>init.signal!.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError'))));
 const started=Date.now();
 const timed=await fetchKeywordRelations('交通',{fetch:mockFetch(hanging).fn,timeoutMs:100});
 assert.deepEqual(timed,{kind:'unavailable',reason:'timeout',retryAfterSeconds:null,retryable:true});
 assert.ok(Date.now()-started<5000);
 // None of the failure texts reach the UI.
 for(const r of [held,timed]){const m=view('交通',r!,{onRetry:()=>{},retriesLeft:3});assert.match(m,/標籤關聯目前無法讀取。本頁影片、比對依據與數量不受影響。/);assert.doesNotMatch(m,/SECRET|10\.0\.0\.1|rate-limited|timeout|Error|digest|筆/);}
});

test('abort on unmount or keyword change returns null so a stale response can never be applied',async()=>{
 let release:((r:Response)=>void)|undefined;
 const {fn}=mockFetch(()=>new Promise<Response>(resolve=>{release=resolve;}));
 const controller=new AbortController();
 const pending=fetchKeywordRelations('舊詞',{fetch:fn,signal:controller.signal});
 controller.abort();release?.(json(envelope('舊詞',{relations:[rel('related','舊結果')]})));
 assert.equal(await pending,null);
 const early=new AbortController();early.abort();
 const {fn:never,calls}=mockFetch(()=>json(envelope('x')));
 assert.equal(await fetchKeywordRelations('交通',{fetch:never,signal:early.signal}),null);assert.equal(calls.length,0);
 // A response for another keyword is rejected even if it arrives for this request.
 assert.equal((await fetchKeywordRelations('新詞',{fetch:mockFetch(()=>json(envelope('舊詞'))).fn}))?.kind,'unavailable');
 // The component also keys on the keyword and aborts in its cleanup (source check; effects do not run in server markup).
 const source=readFileSync(join(components(),'KeywordRelations.tsx'),'utf8');
 assert.match(source,/^'use client';/);assert.match(source,/return\(\)=>controller\.abort\(\);/);assert.match(source,/state\.keyword===keyword\?state\.view:\{kind:'idle'\}/);assert.match(source,/\},\[keyword,attempt\]\);/);
});

test('manual retry: bounded count, respects Retry-After and a minimum gap, no timers or automatic retries',async()=>{
 const failed=(seconds:number|null):RelationsResult=>({kind:'unavailable',reason:'rate-limited',retryAfterSeconds:seconds,retryable:true});
 let s=recordFailure(INITIAL_RETRY_STATE,failed(120),0);
 assert.deepEqual(retryDecision(s,failed(120),1000),{allowed:false,reason:'hold',waitSeconds:119});
 assert.deepEqual(retryDecision(s,failed(120),120000),{allowed:true});
 s=recordFailure(INITIAL_RETRY_STATE,failed(null),0);
 assert.equal(retryDecision(s,failed(null),1000).allowed,false);assert.equal(retryDecision(s,failed(null),5000).allowed,true);
 assert.deepEqual(retryDecision({...s,retries:MAX_MANUAL_RETRIES},failed(null),1e9),{allowed:false,reason:'exhausted',waitSeconds:null});
 assert.equal(retryDecision(INITIAL_RETRY_STATE,{kind:'disabled'},0).allowed,false);
 assert.equal(retryDecision(INITIAL_RETRY_STATE,{kind:'unavailable',reason:'invalid-keyword',retryAfterSeconds:null,retryable:false},0).allowed,false);
 // A later shorter hold never shortens an earlier longer one.
 const long=recordFailure(recordFailure(INITIAL_RETRY_STATE,failed(3600),0),failed(10),0);assert.equal(long.holdUntil,3600000);
 // Full holds, no cap: still blocked at the old 1e9-second boundary, allowed only once the real hold ends.
 const past=recordFailure(INITIAL_RETRY_STATE,failed(2e9),0);assert.equal(past.holdUntil,2e12);
 assert.deepEqual(retryDecision(past,failed(2e9),1e12),{allowed:false,reason:'hold',waitSeconds:1e9});
 assert.deepEqual(retryDecision(past,failed(2e9),2e12-1),{allowed:false,reason:'hold',waitSeconds:1});
 assert.deepEqual(retryDecision(past,failed(2e9),2e12),{allowed:true});
 const t0=Date.parse('2026-10-13T00:00:00Z'),max=recordFailure(INITIAL_RETRY_STATE,failed(8.64e12),t0);
 assert.equal(max.holdUntil,t0+8.64e15);
 for(const at of [t0+1e12,t0+8.64e15-1])assert.equal(retryDecision(max,failed(8.64e12),at).allowed,false);
 assert.deepEqual(retryDecision(max,failed(8.64e12),t0+8.64e15),{allowed:true});
 assert.equal(recordFailure(max,failed(10),t0+1000).holdUntil,t0+8.64e15);
 // Past exact millisecond range the hold becomes unbounded rather than rounding early; it never shrinks back.
 const beyond=recordFailure(INITIAL_RETRY_STATE,failed(1e13),0);assert.equal(beyond.holdUntil,Infinity);
 assert.equal(recordFailure(beyond,failed(10),0).holdUntil,Infinity);
 assert.deepEqual(retryDecision(beyond,failed(1e13),Number.MAX_VALUE),{allowed:false,reason:'hold',waitSeconds:Infinity});
 assert.equal(waitText(30),'約 30 秒');assert.equal(waitText(90),'約 2 分鐘（90 秒）');assert.equal(waitText(7200),'約 2 小時（7200 秒）');assert.equal(waitText(172800),'約 2 天（172800 秒）');
 assert.equal(waitText(1e9),'約 32 年（1000000000 秒）');assert.equal(waitText(2e9),'約 64 年（2000000000 秒）');assert.equal(waitText(8.64e12),'約 273973 年（8640000000000 秒）');
 assert.equal(waitText(Infinity),'超過 9007199254740991 秒（遠超過可預期的時間）');
 assert.equal(retryAfterSeconds('0',0),1);assert.equal(retryAfterSeconds('garbage',0),60);assert.equal(retryAfterSeconds(null,0),null);
 assert.equal(retryAfterSeconds('1000000001',0),1000000001);assert.equal(retryAfterSeconds('8640000000000',0),8.64e12);
 // Past 2^53 a decimal can round down to a double; the parsed hold is stepped up, never below what was sent.
 assert.equal(retryAfterSeconds('9007199254740993',0),9007199254740994);assert.ok(retryAfterSeconds('9'.repeat(30),0)!>1e30);
 // Non-finite (too many digits) is an unbounded hold, not the short 60-second fallback.
 assert.equal(retryAfterSeconds('9'.repeat(400),0),Infinity);
 // A manual check during the hold makes zero transport calls; after it ends a manual retry recovers.
 let limited=true;
 const {fn,calls}=mockFetch(()=>limited?new Response('',{status:429,headers:{'retry-after':'2000000000'}}):json(envelope('交通')));
 const first=(await fetchKeywordRelations('交通',{fetch:fn}))!;
 assert.deepEqual(first,{kind:'unavailable',reason:'rate-limited',retryAfterSeconds:2e9,retryable:true});
 let local=recordFailure(INITIAL_RETRY_STATE,first,0);
 const manual=async(now:number)=>{const d=retryDecision(local,first,now);if(!d.allowed)return d;local={...local,retries:local.retries+1};return fetchKeywordRelations('交通',{fetch:fn});};
 assert.deepEqual(await manual(1e12),{allowed:false,reason:'hold',waitSeconds:1e9});
 assert.deepEqual(await manual(2e12-1),{allowed:false,reason:'hold',waitSeconds:1});
 assert.equal(calls.length,1);
 limited=false;
 assert.equal(((await manual(2e12)) as RelationsResult).kind,'available');
 assert.equal(calls.length,2);assert.equal(local.retries,1);
 // Markup: a retry button only while retries remain; the hold is stated; disabled never offers a retry.
 const withButton=view('交通',failed(90),{onRetry:()=>{},retriesLeft:2});
 assert.match(withButton,/<button type="button"[^>]*>重新讀取標籤關聯<\/button>/);assert.match(withButton,/來源要求稍候，請於約 2 分鐘（90 秒）後再試；本頁不會自動重試/);
 assert.match(view('交通',failed(2e9),{onRetry:()=>{},retriesLeft:2}),/請於約 64 年（2000000000 秒）後再試/);
 const spent=view('交通',failed(null),{onRetry:()=>{},retriesLeft:0});
 assert.doesNotMatch(spent,/<button/);assert.match(spent,/已多次重新讀取仍無法取得/);
 assert.match(view('交通',failed(null),{onRetry:()=>{},retriesLeft:1,note:'等候時間尚未結束（約 5 秒），尚未重新讀取。'}),/等候時間尚未結束/);
 assert.doesNotMatch(view('交通',{kind:'disabled'},{onRetry:()=>{},retriesLeft:3}),/<button/);
 const lib=readFileSync(join(components(),'../lib/keyword-relations.ts'),'utf8'),component=readFileSync(join(components(),'KeywordRelations.tsx'),'utf8');
 assert.doesNotMatch(component,/setTimeout|setInterval|localStorage|sessionStorage|console\.|document\.cookie/);
 // The enabled button decides locally at click time (no disabled-button timer); no cap or coarse text survives.
 assert.match(component,/const decision=retryDecision\(current\.state,view,Date\.now\(\)\);/);
 assert.doesNotMatch(lib,/MAX_HOLD|超過一天/);
 assert.doesNotMatch(lib,/setInterval|localStorage|sessionStorage|console\.|document\.cookie|authorization|x-service-token|x-forwarded|cookie:/i);
 // Only the relative gateway path is ever fetched; tag.observe.tw appears only as a link origin.
 assert.match(lib,/await transport\(relationsPath\(keyword\),/);assert.doesNotMatch(lib,/transport\('https?:|fetch\('https?:/);
});

test('Retry-After dates: only canonical IMF-fixdates count; malformed dates get the 60-second fallback, never a 1-second hold',async()=>{
 const t0=Date.parse('2026-10-13T00:00:00Z');// Tuesday
 const malformed=[
  // Date.parse-compatible but not IMF-fixdate.
  'Oct 12 2026 GMT','12 Oct 2026 00:00:00 GMT','Mon Oct 12 2026 00:00:00 GMT','Monday, 12 Oct 2026 00:00:00 GMT','Mon, 12-Oct-2026 00:00:00 GMT','Mon, 12 Oct 26 00:00:00 GMT',
  'Mon, 2 Oct 2026 00:00:00 GMT','Mon, 12 October 2026 00:00:00 GMT','Mon, 12 oct 2026 00:00:00 GMT','mon, 12 Oct 2026 00:00:00 GMT','Mon, 12 Oct 2026 00:00 GMT','Mon, 12 Oct 2026 0:00:00 GMT','Mon,  12 Oct 2026 00:00:00 GMT',
  // Calendar rollover: the parser would normalise these to another day.
  'Tue, 31 Feb 2026 00:00:00 GMT','Fri, 29 Feb 2030 00:00:00 GMT','Thu, 31 Sep 2026 00:00:00 GMT','Mon, 00 Oct 2026 00:00:00 GMT','Mon, 32 Oct 2026 00:00:00 GMT',
  // Wrong weekday (12 Oct 2026 is a Monday, 13 Oct 2026 00:10 is a Tuesday).
  'Sun, 12 Oct 2026 00:00:00 GMT','Wed, 13 Oct 2026 00:10:00 GMT','Sat, 31 Dec 9999 23:59:59 GMT',
  // Invalid time.
  'Mon, 12 Oct 2026 24:00:00 GMT','Mon, 12 Oct 2026 23:60:00 GMT','Mon, 12 Oct 2026 23:59:60 GMT','Mon, 12 Oct 2026 99:99:99 GMT',
  // Other or missing time zones.
  'Mon, 12 Oct 2026 00:00:00 UTC','Mon, 12 Oct 2026 00:00:00 +0000','Mon, 12 Oct 2026 00:00:00 gmt','Mon, 12 Oct 2026 00:00:00','Mon, 12 Oct 2026 00:00:00 GMT+0800','Fri, 31 Dec 9999 23:59:59 +0000',
 ];
 for(const v of malformed)assert.equal(retryAfterSeconds(v,t0),60,v);
 // Valid canonical dates: a past one may legitimately be the 1-second minimum; future ones are exact.
 assert.equal(retryAfterSeconds('Mon, 12 Oct 2026 00:00:00 GMT',t0),1);
 assert.equal(retryAfterSeconds('Tue, 13 Oct 2026 00:10:00 GMT',t0),600);
 assert.equal(retryAfterSeconds('Sun, 29 Feb 2032 00:00:00 GMT',t0),(Date.parse('2032-02-29T00:00:00Z')-t0)/1000);
 assert.equal(retryAfterSeconds('Fri, 31 Dec 9999 23:59:59 GMT',t0),(Date.parse('9999-12-31T23:59:59Z')-t0)/1000);
 // Numeric behaviour is unchanged.
 assert.equal(retryAfterSeconds(' 120 ',t0),120);assert.equal(retryAfterSeconds('8640000000000',t0),8.64e12);
 // Through a mocked 429: malformed dates become the 60-second hold, so the manual gap is not the only guard.
 const run=async(header:string)=>((await fetchKeywordRelations('交通',{fetch:mockFetch(()=>new Response('',{status:429,headers:{'retry-after':header}})).fn,now:()=>t0})) as {retryAfterSeconds:number}).retryAfterSeconds;
 for(const v of ['Oct 12 2026 GMT','Tue, 31 Feb 2026 00:00:00 GMT','Sun, 12 Oct 2026 00:00:00 GMT','Mon, 12 Oct 2026 24:00:00 GMT','Mon, 12 Oct 2026 00:00:00 UTC'])assert.equal(await run(v),60,v);
 assert.equal(await run('Mon, 12 Oct 2026 00:00:00 GMT'),1);
 assert.equal(await run('Fri, 31 Dec 9999 23:59:59 GMT'),(Date.parse('9999-12-31T23:59:59Z')-t0)/1000);
 const result=(await fetchKeywordRelations('交通',{fetch:mockFetch(()=>new Response('',{status:429,headers:{'retry-after':'Oct 12 2026 GMT'}})).fn,now:()=>t0}))!;
 assert.deepEqual(result,{kind:'unavailable',reason:'rate-limited',retryAfterSeconds:60,retryable:true});
 const state=recordFailure(INITIAL_RETRY_STATE,result,t0);
 assert.equal(state.holdUntil,t0+60000);
 assert.deepEqual(retryDecision(state,result,t0+5000),{allowed:false,reason:'hold',waitSeconds:55});
 assert.deepEqual(retryDecision(state,result,t0+60000),{allowed:true});
});

test('bounded preview: five rows per type, an honest remainder and a capped expansion with a source link',()=>{
 const rows=Array.from({length:50},(_,i)=>rel('related',`相關${i}`));
 const r=available('交通',rows);
 const closed=view('交通',r,{onExpand:()=>{}});
 assert.equal(closed.match(/data-relation-type="related"/g)?.length,RELATION_PREVIEW);
 assert.match(closed,/<button type="button"[^>]*aria-expanded="false"[^>]*>顯示其餘 35 筆<\/button>/);assert.match(closed,/相關標籤 <span[^>]*>50 筆<\/span>/);
 const open=view('交通',r,{onExpand:()=>{},expanded:{related:true}});
 assert.equal(open.match(/data-relation-type="related"/g)?.length,RELATION_GROUP_MAX);
 assert.match(open,/另有 10 筆未在此列出，<a href="https:\/\/tag\.observe\.tw\/tag\/%E4%BA%A4%E9%80%9A\/"[^>]*>請至新文易數查看<\/a>/);
});

test('initial server markup is an honest idle panel and issues no request',()=>{
 const original=globalThis.fetch;let called=0;
 globalThis.fetch=(async()=>{called++;throw new Error('no network in tests');}) as typeof fetch;
 try{
  const markup=renderToStaticMarkup(createElement(KeywordRelations,{keyword:'a/b%41'}));
  assert.match(markup,/data-relations-state="idle"/);assert.match(markup,/<h2 id="keyword-relations-heading"[^>]*>標籤關聯<\/h2>/);assert.match(markup,/aria-labelledby="keyword-relations-heading"/);
  assert.match(markup,/<p role="status"[^>]*>標籤關聯會在頁面載入後另外讀取；本頁影片、比對依據與數量不受影響。<\/p>/);
  assert.doesNotMatch(markup,/<li|筆|<a |正在讀取|尚未開放|沒有此標籤/);
 }finally{globalThis.fetch=original;}
 assert.equal(called,0);
 const loading=view('交通',{kind:'loading'});
 assert.match(loading,/aria-busy="true"/);assert.match(loading,/正在讀取標籤關聯…/);assert.doesNotMatch(loading,/<li|筆|<a /);
 // Dark/light tokens and focus variants are present (class presence only, not contrast).
 const full=view('交通',available('交通',[rel('related','捷運')]));
 for(const token of ['dark:bg-zinc-900','dark:border-zinc-800','dark:text-brand-400','focus-visible:outline-brand-600','min-w-0'])assert.ok(full.includes(token),token);
});

const html=(node:ReactNode)=>renderToStaticMarkup(createElement(ImageConfigContext.Provider,{value:{...imageConfigDefault,...config.images}},node));
function components(){
 const dir=[process.cwd(),join(process.cwd(),'web'),join(process.cwd(),'platform/web')].map(root=>join(root,'src/components')).find(d=>existsSync(join(d,'KeywordProfile.tsx')));
 assert.ok(dir,'src/components not found');return dir;
}
test('keyword profile keeps its SSR controls, counts, null-vs-zero and evidence links; relations sit after the videos',()=>{
 const meta:ReportMeta={schemaVersion:1,requestedAt:'2026-10-12T00:00:00Z',updatedAt:null,timezone:'Asia/Taipei',source:'mariadb',dataset:'fixture',warnings:[],coverage:{}};
 const video=(id:string,views:number|null,patch:Partial<VideoRow>={})=>({id,title:`影片${id}`,views,channelId:42,channelTitle:'來源頻道',youtubeChannelId:'',description:'',thumbnail:null,publishedAt:'2026-10-12T00:00:00Z',likes:null,comments:0,updatedAt:null,youtubeUrl:'',...patch}) as VideoRow;
 const evidence=[{term:'交通',field:'title' as const,snippet:'前文交通後文',start:2,end:4,snippetStart:0}];
 const markup=html(createElement(KeywordProfile,{keyword:'a/b%41',description:'範圍說明',data:{rows:[video('AbCdEfGh123',null,{keywordEvidence:evidence}),video('BbCdEfGh123',0)],total:120,limit:50,offset:0,hasNext:true,totalStatus:'exact'},meta,
  notice:createElement('p',null,'合成資料提醒'),tabs:createElement('nav',null,'報表分頁'),filters:createElement('input',{name:'q',defaultValue:'保留條件'}),pagination:createElement('a',{href:'?offset=50'},'下一頁'),period:{from:'2026-10-06',to:'2026-10-12',days:null}}));
 for(const label of ['合成資料提醒','報表分頁','保留條件','下一頁','120 部</span></h2>','目前條件共 120 部符合・本頁顯示 2 部。','<dt>累計觀看</dt><dd>無觀看值</dd>','<dt>累計觀看</dt><dd>0</dd>','href="/videos/AbCdEfGh123#keyword-evidence"','發布日期 2026-10-06 至 2026-10-12（台北時間）','本頁資料來源與計算方式'])assert.ok(markup.includes(label),label);
 assert.match(markup,/<span class="text-zinc-500">#<\/span>a\/b%41<\/h1>/);
 assert.equal(markup.match(/data-relations-state=/g)?.length,1);assert.match(markup,/data-relations-state="idle"/);
 // Narrow screens: after the list and pagination; wide screens: second column, below coverage.
 assert.ok(markup.indexOf('下一頁')<markup.indexOf('data-relations-state'));assert.ok(markup.indexOf('data-relations-state')<markup.indexOf('本頁資料來源與計算方式'));
 assert.match(markup,/lg:grid-cols-\[minmax\(0,1fr\)_18rem\] lg:grid-rows-\[auto_1fr\]/);assert.match(markup,/<div class="min-w-0 space-y-4 lg:row-span-2">/);assert.match(markup,/<div class="min-w-0 lg:order-3"><section aria-labelledby="keyword-relations-heading"/);
 // The server component itself still has no client fetch, effect or Suspense; it only mounts the island.
 const profile=readFileSync(join(components(),'KeywordProfile.tsx'),'utf8');
 assert.doesNotMatch(profile,/<Suspense|\buseEffect\b|\bfetch\(|fetchKeywordRelations|setTimeout|tag\.observe\.tw\/api/);
 assert.match(profile,/<KeywordRelations key=\{keyword\} keyword=\{keyword\}\/>/);
});
