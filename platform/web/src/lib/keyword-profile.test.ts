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
 assert.match(html,/<dt>累計觀看<\/dt><dd>—<\/dd>/);assert.match(html,/<dt>喜歡<\/dt><dd>—<\/dd>/);assert.match(html,/<dt>留言<\/dt><dd>0<\/dd>/);assert.match(html,/&lt;script&gt;escaped description/);assert.doesNotMatch(html,/<script>|<table/);
});
test('keyword profile retains incomplete evidence and supplied controls while empty rows never claim zero YouTube coverage',()=>{
 const meta:ReportMeta={schemaVersion:1,requestedAt:'2026-10-12T00:00:00Z',updatedAt:null,timezone:'Asia/Taipei',source:'mariadb',dataset:'fixture',warnings:[],coverage:{status:'synchronized',vocabularyVersion:'test-v1',sourceVideos:8,freshVideos:3,staleVideos:2,unprocessedVideos:3,keywordMatchedVideos:0}};
 const html=renderToStaticMarkup(createElement(KeywordProfile,{keyword:'交通%41',description:'範圍說明',data:{rows:[],total:0,limit:50,offset:50},meta,notice:createElement('p',null,'合成資料提醒'),tabs:createElement('nav',null,'報表分頁'),filters:createElement('input',{name:'q',defaultValue:'保留條件'}),pagination:createElement('a',{href:'?offset=0'},'上一頁')}));
 for(const label of ['交通%41','test-v1','來源文字已變動','尚未比對','空列表不能視為沒有相關影片','合成資料提醒','報表分頁','保留條件','上一頁','更新於 未記錄'])assert.ok(html.includes(label),label);
 assert.match(html,/lg:grid-cols-\[minmax\(0,1fr\)_18rem\]/);assert.match(html,/lg:order-2/);assert.match(html,/比對不完整，不代表 YouTube 沒有相關內容/);assert.doesNotMatch(html,/皆已完成有效比對|來自 0 家|未收錄影片 0/);
});
