import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {fetchKeywordMetadata} from './keyword-metadata';
import KeywordRelations from '../components/KeywordRelations';
import KeywordIllustration from '../components/KeywordIllustration';
import {publicRenderDecision} from './public-render';
const keyword='柯文哲';
const json=(data:unknown)=>new Response(JSON.stringify({data,meta:{schemaVersion:1}}),{headers:{'content-type':'application/json'}});
const relation={keyword,source:'https://tag.observe.tw',sourceUrl:'https://tag.observe.tw/tag/'+encodeURIComponent(keyword)+'/',status:'available',tagId:'1',truncated:false,relations:[]};
const picture={kind:'avatar',label:keyword,image:'/media/tag-illustrations/'+encodeURIComponent(keyword)+'/avatar/t3-1',emoji:null,attribution:null};
test('SSR metadata uses two fixed anonymous no-store reads; initial HTML has no loading flash',async()=>{
 const calls:{url:string;init:RequestInit}[]=[];
 const transport=(async(url,init)=>{calls.push({url:String(url),init:init!});return String(url).endsWith('/relations')?json({...relation,secret:'NEVER_COPY'}):json({keyword,source:'https://tag.observe.tw',status:'available',illustration:{...picture,secret:'NEVER_COPY'}});}) as typeof fetch;
 const data=await fetchKeywordMetadata(keyword,'http://127.0.0.1:4100/api/v1',transport);
 assert.equal(calls.length,2);for(const {url,init} of calls){assert.ok(url.startsWith('http://127.0.0.1:4100/api/v1/keywords/'));assert.equal(init.cache,'no-store');assert.equal(init.credentials,'omit');assert.equal(init.redirect,'error');assert.deepEqual(init.headers,{Accept:'application/json',DNT:'1','Sec-GPC':'1'});}
 assert.doesNotMatch(JSON.stringify(data),/NEVER_COPY/);
 const html=renderToStaticMarkup(createElement(KeywordRelations,{keyword,initialView:data.relations}))+renderToStaticMarkup(createElement(KeywordIllustration,{keyword,initialView:data.illustration}));
 assert.match(html,/尚未收錄/);assert.match(html,/loading="eager"/);assert.match(html,/fetchPriority="high"/i);assert.match(html,/width="96" height="96"/);assert.doesNotMatch(html,/正在讀取|載入後另外讀取/);
});
test('optional metadata errors do not claim empty; oversized or wrong-keyword pictures are rejected',async()=>{
 for(const response of [()=>new Response('failure',{status:503}),()=>json({...relation,keyword:'別人'}),()=>new Response('x'.repeat(131073),{headers:{'content-type':'application/json'}})]){
  const data=await fetchKeywordMetadata(keyword,'http://127.0.0.1:4100/api/v1',(async()=>response()) as typeof fetch);
  assert.equal(data.relations.kind,'unavailable');assert.equal(data.illustration.kind,'unavailable');
 }
 const data=await fetchKeywordMetadata(' invalid ','http://127.0.0.1:4100/api/v1',(async()=>{throw Error('must not fetch');}) as typeof fetch);assert.equal(data.relations.kind,'unavailable');
});
test('keyword profile HTML and RSC remain dynamic/private on canonical and query URLs',()=>{
 for(const suffix of ['','?days=7','?_rsc=sample']){const decision=publicRenderDecision(new URL('https://youtube.observe.tw/keywords/'+encodeURIComponent(keyword)+'/videos'+suffix),'GET');assert.equal(decision.kind,'render');if(decision.kind==='render'){assert.equal(decision.eligible,null);assert.equal(decision.target,'filtered');}}
});
test('SSR metadata has a hard deadline even when a transport ignores abort',async()=>{
 const data=await fetchKeywordMetadata(keyword,'http://127.0.0.1:4100/api/v1',(()=>new Promise(()=>{})) as typeof fetch);
 assert.equal(data.relations.kind,'unavailable');assert.equal(data.illustration.kind,'unavailable');
});
test('failed illustration responses always close their body',async()=>{
 for(const [status,headers] of [[503,{'content-type':'application/json'}],[200,{'content-type':'text/html'}],[200,{'content-type':'application/json','content-length':'131073'}]] as const){
  let cancelled=0;
  const transport=(async(url)=>String(url).endsWith('/relations')?json(relation):new Response(new ReadableStream({cancel(){cancelled++;}}),{status,headers})) as typeof fetch;
  await fetchKeywordMetadata(keyword,'http://127.0.0.1:4100/api/v1',transport);assert.equal(cancelled,1);
 }
});
test('deadline cancels stalled illustration but preserves a settled relations Retry-After',async()=>{
 let cancelled=0;
 const data=await fetchKeywordMetadata(keyword,'http://127.0.0.1:4100/api/v1',(async(url)=>String(url).endsWith('/relations')?new Response('',{status:429,headers:{'retry-after':'120'}}):new Response(new ReadableStream({cancel(){cancelled++;}}),{headers:{'content-type':'application/json'}})) as typeof fetch);
 assert.equal(cancelled,1);assert.equal(data.relations.kind,'unavailable');if(data.relations.kind==='unavailable')assert.equal(data.relations.retryAfterSeconds,120);
});
test('late ignored-abort illustration is cancelled without reading its body',async()=>{
 let cancelled=0,pulled=0;
 const transport=(async(url,init)=>{
  if(String(url).endsWith('/relations'))return json(relation);
  await new Promise<void>(resolve=>init!.signal!.addEventListener('abort',()=>resolve(),{once:true}));
  return new Response(new ReadableStream({pull(){pulled++;},cancel(){cancelled++;}},{highWaterMark:0}),{headers:{'content-type':'application/json'}});
 }) as typeof fetch;
 const data=await fetchKeywordMetadata(keyword,'http://127.0.0.1:4100/api/v1',transport);await new Promise(resolve=>setTimeout(resolve,0));
 assert.equal(cancelled,1);assert.equal(pulled,0);assert.equal(data.relations.kind,'available');
});
test('dynamic canonical profiles retain indexing and breadcrumb data; real filters remain noindex',async()=>{
 const {canonicalKeywordProfile}=await import('./public-render');const {resolveRoute}=await import('./routes');
 const {reportMetadata,filteredReportMetadata,breadcrumbJsonLd,reportBreadcrumbs}=await import('./seo');
 const segments=['keywords',keyword,'videos'],route=resolveRoute(segments)!;
 for(const search of [{},{_rsc:'sample'},{days:'7'}]){
  const canonical=canonicalKeywordProfile(route.kind,search);assert.equal(canonical,!('days' in search));
  const meta=canonical?reportMetadata(route,segments):filteredReportMetadata(route,segments);
  assert.equal((meta.robots as {index?:boolean}|undefined)?.index!==false,canonical);
  if(canonical)assert.match(JSON.stringify(breadcrumbJsonLd(reportBreadcrumbs(route,segments))),/keywords/);
 }
});
