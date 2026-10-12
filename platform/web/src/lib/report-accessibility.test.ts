import {strict as assert} from 'node:assert';
import {test} from 'node:test';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {TimeChart} from '../components/Charts';
import {ObservationValue} from '../components/ObservationValue';
import {renameHistory} from './editorial-history';
import {count} from './format';
test('missing observations remain distinguishable from real zero in accessible charts and metrics',()=>{
 assert.equal(count(null),'—');assert.equal(count(undefined),'—');assert.equal(count(0),'0');
 assert.match(renderToStaticMarkup(createElement(ObservationValue,{value:null})),/無觀測值/);
 assert.equal(renderToStaticMarkup(createElement(ObservationValue,{value:0})),'0');
 const html=renderToStaticMarkup(createElement(TimeChart,{points:[{time:'2026-10-10',value:null},{time:'2026-10-11',value:0}],label:'觀看觀測',unit:''}));
 assert.match(html,/無觀測值/);assert.match(html,/1 筆有效觀測/);assert.match(html,/scope="row"/);assert.match(html,/>數值<\/th>/);assert.match(html,/role="group" aria-label="圖表顯示範圍"/);
});
test('merged event history retains the renamed source event and never pairs unrelated entries',()=>{
 const history={before:[{id:'merged',title:'原名'}],after:[{id:'merged',title:'新名'}]};
 assert.deepEqual(renameHistory(history,'canonical'),{before:'原名',after:'新名',sourceId:'merged',merged:true});
 assert.equal(renameHistory({...history,after:[{id:'other',title:'不相關'}]},'canonical'),null);
 assert.equal(renameHistory({before:[],after:[]},'canonical'),null);
});
