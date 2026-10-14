import assert from 'node:assert/strict';
import test from 'node:test';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {ImageConfigContext} from 'next/dist/shared/lib/image-config-context.shared-runtime';
import {imageConfigDefault} from 'next/dist/shared/lib/image-config';
import config from '../../next.config';
import type {HomeKeywordSummary} from '../../../api/src/contracts';
import {joinSentences} from './format';
import {KeywordRankingTable} from '../components/KeywordRanking';
import {DESCRIPTION_TEMPLATE_NOTE,DISPLAY_EXCLUSION_NOTE,INSUFFICIENT,NO_VIEWS,viewsSummary,TAG_SOURCE_ATTRIBUTION,displayExclusionLabel,evidenceParts,heatLabel,keywordEvidenceOf,keywordMethodNotes,matchCoveragePercent,rankingBasis,riseLabel,sparklineRuns,trendValues,viewsCell,viewsText} from './keyword-ranking';
type Row=HomeKeywordSummary['rows'][number];
const row=(patch:Partial<Row>={}):Row=>({key:'k1',term:'台積電',sourceTerms:[{key:'k1',term:'台積電'}],videoCount:4,views:null,unknownViewVideos:1,knownViews:3000,measuredViewVideos:3,heatScore:5.25,channelCount:2,titleVideos:3,descriptionOnlyVideos:1,rise:1.5,trend:[{date:'2026-10-11',heat:2},{date:'2026-10-12',heat:null},{date:'2026-10-13',heat:3.25}],representativeVideoId:'dQw4w9WgXcQ',thumbnail:null,channel:{id:7,name:'某頻道',title:'某頻道',youtubeId:'UC1',youtubeUrl:'',thumbnail:null,avatar:null},...patch});
const summary=(patch:Partial<HomeKeywordSummary>={}):HomeKeywordSummary=>({vocabularyCoverage:'observed-article-window',vocabularyWindow:{since:'2026-10-10T16:00:00.000Z',until:'2026-10-11T16:00:00.000Z'},source:'https://tag.observe.tw',version:'v',status:'synchronized',reason:null,from:'2026-10-07T00:00:00+08:00',to:'2026-10-13T09:00:00+08:00',updatedAt:null,rows:[row()],sourceVideos:23551,freshVideos:8057,staleVideos:43,unprocessedVideos:15451,metric:'current-cumulative-views-of-window-published-videos',rankingMethod:'youtube-channel-weighted-decay-v1',riseMethod:'equal-duration-heat-delta',ruleVersion:'youtube-quality-v2',comparison:{from:'a',to:'b',complete:true,sourceVideos:1,freshVideos:1,staleVideos:0,unprocessedVideos:0},exclusions:{scope:'fresh-window-matched-terms',terms:2,reasons:{'upstream-tag-noise':2},policyCommit:'748978854035050c',youtubePolicyVersion:'youtube-platform-display-v1'},...patch});

test('heat is only claimed for the weighted method; raw-count fallbacks are not labelled as heat',()=>{
 assert.equal(rankingBasis(summary(),[row()]),'heat');
 assert.equal(rankingBasis({},[row()]),'video-count');
 assert.equal(rankingBasis(summary(),[row({heatScore:undefined as unknown as number})]),'video-count');
 assert.equal(heatLabel(row({heatScore:Number.NaN})),INSUFFICIENT);
 assert.match(keywordMethodNotes(summary({rankingMethod:undefined as never}),'video-count').join(''),/依已比對影片數排序/);
});
test('rise needs a complete equal-duration comparison and is never a zero stand-in',()=>{
 assert.deepEqual(riseLabel(row(),summary()),{text:'+1.5',tone:'up'});
 assert.equal(riseLabel(row({rise:-0.04}),summary()).text,'±0');
 assert.equal(riseLabel(row(),summary({comparison:{...summary().comparison!,complete:false}})).text,INSUFFICIENT);
 assert.equal(riseLabel(row({rise:null}),summary()).text,INSUFFICIENT);
 assert.equal(riseLabel(row(),null).text,INSUFFICIENT);
});
test('missing trend days stay gaps and an all-missing trend draws nothing',()=>{
 assert.deepEqual(trendValues(row().trend),[2,null,3.25]);
 assert.equal(sparklineRuns([2,null,3.25]).length,2);
 assert.deepEqual(sparklineRuns([null,null]),[]);assert.deepEqual(trendValues(undefined),[]);
});
test('a null view total reads 無觀看值; a partial known subtotal is labelled and never shown as the total',()=>{
 const partial=viewsCell(row());assert.equal(partial.value,NO_VIEWS);assert.equal(partial.detail,'已知小計 3,000 次・1 支缺值');assert.match(partial.title,/不是合計/);
 assert.doesNotMatch(partial.value,/次/);assert.equal(viewsSummary(row()),'無觀看值（已知小計 3,000 次・1 支缺值）');
 const none=viewsCell(row({measuredViewVideos:0,knownViews:0,unknownViewVideos:4}));assert.equal(none.value,NO_VIEWS);assert.equal(none.detail,'4 支缺值');
 assert.deepEqual([viewsCell({videoCount:2,views:null,unknownViewVideos:2}).value,viewsCell({videoCount:2,views:null,unknownViewVideos:2}).detail],[NO_VIEWS,'2 支缺值']);
 const full=viewsCell(row({views:3000,unknownViewVideos:0,measuredViewVideos:4}));assert.equal(full.value,'3,000 次');assert.equal(full.detail,null);
 assert.equal(viewsCell(row({views:0,unknownViewVideos:0,measuredViewVideos:4,knownViews:0})).value,'0 次');
 assert.equal(viewsText(null),NO_VIEWS);assert.equal(viewsText(0),'0');
});
test('method notes state coverage, weights, sampling limits and keep contextual promotion rules',()=>{
 const text=keywordMethodNotes(summary(),'heat').join('\n');
 assert.ok(text.startsWith(TAG_SOURCE_ATTRIBUTION));
 assert.equal(matchCoveragePercent(summary()),'34.21%');assert.match(text,/有效比對占 34\.21%，這只是比對完成的影片比例，不是內容失真/);
 assert.match(text,/約 24 小時/);assert.match(text,/不是新文易數全部歷史文章的完整標籤庫/);
 assert.match(text,/標題命中的影片計 3、僅說明命中的影片計 1/);assert.match(text,/1、0\.5、0\.25/);
 assert.match(text,/不是隨機抽樣，不能用來推算整體比例/);
 // Display exclusion (whole term) and description-template stripping (repeated spans) stay distinct.
 assert.ok(text.includes(DISPLAY_EXCLUSION_NOTE));assert.ok(text.includes(DESCRIPTION_TEMPLATE_NOTE));
 assert.match(DISPLAY_EXCLUSION_NOTE,/少數 YouTube 平台或宣傳用語/);assert.match(DESCRIPTION_TEMPLATE_NOTE,/「24小時」.*重複宣傳段落.*一般新聞內容時照常計入/);
 assert.doesNotMatch(text,/同一個詞出現在一般新聞內容時照常保留，不會整詞排除/);
 assert.match(text,/已知小計不是合計/);
 assert.match(text,/上游判定為雜訊標籤 2 個/);
 assert.equal(matchCoveragePercent(summary({sourceVideos:0})),null);
});
test('exclusion reasons are human readable and unknown codes are not hidden',()=>{
 assert.equal(displayExclusionLabel(null),'可列入排行');assert.equal(displayExclusionLabel(undefined),'未提供');
 assert.equal(displayExclusionLabel('upstream-number-or-date'),'不列入排行：純數字或日期');
 assert.match(displayExclusionLabel('new-rule'),/new-rule/);
});
test('evidence is bounded, marked only when offsets fit, and absent evidence stays absent',()=>{
 assert.deepEqual(evidenceParts({snippet:'abc交通def',start:13,end:15,snippetStart:10}),{before:'abc',match:'交通',after:'def'});
 assert.equal(evidenceParts({snippet:'abc',start:0,end:9,snippetStart:0}).match,'');
 const long=evidenceParts({snippet:'a'.repeat(200)+'X'+'b'.repeat(200),start:200,end:201,snippetStart:0});
 assert.equal(long.match,'X');assert.ok((long.before+long.match+long.after).length<=92);
 // Anchored on the match: at most 8 leading characters, ellipses only where text was cut.
 const promo=evidenceParts({snippet:'優惠券'.repeat(30)+'支持'+'後文'.repeat(60),start:1090,end:1092,snippetStart:1000});
 assert.equal(promo.match,'支持');assert.equal(promo.before,'…'+'優惠券'.repeat(30).slice(-8));assert.ok(promo.after.endsWith('…'));
 assert.deepEqual(evidenceParts({snippet:'支持者表示',start:0,end:2,snippetStart:0}),{before:'',match:'支持',after:'者表示'});
 assert.deepEqual(evidenceParts({snippet:'1234567支持',start:7,end:9,snippetStart:0}),{before:'1234567',match:'支持',after:''});
 assert.equal(evidenceParts({snippet:'12345678X支持',start:9,end:11,snippetStart:0}).before,'…2345678X');
 // Offsets that do not point inside the snippet never produce a mark.
 for(const bad of [{start:5,end:5},{start:-1,end:1},{start:2.5,end:4},{start:3,end:99}])assert.equal(evidenceParts({snippet:'沒有命中的文字',snippetStart:0,...bad}).match,'',JSON.stringify(bad));
 assert.equal(keywordEvidenceOf({}),null);assert.deepEqual(keywordEvidenceOf({keywordEvidence:[{term:'x'}]}),[]);
});
test('warning sentences join without 。； and keep every warning',()=>{
 assert.equal(joinSentences(['涵蓋不完整。','觀看值缺漏；','比對版本為 exact-text-v1']),'涵蓋不完整；觀看值缺漏；比對版本為 exact-text-v1。');
 assert.doesNotMatch(joinSentences(['a。','b。']),/。；/);assert.equal(joinSentences(['只有一句。']),'只有一句。');assert.equal(joinSentences(['',' ']),'');
});
test('ranking table keeps desktop one-line rows, a sticky lead with fixed thumbnails, and honest gaps',()=>{
 const rows=[row(),row({key:'k2',term:'Apple',sourceTerms:[{key:'k2',term:'Apple'},{key:'k3',term:'apple'}],representativeVideoId:null,trend:[{date:'2026-10-13',heat:null}],views:null,measuredViewVideos:0,knownViews:0,channel:null})];
 const html=renderToStaticMarkup(createElement(ImageConfigContext.Provider,{value:{...imageConfigDefault,...config.images}},createElement(KeywordRankingTable,{rows,summary:summary(),window:'week',basis:'heat',priority:true})));
 assert.match(html,/whitespace-nowrap/);assert.match(html,/table-lead sticky/);assert.match(html,/width:48px;height:27px/);
 assert.equal(html.match(/loading="eager"/g)?.length,1);
 assert.match(html,/href="\/keywords\/%E5%8F%B0%E7%A9%8D%E9%9B%BB\/videos\?from=2026-10-07&amp;to=2026-10-13"/);
 assert.match(html,/2 種寫法/);assert.match(html,/無觀看值<small[^>]*>（已知小計 3,000 次・1 支缺值）/);assert.doesNotMatch(html,/>3,000 次</);assert.match(html,new RegExp(INSUFFICIENT));assert.match(html,/href="\/channels\/7"/);
 assert.doesNotMatch(html,/>0 次</);
});

test('labels authorized source exclusions with the specific reason',()=>{
 assert.equal(displayExclusionLabel('youtube-source-or-platform'),'不列入排行：來源或平台名稱');
});


test('mobile ranking identities remain complete, wrap long terms, and keep scoped evidence links',()=>{
 const terms=['新聞直播','雙十國慶','雙十','極長新聞標籤'.repeat(12),'a/b%41'];
 const rows=terms.map((term,i)=>row({key:`identity${i}`,term}));
 const html=renderToStaticMarkup(createElement(ImageConfigContext.Provider,{value:{...imageConfigDefault,...config.images}},createElement(KeywordRankingTable,{rows,summary:summary(),window:'today',basis:'heat'})));
 const links=[...html.matchAll(/<a ([^>]*?)><span class="([^"]*)">([^<]*)<\/span><span [^>]*data-link-pending="idle"/g)];
 assert.deepEqual(links.map(link=>link[3]),terms);
 for(const [i,link] of links.entries()){
  assert.ok(link[1].includes(`/keywords/${encodeURIComponent(terms[i])}/videos?from=2026-10-07&amp;to=2026-10-13`));
  const classes=link[2].split(' ');
  assert.ok(classes.includes('whitespace-normal'));
  assert.ok(classes.includes('[overflow-wrap:anywhere]'));
  assert.ok(classes.includes('sm:truncate'));
  for(const forbidden of ['truncate','overflow-hidden','text-ellipsis','whitespace-nowrap','line-clamp-1'])assert.ok(!classes.includes(forbidden));
 }
 const decorative=[...html.matchAll(/<a ([^>]*aria-hidden="true"[^>]*)>/g)];
 assert.equal(decorative.length,terms.length);
 assert.ok(decorative.every(link=>link[1].includes('max-sm:hidden')));
});
