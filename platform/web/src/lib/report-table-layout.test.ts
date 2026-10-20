import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {ReportTable} from '../components/ReportTable';
import {stackOnPhones,textWidth,uniformColumns} from './report-table-layout';
import {compareOnOneAxis,COMPARE_COLORS,COMPARE_MAX_SERIES} from './series-compare';
import type {ReportColumn} from './report-contract';
const groups:ReportColumn[]=[{key:'name',label:'群組'},{key:'basis',label:'分類依據'},{key:'items',label:'項目數',kind:'number'}];
const groupRows=[['政治人物','內容詞彙群組',512],['台灣／中國立場與其他頻道分類','頻道分類群組',7],['名嘴','內容詞彙群組',18]].map(([name,basis,items])=>({name,basis,items}));
test('short narrow lists stay one line per row on phones; long text still stacks',()=>{
 assert.equal(textWidth('群組'),2);assert.ok(textWidth('AI')<2);
 assert.equal(stackOnPhones(groups,groupRows),false);
 assert.equal(stackOnPhones([{key:'term',label:'詞'},{key:'w',label:'權重',kind:'number'}],[{term:'陳柏惟',w:15.593},{term:'訂閱',w:0.476}]),false);
 assert.equal(stackOnPhones([{key:'title',label:'議題'},{key:'n',label:'次數',kind:'number'}],[{title:'一個非常非常長的頻道名稱會在手機上被截斷而不是換行成好幾行',n:3}]),true);
 const html=renderToStaticMarkup(createElement(ReportTable,{columns:groups,rows:groupRows,label:'群組'}));
 assert.doesNotMatch(html,/table-stack/);assert.match(html,/max-sm:max-w-36/,'phone cut keeps the row on screen');
});
test('columns with one value on every row are named once above a wide table',()=>{
 const columns:ReportColumn[]=[{key:'group',label:'分組'},{key:'views',label:'觀看',kind:'number'},{key:'videos',label:'影片',kind:'number'},{key:'days',label:'有快取日數',kind:'number'},{key:'asked',label:'選定日數',kind:'number'}];
 const rows=[{group:'甲',views:10,videos:1,days:7,asked:7},{group:'乙',views:20,videos:2,days:7,asked:7},{group:'丙',views:30,videos:3,days:7,asked:7}];
 assert.deepEqual(uniformColumns(columns,rows,0).map(u=>u.column.key),['days','asked']);
 assert.deepEqual(uniformColumns(columns,rows.slice(0,2),0),[],'two rows compare nothing either way');
 assert.deepEqual(uniformColumns(columns,[...rows.slice(0,2),{...rows[2]!,days:6}],0).map(u=>u.column.key),['asked']);
 assert.deepEqual(uniformColumns(columns,[...rows.slice(0,2),{...rows[2]!,days:null}],0).map(u=>u.column.key),['asked'],'a missing value is not the same value');
 const html=renderToStaticMarkup(createElement(ReportTable,{columns,rows,label:'排行',foldUniform:true}));
 assert.match(html,/每列相同：/);assert.match(html,/有快取日數 <strong[^>]*>7<\/strong>/);
 assert.doesNotMatch(html,/<th[^>]*>有快取日數/);assert.match(html,/<th[^>]*>影片/);
 assert.doesNotMatch(renderToStaticMarkup(createElement(ReportTable,{columns,rows,label:'排行'})),/每列相同/,'opt-in only');
});
test('term comparison shares one axis only with a fixed colour slot for every term',()=>{
 assert.equal(COMPARE_COLORS.light.length,COMPARE_COLORS.dark.length);
 const s=(unit='次',n=7)=>({name:'x',unit,points:Array.from({length:n},()=>({time:'2026-10-01',value:1}))});
 assert.equal(compareOnOneAxis([s(),s()]),true);
 assert.equal(compareOnOneAxis([s()]),false);
 assert.equal(compareOnOneAxis([s(),s('部')]),false);
 assert.equal(compareOnOneAxis([s(),s('次',6)]),false);
 assert.equal(compareOnOneAxis(Array.from({length:COMPARE_MAX_SERIES+1},()=>s())),false,'never a cycled colour');
});
