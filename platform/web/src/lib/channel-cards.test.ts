import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {ChannelTable} from '../components/DataViews';
import type {ChannelRow} from '../../../api/src/contracts';
import {CHANNEL_SORTS,type ChannelRanking} from '../../../shared/channel-ranking';
const row:ChannelRow={id:42,youtubeId:'UCpublic',title:'<script>完整頻道名稱與不可省略的尾綴</script>',thumbnail:null,avatar:null,description:null,publishedAt:null,youtubeUrl:'https://www.youtube.com/channel/UCpublic',views:6151197724,subscribers:0,videoCount:null,weeklyViews:61998368,monthlyViews:null,weeklySubscribers:null,monthlySubscribers:null,weeklyVideos:null,monthlyVideos:null,estimatedWeeklyViews:null,estimatedMonthlyViews:null,monthlyEstimateGap:null,legacyGrowthPercent:null,averageWeeklyViewsPerVideo:null,updatedAt:'2026-10-14T05:09:47.000Z',tags:[{id:102,name:'每日新聞頻道',kind:'channel'}]};
const ranking:ChannelRanking={column:'view_week',scope:'directory',min:null,minMetric:'subscribers'};
const render=(item:ChannelRow,options:Partial<Parameters<typeof ChannelTable>[0]>={})=>renderToStaticMarkup(createElement(ChannelTable,{rows:[item],ranking,responsive:true,...options}));
test('responsive channel ranking exposes full sorted value and source identity outside the wide table',()=>{
 const html=render(row),cards=html.split('</ol>')[0]!;
 assert.match(cards,/aria-label="頻道排行列表"/);assert.match(cards,/近七日觀看增量/);assert.match(cards,/>61,998,368<\/dd>/);assert.match(cards,/完整頻道名稱與不可省略的尾綴/);assert.doesNotMatch(cards,/line-clamp|truncate|<script/);
 assert.match(cards,/href="\/channels\/42"/);assert.match(cards,/href="\/tags\/102\/channels"/);assert.match(cards,/其他指標與分類/);assert.match(cards,/資料最後記錄/);assert.match(cards,/不代表各項統計同時更新/);
 for(const [,label] of CHANNEL_SORTS)assert.ok(cards.includes(label),label);
 assert.match(html,/hidden sm:block/);assert.doesNotMatch(html,/min-width:1780px/);
});
test('channel selected zero remains zero and unknown counts stay missing; timestamp never becomes a fake metric',()=>{
 const zero=render(row,{ranking:{...ranking,column:'subscriberCount'}}).split('</ol>')[0]!;
 assert.match(zero,/<dt[^>]*>訂閱人數<\/dt><dd[^>]*>0<\/dd>/);
 const missing=render({...row,weeklyViews:null,updatedAt:null}).split('</ol>')[0]!;
 assert.match(missing,/<dt[^>]*>近七日觀看增量<\/dt><dd[^>]*>—<\/dd>/);assert.match(missing,/資料最後記錄：未記錄/);
 const old=render(row,{responsive:false});assert.doesNotMatch(old,/<ol/);assert.match(old,/<table/);
});
