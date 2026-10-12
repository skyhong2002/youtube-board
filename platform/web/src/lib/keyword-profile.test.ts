import {strict as assert} from 'node:assert';
import {test} from 'node:test';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {ImageConfigContext} from 'next/dist/shared/lib/image-config-context.shared-runtime';
import {imageConfigDefault} from 'next/dist/shared/lib/image-config';
import config from '../../next.config';
import {KeywordProfile,KeywordVideoList,MATCH_CAVEAT} from '../components/KeywordProfile';
import type {VideoRow,ReportMeta} from '../../../api/src/contracts';
const row=(id:string,title:string,views:number|null):VideoRow=>({id,title,views,channelId:42,channelTitle:'來源頻道',youtubeChannelId:'',description:'<script>escaped description</script>',thumbnail:null,publishedAt:'2026-10-12T00:00:00Z',likes:null,comments:0,updatedAt:null,youtubeUrl:''});
test('keyword article rows preserve API rank order, exact IDs, null metrics and escaped source text',()=>{
 const html=renderToStaticMarkup(createElement(ImageConfigContext.Provider,{value:{...imageConfigDefault,...config.images}},createElement(KeywordVideoList,{rows:[row('AbCdEfGh123','高觀看先列',999),row('abCdEfGh123','較新影片後列',null)]})));
 assert.ok(html.indexOf('高觀看先列')<html.indexOf('較新影片後列'));assert.match(html,/href="\/videos\/AbCdEfGh123"/);assert.match(html,/href="\/videos\/abCdEfGh123"/);assert.match(html,/href="\/channels\/42"/);
 assert.match(html,/<dt>累計觀看<\/dt><dd>無觀看值<\/dd>/);assert.match(html,/<dt>喜歡<\/dt><dd>—<\/dd>/);assert.match(html,/<dt>留言<\/dt><dd>0<\/dd>/);assert.doesNotMatch(html,/<dt>累計觀看<\/dt><dd>0<\/dd>/);assert.doesNotMatch(html,/<script>|<table/);
 // Without API keywordEvidence nothing is fabricated from the description.
 assert.equal(html.match(/沒有命中片段/g)?.length,2);assert.doesNotMatch(html,/escaped description/);
});
test('keyword evidence shows field badges, bounded marked snippets, a caption gap and the video evidence link',()=>{
 const withEvidence={...row('AbCdEfGh123','有片段',5),keywordEvidence:[{term:'交通',field:'title',snippet:'<b>今日交通</b>新聞',start:10,end:12,snippetStart:5},{term:'交通',field:'caption',snippet:'',start:0,end:0,snippetStart:0},{term:'交通',field:'description',snippet:'x'.repeat(300)+'交通',start:300,end:302,snippetStart:0},{term:'多餘',field:'title',snippet:'第四段',start:0,end:2,snippetStart:0}]};
 const html=renderToStaticMarkup(createElement(ImageConfigContext.Provider,{value:{...imageConfigDefault,...config.images}},createElement(KeywordVideoList,{rows:[withEvidence as VideoRow]})));
 assert.match(html,/>標題<\/span>/);assert.match(html,/>字幕<\/span>/);assert.match(html,/字幕尚未取得/);assert.match(html,/<mark[^>]*>交通<\/mark>/);
 assert.match(html,/&lt;b&gt;今日/);assert.doesNotMatch(html,/第四段/);
 // The full source snippet is only the tooltip; the visible text stays bounded.
 const visible=html.replace(/\stitle="[^"]*"/g,'');assert.ok(!visible.includes('x'.repeat(120)));assert.ok(html.includes(`title="${'x'.repeat(300)}交通"`));
 assert.match(html,/href="\/videos\/AbCdEfGh123#keyword-evidence"/);
});
test('a long promotional prefix never pushes the match out of the narrow one-line snippet',()=>{
 const prefix='限時優惠折價券領取請點連結訂閱頻道開啟小鈴鐺加入會員支持我們'.repeat(2),term='沈伯洋',snippet=prefix+term+'今天出席記者會說明';
 const promo={...row('AbCdEfGh123','長前綴',1),keywordEvidence:[{term,field:'description',snippet,start:500+prefix.length,end:500+prefix.length+term.length,snippetStart:500}]};
 const html=renderToStaticMarkup(createElement(ImageConfigContext.Provider,{value:{...imageConfigDefault,...config.images}},createElement(KeywordVideoList,{rows:[promo as VideoRow]})));
 const lead=html.match(/justify-end overflow-hidden"><span>([^<]*)<\/span>/)?.[1]??'';
 assert.ok(lead.startsWith('…')&&lead.length<=9,lead);assert.ok(prefix.endsWith(lead.slice(1)));
 // The mark cannot shrink; only the trailing context truncates first.
 assert.match(html,/<mark class="[^"]*shrink-0[^"]*">沈伯洋<\/mark>/);assert.match(html,/shrink-\[1000\] truncate">今天出席記者會說明<\/span>/);
 assert.match(html,/>說明<\/span>/);
});
test('the keyword page keeps a compact coverage summary and moves methodology into the disclosure',()=>{
 const meta:ReportMeta={schemaVersion:1,requestedAt:'2026-10-12T00:00:00Z',updatedAt:null,timezone:'Asia/Taipei',source:'mariadb',dataset:'live',warnings:[],coverage:{status:'synchronized',vocabularyVersion:'v2',sourceVideos:10,freshVideos:4,staleVideos:null,unprocessedVideos:6,keywordMatchedVideos:2}};
 const html=renderToStaticMarkup(createElement(KeywordProfile,{keyword:'交通',description:'範圍說明',data:{rows:[],total:2,limit:50,offset:0,hasNext:false,totalStatus:'exact'},meta,notice:null,tabs:null,filters:null,pagination:null,period:{from:null,to:null,days:'7'}}));
 const body=html.split('本頁資料來源與計算方式')[0]!,disclosure=html.slice(body.length);
 assert.ok(body.includes(MATCH_CAVEAT));assert.ok(body.indexOf('符合共同標籤的影片')<body.indexOf(MATCH_CAVEAT));assert.doesNotMatch(body,/品質規則 v2|已過濾/);
 for(const label of ['尚未比對','6 部','來源文字已變動</dt><dd>未提供','結果可能不完整','版本：v2','含今天共 8 個台北日曆日'])assert.ok(body.includes(label),label);
 for(const moved of ['僅列出目前詞彙版本','往前 7 日為 8 個日曆日','不能用來推算整體比例'])assert.ok(!body.includes(moved)&&disclosure.includes(moved),moved);
});
test('keyword profile retains incomplete evidence and supplied controls while empty rows never claim zero YouTube coverage',()=>{
 const meta:ReportMeta={schemaVersion:1,requestedAt:'2026-10-12T00:00:00Z',updatedAt:null,timezone:'Asia/Taipei',source:'mariadb',dataset:'fixture',warnings:[],coverage:{status:'synchronized',vocabularyVersion:'test-v1',sourceVideos:8,freshVideos:3,staleVideos:2,unprocessedVideos:3,keywordMatchedVideos:0}};
 const html=renderToStaticMarkup(createElement(KeywordProfile,{keyword:'交通%41',description:'範圍說明',data:{rows:[],total:0,limit:50,offset:50,hasNext:false,totalStatus:'exact'},meta,notice:createElement('p',null,'合成資料提醒'),tabs:createElement('nav',null,'報表分頁'),filters:createElement('input',{name:'q',defaultValue:'保留條件'}),pagination:createElement('a',{href:'?offset=0'},'上一頁')}));
 for(const label of ['交通%41','test-v1','來源文字已變動','尚未比對','空列表不能視為沒有相關影片','合成資料提醒','報表分頁','保留條件','上一頁','更新於 未記錄'])assert.ok(html.includes(label),label);
 assert.match(html,/lg:grid-cols-\[minmax\(0,1fr\)_18rem\]/);assert.match(html,/lg:order-2/);assert.match(html,/比對不完整，不代表 YouTube 沒有相關內容/);assert.doesNotMatch(html,/皆已完成有效比對|來自 0 家|未收錄影片 0/);
});

test('keyword profile never converts an uncounted or unavailable video total to zero',()=>{
 const meta:ReportMeta={schemaVersion:1,requestedAt:'2026-10-12T00:00:00Z',updatedAt:null,timezone:'Asia/Taipei',source:'mariadb',dataset:'fixture',warnings:[],coverage:{}};
 for(const totalStatus of ['not-computed','unavailable'] as const){
  const html=renderToStaticMarkup(createElement(KeywordProfile,{keyword:'交通',description:'範圍說明',data:{rows:[],total:null,limit:50,offset:0,hasNext:false,totalStatus},meta,notice:null,tabs:null,filters:null,pagination:null}));
  assert.ok(html.includes(totalStatus==='not-computed'?'總數未計算':'總數暫時無法取得'));assert.doesNotMatch(html,/0 部|— 部/);
 }
});
