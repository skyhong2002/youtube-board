import test from 'node:test';
import assert from 'node:assert/strict';
import {createElement,type ReactElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {ImageConfigContext} from 'next/dist/shared/lib/image-config-context.shared-runtime';
import {imageConfigDefault} from 'next/dist/shared/lib/image-config';
import config from '../../next.config';
import {AiDailyBoard} from '../components/AiDailyBoard';
import type {AiDaysData,TopicRow} from '../../../api/src/contracts';

const topic:TopicRow={id:'t1',dailyId:5581,title:'颱風接近',channelCount:2,networkCount:2,videoCount:9,score:1,keywords:[],people:[],
 evidence:[{channelId:1,channelTitle:'甲台',event:'颱風路徑',videoIds:['AbCdEfGh123','AbCdEfGh124'],keywords:[],people:[],source:{table:'urt_channel_ai',id:1}}],
 unresolvedReferences:[],
 summary:{keywords:[{term:'颱風',count:3}],people:[],party:{green:7,blue:0},angle:{taiwan:0,china:0},camp:{dpp:0,kmt:0},
  videos:[{videoId:'AbCdEfGh123',channelId:1,channelTitle:'甲台',event:'颱風路徑'}]}};
const render=(element:ReactElement)=>renderToStaticMarkup(createElement(ImageConfigContext.Provider,{value:{...imageConfigDefault,...config.images}},element));
const day=(rows:TopicRow[],extra:Partial<AiDaysData>={}):AiDaysData=>({date:'2026-10-20',dateFrom:null,dateTo:null,dailyId:5581,dataType:'oneday',condition:'all',rows,channels:2,source:'daily-cache',updatedAt:null,rawVideoRows:null,sourceChannels:2,...extra});

test('daily topics keep every summary row, but load no YouTube player until asked', () => {
 const html=render(createElement(AiDailyBoard,{data:day([topic]),dated:true}));
 for(const label of ['媒體數','關鍵字','人物','媒體陣營','報導角度','政黨觀點'])assert.match(html,new RegExp(`>${label}<`));
 assert.doesNotMatch(html,/<iframe/);
 assert.match(html,/aria-label="播放影片：甲台 - 颱風路徑"/);
 assert.match(html,/href="https:\/\/www\.youtube\.com\/watch\?v=AbCdEfGh123"/);
 // Zero sides stay printed but greyed.
 assert.match(html,/<span class="whitespace-nowrap text-zinc-400 dark:text-zinc-500">泛藍媒體 0 則<\/span>/);
 assert.match(html,/<span class="whitespace-nowrap">泛綠媒體 7 則<\/span>/);
});

test('the stored record sits with its count; the selected tabs carry date and condition', () => {
 const html=render(createElement(AiDailyBoard,{data:day([topic]),dated:true}));
 assert.match(html,/1 個議題 · 紀錄 #5581 · 資料類型 oneday/);
 assert.doesNotMatch(html,/條件：/);
 // A missing raw count is one dash, not 「— 則」.
 assert.match(html,/原始收錄<\/div><div[^>]*>—<\/div>/);
});

test('an empty day names the day and condition and offers the previous day and all media', () => {
 const html=render(createElement(AiDailyBoard,{data:day([],{condition:'green'}),dated:true}));
 assert.match(html,/2026-10-20「泛綠」條件目前沒有 AI 每日彙整。/);
 assert.match(html,/href="\/ai\/days\/2026-10-19\/green"/);
 assert.match(html,/href="\/ai\/days\/2026-10-20"[^>]*>改看全部媒體/);
});
