import assert from 'node:assert/strict';
import test from 'node:test';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {CoverageDisclosure} from '../components/CoverageDisclosure';
import type {BucketCoverage} from './bucket-coverage';

const render=(coverage:BucketCoverage[])=>renderToStaticMarkup(createElement(CoverageDisclosure,{coverage}));
test('incomplete chart warning stays visible; complete date evidence uses a closed native disclosure',()=>{
 const html=render([{date:'2026-10-11',observed:19,status:'partial'},{date:'2026-10-12',observed:null,status:'unknown'},{date:'2026-10-13',observed:28,status:'complete'}]);
 const visible=html.slice(0,html.indexOf('<details>'));
 assert.match(visible,/1 個日期未完整、1 個日期涵蓋未知/);
 assert.match(visible,/虛線與空心點不應與完整觀測直接比較/);
 assert.match(visible,/不補零.*不代表聲量下降/);
 assert.match(html,/<details><summary[^>]*>查看各日期的來源涵蓋與計算限制/);
 assert.doesNotMatch(html,/<details[^>]*open/);
 assert.match(html,/2026-10-11 19\/28、2026-10-12 涵蓋未知/);
 assert.match(html,/實線與實心點只用於涵蓋完整（28\/28）/);
 assert.doesNotMatch(html,/2026-10-13 28\/28/);
});
test('complete coverage and no dates produce no incomplete-data warning',()=>{
 assert.equal(render([]),'');
 assert.equal(render([{date:'2026-10-13',observed:28,status:'complete'}]),'');
});
test('recorded zero coverage is partial, unknown remains distinct and source dates are escaped',()=>{
 const html=render([{date:'<img src=x>',observed:0,status:'partial'},{date:'2026-10-12',observed:null,status:'unknown'}]);
 assert.match(html,/1 個日期未完整、1 個日期涵蓋未知/);
 assert.match(html,/&lt;img src=x&gt; 0\/28/);assert.doesNotMatch(html,/<img|2026-10-12 0\/28/);
 assert.match(html,/dark:text-amber-200/);
});
