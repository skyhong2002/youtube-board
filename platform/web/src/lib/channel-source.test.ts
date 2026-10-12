import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createElement,type ReactElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {ImageConfigContext} from 'next/dist/shared/lib/image-config-context.shared-runtime';
import {imageConfigDefault} from 'next/dist/shared/lib/image-config';
import config from '../../next.config';
import {ReportTable} from '../components/ReportTable';
import {ChannelSourceLabel,sourceIdentity} from '../components/ChannelSource';
import {EventAnalysis} from '../components/EventAnalysis';
import TargetLink from '../app/my/TargetLink';
import type {AiEventData,EventPresentation} from '../../../api/src/contracts';
import type {ReportCell,ReportColumn,ReportValue} from './report-contract';
import type {ChannelAvatar,ChannelSource} from '../../../shared/media-assets';
const render=(element:ReactElement)=>renderToStaticMarkup(createElement(ImageConfigContext.Provider,{value:{...imageConfigDefault,...config.images}},element));
const revision='c'.repeat(64),avatar=(id:number):ChannelAvatar=>({url:`/media/channels/${id}/${revision}.png`,revision,width:192,height:192,cachedAt:'2026-10-12T00:00:00.000Z'});
const known:ChannelSource={channelId:7,channelTitle:'甲頻道',channelAvatar:avatar(7)};
const unknown:ChannelSource={channelId:null,channelTitle:'乙媒體',channelAvatar:null};
const clip='table-clip inline-block min-w-0 max-w-xs truncate align-top';
const bodyRows=(html:string)=>{const rows=[...html.matchAll(/<tr class="group [^"]*">([\s\S]*?)<\/tr>/g)].map(m=>m[1]);assert.ok(rows.length,'no body rows');return rows;};
const assertOneLineRow=(row:string)=>{assert.ok((row.match(/<div/g)?.length??0)<=1,row);assert.doesNotMatch(row,/class="(?:[^"]*\s)?(block|mt-\d|mb-\d|line-clamp-\d)[\s"]|<br|<p\b|display:block/,row);};
const columns:ReportColumn[]=[{key:'event',label:'議題'},{key:'summary',label:'摘要'},{key:'channels',label:'頻道'},{key:'videos',label:'影片引用',kind:'number'}];
const table=(channels:ReportValue|ReportCell)=>render(createElement(ReportTable,{columns,rows:[{event:'議題',summary:'摘要',channels,videos:2}],label:'每小時 AI 議題'}));
const channelCell=(html:string)=>html.match(/<td data-label="頻道"[^>]*>([\s\S]*?)<\/td>/)?.[1]??'';
/** An <a> carrying all of these exact attributes, in any order (pattern source). */
const escape=(text:string)=>text.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
const anchor=(attrs:Record<string,string>)=>'<a '+Object.entries(attrs).map(([key,value])=>'(?=[^>]*'+key+'="'+escape(value)+'")').join('')+'[^>]*>';

test('multi-source cell stays one clipped line with every name in the title; only the exact identity links or shows a logo',()=>{
 const html=table({value:'甲頻道、乙媒體',sources:[known,unknown]}),cell=channelCell(html);
 assert.ok(cell.startsWith(`<span class="${clip}" title="甲頻道、乙媒體">`),cell);
 assert.match(cell,new RegExp(anchor({class:'hover:underline',href:'/channels/7',title:'甲頻道'})));
 assert.ok(cell.includes(`src="${known.channelAvatar!.url}"`));
 assert.match(cell,/<span title="乙媒體（未對應到本站頻道）"><span class="inline-flex[^"]*"[^>]*><span aria-hidden="true"[^>]*>乙<\/span><\/span>乙媒體<\/span>/);
 assert.equal(cell.match(/<a /g)?.length,1);assert.equal(cell.match(/<img /g)?.length,1);
 // The legacy joined value is not printed again beside the source list.
 assert.equal(cell.split('甲頻道、乙媒體').length,2);
 bodyRows(html).forEach(assertOneLineRow);
});

test('empty source list keeps the explicit label as one unlinked fallback and never splits or resolves it by name',()=>{
 const cell=channelCell(table({value:'甲頻道',sources:[]}));
 assert.doesNotMatch(cell,/<a |<img |\/channels\//);
 assert.match(cell,/title="甲頻道（未對應到本站頻道）"/);assert.match(cell,/>甲<\/span><\/span>甲頻道<\/span>/);
 // Missing or blank labels fall back to the ordinary missing-value rendering.
 assert.doesNotMatch(channelCell(table({value:'',sources:[]})),/未對應到本站頻道/);
 // Cells without `sources` (older responses, plain text) are untouched.
 assert.equal(channelCell(table('甲頻道')),`<span class="${clip}" title="甲頻道">甲頻道</span>`);
});

test('a source never borrows a logo or link it does not own',()=>{
 for(const s of [{...unknown,channelAvatar:avatar(7)},{...known,channelAvatar:avatar(8)},{...known,channelId:0},{...known,channelId:-7},{...known,channelId:7.5}] as ChannelSource[]){
  const html=render(createElement(ChannelSourceLabel,{source:s}));
  assert.doesNotMatch(html,/<img |\/media\/channels\/8\//,html);
  if(s.channelId!==7)assert.doesNotMatch(html,/href=/,html);
 }
 assert.deepEqual(sourceIdentity({...known,channelAvatar:avatar(8)}),{id:7,avatar:null});
 assert.deepEqual(sourceIdentity(known),{id:7,avatar:known.channelAvatar});
});

test('a source list in the sticky lead keeps the lead clip and box',()=>{
 const html=render(createElement(ReportTable,{columns:[{key:'media',label:'媒體'},...columns.slice(0,2),{key:'n',label:'次數',kind:'number'}],rows:[{media:{value:'甲頻道',sources:[known,unknown]},event:'議題',summary:'摘要',n:1}],label:'媒體觀點'}));
 assert.match(html,/<td data-label="媒體" class="table-lead sticky[^"]*"><div class="table-lead-box min-w-0"><span class="min-w-0 max-w-full truncate inline-block align-top sm:max-w-xs" title="甲頻道、乙媒體">/);
 bodyRows(html).forEach(assertOneLineRow);
});

test('event citations and media rows show explicit sources without nesting the channel link in the video link',()=>{
 const citation=(id:string,media:string,sourceChannel:ChannelSource)=>({id,rawId:id,media,href:`https://www.youtube.com/watch?v=${id}`,verification:'stored-reference' as const,sourceChannel});
 const presentation:EventPresentation={summaries:[{analysisId:1,title:'議題',description:'',keywords:['關鍵'],media:['甲頻道','乙媒體'],sourceChannels:[known,unknown],facts:[{headline:'事實',citation:citation('AbCdEfGh123','甲頻道',known)}],opinions:[{stance:'',intensity:'',content:'觀點',citation:citation('ZyXwVuTs987','乙媒體',unknown)}]}],people:null,media:{analysisId:2,mainSubject:'',all:['乙媒體'],sourceChannels:[unknown],groups:[{kind:'other',rows:[{media:'乙媒體',sourceChannel:unknown,stance:'',strength:'',description:''}]}]}};
 const html=render(createElement(EventAnalysis,{data:{dailyId:1,title:'議題',analyses:[],presentation,resolution:{kind:'exact'},evidenceCoverage:{}} as unknown as AiEventData}));
 assert.equal(html.match(/href="\/channels\/7"/g)?.length,2);assert.doesNotMatch(html,/href="\/channels\/(?!7")/);
 for(const anchor of html.match(/<a [^>]*youtube\.com[\s\S]*?<\/a>/g)??[])assert.doesNotMatch(anchor,/\/channels\/|<img /);
 assert.match(html,/分析 #1 · 關鍵 · 媒體：<span title="甲頻道、乙媒體">/);
 assert.match(html,/<h4 class="text-sm font-semibold"><span title="乙媒體（未對應到本站頻道）">/);
});

test('snapshot source videos show the recorded channel as a sibling of the YouTube link, linked only for a positive ID',()=>{
 const presentation:EventPresentation={summaries:[],people:null,media:null};
 const lineage={state:'immutable-snapshot',runId:null,dailyResultSha256:null,sourceChanged:false,sourceVideos:[{id:'AbCdEfGh123',title:'影片甲',channelId:7,media:'甲頻道'},{id:'ZyXwVuTs987',title:'影片乙',channelId:0,media:'乙媒體'}]};
 const html=render(createElement(EventAnalysis,{data:{dailyId:1,title:'議題',analyses:[{id:9,type:'summary',updatedAt:null,result:{},lineage}],presentation,resolution:{kind:'exact'},evidenceCoverage:{}} as unknown as AiEventData}));
 assert.match(html,new RegExp(`${anchor({class:'hover:underline',href:'/channels/7',title:'甲頻道'})}<span class="inline-flex[^"]*"[^>]*><span aria-hidden="true"[^>]*>甲</span></span>甲頻道</a><span aria-hidden="true">·</span>${anchor({href:'https://www.youtube.com/watch?v=AbCdEfGh123'})}影片甲`));
 assert.match(html,/<span title="乙媒體（未對應到本站頻道）">[\s\S]*?乙媒體<\/span><span aria-hidden="true">·<\/span><a [^>]*watch\?v=ZyXwVuTs987[^>]*>影片乙/);
 assert.equal(html.match(/href="\/channels\//g)?.length,1);
 for(const a of html.match(/<a [^>]*youtube\.com[\s\S]*?<\/a>/g)??[])assert.doesNotMatch(a,/\/channels\/|甲頻道|乙媒體/);
});

test('channel insight cells render explicit sources on one clipped line with unknown fallbacks; plain cells are unchanged',async()=>{
 const {ChannelInsights}=await import('../components/ChannelInsights');
 const report=(rows:Record<string,ReportValue|ReportCell>[])=>({title:'',columns:[],rows,total:rows.length,limit:5,offset:0,updatedAt:null});
 const data={channel:{id:7},trendAvailable:false,aiSummary:report([{title:'純文字議題',description:'描述'}]),dailySummary:report([{title:{value:'丙頻道',sources:[]},description:'描述',source:{value:'甲頻道、乙媒體',sources:[known,unknown]}}])};
 const html=render(createElement(ChannelInsights,{data:data as never}));
 assert.match(html,new RegExp(`<strong><span class="${clip}" title="丙頻道"><span title="丙頻道（未對應到本站頻道）">`));
 assert.match(html,new RegExp(`<small><span class="${clip}" title="甲頻道、乙媒體">${anchor({href:'/channels/7'})}`));
 assert.match(html,/<span title="乙媒體（未對應到本站頻道）">/);
 assert.match(html,/<strong>純文字議題<\/strong>/);
 assert.equal(html.match(/<img /g)?.length,1);
});

test('feed and saved video targets add a separate channel byline only when the source is present',()=>{
 const withSource=render(createElement(TargetLink,{href:'/videos/AbCdEfGh123',videoId:'AbCdEfGh123',label:'影片',source:known}));
 assert.match(withSource,new RegExp(`${anchor({class:'break-words font-medium hover:underline',href:'/videos/AbCdEfGh123'})}影片</a><p class="mt-1 text-xs[^"]*">${anchor({class:'hover:underline',href:'/channels/7'})}`));
 assert.match(withSource,new RegExp(anchor({class:'shrink-0',tabindex:'-1','aria-hidden':'true',href:'/videos/AbCdEfGh123'})));
 // No anchor wraps another one.
 assert.doesNotMatch(withSource,/<a [^>]*>(?:(?!<\/a>)[\s\S])*<a /);
 const unresolved=render(createElement(TargetLink,{href:'/videos/AbCdEfGh123',videoId:'AbCdEfGh123',label:'影片',source:unknown}));
 assert.doesNotMatch(unresolved,/\/channels\//);assert.match(unresolved,/乙媒體/);
 const none=render(createElement(TargetLink,{href:'/events/x',videoId:null,label:'事件',source:null}));
 assert.match(none,new RegExp(`^${anchor({class:'flex min-w-0 items-start gap-3 break-words font-medium hover:underline',href:'/events/x'})}<span class="min-w-0">事件</span></a>$`));assert.doesNotMatch(none,/<p /);
});
