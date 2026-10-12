import {test} from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {NextRequest} from 'next/server';
import {API_DOCS_CATALOG_TITLE,API_DOCS_RULES_TITLE,endpointSummaries,inlineParts,openApiPath,parseApiDocs,plainText,tableCells,type DocBlock,type DocSection} from './api-docs';
import {fetchApiAvailability,parseApiAvailability} from './api-status';
import {publicRenderDecision} from './public-render';
import {proxy,config} from '../proxy';
import {Blocks} from '../components/ApiDocument';
import {PUBLIC_RENDER_HEADER,PUBLIC_RENDER_REVALIDATE_SECONDS} from '../../../shared/public-render-contract';
const file=(name:string)=>{for(const root of [process.cwd(),join(process.cwd(),'web'),join(process.cwd(),'platform/web')]){const path=join(root,name);if(existsSync(path))return readFileSync(path,'utf8');}throw new Error('missing '+name);};
const markdown=file('../docs/api.md');
const doc=parseApiDocs(markdown);
const all=(sections:DocSection[]):DocSection[]=>sections.flatMap(s=>[s,...all(s.children)]);
const tables=(sections:DocSection[])=>all(sections).flatMap(s=>s.blocks.filter((b):b is Extract<DocBlock,{kind:'table'}>=>b.kind==='table'));
const text=(blocks:DocBlock[])=>blocks.map(b=>b.kind==='paragraph'?b.text:b.kind==='list'?b.items.join('\n'):'').join('\n');
const pages=['src/app/api/page.tsx','src/app/api/status/page.tsx','src/app/api/status/ApiStatusView.tsx','src/components/ApiDocument.tsx','src/components/ApiTabs.tsx'];

test('generated docs parse into the same catalog the generator wrote, with no hand-kept endpoint list',()=>{
 assert.equal(doc.title,'有影儀表板公開 API');
 assert.ok(doc.intro.length>=1&&doc.intro.every(b=>b.kind==='paragraph'));
 for(const title of [API_DOCS_RULES_TITLE,'分頁與狀態','規格與文件入口','快速開始',API_DOCS_CATALOG_TITLE,'參數','回應欄位','舊版 PHP API 對照'])assert.equal(doc.sections.filter(s=>s.title===title).length,1,title);
 const rules=doc.sections.find(s=>s.title===API_DOCS_RULES_TITLE)!;
 assert.ok(rules.blocks.some(b=>b.kind==='list'&&b.items.some(i=>/400參數錯誤.*503/.test(i))));
 // Every catalog row of the Markdown table is present, in order.
 const catalogRows=markdown.split(`## ${API_DOCS_CATALOG_TITLE}`)[1]!.split('\n## ')[0]!.split('\n').filter(l=>/^\| GET \|/.test(l));
 const summaries=endpointSummaries(doc);
 assert.equal(summaries.size,catalogRows.length);assert.ok(summaries.size>100);
 assert.equal(summaries.get('GET /api/status'),'Public API availability');
 assert.equal(summaries.get(`GET ${openApiPath('/api/v1/channels/:id')}`),'Channel profile');
 // Code examples, errors, pagination and legacy mappings come through.
 const code=all(doc.sections).flatMap(s=>s.blocks).filter(b=>b.kind==='code');
 assert.ok(code.some(b=>b.kind==='code'&&b.lang==='bash'&&b.code.includes('curl')));
 const legacy=doc.sections.find(s=>s.title==='舊版 PHP API 對照')!.blocks.find(b=>b.kind==='table') as Extract<DocBlock,{kind:'table'}>;
 assert.equal(legacy.rows.length,(markdown.match(/^\| `\/api\/[a-z_]+\.php` \|/gm)??[]).length);
 // Escaped pipes stay inside their cell.
 for(const t of tables(doc.sections))for(const row of t.rows)assert.equal(row.length,t.head.length);
 assert.deepEqual(tableCells('| `a` | string \\| null | yes |'),['`a`','string | null','yes']);
 const ids=all(doc.sections).map(s=>s.id);assert.equal(new Set(ids).size,ids.length);
 assert.equal(rules.id,'使用規則');
 // The page renders the document's own 使用規則 once and the loader checks the Chinese headings.
 const page=file('src/app/api/page.tsx');assert.doesNotMatch(page,/>使用規則<|id: 'rules'/);
 const loader=file('src/lib/api-docs-source.ts');assert.match(loader,/API_DOCS_RULES_TITLE/);assert.match(loader,/API_DOCS_CATALOG_TITLE/);assert.doesNotMatch(loader,/Endpoint catalog/);
 assert.match(file('next.config.ts'),/outputFileTracingIncludes: \{ "\/api": \["\.\.\/docs\/api\.md"\], "\/api\/status": \["\.\.\/docs\/api\.md"\] \}/);
});
test('quota, keys and pagination claims come only from the generated docs, never from the frontend',()=>{
 // This release documents anonymous limits and offset pagination; keys and cursors are pending.
 const pagination=doc.sections.find(s=>s.title==='分頁與狀態')!;
 assert.match(text(pagination.blocks),/offset/);
 for(const page of pages){
  const source=file(page);
  assert.doesNotMatch(source,/x-api-key|金鑰|apiKey|nextCursor|游標|1000|1,000|每分鐘\s*\d/i,page);
  // No key management UI on these pages.
  assert.doesNotMatch(source,/<form|<input|type="password"/,page);
 }
});
test('documentation renders as text only: source HTML is escaped, never markup',()=>{
 // The generator's HTML comment is stripped; a legitimate code example naming the generator may remain.
 assert.doesNotMatch(JSON.stringify(doc),/<!--|-->/);
 assert.match(JSON.stringify(doc),/node --import tsx tools\/gen-api-docs\.ts/);
 const hostile=parseApiDocs('# T\n\n<script>alert(1)</script> and `<img src=x onerror=alert(1)>`\n\n| a | b |\n| --- | --- |\n| <b>x</b> | `y` |\n');
 const html=renderToStaticMarkup(createElement(Blocks,{blocks:hostile.intro,label:'t'}));
 assert.doesNotMatch(html,/<script|<img|<b>/);assert.match(html,/&lt;script&gt;/);
 assert.deepEqual(inlineParts('a `b` c'),[{code:false,text:'a '},{code:true,text:'b'},{code:false,text:' c'}]);
 assert.equal(plainText('`GET` /x'),'GET /x');
 for(const page of pages)assert.doesNotMatch(file(page),/dangerouslySetInnerHTML/,page);
});
test('generated tables scroll inside TableScroller with a sticky single-line lead column',()=>{
 const block=tables(doc.sections)[0]!;
 const html=renderToStaticMarkup(createElement(Blocks,{blocks:[block],label:'t'}));
 assert.match(html,/class="table-scroller[^"]*overflow-x-auto/);
 // Every cell stays on one line at all widths: no responsive wrap override anywhere in the table.
 assert.match(html,/<table class="[^"]*whitespace-nowrap/);
 assert.doesNotMatch(html,/whitespace-normal/);
 assert.match(html,/<td class="[^"]*whitespace-nowrap[^"]*"><span class="table-clip [^"]*truncate[^"]*" title="/);
 for(const src of ['src/components/ApiDocument.tsx','src/app/api/status/ApiStatusView.tsx'])assert.doesNotMatch(file(src),/sm:whitespace-normal/,src);
 assert.match(html,/<th scope="col" class="table-lead sticky left-0/);
 assert.match(html,/<th scope="row" class="table-lead sticky left-0[^"]*"><div class="table-lead-box[^"]*"><span class="block [^"]*truncate" title="/);
 // Table code spans keep to one line; prose code may wrap so paragraphs never widen the page.
 assert.doesNotMatch(html,/break-all/);
 const prose=renderToStaticMarkup(createElement(Blocks,{blocks:[{kind:'paragraph',text:'`/api/v1/very/long/path`'}],label:'t'}));
 assert.match(prose,/<code class="[^"]*break-all/);
 assert.match(file('src/components/ApiDocument.tsx'),/overflow-x-auto/);
 assert.match(file('src/app/api/status/ApiStatusView.tsx'),/<TableScroller card/);
});
test('/api is ISR-eligible as the api route; /api/status is never shared; /api/v1 and /auth stay outside the proxy',()=>{
 assert.equal(PUBLIC_RENDER_REVALIDATE_SECONDS.api,3600);
 const page=file('src/app/api/page.tsx');
 assert.match(page,/^export const revalidate = 3600;$/m);assert.doesNotMatch(page,/searchParams|next\/headers|cookies\(|headers\(|force-dynamic|connection\(/);
 const status=file('src/app/api/status/page.tsx');assert.doesNotMatch(status,/searchParams|next\/headers|cookies\(|headers\(|export const revalidate|fetch\(/);
 const decide=(path:string,method?:string)=>publicRenderDecision(new URL(path,'http://local'),method);
 assert.deepEqual(decide('/api'),{kind:'render',target:null,eligible:'api'});
 assert.deepEqual(decide('/api','HEAD'),{kind:'render',target:null,eligible:'api'});
 for(const path of ['/api?x=1','/api?_rsc=1','/api/status','/api/status?x=1'])assert.deepEqual(decide(path),{kind:'render',target:null,eligible:null},path);
 assert.equal((decide('/api','POST') as {eligible:unknown}).eligible,null);
 const call=(path:string)=>proxy(new NextRequest('http://localhost:3100'+path,{headers:{[PUBLIC_RENDER_HEADER]:'api'}}));
 const docs=call('/api');assert.equal(docs.headers.get(PUBLIC_RENDER_HEADER),'api');assert.equal(docs.headers.get('cache-control'),null);assert.equal(docs.headers.get('x-robots-tag'),null);
 for(const path of ['/api/status','/api?q=1']){const response=call(path);assert.equal(response.headers.get(PUBLIC_RENDER_HEADER),null,path);assert.equal(response.headers.get('cache-control'),'private, no-store',path);}
 assert.equal(call('/api?q=1').headers.get('x-robots-tag'),'noindex, follow');
 // Only the two exact HTML pages are proxied; the catch-all still skips every /api path.
 const apiEntries=config.matcher.filter(m=>/^\/(?:\(\?!.*)?api/.test(m)||m.startsWith('/api'));
 assert.deepEqual(apiEntries,['/api','/api/status']);
 assert.match(config.matcher[0]!,/\(\?:api\|auth\|/);
});
test('status view keeps only availability and endpoint paths; 503 bodies still describe availability',async()=>{
 const body={status:'degraded',scope:'api_availability',checkedAt:'2026-10-12T00:00:00.000Z',services:[{id:'reports',status:'unavailable',detail:'mariadb://internal'}],endpoints:[{method:'GET',path:'/api/v1/channels/:id',table:'channels'},{method:'POST',path:'/api/x'},{method:'GET',path:'http://internal/x'},{method:'GET',path:'/api/v1/x?token=secret'},{method:'GET',path:'/api/v1/x#frag'}],internal:'secret'};
 const parsed=parseApiAvailability(body);
 assert.deepEqual(parsed,{status:'degraded',checkedAt:body.checkedAt,services:[{id:'reports',status:'unavailable'}],endpoints:[{method:'GET',path:'/api/v1/channels/:id'}]});
 assert.doesNotMatch(JSON.stringify(parsed),/internal|secret|mariadb|token/);
 for(const bad of [null,[],{...body,scope:'data'},{...body,status:'fresh'},{...body,checkedAt:'x'}])assert.equal(parseApiAvailability(bad),null);
 const seen:RequestInit[]=[];
 const json=(status:number,value:unknown)=>(async(input:RequestInfo|URL,init?:RequestInit)=>{assert.equal(String(input),'/api/status');seen.push(init!);return Response.json(value,{status});}) as typeof fetch;
 assert.equal((await fetchApiAvailability(json(503,body)))?.status,'degraded');
 assert.equal(new Headers(seen[0]!.headers).get('accept'),'application/json');assert.equal(seen[0]!.cache,'no-store');assert.equal(seen[0]!.credentials,'omit');
 assert.equal(await fetchApiAvailability(json(500,body)),null);
 // The HTML page answering its own path (no gateway negotiation) is "unavailable", not re-fetched.
 let calls=0;const html=(async()=>{calls++;return new Response('<!doctype html>',{headers:{'content-type':'text/html'}});}) as typeof fetch;
 assert.equal(await fetchApiAvailability(html),null);assert.equal(calls,1);
 assert.equal(await fetchApiAvailability((async()=>{throw new Error('offline');}) as typeof fetch),null);
});
test('attribution and navigation link follow the tag-style development group',()=>{
 const footer=file('src/components/SiteFooter.tsx');
 assert.match(footer,/label: '開發與來源', links: \[\n\s+\{ href: '\/api', label: 'API 文件與狀態' \}/);
 // API docs live in the footer only; the header lists public reports.
 assert.doesNotMatch(file('src/lib/site-nav.ts'),/href: '\/api'/);
 for(const name of ['src/components/SiteFooter.tsx','src/app/api/page.tsx']){const source=file(name);assert.match(source,/標籤來源：新文易數（tag\.observe\.tw）/,name);assert.doesNotMatch(source,/新文易數 tag\.observe\.tw|記者/,name);}
 for(const name of ['src/components/SiteFooter.tsx','src/lib/site-nav.ts','src/components/ApiTabs.tsx'])assert.doesNotMatch(file(name),/href: '\/api\/'/,name);
});
