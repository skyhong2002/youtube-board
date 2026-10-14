import assert from 'node:assert/strict';
import test from 'node:test';
import {existsSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {createElement,type ReactNode} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import Link from 'next/link';
import {ImageConfigContext} from 'next/dist/shared/lib/image-config-context.shared-runtime';
import {imageConfigDefault} from 'next/dist/shared/lib/image-config';
import config from '../../next.config';
import type {HomeKeywordSummary,ReportMeta,VideoRow} from '../../../api/src/contracts';
import LinkPending,{LinkPendingHint} from '../components/LinkPending';
import {KeywordRankingView} from '../components/KeywordRanking';
import {KeywordProfile} from '../components/KeywordProfile';

/* Offline server-markup checks of the F2 link pending hint. Outside a running App Router,
 * next/link's useLinkStatus always reports idle, so the pending branch is exercised through the
 * presentational LinkPendingHint and the wiring through markup placement plus a source check.
 * None of this proves that a real navigation shows the hint, its timing, or its contrast. */
const html=(node:ReactNode)=>renderToStaticMarkup(createElement(ImageConfigContext.Provider,{value:{...imageConfigDefault,...config.images}},node));
const text=(markup:string)=>markup.replace(/<[^>]*>/g,'');
const outerClass=(markup:string)=>markup.match(/^<span class="([^"]*)"/)?.[1]??'';
const ringClass=(markup:string)=>markup.match(/<span aria-hidden="true" class="([^"]*)"/)?.[1]??'';
/** Every <a> element (none are nested) that carries a pending hint, as [href, anchor markup]. */
const hinted=(markup:string)=>(markup.match(/<a\s[^>]*>[\s\S]*?<\/a>/g)??[]).filter(a=>a.includes('data-link-pending=')).map(a=>[a.match(/href="([^"]*)"/)?.[1]??'',a] as const);
const app=[process.cwd(),join(process.cwd(),'web'),join(process.cwd(),'platform/web')].map(root=>join(root,'src/app')).find(dir=>existsSync(join(dir,'error.tsx')));
const source=(file:string)=>{assert.ok(app,'src/app not found');return readFileSync(join(app,file),'utf8');};

test('pending hint: idle is invisible but reserves the same fixed box; pending shows a delayed ring and says loading',()=>{
 const idle=renderToStaticMarkup(createElement(LinkPendingHint,{pending:false}));
 const pending=renderToStaticMarkup(createElement(LinkPendingHint,{pending:true}));
 assert.match(idle,/data-link-pending="idle"/);assert.match(pending,/data-link-pending="pending"/);
 // Same always-rendered footprint in both states: toggling cannot shift the link's layout.
 assert.equal(outerClass(idle),outerClass(pending));assert.match(outerClass(idle),/\binline-flex\b/);assert.match(outerClass(idle),/\bsize-3\b/);assert.match(outerClass(idle),/\bshrink-0\b/);
 for(const markup of [idle,pending])assert.match(ringClass(markup),/\bsize-2\.5\b.*\bborder-current\b/);
 assert.match(ringClass(idle),/\bopacity-0\b/);assert.doesNotMatch(ringClass(idle),/opacity-100|animate-spin|delay-/);
 // Fades in only after 150ms (fast or prefetched navigations do not flash); spin respects reduced motion.
 assert.match(ringClass(pending),/\bopacity-100\b/);assert.match(ringClass(pending),/\bdelay-150\b/);assert.match(ringClass(pending),/\bmotion-safe:animate-spin\b/);assert.match(ringClass(pending),/motion-reduce:transition-none/);
 // Honest screen-reader feedback: a polite status that is empty when idle and only says loading.
 assert.match(idle,/<span role="status" class="sr-only"><\/span>/);
 assert.match(pending,/<span role="status" class="sr-only">頁面載入中<\/span>/);
 assert.equal(text(idle),'');assert.equal(text(pending),'頁面載入中');
 // No fake rows/counts and nothing a hash CSP would have to allow.
 assert.doesNotMatch(idle+pending,/style=|<script|<tr|<li|<table/);
 assert.match(renderToStaticMarkup(createElement(LinkPendingHint,{pending:true,className:'text-(--accent)'})),/^<span class="[^"]*text-\(--accent\)[^"]*" data-link-pending="pending">/);
});

test('the real wrapper reads next/link status: idle outside navigation, rendered inside the Link it reports on',()=>{
 // useLinkStatus behaves like useFormStatus: without an active navigation it is { pending: false }.
 assert.equal(renderToStaticMarkup(createElement(LinkPending)),renderToStaticMarkup(createElement(LinkPendingHint,{pending:false})));
 const linked=renderToStaticMarkup(createElement(Link,{href:'/keywords'},'熱門標籤排行 →',createElement(LinkPending)));
 assert.match(linked,/^<a [^>]*href="\/keywords"[^>]*>熱門標籤排行 →<span class="[^"]*" data-link-pending="idle">[\s\S]*<\/span><\/a>$/);
 // A disconnected wrapper (constant prop, missing hook, wrong import) would still render idle above;
 // this catches it at the source. Loose on formatting, strict on the data flow.
 const wrapper=source('../components/LinkPending.tsx');
 assert.match(wrapper,/^'use client';/);
 assert.match(wrapper,/import \{useLinkStatus\} from 'next\/link';/);
 const body=wrapper.slice(wrapper.indexOf('export default function LinkPending'));
 assert.match(body,/const \{pending\}=useLinkStatus\(\);/);assert.match(body,/<LinkPendingHint pending=\{pending\}/);
});

type Row=HomeKeywordSummary['rows'][number];
const row=(i:number,patch:Partial<Row>={}):Row=>({key:`k${i}`,term:`詞${i}`,sourceTerms:[{key:`k${i}`,term:`詞${i}`}],videoCount:10+i,views:1000*i,unknownViewVideos:0,knownViews:1000*i,measuredViewVideos:10+i,heatScore:5+i,channelCount:2,titleVideos:1,descriptionOnlyVideos:9+i,rise:null,trend:[],representativeVideoId:null,thumbnail:null,channel:null,...patch});
const summary=(patch:Partial<HomeKeywordSummary>={}):HomeKeywordSummary=>({vocabularyCoverage:'observed-article-window',vocabularyWindow:null,source:'https://tag.observe.tw',version:'run-1',status:'synchronized',reason:null,from:'2026-10-06T00:00:00+08:00',to:'2026-10-12T09:30:00+08:00',updatedAt:'2026-10-12T01:00:00.000Z',rows:[],sourceVideos:10,freshVideos:8,staleVideos:1,unprocessedVideos:1,metric:'current-cumulative-views-of-window-published-videos',rankingMethod:'youtube-channel-weighted-decay-v1',riseMethod:'equal-duration-heat-delta',ruleVersion:'youtube-quality-v2',comparison:null,exclusions:null,...patch});
const meta=():ReportMeta=>({schemaVersion:1,requestedAt:'2026-10-12T00:00:00Z',updatedAt:null,timezone:'Asia/Taipei',source:'mariadb',dataset:'live',warnings:[],coverage:{}});

test('/keywords: every ranked term link (and only those) carries the hint; label, href and date scope are unchanged',()=>{
 const week=summary({rows:[row(1,{term:'a/b%41',representativeVideoId:'AbCdEfGh123'}),row(9,{term:'100%'})]});
 const markup=html(createElement(KeywordRankingView,{exploration:{keywords:week},meta:meta(),initial:'week'}));
 const links=hinted(markup);
 assert.deepEqual(links.map(([href])=>href),['/keywords/a%2Fb%2541/videos?from=2026-10-06&amp;to=2026-10-12','/keywords/100%25/videos?from=2026-10-06&amp;to=2026-10-12']);
 assert.equal(markup.match(/data-link-pending=/g)?.length,2);
 for(const [,anchor] of links){
  // The exact term wraps on phones; the hint follows it inside the same link.
  assert.match(anchor,/<span class="min-w-0 max-w-full whitespace-normal \[overflow-wrap:anywhere\] sm:truncate sm:whitespace-nowrap">(a\/b%41|100%)<\/span><span class="[^"]*" data-link-pending="idle">/);
  assert.match(anchor,/class="[^"]*text-brand-700[^"]*dark:text-brand-400/);
  assert.doesNotMatch(anchor.slice(0,anchor.indexOf('>')),/aria-hidden|tabindex="-1"/);
 }
 // The decorative thumbnail link (aria-hidden, no focus) gets no status region.
 assert.ok((markup.match(/<a [^>]*aria-hidden="true"[^>]*>[\s\S]*?<\/a>/g)??[]).every(a=>!a.includes('data-link-pending')));
});

test('keyword profile: the back link to /keywords and each evidence link carry the hint; pagination and filters keep their scope',()=>{
 const evidence=[{term:'交通',field:'title' as const,snippet:'前文交通後文',start:2,end:4,snippetStart:0}];
 const video=(id:string,patch:Partial<VideoRow>={})=>({id,title:`影片${id}`,views:null,channelId:42,channelTitle:'來源頻道',youtubeChannelId:'',description:'',thumbnail:null,publishedAt:'2026-10-12T00:00:00Z',likes:null,comments:0,updatedAt:null,youtubeUrl:'',...patch}) as VideoRow;
 const markup=html(createElement(KeywordProfile,{keyword:'a/b%41',description:'範圍說明',data:{rows:[video('AbCdEfGh123',{keywordEvidence:evidence}),video('BbCdEfGh123')],total:2,limit:50,offset:0,hasNext:false,totalStatus:'exact'},meta:meta(),notice:null,tabs:null,filters:null,
  pagination:createElement(Link,{href:'/keywords/a%2Fb%2541/videos?from=2026-10-06&to=2026-10-12&offset=50'},'下一頁'),period:{from:'2026-10-06',to:'2026-10-12',days:null}}));
 assert.deepEqual(hinted(markup).map(([href])=>href),['/keywords','/videos/AbCdEfGh123#keyword-evidence']);
 assert.match(markup,/>熱門標籤排行 →<span class="[^"]*" data-link-pending="idle">/);assert.match(markup,/>查看影片比對依據 →<span class="[^"]*" data-link-pending="idle">/);
 // Page content stays as rendered: exact keyword, period and counts are untouched by the hint.
 assert.match(markup,/<span class="text-zinc-500">#<\/span>a\/b%41<\/h1>/);assert.match(markup,/發布日期 2026-10-06 至 2026-10-12（台北時間）/);assert.match(markup,/2 部<\/span><\/h2>/);
 assert.ok(markup.includes('href="/keywords/a%2Fb%2541/videos?from=2026-10-06&amp;to=2026-10-12&amp;offset=50"'));
});

test('home: the ranking rows and the 熱門標籤 完整排行 link render the hint inside their Link (source check; HomePage needs a live API read)',()=>{
 const home=source('_home/HomePage.tsx');
 assert.match(home,/import LinkPending from '@\/components\/LinkPending';/);
 const rankingLink=home.match(/<Link href=\{keywordVideosHref\(term\.term,view\.summary\)\}[\s\S]*?<\/Link>/)?.[0]??'';
 assert.match(rankingLink,/<LinkPending className="text-\(--accent\)"\/><\/Link>$/);
 const section=home.match(/function Section[\s\S]*?<\/Link>/)?.[0]??'';
 assert.match(section,/\{pending&&<LinkPending[^>]*\/>\}<\/Link>$/);
 assert.match(home,/<Section title="熱門標籤" href="\/keywords" label="完整排行" pending\/>/);
 // Other sections keep their links unchanged (opt-in only).
 assert.equal(home.match(/<Section [^>]*\bpending\b/g)?.length,1);
});

test('pending feedback adds no requests or timers; only numeric AI topic links opt out of prefetch',()=>{
 for(const file of ['_home/HomePage.tsx','../components/KeywordRanking.tsx','../components/KeywordProfile.tsx','../components/LinkPending.tsx'])
  {
   const text=source(file);
   assert.doesNotMatch(text,/<Suspense|\buseEffect\b|\bfetch\(|setTimeout|setInterval|\brouter\.(?:refresh|push|replace|prefetch)/,file);
   if(file==='_home/HomePage.tsx'){
    const overrides=[...text.matchAll(/\bprefetch=\{([^}]*)\}/g)].map(match=>match[1]);
    assert.equal(overrides.length,5);
    assert.ok(overrides.every(value=>/^reportLinkPrefetch\(topicHref\((lead|topic)\)\)$/.test(value)));
   }else assert.doesNotMatch(text,/\bprefetch=/,file);
  }
 // The route-level loading guard in keyword-states.test.ts still holds; the hint lives below the blocking server read.
 for(const dir of ['','[...segments]','render-filtered/report/[...segments]','render-isr/home/[edition]'])assert.equal(existsSync(join(app!,dir,'loading.tsx')),false,dir);
});
