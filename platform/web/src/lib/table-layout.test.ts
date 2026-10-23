import assert from 'node:assert/strict';
import {COMMENTS_PUBLISHED} from './comments-launch';
import {test} from 'node:test';
import {createElement,type ReactElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {ImageConfigContext} from 'next/dist/shared/lib/image-config-context.shared-runtime';
import {imageConfigDefault} from 'next/dist/shared/lib/image-config';
import config from '../../next.config';
import {ChannelTable,LiveTable,VideoTable} from '../components/DataViews';
import {ReportTable} from '../components/ReportTable';
import {CHANNEL_SORTS,type ChannelRanking} from '../../../shared/channel-ranking';
import {reportLeadIndex} from './report-table';
import type {ChannelRow,LiveRow,VideoRow} from '../../../api/src/contracts';
import type {ReportCell,ReportColumn,ReportValue} from './report-contract';
const render=(element:ReactElement)=>renderToStaticMarkup(createElement(ImageConfigContext.Provider,{value:{...imageConfigDefault,...config.images}},element));
/** Class list of the header or body cell whose text / data-label is `label`. */
const headClass=(html:string,label:string)=>html.match(new RegExp(`<th[^>]*class="([^"]*)"[^>]*>${label}<`))?.[1]??'';
const bodyClasses=(html:string,label:string)=>[...html.matchAll(new RegExp(`<td data-label="${label}"[^>]*class="([^"]*)"`,'g'))].map(m=>m[1]);
const longTitle='一個非常非常長的頻道名稱會在手機上被截斷而不是換行成好幾行';
const clip='table-clip inline-block min-w-0 max-w-xs truncate align-top';
/** A 48×27 VideoThumbnail directly inside a span with exactly `wrapper` classes. The thumbnail's
 * own attributes (data-thumbnail-*, class, style) may come in any order. */
const thumbIn=(wrapper:string)=>new RegExp(`<span class="${wrapper.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}"><span (?=[^>]*data-thumbnail-state="(?:pending|missing)")(?=[^>]*class="relative inline-flex[^"]*")(?=[^>]*style="width:48px;height:27px;min-width:48px")[^>]*>`);
/** Every body row (table.row) of a rendered table. */
const bodyRows=(html:string)=>{const rows=[...html.matchAll(/<tr class="group [^"]*">([\s\S]*?)<\/tr>/g)].map(m=>m[1]);assert.ok(rows.length,'no body rows');return rows;};
/** One visual line per row: at most the lead's own flex box, no stacked blocks, vertical margins or line breaks. */
const assertOneLineRow=(row:string)=>{
 assert.ok((row.match(/<div/g)?.length??0)<=1,row);
 assert.doesNotMatch(row,/class="(?:[^"]*\s)?(block|mt-\d|mb-\d|line-clamp-\d)[\s"]|<br|<p\b|display:block/,row);
};

test('report lead skips a leading rank or log number for the identifying column, but keeps date-led matrices',()=>{
 const rank:ReportColumn={key:'rank',label:'排名',kind:'number'};
 assert.equal(reportLeadIndex([rank,{key:'channel',label:'頻道'},{key:'total',label:'加總',kind:'number'}],[]),1);
 // live-taxonomy-videos: log number, observation date, then the video.
 assert.equal(reportLeadIndex([{key:'sourceLogId',label:'日誌編號',kind:'number'},{key:'date',label:'觀測日期',kind:'date'},{key:'video',label:'影片'}],[]),2);
 // tag-days rank matrix: the dated columns are the axis, so the rank stays the lead.
 assert.equal(reportLeadIndex([rank,{key:'2026-10-11',label:'2026-10-11'},{key:'2026-10-12',label:'2026-10-12'}],[]),0);
 // Daily metrics / hour grids open with the row's date.
 assert.equal(reportLeadIndex([{key:'date',label:'日期',kind:'date'},{key:'channels',label:'頻道數',kind:'number'}],[]),0);
 // A channel avatar or video thumbnail marks the entity column wherever it is.
 const media:ReportCell={value:'頻道甲',media:{kind:'channel',channelId:1,avatar:null}};
 assert.equal(reportLeadIndex([rank,{key:'status',label:'狀態'},{key:'channel',label:'頻道'}],[{rank:1,status:'完整',channel:media}]),2);
 assert.equal(reportLeadIndex([],[]),0);
});

test('wide report table: sticky entity lead, one-line clipped text with full titles, numbers right-aligned',()=>{
 const columns:ReportColumn[]=[{key:'rank',label:'來源序',kind:'number'},{key:'video',label:'影片'},{key:'channel',label:'頻道'},{key:'views',label:'累計觀看',kind:'number',unit:'次'},{key:'status',label:'收錄狀態'}];
 const rows:Record<string,ReportValue|ReportCell>[]=[{rank:1,video:{value:'影片標題',href:'/videos/AbCdEfGh123',media:{kind:'video',videoId:'AbCdEfGh123',thumbnail:null}},channel:{value:longTitle,href:'/channels/8',media:{kind:'channel',channelId:8,avatar:null}},views:1234,status:{value:longTitle,detail:'批次說明很長很長的補充'}}];
 const html=render(createElement(ReportTable,{columns,rows,label:'留言收錄'}));
 assert.match(html,/<table class="[^"]*whitespace-nowrap/);assert.doesNotMatch(html,/table-stack/);
 assert.match(headClass(html,'影片'),/table-lead sticky left-0/);
 assert.doesNotMatch(headClass(html,'來源序'),/table-lead/);
 assert.match(headClass(html,'來源序'),/text-right tabular-nums/);
 assert.match(html,/>累計觀看<span>（次）<\/span><\/th>/);
 assert.deepEqual(bodyClasses(html,'影片').map(c=>c.includes('table-lead')),[true]);
 assert.deepEqual(bodyClasses(html,'來源序').map(c=>c.includes('table-lead')),[false]);
 assert.match(bodyClasses(html,'累計觀看')[0],/text-right tabular-nums/);
 // Only the lead's thumbnail yields on scroll; the channel avatar in a data column stays.
 assert.equal(html.match(/table-lead-extra shrink-0/g)?.length,1);
 assert.match(html,/<span class="shrink-0"><span class="inline-flex shrink-0/);
 assert.match(html,/table-lead-box[\s\S]*?class="min-w-0 max-w-full truncate inline-block align-top sm:max-w-xs" title="影片標題"/);
 assert.match(html,thumbIn('table-lead-extra shrink-0'));
 assert.equal(html.match(new RegExp(`class="${clip}" title="${longTitle}"`,'g'))?.length,2);
 // The detail rides on the same line as its value and is cut first.
 assert.match(html,new RegExp(`<span class="inline-flex min-w-0 max-w-full items-center gap-2 align-top"><span class="${clip}" title="${longTitle}">${longTitle}</span><small class="min-w-0 max-w-xs shrink-3 truncate text-xs" title="批次說明很長很長的補充">`));
 assert.doesNotMatch(html,/white-space:normal|display:block|<small class="block/);
 bodyRows(html).forEach(assertOneLineRow);
});

test('narrow report table stacks on phones with column labels instead of a sticky lead',()=>{
 const html=render(createElement(ReportTable,{columns:[{key:'term',label:'詞彙'},{key:'count',label:'次數',kind:'number'}],rows:[{term:longTitle,count:3}],label:'詞彙'}));
 assert.match(html,/<table class="[^"]*whitespace-nowrap table-stack"/);assert.doesNotMatch(html,/table-lead/);
 assert.match(html,/<td data-label="詞彙"/);assert.match(html,/<td data-label="次數"/);
 assert.match(html,new RegExp(`<td data-label="詞彙" class="[^"]*"><span class="${clip}" title="${longTitle}">`));
 bodyRows(html).forEach(assertOneLineRow);
});

const tag={id:3,name:'新聞',kind:'channel' as const};
const channel={id:8,youtubeId:'UCfixture',title:longTitle,avatar:null,thumbnail:null,description:null,publishedAt:null,youtubeUrl:'https://www.youtube.com/channel/UCfixture',views:1,subscribers:2,videoCount:3,weeklyViews:4,monthlyViews:5,weeklySubscribers:null,weeklyVideos:null,monthlySubscribers:null,monthlyVideos:null,estimatedWeeklyViews:null,estimatedMonthlyViews:null,monthlyEstimateGap:null,legacyGrowthPercent:null,averageWeeklyViewsPerVideo:null,updatedAt:null,tags:[tag,{...tag,id:4,name:'政治'}]} satisfies ChannelRow;
const video:VideoRow={id:'AbCdEfGh123',channelId:8,youtubeChannelId:'UCfixture',channelTitle:'來源頻道',title:longTitle,description:'',thumbnail:null,publishedAt:'2026-10-10T17:02:00.000Z',views:1234,likes:0,comments:17,updatedAt:null,youtubeUrl:'https://www.youtube.com/watch?v=AbCdEfGh123'};

/** An <a> carrying all of these exact attributes, in any order (pattern source). */
const escape=(text:string)=>text.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
const anchor=(attrs:Record<string,string>)=>'<a '+Object.entries(attrs).map(([key,value])=>'(?=[^>]*'+key+'="'+escape(value)+'")').join('')+'[^>]*>';
/** Header labels in document order. */
const heads=(html:string)=>[...html.matchAll(/<th(?:\s[^>]*)?>([^<]*)/g)].map(m=>m[1]);
const thumb48=thumbIn('table-lead-extra shrink-0');
const videoName='min-w-0 max-w-full max-sm:w-full max-sm:whitespace-normal max-sm:[overflow-wrap:anywhere] sm:truncate sm:max-w-xs font-medium hover:underline';
const videoLead='table-lead-box min-w-0 flex items-center gap-2 max-sm:flex-col max-sm:items-start';
/** The phone lead keeps its capped width, but puts the small thumbnail above a full-width
 * wrapping title. No clamp hides a distinguishing suffix; desktop keeps the inline lead. */
/** Live titles take two lines on desktop (full title in the tooltip), sized to fit beside the pinned lead. */
const liveVideoName=videoName.replace('sm:truncate sm:max-w-xs','sm:line-clamp-2 sm:w-58 sm:whitespace-normal sm:[overflow-wrap:anywhere] sm:leading-5');
/** The live thumbnail is two text lines tall (72×40); the stream preview is portalled on hover, so SSR has only the thumbnail. */
const liveThumb=/<span class="table-lead-extra shrink-0"><span class="relative inline-block"><span (?=[^>]*data-thumbnail-state="(?:pending|missing)")(?=[^>]*style="width:72px;height:40px;min-width:72px")[^>]*>/;
const assertVideoIdentityRow=(row:string,name=videoName,thumb=thumb48)=>{
 assert.match(row,new RegExp(`<div class="${escape(videoLead)}">`));
 assert.match(row,thumb);
 assert.match(row,new RegExp(anchor({class:name})));
 // Only the live desktop title and taxonomy clamp (to two lines); phones never clamp a distinguishing suffix.
 assert.doesNotMatch(row.replaceAll('sm:line-clamp-2','').replaceAll('line-clamp-2 w-34',''),/line-clamp|table-stack|data-thumbnail-state="loaded"/);
 assert.equal(row.match(/max-sm:whitespace-normal/g)?.length,1);
};

const channelName='min-w-0 max-w-full truncate max-sm:line-clamp-2 max-sm:whitespace-normal max-sm:[overflow-wrap:anywhere] sm:max-w-xs';
test('channel ranking row: rank, avatar, name (the one lead text that wraps on phones) and categories under the name that yield on scroll',()=>{
 const html=render(createElement(ChannelTable,{rows:[channel],offset:9}));
 assert.match(html,/<table class="whitespace-nowrap w-full"/);
 assert.match(headClass(html,'頻道'),/table-lead sticky/);
 // Phones keep only avatar + name in the 9.5rem lead: rank and categories are hidden at rest below sm, shown from sm up.
 assert.match(html,/<div class="table-lead-box min-w-0 flex items-center gap-2"><span class="table-lead-extra max-sm:hidden shrink-0 text-xs tabular-nums text-zinc-400">10<\/span>/);
 assert.doesNotMatch(html.match(/<a [^>]*href="\/channels\/8"[^>]*>/)![0],/max-sm:hidden/);
 // Below sm the name may wrap to two lines in the capped lead; from sm up it is one clipped line. The full name stays in the link title.
 assert.match(html,new RegExp(`${anchor({title:longTitle,href:'/channels/8'})}<span class="inline-flex shrink-0[^>]*>[\\s\\S]*?<span class="${escape(channelName)}">${longTitle}</span>`));
 // Only the name wraps: the table stays nowrap and the number cells carry no wrapping class.
 assert.deepEqual(html.match(/<td class="number">[^<]*<\/td>/g),['<td class="number">2</td>','<td class="number">4</td>','<td class="number">3</td>']);
 assert.equal(html.match(/whitespace-normal/g)?.length,1);
 assert.deepEqual(heads(html),['頻道','訂閱人數','近七日觀看增量','累計影片']);
 assert.match(html,new RegExp(`<span class="table-lead-extra max-sm:hidden min-w-0 max-w-full truncate shrink-3 pl-8 text-xs text-zinc-500 sm:max-w-xs" title="新聞、政治">${anchor({href:'/tags/3/channels'})}新聞</a>、${anchor({href:'/tags/4/channels'})}政治</a></span>`));
 assert.doesNotMatch(html,/class="tags/);
 bodyRows(html).forEach(assertOneLineRow);
});
test('ranked channel table puts the sorted metric right after the name and keeps every other metric once',()=>{
 const ranking={column:'view_week',scope:'directory',min:null,minMetric:'views'} satisfies ChannelRanking;
 const html=render(createElement(ChannelTable,{rows:[channel],ranking}));
 const labels=CHANNEL_SORTS.map(([,label])=>label),selected=labels[CHANNEL_SORTS.findIndex(([key])=>key==='view_week')]!;
 const order=heads(html);
 assert.deepEqual(order,['頻道',selected,...labels.filter(label=>label!==selected),'近月估計差距']);
 assert.equal(new Set(order).size,order.length);
 // The header and its value stay paired: the first metric cell is weeklyViews (4), then views (1), subscribers (2), videos (3).
 const cells=[...html.matchAll(/<td class="number">([^<]*)<\/td>/g)].map(m=>m[1]);
 assert.equal(cells.length,labels.length+1);assert.deepEqual(cells.slice(0,4),['4','1','2','3']);
 assert.match(html,/<th class="number" aria-sort="descending">近七日觀看增量<span aria-hidden="true"> ↓<\/span><\/th>/);
 assert.equal(html.match(/aria-sort=/g)?.length,1);
 // Each other sort still leads when chosen, so no metric is reachable only by scrolling past a fixed order.
 for(const [key,label] of CHANNEL_SORTS)assert.equal(heads(render(createElement(ChannelTable,{rows:[channel],ranking:{...ranking,column:key}})))[1],label);
 bodyRows(html).forEach(assertOneLineRow);
});

test('a channel\'s own video list drops the repeated channel column and gives its width to the titles',()=>{
 const html=render(createElement(VideoTable,{rows:[{...video,listing:{scope:'channel',providerComments:17,recordedComments:null,commentStatus:'pending',commentAuthors:null,commentReplies:null,commentLikes:null,likeSharePercent:null,commentsPerThousandViews:null,commentObservedAt:null,tags:[]}}]}));
 assert.deepEqual(heads(html).slice(0,3),['影片','發布時間','觀看數']);
 assert.match(html,thumb48);
 assert.match(html,new RegExp(anchor({class:videoName.replace('sm:max-w-xs','sm:max-w-xl'),title:longTitle,href:'/videos/AbCdEfGh123'})));
 // The channel is named once by the page's breadcrumb, not on every row.
 assert.doesNotMatch(html,/href="\/channels\/8"/);
 // Collection status follows the counts inline instead of on a second line.
 if(COMMENTS_PUBLISHED)assert.match(html,/— ／ 17<small class="ml-1.5">收錄未完成，顯示 YouTube<\/small>/);
 // Until comments are collected (issue #2) the cell is the plain YouTube count.
 else{assert.match(html,/<td class="number">17<\/td>/);assert.doesNotMatch(html,/收錄/);}
 assert.match(html,new RegExp(`<div class="${escape(videoLead)}">`));
});

test('live phone title wraps below its thumbnail; rank stays desktop-only and attribution and metrics stay in their columns',()=>{
 const live:LiveRow={...video,currentViewers:10,todayPeak:20,allTimePeak:null,startedAt:null,trend:[],tags:[tag],partialLogEvidence:true};
 const all=render(createElement(LiveTable,{rows:[live],offset:0}));
 const html=all.slice(all.indexOf('<div class="table-frame'));
 assert.match(all,/aria-label="直播觀測清單"/);
 // Every live column is a sort button (legacy DataTables); none is sorted until the reader picks one.
 assert.deepEqual([...html.matchAll(/<th[^>]*><button type="button"[^>]*>(?:<!-- -->)?([^<]*)/g)].map(m=>m[1]),['直播','同時在線','今日高峰','今日走勢','歷史高峰','頻道','頻道分類','開播時間']);
 assert.doesNotMatch(html,/aria-sort=/);
 // Cells centre vertically, including the clipped one-line taxonomy.
 assert.match(html,/<table class="[^"]*\[&amp;_td\]:py-1 \[&amp;_td\]:align-middle/);
 assert.match(html,new RegExp(`<div class="${escape(videoLead)}"><span class="table-lead-extra max-sm:hidden shrink-0 text-xs tabular-nums text-zinc-400">01</span>`));
 assert.match(html,liveThumb);
 // The thumbnail identifies the video; full titles wrap on phones and the tooltip keeps attribution.
 assert.match(html,new RegExp(`${anchor({class:liveVideoName,title:`來源頻道 · ${longTitle}`,href:'/videos/AbCdEfGh123'})}${longTitle}</a>`));
 // The visible channel name lives only in the channel column, always beside its avatar.
 assert.equal(html.match(/>來源頻道</g)?.length,1);
 assert.match(html,new RegExp(`<td>${anchor({class:'flex min-w-0 items-center gap-1.5 hover:underline',title:'來源頻道',href:'/channels/8'})}<span class="inline-flex shrink-0[^>]*>[\\s\\S]*?<span class="${clip.replace('max-w-xs','max-w-40')}">來源頻道</span></a></td>`));
 // Taxonomy takes up to two lines rather than one clipped line.
 assert.match(html,new RegExp(`<td><span class="${escape('line-clamp-2 w-34 whitespace-normal text-xs leading-5 text-zinc-500 [overflow-wrap:anywhere]')}" title="新聞">${anchor({href:'/live/current?tagid=3'})}新聞</a></span></td>`));
 assert.match(html,/20<small class="ml-1.5">部分取樣<\/small>/);
 // The desktop table fits the content column: the YouTube link stays on the phone cards and the video page.
 assert.doesNotMatch(html,/youtube\.com\/watch|min-width:1280px/);
 // live.php 時間: dense start time (publication time until YouTube reports a start), update time in the tooltip.
 assert.match(render(createElement(LiveTable,{rows:[{...live,publishedAt:null}]})),/<time title="更新於 未記錄">—<\/time>/);
 assert.match(render(createElement(LiveTable,{rows:[{...live,publishedAt:'2026-10-20T20:00:00Z',startedAt:'2026-10-20T21:01:00Z'}]})),/<time dateTime="2026-10-20T21:01:00Z" title="更新於 [^"]*">10\/21 05:01<\/time>/);
 assert.match(render(createElement(LiveTable,{rows:[{...live,publishedAt:'2026-10-20T20:00:00Z'}]})),/<time dateTime="2026-10-20T20:00:00Z"[^>]*>10\/21 04:00<\/time>/);
 // 最近趨勢線 → 今日走勢: a sparkline of today's samples labelled with its Taipei clock span, 「—」 without samples.
 const trend=render(createElement(LiveTable,{rows:[{...live,trend:[{time:'2026-10-20T21:00:00Z',value:5},{time:'2026-10-20T23:12:00Z',value:9}]}]}));
 assert.match(trend,/<polyline points=/);
 assert.match(trend,/title="台北時間 05:00–07:12 共 2 筆取樣：5 → 9 人"/);
 assert.match(trend,/>05:00–07:12<\/small>/);
 bodyRows(html).forEach(row=>assertVideoIdentityRow(row,liveVideoName,liveThumb));
});

test('video and live rows keep distinct common-prefix suffixes, video identities and canonical thumbnail sources',()=>{
 const prefix='【每日直播新聞】日テレNEWS 共用節目名稱與日期時段前綴';
 const rows=[{...video,title:`${prefix} 台灣地震現場`,id:'AbCdEfGh123'},{...video,title:`${prefix} 東京交通速報`,id:'ZyXwVuTs987'}];
 const lives=rows.map(row=>({...row,currentViewers:10,todayPeak:20,allTimePeak:null,startedAt:null,trend:[],tags:[]} satisfies LiveRow));
 for(const [html,name,thumb] of [[render(createElement(VideoTable,{rows})),videoName,thumb48],[render(createElement(LiveTable,{rows:lives})),liveVideoName,liveThumb]] as const){
  const renderedRows=bodyRows(html);
  assert.equal(renderedRows.length,2);
  renderedRows.forEach((row,index)=>{
   assertVideoIdentityRow(row,name,thumb);
   const source=rows[index];
   assert.match(row,new RegExp(`${anchor({href:`/videos/${source.id}`})}${escape(source.title)}</a>`));
   assert.match(row,new RegExp(`data-thumbnail-src="https://i\\.ytimg\\.com/vi/${source.id}/mqdefault\\.jpg"`));
   assert.match(row,/data-thumbnail-state="pending"/);
   assert.match(row,/<td><a [^>]*href="\/channels\/8"/);
  });
 }
});

test('video and live identity fallbacks keep unknown labels and encoded links without inventing a thumbnail source',()=>{
 const row={...video,id:'missing/id%',title:'',channelTitle:'',thumbnail:'https://untrusted.example/fake.jpg'};
 const live={...row,currentViewers:10,todayPeak:20,allTimePeak:null,startedAt:null,trend:[],tags:[]} satisfies LiveRow;
 for(const [element,label,thumb] of [[createElement(VideoTable,{rows:[row]}),'影片標題尚未取得',thumb48],[createElement(LiveTable,{rows:[live]}),'直播標題尚未取得',liveThumb]] as const){
  const html=render(element);
  assert.match(html,thumb);
  assert.match(html,new RegExp(`${anchor({href:'/videos/missing%2Fid%25'})}${label}</a>`));
  assert.match(html,/頻道名稱尚未取得/);
  assert.match(html,/data-thumbnail-state="missing"/);
  assert.doesNotMatch(html,/data-thumbnail-state="loaded"|data-thumbnail-src=|untrusted\.example|<img/);
 }
});

test('mobile live cards keep full distinguishing titles, attribution and every observation without a narrow sticky column',()=>{
 const lives=['台灣地震現場','東京交通速報'].map((suffix,i)=>({...video,id:i?'ZyXwVuTs987':video.id,title:`【每日直播新聞】共用節目名稱日期與時段 ${suffix}`,currentViewers:10,todayPeak:20,allTimePeak:null,startedAt:null,trend:[],tags:[tag],partialLogEvidence:true} satisfies LiveRow));
 const html=render(createElement(LiveTable,{rows:lives}));
 const mobile=html.slice(0,html.indexOf('<div class="table-frame'));
 assert.match(mobile,/sm:hidden/);assert.doesNotMatch(mobile,/table-lead|line-clamp|<table/);
 for(const row of lives){assert.ok(mobile.includes(row.title));assert.ok(mobile.includes(`/videos/${row.id}`));}
 for(const label of ['同時在線','今日高峰','歷史高峰','更新時間','頻道分類','YouTube 原始來源','部分取樣'])assert.ok(mobile.includes(label),label);
 assert.equal(mobile.match(/>來源頻道</g)?.length,2);
 assert.doesNotMatch(html,/min-width:1280px/);assert.match(html,/hidden sm:block/);
 assert.match(mobile,/dark:text-zinc-400/);
});
