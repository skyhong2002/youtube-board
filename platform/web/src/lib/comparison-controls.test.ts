import {strict as assert} from 'node:assert';
import {test} from 'node:test';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {ComparisonControls} from '../components/ComparisonControls';
test('comparison range has required observed dates, normalized datetime and omits missing inputs',()=>{
 const html=renderToStaticMarkup(createElement(ComparisonControls,{search:{},points:[{time:'2026-10-01T00:00:00Z'},{time:'2026-10-11'}]}));
 assert.match(html,/<input(?=[^>]*name="from")(?=[^>]*required="")(?=[^>]*value="2026-10-01")[^>]*>/);assert.match(html,/<input(?=[^>]*name="to")(?=[^>]*required="")(?=[^>]*value="2026-10-11")[^>]*>/);
 const empty=renderToStaticMarkup(createElement(ComparisonControls,{search:{}}));assert.match(empty,/<input(?=[^>]*name="from")(?=[^>]*disabled="")(?=[^>]*value="")[^>]*>/);assert.match(empty,/<input(?=[^>]*name="to")(?=[^>]*disabled="")(?=[^>]*value="")[^>]*>/);
});
test('comparison preserves repeated scope parameters and exposes ambiguous editable values',()=>{
 const scopes=renderToStaticMarkup(createElement(ComparisonControls,{search:{tagid:['1','2']}}));assert.match(scopes,/name="tagid" value="1"/);assert.match(scopes,/name="tagid" value="2"/);
 const duplicate=renderToStaticMarkup(createElement(ComparisonControls,{search:{from:['2026-10-01','2026-10-02'],tags:['a','b']}}));assert.match(duplicate,/重複參數/);assert.match(duplicate,/name="from" value="2026-10-01"/);assert.match(duplicate,/name="from" value="2026-10-02"/);assert.match(duplicate,/name="tags" value="a"/);assert.match(duplicate,/name="tags" value="b"/);assert.doesNotMatch(duplicate,/套用比較/);
});

test('accepted comparison metric aliases display and submit the effective API metric',()=>{
 for(const [type,expected] of [['count_videos','tags_video'],['tags_view','tags_views'],['total_views','tags_views']]){const html=renderToStaticMarkup(createElement(ComparisonControls,{search:{type}}));assert.match(html,new RegExp('<option value="'+expected+'" selected=""'));}
});
