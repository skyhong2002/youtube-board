import {strict as assert} from 'node:assert';
import {test} from 'node:test';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {EventAnalysis} from '../components/EventAnalysis';
import type {AiEventData} from '../../../api/src/contracts';
import {eventPresentation} from '../../../api/src/reports/event-shapes';
test('event presentation exposes media attribution, snapshot change and safe exact source citations',()=>{
 const analyses=[{id:3,type:'media',updatedAt:null,result:{main_subject:'<script>subject</script>',all_medias:['甲媒體'],other_opinions_medias:[{media:'甲媒體',description:'媒體描述',support_or_opposition:'中立',strength:'低'}]}},{id:4,type:'summary',updatedAt:null,result:{events:[{event:'議題',fact:[{headline:'來源引文',video_id:'AbCdEfGh123',media:'甲媒體'},{headline:'無效引用',video_id:'javascript:alert(1)'}]}]}}];
 const data={dailyId:1,title:'議題',analyses,presentation:eventPresentation(analyses),resolution:{kind:'same-day-source-alias',requestedTitle:'來源題'},evidenceCoverage:{sourceChanged:true}} as unknown as AiEventData;
 const html=renderToStaticMarkup(createElement(EventAnalysis,{data}));assert.match(html,/媒體觀點/);assert.match(html,/媒體描述/);assert.match(html,/每日來源已有變動/);assert.match(html,/watch\?v=AbCdEfGh123/);assert.doesNotMatch(html,/<script>/);assert.doesNotMatch(html,/href="javascript:/);assert.match(html,/&lt;script&gt;subject/);
});
test('event citation rendering rejects unsafe hrefs even when presentation input bypasses the API',()=>{
 const analyses=[{id:1,type:'summary',updatedAt:null,result:{events:[{event:'議題',fact:[{headline:'引用',video_id:'AbCdEfGh123',media:'甲媒體'}]}]}}];
 const presentation=eventPresentation(analyses);presentation.summaries[0]!.facts[0]!.citation.href='javascript:alert(1)';
 const data={dailyId:1,title:'議題',analyses,presentation,resolution:{kind:'direct'},evidenceCoverage:{}} as unknown as AiEventData;
 const html=renderToStaticMarkup(createElement(EventAnalysis,{data}));assert.doesNotMatch(html,/href="javascript:/);assert.match(html,/甲媒體/);
});

test('shared event header preserves exact source navigation, actions, known counts and escaped labels',async()=>{
 const {EventHeader}=await import('../components/EventHeader');
 const html=renderToStaticMarkup(createElement(EventHeader,{title:'<script>事件</script>',breadcrumb:'事件表',description:'來源整理',updatedAt:null,actions:createElement('a',{href:'/my/saved'},'收藏'),tags:['交通 %41','交通 '],stats:[{label:'本地來源影片',value:'0'}],jumps:[['source-videos','來源影片'],['stored-analysis','儲存分析']]}));
 assert.match(html,/&lt;script&gt;事件&lt;\/script&gt;/);assert.doesNotMatch(html,/<script>|<img/);assert.match(html,/href="\/my\/saved"/);assert.match(html,/href="#source-videos"/);assert.match(html,/href="#stored-analysis"/);assert.ok(html.includes('/keywords/'+encodeURIComponent('交通 %41')+'/videos'));assert.ok(html.includes('/keywords/'+encodeURIComponent('交通 ')+'/videos'));assert.match(html,/本地來源影片/);assert.match(html,/>0<\/dd>/);
});
