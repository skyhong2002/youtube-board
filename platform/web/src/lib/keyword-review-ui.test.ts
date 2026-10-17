import {strict as assert} from 'node:assert';
import {test} from 'node:test';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {NOT_APPLIED_NOTICE,parseDetail,parseReview,parseStatus,parseVocabularyLookup,type ReviewPreview} from './keyword-review-client';
import {loginHref} from './account-client';
import KeywordReviewAccess from '../app/manage/keywords/console';
import {ExecutionView,GateNotice,GateSummary,NotAppliedBadge,PreviewView,ReviewDetailView,ReviewTable,SelectedVocabulary,VocabularyResults,type GateState} from '../app/manage/keywords/review-details';
import KeywordsPage,{dynamic as keywordsDynamic,metadata as keywordsMetadata} from '../app/manage/keywords/page';
import ManagePage,{metadata as manageMetadata} from '../app/manage/page';

const ID='11111111-1111-4111-8111-111111111111',REQ='22222222-2222-4222-8222-222222222222',KEY='c'.repeat(64),HASH='d'.repeat(64);
const XSS_TERM='<img src=x onerror=alert(1)>',XSS_REASON='</p><script>alert("r")</script>';
const raw=(over:Record<string,unknown>={})=>({id:ID,revision:2,status:'pending',decision:'keep',context:'youtube-text-matching',evidence:{vocabularyVersion:'v2026_10',termKey:KEY,rawTerm:XSS_TERM,ruleVersion:'exact-text-v1',payload:{key:KEY,term:XSS_TERM,upstreamId:'up-9',media:['<i>媒體</i>'],hidden:'PAYLOAD_SECRET_FIELD'},source:'https://tag.observe.tw',sha256:HASH},submittedBy:'user:7',reason:XSS_REASON,applied:false,applicationStatus:'not-applied',createdAt:'2026-10-01T00:00:00.000Z',updatedAt:'2026-10-02T00:00:00.000Z',...over});
const html=(el:Parameters<typeof renderToStaticMarkup>[0])=>renderToStaticMarkup(el);
const APPLIED_CLAIM=/已套用|已變更排行|已生效|排行已更新/;

test('SSR console renders the persistent not-applied badge and session loading, with no token input',()=>{
 const out=html(createElement(KeywordReviewAccess));
 assert.match(out,new RegExp(NOT_APPLIED_NOTICE));assert.match(out,/載入登入狀態/);
 assert.doesNotMatch(out,/type="password"|服務權杖（|Authorization|Bearer/);
});
test('gate notices cover login-disabled, sign-in, permission, disabled, schema and error states',()=>{
 const cases:[GateState,RegExp][]=[
  [{kind:'loading'},/載入登入狀態/],
  [{kind:'login-disabled'},/Google 登入尚未開放.*不接受服務權杖/],
  [{kind:'signed-out',loginUrl:loginHref('/manage/keywords')},/href="\/auth\/google\?next=%2Fmanage%2Fkeywords"/],
  [{kind:'forbidden'},/沒有管理員權限/],
  [{kind:'feature-disabled'},/尚未啟用/],
  [{kind:'schema-unavailable'},/資料表尚未就緒/],
  [{kind:'session-error',message:'登入服務暫時無法使用。'},/登入服務暫時無法使用/],
  [{kind:'status-error',message:'同源驗證（CSRF）未通過'},/CSRF/],
 ];
 for(const [state,expected] of cases)assert.match(html(createElement(GateNotice,{state})),expected,state.kind);
 const retry=html(createElement(GateNotice,{state:{kind:'session-error',message:'x'},action:createElement('button',null,'重試')}));assert.match(retry,/重試/);
 const summary=html(createElement(GateSummary,{info:parseStatus({enabled:true,writeEnabled:false,schemaReady:true,status:'ready',phase:'review-record-only',applied:false,applicationStatus:'not-applied',rankingOverlayEnabled:false})}));
 assert.match(summary,/未開放（僅能預覽）/);assert.match(summary,/排行疊加關閉/);
});
test('detail escapes stored term/reason, shows selected provenance and audit, and never dumps payload',()=>{
 const detail=parseDetail({review:raw(),audit:[{sequence:'5',request_id:REQ,actor:'user:7',action:'submit',reason:XSS_REASON,before:null,after:raw(),created_at:'2026-10-01T00:00:00.000Z'}]});
 const out=html(createElement(ReviewDetailView,{detail}));
 assert.doesNotMatch(out,/<img src=x|<script>|<i>媒體/);
 assert.match(out,/&lt;img src=x onerror=alert\(1\)&gt;/);assert.match(out,/&lt;script&gt;/);assert.match(out,/&lt;i&gt;媒體/);
 assert.match(out,/up-9/);assert.match(out,/v2026_10/);assert.match(out,/exact-text-v1/);assert.match(out,/youtube-text-matching/);assert.match(out,/修訂 2/);assert.match(out,/待覆核/);
 assert.match(out,/#5/);assert.match(out,/user:7/);assert.match(out,/提出提案/);assert.match(out,/（新建）/);
 assert.match(out,new RegExp(NOT_APPLIED_NOTICE));assert.doesNotMatch(out,/PAYLOAD_SECRET_FIELD/);assert.doesNotMatch(out,APPLIED_CLAIM);
});
test('list renders empty state and approved rows without the record-only label',()=>{
 assert.match(html(createElement(ReviewTable,{rows:[],selectedId:null})),/沒有覆核紀錄/);
 const out=html(createElement(ReviewTable,{rows:[parseReview(raw({status:'approved'}))],selectedId:ID}));
 assert.match(out,/已核准/);assert.doesNotMatch(out,/僅記錄/);assert.match(out,/aria-pressed="true"/);assert.doesNotMatch(out,/<img src=x/);assert.doesNotMatch(out,APPLIED_CLAIM);
});
test('preview shows server-resolved term, write-gate state, and never claims application',()=>{
 const after=parseReview(raw()),preview:ReviewPreview={command:{requestId:REQ,id:ID,action:'submit',reason:'r',vocabularyVersion:'v2026_10',termKey:KEY,ruleVersion:'exact-text-v1',context:'youtube-text-matching',decision:'keep'},before:null,after,previewHash:HASH,warnings:['覆核只記錄提案與決策，尚未套用排行或文字比對；原始詞彙與命中證據保留。'],writes:0,applied:false,applicationStatus:'not-applied'};
 const gated=html(createElement(PreviewView,{preview,writeEnabled:false}));
 assert.match(gated,/寫入開關未開放：可以預覽，但無法執行/);assert.match(gated,/&lt;img src=x/);assert.match(gated,new RegExp(NOT_APPLIED_NOTICE));assert.match(gated,new RegExp(REQ));assert.doesNotMatch(gated,APPLIED_CLAIM);
 assert.doesNotMatch(html(createElement(PreviewView,{preview,writeEnabled:true})),/無法執行/);
 const decide=html(createElement(PreviewView,{preview:{...preview,command:{requestId:REQ,id:ID,action:'approve',reason:'r',expectedRevision:2},before:parseReview(raw()),after:parseReview(raw({status:'approved',revision:3}))},writeEnabled:true}));
 assert.match(decide,/待覆核（修訂 2）→ 已核准（修訂 3）/);assert.doesNotMatch(decide,APPLIED_CLAIM);
});
test('successful and replayed writes still prominently say not applied',()=>{
 for(const replayed of [false,true]){
  const out=html(createElement(ExecutionView,{result:{review:parseReview(raw()),requestId:REQ,replayed,applied:false,applicationStatus:'not-applied'}}));
  assert.match(out,new RegExp(NOT_APPLIED_NOTICE));assert.match(out,replayed?/重送未重複建立/:/已寫入覆核紀錄/);assert.doesNotMatch(out,APPLIED_CLAIM);assert.doesNotMatch(out,/<img src=x/);
 }
 assert.match(html(createElement(NotAppliedBadge)),/role="note"/);
});
const VKEY='0123456789abcdef'.repeat(4);
const vocab=(data:Record<string,unknown>={})=>parseVocabularyLookup({data:{rows:[{key:VKEY,term:XSS_TERM,articleCount:12,media:['公視'],provenance:'upstream-article-tag-origin-unspecified',displayExclusion:'平台用語',upstreamId:'up-1'}],total:35,limit:20,offset:0,version:'run_2026_10_13',source:'https://tag.observe.tw',attribution:'新文易數 tag.observe.tw',window:null,publishedAt:null,coverage:'all-current-indexed-article-tags',upstreamSnapshotConsistent:true,...data},meta:{schemaVersion:1,requestedAt:'2026-10-13T00:00:00.000Z',updatedAt:null,timezone:'Asia/Taipei',source:'mariadb',dataset:'fixture',coverage:{},warnings:[]}});
test('vocabulary chooser renders idle, loading, error+retry, not-synchronized, empty and result states',()=>{
 assert.match(html(createElement(VocabularyResults,{state:{kind:'idle'},selectedKey:null})),/搜尋目前已發布的公開詞彙快照/);
 assert.match(html(createElement(VocabularyResults,{state:{kind:'loading',query:'直播'},selectedKey:null})),/role="status"[^>]*>正在搜尋「直播」/);
 const err=html(createElement(VocabularyResults,{state:{kind:'error',query:'直播',message:'公開詞彙 API 目前無法使用'},selectedKey:null,onRetry:()=>{}}));
 assert.match(err,/role="alert"/);assert.match(err,/目前無法使用/);assert.match(err,/重試搜尋/);
 const unsynced=html(createElement(VocabularyResults,{state:{kind:'ready',query:'直播',lookup:vocab({version:null,rows:[],total:0})},selectedKey:null,onRetry:()=>{}}));
 assert.match(unsynced,/尚未同步/);assert.match(unsynced,/重試搜尋/);
 const empty=html(createElement(VocabularyResults,{state:{kind:'ready',query:'不存在',lookup:vocab({rows:[],total:0})},selectedKey:null}));
 assert.match(empty,/找不到符合「不存在」的詞彙/);assert.match(empty,/run_2026_10_13/);
 const out=html(createElement(VocabularyResults,{state:{kind:'ready',query:'img',lookup:vocab()},selectedKey:VKEY}));
 assert.match(out,/href="https:\/\/tag\.observe\.tw"/);assert.match(out,/新文易數 tag\.observe\.tw/);assert.match(out,/run_2026_10_13/);
 assert.match(out,/共 35 筆，僅列出前 20 筆/);assert.match(out,/12 篇文章/);assert.match(out,/公視/);assert.match(out,/目前靜態顯示排除：平台用語/);
 assert.match(out,/aria-pressed="true"/);assert.doesNotMatch(out,/<img src=x/);assert.match(out,/&lt;img src=x/);assert.doesNotMatch(out,APPLIED_CLAIM);
});
test('selected vocabulary shows the exact original term, version and key as read-only fields',()=>{
 const l=vocab();assert.equal(l.status,'synchronized');if(l.status!=='synchronized')return;
 const out=html(createElement(SelectedVocabulary,{version:l.version,choice:l.rows[0]!}));
 assert.equal((out.match(/readOnly=""|readonly=""/g)??[]).length,3);
 assert.match(out,new RegExp('value="'+VKEY+'"'));assert.match(out,/value="run_2026_10_13"/);assert.match(out,/value="&lt;img src=x onerror=alert\(1\)&gt;"/);
 assert.match(out,/未在瀏覽器推導/);assert.match(out,/up-1/);assert.doesNotMatch(out,/<img src=x/);
});
test('pages are force-dynamic noindex; /manage is a navigation page, not a redirect',()=>{
 assert.equal(keywordsDynamic,'force-dynamic');assert.deepEqual(keywordsMetadata.robots,{index:false,follow:false});assert.deepEqual(manageMetadata.robots,{index:false,follow:false});
 const keywords=html(createElement(KeywordsPage));assert.match(keywords,/關鍵字覆核/);assert.match(keywords,new RegExp(NOT_APPLIED_NOTICE));
 const manage=html(createElement(ManagePage));assert.match(manage,/管理後台/);
});

import KeywordExcludeButton from '../components/admin/KeywordExcludeButton';
import {RankingExclusionsView} from '../app/manage/keywords/ranking-exclusions';
test('the ranking exclude button renders nothing without an administrator session',()=>{
 assert.equal(html(createElement(KeywordExcludeButton,{terms:['OpenAI'],label:'OpenAI'})),'');
});
test('administrator exclusions list escapes labels and offers restore',()=>{
 assert.match(html(createElement(RankingExclusionsView,{rows:[],busy:null})),/目前沒有管理員排除的關鍵字/);
 const out=html(createElement(RankingExclusionsView,{rows:[{termKey:KEY,term:XSS_TERM,reviewId:ID,vocabularyVersion:'v1',decidedBy:'user:7',decidedAt:'2026-10-17T14:00:00.000Z',reason:'泛用詞'}],busy:null,onRestore:()=>{}}));
 assert.match(out,/&lt;img src=x/);assert.doesNotMatch(out,/<img src=x/);assert.match(out,/恢復顯示/);assert.match(out,/user:7/);assert.match(out,/泛用詞/);
});
