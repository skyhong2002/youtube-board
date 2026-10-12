import {strict as assert} from 'node:assert';
import {test} from 'node:test';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {ImageConfigContext} from 'next/dist/shared/lib/image-config-context.shared-runtime';
import {imageConfigDefault} from 'next/dist/shared/lib/image-config';
import config from '../../next.config';
import {KeywordProfile,KeywordVideoList} from '../components/KeywordProfile';
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
 assert.match(html,/&lt;b&gt;今日/);assert.doesNotMatch(html,/第四段/);assert.ok(!html.includes('x'.repeat(120)));
 assert.match(html,/href="\/videos\/AbCdEfGh123#keyword-evidence"/);
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
