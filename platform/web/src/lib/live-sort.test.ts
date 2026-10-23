import assert from 'node:assert/strict';
import {test} from 'node:test';
import {sortLiveRows} from '../components/LiveSortable';

const rows=[
 {key:'a',values:{current:30,channel:'乙台',start:Date.parse('2026-10-23T01:00:00Z'),trend:null}},
 {key:'b',values:{current:90,channel:'甲台',start:null,trend:0.5}},
 {key:'c',values:{current:30,channel:'丙台',start:Date.parse('2026-10-24T01:00:00Z'),trend:-0.2}},
];
const keys=(list:typeof rows)=>list.map(row=>row.key);

test('live rows keep the viewer ranking until a column is chosen',()=>{
 assert.equal(sortLiveRows(rows,null),rows);
});

test('numbers and start times sort both ways; ties keep the ranking order',()=>{
 assert.deepEqual(keys(sortLiveRows(rows,{key:'current',descending:true})),['b','a','c']);
 assert.deepEqual(keys(sortLiveRows(rows,{key:'current',descending:false})),['a','c','b']);
 assert.deepEqual(keys(sortLiveRows(rows,{key:'start',descending:true})),['c','a','b']);
});

test('unknown values stay last in either direction',()=>{
 assert.deepEqual(keys(sortLiveRows(rows,{key:'start',descending:false})),['a','c','b']);
 assert.deepEqual(keys(sortLiveRows(rows,{key:'trend',descending:true})),['b','c','a']);
 assert.deepEqual(keys(sortLiveRows(rows,{key:'trend',descending:false})),['c','b','a']);
});

test('channel names compare as Traditional Chinese text',()=>{
 const expected=[...rows].sort((x,y)=>x.values.channel.localeCompare(y.values.channel,'zh-Hant-TW')).map(row=>row.key);
 assert.deepEqual(keys(sortLiveRows(rows,{key:'channel',descending:false})),expected);
});

import {playerReport,previewAudio,previewPlace,readPreviewAudio} from '../components/LivePreview';
test('the live preview opens large under the thumbnail, above it near the bottom, inside the viewport',()=>{
 const viewport={width:1280,height:900};
 assert.deepEqual(previewPlace({left:114,top:261,bottom:342},viewport),{left:114,top:350,width:720,height:405});
 const low=previewPlace({left:114,top:758,bottom:839},viewport);
 assert.equal(low.top+low.height,750);
 assert.ok(low.top>=64);
 const narrow=previewPlace({left:300,top:100,bottom:160},{width:390,height:844});
 assert.deepEqual([narrow.width,narrow.left],[374,8]);
});

test('the preview plays with sound once the page was used, then follows the reader\'s saved choice',()=>{
 assert.deepEqual(previewAudio(null,false),{muted:true,volume:null});
 assert.deepEqual(previewAudio(null,true),{muted:false,volume:null});
 assert.deepEqual(previewAudio({muted:true,volume:40},true),{muted:true,volume:40});
 assert.deepEqual(previewAudio({muted:false,volume:30},false),{muted:true,volume:30});
 assert.deepEqual(readPreviewAudio('{"muted":false,"volume":30}'),{muted:false,volume:30});
 assert.deepEqual(readPreviewAudio('{"muted":true,"volume":900}'),{muted:true,volume:null});
 for(const raw of [null,'','not json','{"volume":30}','[]'])assert.equal(readPreviewAudio(raw),null);
});

test('only YouTube player info reports are read from postMessage',()=>{
 assert.deepEqual(playerReport('{"event":"infoDelivery","info":{"muted":true,"volume":55,"playerState":1,"currentTime":3}}'),{muted:true,volume:55,playerState:1});
 assert.deepEqual(playerReport({event:'initialDelivery',info:{volume:20}}),{volume:20});
 for(const data of ['{"event":"onReady"}','oops',null,{event:'infoDelivery',info:{muted:'yes'}}])assert.deepEqual(playerReport(data)??{},{});
});
