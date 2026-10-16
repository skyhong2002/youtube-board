import assert from 'node:assert/strict';
import test from 'node:test';
import {existsSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {createElement,type ReactElement,type ReactNode} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {ImageConfigContext} from 'next/dist/shared/lib/image-config-context.shared-runtime';
import {imageConfigDefault} from 'next/dist/shared/lib/image-config';
import config from '../../next.config';
import type {HomeKeywordSummary,ReportMeta,VideoRow} from '../../../api/src/contracts';
import {homeKeywordState} from './home-presentation';
import {KeywordRankingView} from '../components/KeywordRanking';
import {KeywordProfile} from '../components/KeywordProfile';
import {Pagination} from '../components/Pagination';
import {Unavailable} from '../components/ReportUI';
import ErrorPage from '../app/error';

/* Offline server-markup checks of the F2 keyword states. They read rendered HTML and class
 * names only: they do not measure contrast, run a browser, switch periods interactively or
 * stand in for visual acceptance. */
const html=(node:ReactNode)=>renderToStaticMarkup(createElement(ImageConfigContext.Provider,{value:{...imageConfigDefault,...config.images}},node));
type Row=HomeKeywordSummary['rows'][number];
const row=(i:number,patch:Partial<Row>={}):Row=>({key:`k${i}`,term:`詞${i}`,sourceTerms:[{key:`k${i}`,term:`詞${i}`}],videoCount:10+i,views:1000*i,unknownViewVideos:0,knownViews:1000*i,measuredViewVideos:10+i,heatScore:5+i,channelCount:2,titleVideos:1,descriptionOnlyVideos:9+i,rise:null,trend:[],representativeVideoId:null,thumbnail:null,channel:null,...patch});
const summary=(patch:Partial<HomeKeywordSummary>={}):HomeKeywordSummary=>({vocabularyCoverage:'observed-article-window',vocabularyWindow:null,source:'https://tag.observe.tw',version:'run-1',status:'synchronized',reason:null,from:'2026-10-05T16:00:00.000Z',to:'2026-10-12T01:30:00.000Z',updatedAt:'2026-10-12T01:00:00.000Z',rows:[],sourceVideos:10,freshVideos:8,staleVideos:1,unprocessedVideos:1,metric:'current-cumulative-views-of-window-published-videos',rankingMethod:'youtube-channel-weighted-decay-v1',riseMethod:'equal-duration-heat-delta',ruleVersion:'youtube-quality-v2',comparison:null,exclusions:null,...patch});
const today=(patch:Partial<HomeKeywordSummary>={})=>summary({from:'2026-10-11T16:00:00.000Z',...patch});
const meta=(coverage:ReportMeta['coverage']={}):ReportMeta=>({schemaVersion:1,requestedAt:'2026-10-12T00:00:00Z',updatedAt:null,timezone:'Asia/Taipei',source:'mariadb',dataset:'live',warnings:[],coverage});
const checkedWindow=(markup:string)=>(markup.match(/<input[^>]*>/g)??[]).filter(input=>/\schecked=""/.test(input)).map(input=>input.match(/value="(\w+)"/)?.[1]);
const EMPTY_WORDING=/尚無收錄的發布影片|尚未出現共同詞彙/;

test('state kinds: only a confirmed successful read with no rows is empty; unknown and unread states stay distinct',()=>{
 const kind=(s:HomeKeywordSummary|null)=>homeKeywordState(s,'week').kind;
 assert.equal(kind(summary({rows:[row(1)]})),'listed');
 assert.equal(kind(summary({sourceVideos:0,freshVideos:0})),'empty');
 assert.equal(kind(summary({sourceVideos:5,freshVideos:4})),'empty');
 assert.equal(kind(null),'unknown');
 assert.equal(kind(summary({sourceVideos:null,freshVideos:null})),'unknown');
 assert.equal(kind(summary({status:'unavailable',rows:[row(1)]})),'unavailable');
 assert.equal(kind(summary({status:'not-synchronized',rows:[row(1)]})),'not-synchronized');
 assert.equal(kind(summary({sourceVideos:5,freshVideos:0})),'not-computed');
 // A null completion count is unknown progress, not a measured zero (corrected from 'not-computed').
 assert.equal(kind(summary({sourceVideos:5,freshVideos:null})),'completion-unknown');
 // Rows that were never matched (videoCount 0) are not listed rows.
 assert.equal(kind(summary({rows:[row(1,{videoCount:0})]})),'empty');
 for(const s of [null,summary({status:'unavailable'}),summary({status:'not-synchronized'}),summary({sourceVideos:5,freshVideos:0}),summary({sourceVideos:null})])assert.doesNotMatch(homeKeywordState(s,'today').message??'',EMPTY_WORDING);
});

test('completion count: null, omitted or malformed freshVideos is unknown progress; only a measured 0 is not-computed',()=>{
 const state=(patch:Partial<HomeKeywordSummary>)=>homeKeywordState(summary(patch),'week');
 const omitted=(()=>{const {freshVideos:_f,...rest}=summary({sourceVideos:5});return rest as unknown as HomeKeywordSummary;})();
 const unknown=[summary({sourceVideos:5,freshVideos:null}),omitted,...[Number.NaN,-1,1.5,'4',Infinity].map(v=>summary({sourceVideos:5,freshVideos:v as unknown as number}))];
 for(const s of unknown){
  const {kind,message,rows}=homeKeywordState(s,'week'),label=String(s.freshVideos);
  assert.equal(kind,'completion-unknown',label);assert.deepEqual(rows,[],label);
  assert.equal(message,'近七日收錄 5 支影片，完成比對的影片數未提供；比對進度未知，不代表沒有相關影片。',label);
  // Never presented as a known zero, a completed empty read, or the measured-zero sentence.
  assert.doesNotMatch(message??'',/尚無完成比對|已完成比對|\b0 支|NaN|undefined|null/,label);assert.doesNotMatch(message??'',EMPTY_WORDING,label);
 }
 // Known states keep their prior messages.
 assert.equal(state({sourceVideos:5,freshVideos:0}).kind,'not-computed');assert.match(state({sourceVideos:5,freshVideos:0}).message??'',/近七日收錄 5 支影片，尚無完成比對的影片；沒有比對資料不代表沒有相關影片/);
 assert.equal(state({sourceVideos:5,freshVideos:4}).message,'近七日已完成比對 4 支影片，尚未出現共同詞彙。');
 assert.equal(state({sourceVideos:0,freshVideos:0}).message,'近七日尚無收錄的發布影片。');
 assert.equal(state({sourceVideos:0,freshVideos:null}).kind,'empty');
 assert.equal(state({sourceVideos:null,freshVideos:null}).message,'近七日尚無可確認的比對結果。');
 assert.equal(state({sourceVideos:null,freshVideos:3}).kind,'unknown');
 // A malformed or omitted collected count is unknown too, never "收錄 undefined/NaN 支".
 const noSource=(()=>{const {sourceVideos:_s,...rest}=summary();return rest as unknown as HomeKeywordSummary;})();
 for(const s of [noSource,summary({sourceVideos:Number.NaN}),summary({sourceVideos:-2})]){const r=homeKeywordState(s,'week');assert.equal(r.kind,'unknown');assert.doesNotMatch(r.message??'',/收錄|NaN|undefined/);}
 // Populated rows win regardless of the completion count; unavailable and not-synchronized stay unchanged.
 assert.equal(state({rows:[row(1)],freshVideos:null}).kind,'listed');
 assert.equal(state({status:'unavailable',freshVideos:null}).kind,'unavailable');
 assert.equal(state({status:'not-synchronized',freshVideos:null}).kind,'not-synchronized');
});

test('/keywords loaded: API order, selected-period links, partial views show their lower bound and a measured zero stays 0',()=>{
 const week=summary({rows:[row(1,{term:'a/b%41',views:null,unknownViewVideos:2,measuredViewVideos:9,knownViews:4000}),row(9,{term:'零觀看',views:0,knownViews:0})]});
 const markup=html(createElement(KeywordRankingView,{exploration:{keywords:week,keywordToday:today({rows:[row(3,{term:'過去24小時詞'})]})},meta:meta(),initial:'week'}));
 // Returned order, not re-sorted by heat (row 9 has the higher score).
 assert.ok(markup.indexOf('a/b%41')<markup.indexOf('零觀看'));
 assert.match(markup,/href="\/keywords\/a%2Fb%2541\/videos\?from=2026-10-06&amp;to=2026-10-12"/);
 assert.match(markup,/≥4,000 次<small[^>]*>（2 支缺值）/);
 assert.match(markup,/>0 次<\/td>/);
 assert.doesNotMatch(markup,/過去24小時詞|data-keyword-state/);
 assert.deepEqual(checkedWindow(markup),['week']);
 assert.match(markup,/data-keyword-window-pane="week"/);assert.doesNotMatch(markup,/data-keyword-window-pane="today"/);
 assert.match(markup,/列出 2 個標籤/);
 // Method/provenance disclosure and vocabulary link stay.
 assert.match(markup,/本頁資料來源與計算方式/);assert.match(markup,/href="\/vocabulary"/);
});

test('/keywords today states: empty, unknown, unavailable, not synchronized and not computed are each labelled and never a table',()=>{
 const week=summary({rows:[row(1,{term:'週詞'})]});
 const cases:[unknown,string,RegExp][]=[
  [today({sourceVideos:5,freshVideos:4}),'empty',/過去24小時已完成比對 4 支影片，尚未出現共同詞彙/],
  [today({sourceVideos:0,freshVideos:0}),'empty',/過去24小時尚無收錄的發布影片/],
  [undefined,'unknown',/尚未提供過去24小時關鍵字摘要；狀態未知，不代表沒有相關影片/],
  [today({status:'unavailable',rows:[row(2,{term:'舊資料詞'})]}),'unavailable',/過去24小時關鍵字觀測目前無法完整讀取/],
  [today({status:'not-synchronized',rows:[row(2,{term:'舊資料詞'})]}),'not-synchronized',/共同詞彙尚未同步/],
  [today({sourceVideos:5,freshVideos:0}),'not-computed',/收錄 5 支影片，尚無完成比對的影片；沒有比對資料不代表沒有相關影片/],
  [today({sourceVideos:5,freshVideos:null}),'completion-unknown',/過去24小時收錄 5 支影片，完成比對的影片數未提供；比對進度未知，不代表沒有相關影片/],
 ];
 for(const [keywordToday,kind,message] of cases){
  const exploration=keywordToday===undefined?{keywords:week}:{keywords:week,keywordToday:keywordToday as HomeKeywordSummary};
  const markup=html(createElement(KeywordRankingView,{exploration,meta:meta(),initial:'today'}));
  assert.match(markup,new RegExp(`role="status" class="[^"]*dark:bg-zinc-900[^"]*dark:text-zinc-400[^"]*" data-keyword-state="${kind}">`),kind);
  assert.match(markup,message,kind);
  assert.doesNotMatch(markup,/<table|週詞|舊資料詞|>0 次</,kind);
  if(kind!=='empty')assert.doesNotMatch(markup,EMPTY_WORDING,kind);
  // Period coherence: the switch, the controlled region and the content all say today.
  assert.deepEqual(checkedWindow(markup),['today'],kind);
  assert.match(markup,/<fieldset [^>]*data-keyword-window-selected="today"/);
  assert.match(markup,/<div id="keyword-ranking-table"><div class="space-y-3" data-keyword-window-pane="today">/);
 }
});

test('/keywords controls are labelled, keyboard-native and carry dark tokens (class presence only, not contrast)',()=>{
 const markup=html(createElement(KeywordRankingView,{exploration:{keywords:summary({rows:[row(1)]})},meta:meta()}));
 assert.match(markup,/<legend class="sr-only">排行期間<\/legend>/);
 assert.equal(markup.match(/type="radio"/g)?.length,2);assert.match(markup,/aria-controls="keyword-ranking-table"/);
 assert.match(markup,/peer-focus-visible:outline-2/);assert.match(markup,/dark:peer-checked:bg-brand-600/);assert.match(markup,/dark:text-brand-400/);
 // The scroll label is only applied once the client measures overflow, so the server markup has the card tokens alone.
 assert.match(markup,/table-card[^"]*dark:border-zinc-800 dark:bg-zinc-900/);
});

const video=(id:string,title:string,views:number|null,patch:object={})=>({id,title,views,channelId:42,channelTitle:'來源頻道',youtubeChannelId:'',description:'',thumbnail:null,publishedAt:'2026-10-12T00:00:00Z',likes:null,comments:0,updatedAt:null,youtubeUrl:'',...patch}) as VideoRow;
const PATH='/keywords/a%2Fb%2541/videos',SEARCH={from:'2026-10-06',to:'2026-10-12'};
const profile=(data:{rows:VideoRow[];total:number|null;limit:number;offset:number;hasNext:boolean;totalStatus:'exact'|'not-computed'|'unavailable'},coverage:ReportMeta['coverage']={})=>html(createElement(KeywordProfile,{keyword:'a/b%41',description:'範圍說明',data,meta:meta(coverage),notice:null,tabs:null,filters:null,
 pagination:createElement(Pagination,{collection:data,search:{...SEARCH,offset:String(data.offset)},path:PATH}),period:{...SEARCH,days:null}}));
const bodyOf=(markup:string)=>markup.split('本頁資料來源與計算方式')[0]!;

test('keyword profile loaded: exact keyword, period, real counts, pagination links keep the date scope; null views never 0',()=>{
 const evidence=[{term:'交通',field:'description',snippet:'',start:0,end:0,snippetStart:0},{term:'交通',field:'caption',snippet:'',start:0,end:0,snippetStart:0},{term:'交通',field:'title',snippet:'前文交通後文',start:2,end:4,snippetStart:0}];
 const markup=profile({rows:[video('AbCdEfGh123','無觀看列',null,{keywordEvidence:evidence}),video('BbCdEfGh123','零觀看列',0)],total:120,limit:50,offset:50,hasNext:true,totalStatus:'exact'});
 assert.match(markup,/<span class="text-zinc-500">#<\/span>a\/b%41<\/h1>/);
 assert.match(markup,/發布日期 2026-10-06 至 2026-10-12（台北時間）/);
 assert.match(markup,/120 部<\/span><\/h2>/);assert.match(markup,/目前條件共 120 部符合・本頁顯示 2 部。/);
 assert.ok(markup.indexOf('無觀看列')<markup.indexOf('零觀看列'));
 assert.match(markup,/<dt>累計觀看<\/dt><dd>無觀看值<\/dd>/);assert.match(markup,/<dt>累計觀看<\/dt><dd>0<\/dd>/);
 assert.equal(markup.match(/<dt>累計觀看<\/dt><dd>0<\/dd>/g)?.length,1);
 // Missing source text is said to be missing; the matched span keeps its non-shrinking mark.
 const body=bodyOf(markup);
 assert.match(body,/>說明<\/span><span class="text-xs">來源文字未提供<\/span>/);assert.match(body,/>字幕<\/span><span class="text-xs">字幕尚未取得<\/span>/);assert.equal(body.match(/沒有命中片段/g)?.length,1);
 assert.match(body,/<mark class="[^"]*shrink-0[^"]*">交通<\/mark>/);
 assert.match(markup,/<nav [^>]*aria-label="頁碼"/);assert.match(markup,/共 120 筆 · 第 51–52 筆/);
 assert.ok(markup.includes(`href="${PATH}?from=2026-10-06&amp;to=2026-10-12&amp;offset=0"`));
 assert.ok(markup.includes(`href="${PATH}?from=2026-10-06&amp;to=2026-10-12&amp;offset=100"`));
 assert.doesNotMatch(markup,/data-keyword-list-state/);
});

test('keyword profile empty states: counted zero, uncounted, unavailable total and a page past the results stay distinct',()=>{
 const none=profile({rows:[],total:0,limit:50,offset:0,hasNext:false,totalStatus:'exact'});
 assert.match(none,/role="status" data-keyword-list-state="none"/);assert.match(none,/不代表 YouTube 沒有相關內容/);assert.match(none,/0 部<\/span><\/h2>/);
 for(const totalStatus of ['not-computed','unavailable'] as const){
  const markup=profile({rows:[],total:null,limit:50,offset:0,hasNext:false,totalStatus});
  assert.match(markup,/data-keyword-list-state="uncounted"/,totalStatus);
  assert.ok(markup.includes(totalStatus==='unavailable'?'總數暫時無法取得':'總數未計算'),totalStatus);
  assert.doesNotMatch(markup,/0 部|共 0 筆|data-keyword-list-state="none"/,totalStatus);
 }
 const past=profile({rows:[],total:120,limit:50,offset:150,hasNext:false,totalStatus:'exact'});
 assert.equal(past.match(/data-keyword-results="page-empty"/g)?.length,2);
 assert.doesNotMatch(past,/data-keyword-list-state|目前沒有可呈現的符合影片/);
 assert.ok(past.includes(`href="${PATH}?from=2026-10-06&amp;to=2026-10-12&amp;offset=100"`));
 assert.doesNotMatch(past,/下一頁/);
});

const findElement=(node:unknown,type:string):ReactElement<Record<string,unknown>>|null=>{
 if(!node||typeof node!=='object')return null;
 if(Array.isArray(node)){for(const child of node){const found=findElement(child,type);if(found)return found;}return null;}
 const element=node as ReactElement<{children?:unknown}>;
 return element.type===type?element as ReactElement<Record<string,unknown>>:findElement(element.props?.children,type);
};
test('error fallback never shows the raw error or digest, never claims zero, and retries through Next',()=>{
 const error=Object.assign(new Error('SECRET upstream body 10.0.0.1'),{digest:'DIGEST-123'});
 const markup=renderToStaticMarkup(createElement(ErrorPage,{error}));
 assert.match(markup,/role="alert"/);assert.match(markup,/資料暫時無法讀取/);assert.match(markup,/無法讀取不代表影片、頻道或觀看數為零/);
 assert.doesNotMatch(markup,/SECRET|10\.0\.0\.1|DIGEST-123|digest/);
 assert.match(markup,/<button type="button" class="[^"]*dark:bg-brand-600[^"]*">重新讀取<\/button>/);assert.match(markup,/href="\/"/);
 const calls:string[]=[];
 const click=(props:Parameters<typeof ErrorPage>[0])=>(findElement(ErrorPage(props),'button')!.props.onClick as ()=>void)();
 // Next 16.3 passes the stable `retry`; it wins over the 16.2 name and the client-only reset.
 click({error,retry:()=>calls.push('retry'),unstable_retry:()=>calls.push('unstable'),reset:()=>calls.push('reset')});
 click({error,unstable_retry:()=>calls.push('unstable'),reset:()=>calls.push('reset')});
 assert.deepEqual(calls,['retry','unstable']);
});
test('an unavailable read renders the shared unavailable state, not zeros',()=>{
 const markup=renderToStaticMarkup(createElement(Unavailable,{status:503,title:'熱門標籤排行'}));
 assert.match(markup,/<h1[^>]*>熱門標籤排行<\/h1>/);assert.match(markup,/role="status"/);assert.match(markup,/資料來源暫時無法讀取/);assert.match(markup,/不代表影片、頻道或觀看數為零/);
 assert.doesNotMatch(markup,/>0</);assert.match(markup,/href="\/"/);
});

/* Loading placement guard. Per the installed Next docs (loading.md "Status Codes"), a loading.js
 * Suspense fallback starts streaming with 200 before the page's server read finishes, after which a
 * failed first read can no longer change the status. These entries keep the blocking render so the
 * read failure still throws to app/error.tsx uncached; a loading file here must be a reviewed choice. */
test('no streaming loading boundary sits above the home or report server reads',()=>{
 const app=[process.cwd(),join(process.cwd(),'web'),join(process.cwd(),'platform/web')].map(root=>join(root,'src/app')).find(dir=>existsSync(join(dir,'error.tsx')));
 assert.ok(app,'src/app not found');
 for(const dir of ['','render-isr','render-isr/home','render-isr/home/[edition]','[...segments]','render-filtered','render-filtered/report','render-filtered/report/[...segments]','_home'])
  for(const file of ['loading.tsx','loading.ts','loading.jsx','loading.js'])assert.equal(existsSync(join(app,dir,file)),false,join(dir,file));
 for(const file of ['_home/HomePage.tsx','../components/KeywordRanking.tsx','../components/KeywordProfile.tsx'])assert.doesNotMatch(readFileSync(join(app,file),'utf8'),/<Suspense|\buseEffect\b|\bfetch\(/,file);
});
