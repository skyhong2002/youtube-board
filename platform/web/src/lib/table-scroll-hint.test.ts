import assert from 'node:assert/strict';
import test from 'node:test';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import TableScroller from '../components/TableScroller';
import {TableScrollHint,type TableScrollPosition} from '../components/TableScrollHint';

test('scroll guidance requires measured overflow, including both directions at the end',()=>{
 for(const position of [undefined,'none'] as const)assert.equal(renderToStaticMarkup(createElement(TableScrollHint,{position})),'');
 for(const position of ['start','middle','end'] satisfies TableScrollPosition[]){
  const html=renderToStaticMarkup(createElement(TableScrollHint,{position}));
  assert.match(html,/左右滑動表格可查看其餘欄位/);
  assert.match(html,/sm:hidden/);assert.match(html,/dark:text-zinc-400/);
 }
});
test('SSR keeps comparison content and never claims a scroll affordance before measuring geometry',()=>{
 const html=renderToStaticMarkup(createElement(TableScroller,{showMobileScrollHint:true,label:'候選人比較表',children:createElement('table',null,createElement('tbody',null,createElement('tr',null,createElement('td',null,'候選人甲'))))}));
 assert.match(html,/候選人甲/);assert.match(html,/overflow-x-auto/);
 assert.doesNotMatch(html,/左右滑動表格可查看其餘欄位/);
});
