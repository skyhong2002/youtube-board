import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {ImageConfigContext} from 'next/dist/shared/lib/image-config-context.shared-runtime';
import {imageConfigDefault} from 'next/dist/shared/lib/image-config';
import config from '../../next.config';
import {VideoResults} from '../components/VideoResults';
import type {VideoRow} from '../../../api/src/contracts';
const render=(rows:VideoRow[])=>renderToStaticMarkup(createElement(ImageConfigContext.Provider,{value:{...imageConfigDefault,...config.images}},createElement(VideoResults,{rows})));
const video:VideoRow={id:'AbCdEfGh123',channelId:8,youtubeChannelId:'UCfixture',channelTitle:'來源頻道',title:'<script>長影片標題</script>',description:'來源描述',thumbnail:null,publishedAt:'2026-10-11T01:02:00+08:00',views:1234,likes:0,comments:17,updatedAt:null,youtubeUrl:'https://www.youtube.com/watch?v=AbCdEfGh123',listing:{scope:'channel',providerComments:17,recordedComments:0,commentStatus:'complete',commentAuthors:0,commentReplies:0,commentLikes:0,likeSharePercent:0,commentsPerThousandViews:null,commentObservedAt:null,tags:[]}};
test('source video divided list keeps attribution, dates, totals and all collection metrics without a wide table',()=>{
 const html=render([video]);
 assert.match(html,/近期收錄影片列表/);assert.doesNotMatch(html,/<table|<script/);assert.match(html,/&lt;script&gt;長影片標題/);
 assert.match(html,/href="\/videos\/AbCdEfGh123"/);assert.match(html,/href="\/channels\/8"/);assert.match(html,/dateTime="2026-10-11T01:02:00\+08:00"/);assert.match(html,/累計觀看/);assert.match(html,/YouTube 留言/);assert.match(html,/>17<\/dd>/);
 assert.match(html,/<details/);assert.match(html,/完整收錄/);for(const label of ['收錄留言','喜歡占互動','收錄作者','收錄回覆','留言獲讚','留言觀測時間','資料更新時間'])assert.ok(html.includes(label));assert.match(html,/>0\.00%<\/dd>/);assert.match(html,/收錄留言<\/dt><dd[^>]*>0<\/dd>/);
});
test('missing provider and collection counts remain unknown; pending coverage is explicit',()=>{
 const row={...video,listing:{...video.listing!,providerComments:null,recordedComments:null,commentStatus:'pending' as const,likeSharePercent:null}};
 const html=render([row]);assert.match(html,/收錄未完成，顯示 YouTube/);assert.match(html,/YouTube 留言<\/dt><dd>—<\/dd>/);assert.match(html,/收錄留言<\/dt><dd[^>]*>—<\/dd>/);
});
test('empty source listing explains observation scope',()=>{
 const html=render([]);assert.match(html,/尚未收錄，不代表頻道沒有發布影片/);assert.doesNotMatch(html,/<table|<ul/);
});

test('report mobile list preserves whole titles, missingness, taxonomy metrics and last-record timestamp',()=>{
 const title='一段很長但必須可以完整辨識的影片標題與不同尾綴';
 const item={...video,title,views:null,likes:0,updatedAt:'2026-10-14T22:00:00Z',listing:{...video.listing!,scope:'taxonomy' as const,commentsPerThousandViews:0,tags:[{id:102,name:'每日新聞頻道',kind:'channel' as const}]}};
 const html=renderToStaticMarkup(createElement(ImageConfigContext.Provider,{value:{...imageConfigDefault,...config.images}},createElement(VideoResults,{rows:[item],report:true})));
 assert.ok(html.includes(title));assert.doesNotMatch(html,/line-clamp|<table/);assert.match(html,/來源頻道/);assert.match(html,/累計觀看<\/dt><dd>—<\/dd>/);assert.match(html,/喜歡<\/dt><dd>0<\/dd>/);assert.match(html,/每千次觀看留言/);assert.match(html,/0\.00‰/);assert.match(html,/href="\/tags\/102\/videos"/);assert.match(html,/資料最後記錄/);assert.match(html,/各項統計未必在同一時間觀測/);
});
