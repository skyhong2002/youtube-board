import assert from 'node:assert/strict';
import test from 'node:test';
import {Fragment,createElement,type ReactNode} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import type {HomeKeywordSummary} from '../../../api/src/contracts';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {homeCategoryBandState,homeEdition,homeKeywordCloudWords,homeKeywordState,homeKeywordSummary,keywordVideosHref,keywordViewsLabel,visibleHomeKeywords} from './home-presentation';
import {KeywordWindowPane,KeywordWindowProvider,KeywordWindowSwitch} from '../app/_home/KeywordWindow';
import {KeywordRankingView} from '../components/KeywordRanking';
import {reportHref} from './report-navigation';
import type {ReportMeta} from '../../../api/src/contracts';
type Row=HomeKeywordSummary['rows'][number];
const summary=(patch:Partial<HomeKeywordSummary>={}):HomeKeywordSummary=>({vocabularyCoverage:'observed-article-window',vocabularyWindow:null,source:'https://tag.observe.tw',version:'run-1',status:'synchronized',reason:null,from:'2026-10-06T00:00:00+08:00',to:'2026-10-12T09:30:00+08:00',updatedAt:'2026-10-12T01:00:00.000Z',rows:[],sourceVideos:10,freshVideos:8,staleVideos:1,unprocessedVideos:1,metric:'current-cumulative-views-of-window-published-videos',rankingMethod:'youtube-channel-weighted-decay-v1',riseMethod:'equal-duration-heat-delta',ruleVersion:'youtube-quality-v2',comparison:null,exclusions:null,...patch});
const row=(i:number,patch:Partial<Row>={}):Row=>({key:`k${i}`,term:`詞${i}`,sourceTerms:[{key:`k${i}`,term:`詞${i}`}],videoCount:50-i,views:1000*i,unknownViewVideos:0,knownViews:1000*i,measuredViewVideos:50-i,heatScore:100-i,channelCount:3,titleVideos:1,descriptionOnlyVideos:49-i,rise:null,trend:[],representativeVideoId:null,thumbnail:null,channel:null,...patch});
/** A pre-F2 API: no method flags and rows without heat. Typed loosely on purpose; the UI must still read it honestly. */
const legacySummary=(patch:Partial<HomeKeywordSummary>={})=>{const {rankingMethod:_m,riseMethod:_r,ruleVersion:_v,comparison:_c,exclusions:_e,...rest}=summary(patch);return rest as unknown as HomeKeywordSummary;};
const legacyRow=(i:number,patch:Partial<Pick<Row,'views'|'unknownViewVideos'>>={})=>({key:`k${i}`,term:`詞${i}`,videoCount:50-i,views:1000*i,unknownViewVideos:0,...patch}) as unknown as Row;
test('home edition uses recorded observation time with Taipei dates and a neutral missing state',()=>{assert.match(homeEdition('2026-10-10T18:00:00Z','2026-10-08'),/2026\/10\/11/);assert.match(homeEdition(null,'2026-10-08'),/2026\/10\/08/);assert.equal(homeEdition(null,null),'持續觀察 YouTube 公共討論');assert.equal(homeEdition('invalid',null),'持續觀察 YouTube 公共討論');});
test('unavailable or unsynchronized home vocabulary never exposes old rows as current',()=>{const rows=[row(1,{key:'news',term:'新聞',videoCount:3,views:null,unknownViewVideos:3,measuredViewVideos:0,knownViews:0})];assert.deepEqual(visibleHomeKeywords({status:'unavailable',rows}),[]);assert.deepEqual(visibleHomeKeywords({status:'not-synchronized',rows}),[]);assert.equal(visibleHomeKeywords({status:'synchronized',rows}),rows);});
test('today and week are read from their own summaries; an older API without keywordToday is unknown, not empty',()=>{
 const week=summary({rows:[row(1)]}),today=summary({from:'2026-10-12T00:00:00+08:00',rows:[row(2)]});
 assert.equal(homeKeywordSummary({keywords:week,keywordToday:today},'today'),today);
 assert.equal(homeKeywordSummary({keywords:week,keywordToday:today},'week'),week);
 assert.equal(homeKeywordSummary({keywords:week},'today'),null);
 assert.equal(homeKeywordSummary({keywords:week,keywordToday:{status:'synchronized'}},'today'),null);
 const missing=homeKeywordState(null,'today');assert.deepEqual(missing.rows,[]);assert.match(missing.message??'',/尚未提供過去24小時.*狀態未知/);assert.doesNotMatch(missing.message??'',/尚無收錄|尚無可確認/);
});
test('empty keyword states stay distinct and truthful',()=>{
 const message=(s:HomeKeywordSummary)=>homeKeywordState(s,'today').message;
 assert.match(message(summary({status:'unavailable',rows:[row(1)]}))??'',/無法完整讀取/);
 assert.match(message(summary({status:'not-synchronized',rows:[row(1)]}))??'',/尚未同步/);
 assert.match(message(summary({sourceVideos:0,freshVideos:0}))??'',/過去24小時尚無收錄的發布影片/);
 assert.match(message(summary({sourceVideos:5,freshVideos:0}))??'',/收錄 5 支影片，尚無完成比對/);
 assert.match(message(summary({sourceVideos:5,freshVideos:4}))??'',/已完成比對 4 支影片，尚未出現共同詞彙/);
 assert.match(message(summary({sourceVideos:null,freshVideos:null}))??'',/尚無可確認/);
 // Video-only surface: no article/news wording in any empty state.
 for(const s of [null,summary({status:'unavailable'}),summary({status:'not-synchronized'}),summary({sourceVideos:0}),summary({freshVideos:0}),summary()])assert.doesNotMatch(homeKeywordState(s,'week').message??'',/文章|新聞|篇/);
 const ok=homeKeywordState(summary({rows:[row(1)]}),'week');assert.equal(ok.message,null);assert.equal(ok.rows.length,1);
});
test('lower category band: unavailable is a failed read, unknown stays unknown, only available may say no records',()=>{
 const available=homeCategoryBandState('available'),unavailable=homeCategoryBandState('unavailable');
 assert.equal(available.kind,'empty');assert.match(available.message,/已列分類以外，尚無其他分類紀錄/);
 assert.equal(unavailable.kind,'unavailable');assert.match(unavailable.message,/無法讀取/);assert.doesNotMatch(unavailable.message,/尚無/);
 for(const status of [undefined,null,'','pending',{}]){const s=homeCategoryBandState(status);assert.equal(s.kind,'unknown');assert.match(s.message,/狀態未知/);assert.doesNotMatch(s.message,/尚無/);}
 for(const s of [available,unavailable,homeCategoryBandState(undefined)])assert.doesNotMatch(s.message,/\d/);
 // Source wiring (no live render): both lower-band empty rows use the status-aware state, never a fixed "no records".
 const source=readFileSync(join(process.cwd(),'src/app/_home/HomePage.tsx'),'utf8');
 assert.doesNotMatch(source,/>尚無分類紀錄。</);
 assert.match(source,/categoryBand=homeCategoryBandState\(discovery\.categories\.status\)/);
 assert.match(source,/\{!rows\.length&&<li className=\{styles\.muted\} data-category-state=\{categoryBand\.kind\}>\{categoryBand\.message\}<\/li>\}/);
});
test('keyword links keep the selected Taipei publication dates',()=>{
 assert.equal(keywordVideosHref('台積電',summary()),'/keywords/%E5%8F%B0%E7%A9%8D%E9%9B%BB/videos?from=2026-10-06&to=2026-10-12');
 assert.equal(keywordVideosHref('a/b',summary({from:'2026-10-12T00:00:00+08:00'})),'/keywords/a%2Fb/videos?from=2026-10-12&to=2026-10-12');
 // Late UTC evening is already the next Taipei day.
 assert.equal(keywordVideosHref('x',{from:'2026-10-11T16:00:00.000Z',to:'2026-10-11T17:00:00.000Z'}),'/keywords/x/videos?from=2026-10-12&to=2026-10-12');
 assert.equal(keywordVideosHref('x',{from:'invalid',to:'2026-10-12T00:00:00+08:00'}),'/keywords/x/videos');
 assert.equal(keywordVideosHref('x',null),'/keywords/x/videos');
});
test('ranked pool evidence links retain the exact rolling UTC bounds and state qualification honestly',()=>{
 const window={since:'2026-10-13T16:00:00.000Z',until:'2026-10-14T16:00:00.000Z'};
 const rankingPool={status:'available',comparisonBasis:'current-eligible-terms',provenance:{window}} as HomeKeywordSummary['rankingPool'];
 const s=summary({rankingPool});
 const url=new URL(keywordVideosHref('沈伯洋',s),'https://youtube.observe.tw');
 assert.equal(url.searchParams.get('since'),window.since);assert.equal(url.searchParams.get('until'),window.until);assert.equal(url.searchParams.has('from'),false);
 assert.match(homeKeywordState(s,'today').message??'',/過去24小時.*本期新聞詞池與顯示規則/);
 const unavailable=summary({status:'unavailable',rankingPool:{status:'unavailable',reason:'contract',windows:{today:window,week:window}}});
 assert.match(homeKeywordState(unavailable,'today').message??'',/無法完整驗證/);
 const path='/keywords/AI/videos';
 const href=new URL(reportHref(path,window,path),'https://youtube.observe.tw');assert.equal(href.searchParams.get('since'),window.since);
});
test('the cloud keeps all forty ranked terms sized by heat and labels partial views as a lower bound',()=>{
 const rows=Array.from({length:40},(_,i)=>row(i+1));rows[5]={...rows[5]!,views:null,unknownViewVideos:2,measuredViewVideos:rows[5]!.videoCount-2};
 const words=homeKeywordCloudWords(rows,summary({from:'2026-10-12T00:00:00+08:00',rows}),'today');
 assert.equal(words.length,40);assert.deepEqual(words.map(w=>w.count),rows.map(r=>r.heatScore));
 assert.ok(words.every(w=>w.href.endsWith('?from=2026-10-12&to=2026-10-12')));
 assert.deepEqual(words.map(w=>w.tone).slice(0,4),['brand','brand','brand','strong']);
 const unknown=words[5]!.card.rows.find(([k])=>k==='目前累計觀看')?.[1]??'';assert.match(unknown,/^≥.+ 次（2 支缺值）$/);
 assert.equal(words[0]!.card.rows.find(([k])=>k==='熱度')?.[1],'99.0');assert.equal(words[0]!.card.rows.find(([k])=>k==='升溫')?.[1],'資料不足');
 assert.ok(words.every(w=>w.card.rows.every(([,v])=>!/AI|增量|文章/.test(v))));
});
test('legacy summaries without the weighted method keep video-count sizing and never claim heat',()=>{
 const rows=Array.from({length:40},(_,i)=>legacyRow(i+1));rows[5]=legacyRow(6,{views:null,unknownViewVideos:2});
 const words=homeKeywordCloudWords(rows,legacySummary({from:'2026-10-12T00:00:00+08:00',rows}),'today');
 assert.equal(words.length,40);assert.deepEqual(words.map(w=>w.count),rows.map(r=>r.videoCount));
 assert.ok(words.every(w=>!w.card.rows.some(([k])=>k==='熱度'||k==='升溫')));
 const unknown=words[5]!.card.rows.find(([k])=>k==='目前累計觀看')?.[1];assert.match(unknown??'',/無觀看值（2 支）/);assert.doesNotMatch(unknown??'',/^0/);
 assert.equal(keywordViewsLabel({views:0,unknownViewVideos:0}),'0 次');
 // Heat present on rows but no method flag: still not labelled as heat.
 const flagless=homeKeywordCloudWords([row(1)],legacySummary({rows:[row(1)]}),'week');assert.equal(flagless[0]!.count,row(1).videoCount);
});
test('the window switch is a labelled radio group and only the selected pane renders',()=>{
 const panes=(extra?:ReactNode)=>createElement(Fragment,null,extra,createElement(KeywordWindowPane,{window:'today',children:'TODAY-PANE'}),createElement(KeywordWindowPane,{window:'week',children:'WEEK-PANE'}));
 const html=renderToStaticMarkup(createElement(KeywordWindowProvider,{children:panes(createElement(KeywordWindowSwitch,{name:'kw'}))}));
 assert.match(html,/<legend[^>]*>關鍵字期間/);assert.equal(html.match(/type="radio"/g)?.length,2);
 const checked=(html.match(/<input[^>]*>/g)??[]).filter(input=>/\schecked=""/.test(input));assert.equal(checked.length,1);assert.match(checked[0]!,/value="week"/);
 assert.match(html,/aria-controls="home-keyword-ranking home-keyword-cloud"/);
 assert.match(html,/WEEK-PANE/);assert.doesNotMatch(html,/TODAY-PANE/);
 const today=renderToStaticMarkup(createElement(KeywordWindowProvider,{initial:'today',children:panes()}));
 assert.match(today,/TODAY-PANE/);assert.doesNotMatch(today,/WEEK-PANE/);
});
// Server markup only: these markers let a browser check observe which period is shown; switching itself is not exercised here.
test('every switch names the selected period; ordinary panes add nothing and only opted-in regions are marked',()=>{
 const pane=(window:'today'|'week',tag:string,region?:boolean)=>createElement(KeywordWindowPane,{key:window+tag,window,...(region?{region,className:'contents'}:{}),children:createElement(tag,null,`${window.toUpperCase()}-${tag}`)});
 const tree=(initial?:'today'|'week')=>renderToStaticMarkup(createElement(KeywordWindowProvider,{initial,children:createElement(Fragment,null,createElement(KeywordWindowSwitch,{name:'a'}),createElement(KeywordWindowSwitch,{name:'b',className:''}),pane('today','p'),pane('week','p'),createElement('section',{id:'region'},pane('today','ol',true),pane('week','ol',true)))}));
 for(const window of ['today','week'] as const){
  const html=tree(window),other=window==='today'?'week':'today',label=window.toUpperCase();
  assert.equal(html.match(new RegExp(`<fieldset [^>]*data-keyword-window-selected="${window}"`,'g'))?.length,2);
  assert.doesNotMatch(html,new RegExp(`data-keyword-window-selected="${other}"|data-keyword-window-pane="${other}"|${other.toUpperCase()}-`));
  // An ordinary pane (caption, method note) returns its children exactly, with no box or marker.
  assert.match(html,new RegExp(`</fieldset><p>${label}-p</p><section`));
  // The controlled region holds one marked box around exactly the selected content.
  assert.equal(html.match(/data-keyword-window-pane=/g)?.length,1);
  assert.match(html,new RegExp(`<section id="region"><div class="contents" data-keyword-window-pane="${window}"><ol>${label}-ol</ol></div></section>`));
 }
 assert.match(tree(),/data-keyword-window-selected="week"/);
});
test('/keywords uses the same pane and switch markers for its table and method notes',()=>{
 const meta:ReportMeta={schemaVersion:1,requestedAt:'2026-10-12T00:00:00Z',updatedAt:null,timezone:'Asia/Taipei',source:'mariadb',dataset:'fixture',warnings:[],coverage:{}};
 for(const initial of ['today','week'] as const){
  const html=renderToStaticMarkup(createElement(KeywordRankingView,{exploration:{},meta,initial})),other=initial==='today'?'week':'today';
  assert.match(html,new RegExp(`<fieldset [^>]*data-keyword-window-selected="${initial}"`));
  // Only the aria-controls region is marked; its box spaces the pane's children itself. The method
  // notes stay plain paragraphs under the disclosure.
  assert.equal(html.match(/data-keyword-window-pane=/g)?.length,1);
  assert.doesNotMatch(html,new RegExp(`data-keyword-window-pane="${other}"`));
  assert.match(html,new RegExp(`<div id="keyword-ranking-table"><div class="space-y-3" data-keyword-window-pane="${initial}"><p role="status"`));
 }
});
