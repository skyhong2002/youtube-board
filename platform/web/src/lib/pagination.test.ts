import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {VideoSearchReadHint} from '../components/VideoSearchReadHint';
import {Pagination,type PaginationCollection} from '../components/Pagination';
const html=(collection:PaginationCollection,search={})=>renderToStaticMarkup(createElement(Pagination,{collection,search,path:'/videos'}));
const unknown={total:null,limit:50,offset:0,hasNext:true,totalStatus:'not-computed' as const,rows:Array(50).fill({})};
test('unknown total first page explicitly discloses uncounted total and keeps next based on hasNext',()=>{
 const rendered=html(unknown);assert.match(rendered,/總數未計算/);assert.match(rendered,/第 1–50 筆/);assert.match(rendered,/下一頁/);assert.doesNotMatch(rendered,/共 0|共 50|上一頁<\/a>/);assert.match(rendered,/未另外縮短日期範圍/);
});
test('partial last page uses actual rows, empty later page retains previous, missing hasNext never invents next',()=>{
 const partial=html({...unknown,offset:50,rows:Array(3).fill({}),hasNext:false});assert.match(partial,/第 51–53 筆/);assert.doesNotMatch(partial,/第 51–100|下一頁/);assert.match(partial,/上一頁/);
 for(const offset of [0,50]){const empty=html({...unknown,offset,rows:[],hasNext:undefined});assert.match(empty,/目前頁面沒有資料/);assert.match(empty,/總數未計算/);assert.doesNotMatch(empty,/共 0|下一頁/);assert.equal(empty.includes('← 上一頁'),offset>0);}
});
test('nullable totals preserve all filter state and enforce supported offset boundary',()=>{
 const search={q:'%_台灣',tagid:'1',or:['2','3'],not:'4',from:'2024-01-01',to:'2026-01-01',column:'viewCount',limit:'50'};
 const rendered=html({...unknown,offset:50},search),links=[...rendered.matchAll(/href="([^"]+)"/g)].map(m=>new URL(m[1]!.replaceAll('&amp;','&'),'https://example.test'));
 assert.equal(links.length,2);assert.deepEqual(links.map(u=>u.searchParams.get('offset')),['0','100']);
 for(const url of links){assert.equal(url.searchParams.get('q'),search.q);assert.deepEqual(url.searchParams.getAll('or'),['2','3']);for(const key of ['tagid','not','from','to','column','limit'] as const)assert.equal(url.searchParams.get(key),search[key]);}
 const capped=html({...unknown,offset:100000},search);assert.doesNotMatch(capped,/offset=100050|下一頁/);assert.match(capped,/已達可瀏覽頁數上限/);assert.match(capped,/上一頁/);
});
test('unavailable count differs from intentionally skipped count; numeric other collections retain exact pager',()=>{
 assert.match(html({...unknown,totalStatus:'unavailable'}),/總數暫時無法取得/);
 assert.equal(html({total:0,limit:50,offset:0}),'');assert.equal(html({total:20,limit:50,offset:0}),'');
 assert.match(html({total:20,limit:50,offset:0,hasNext:true,rows:Array(50).fill({})}),/下一頁/);
 const exact=html({total:103,limit:50,offset:50});assert.match(exact,/共 103 筆/);assert.match(exact,/第 51–100 筆/);assert.match(exact,/上一頁/);assert.match(exact,/下一頁/);assert.doesNotMatch(exact,/總數未計算/);
});

test('bounded search failure suggests explicit narrowing without claiming a zero result or applying a window',()=>{
 const rendered=renderToStaticMarkup(createElement(VideoSearchReadHint));assert.match(rendered,/選擇頻道或發布日期範圍後重試/);assert.match(rendered,/沒有自動套用日期限制/);assert.match(rendered,/不能據此判定沒有相關影片/);assert.doesNotMatch(rendered,/href=|最近 7 天|共 0/);
});
