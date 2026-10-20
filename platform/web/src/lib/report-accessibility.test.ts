import {strict as assert} from 'node:assert';
import {test} from 'node:test';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {TimeChart} from '../components/Charts';
import {ObservationValue} from '../components/ObservationValue';
import {renameHistory} from './editorial-history';
import {count} from './format';
import {existsSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
test('missing observations remain distinguishable from real zero in accessible charts and metrics',()=>{
 assert.equal(count(null),'—');assert.equal(count(undefined),'—');assert.equal(count(0),'0');
 assert.match(renderToStaticMarkup(createElement(ObservationValue,{value:null})),/無觀測值/);
 assert.equal(renderToStaticMarkup(createElement(ObservationValue,{value:0})),'0');
 const html=renderToStaticMarkup(createElement(TimeChart,{points:[{time:'2026-10-10',value:null},{time:'2026-10-11',value:0}],label:'觀看觀測',unit:''}));
 assert.match(html,/無觀測值/);assert.match(html,/1 筆有效觀測/);assert.match(html,/scope="row"/);assert.match(html,/>數值<\/th>/);assert.doesNotMatch(html,/圖表顯示範圍/,'a two-point series has no window to choose');
 const long=renderToStaticMarkup(createElement(TimeChart,{points:Array.from({length:10},(_,i)=>({time:`2026-10-${String(i+1).padStart(2,'0')}`,value:i})),label:'觀看觀測',unit:''}));
 assert.match(long,/role="group" aria-label="圖表顯示範圍"/);assert.match(long,/最近 7 點/);
});
test('merged event history retains the renamed source event and never pairs unrelated entries',()=>{
 const history={before:[{id:'merged',title:'原名'}],after:[{id:'merged',title:'新名'}]};
 assert.deepEqual(renameHistory(history,'canonical'),{before:'原名',after:'新名',sourceId:'merged',merged:true});
 assert.equal(renameHistory({...history,after:[{id:'other',title:'不相關'}]},'canonical'),null);
 assert.equal(renameHistory({before:[],after:[]},'canonical'),null);
});
// Source-level caller guards only (P0 ledger E1 / VD1): they read the JSX callsites, not a rendered route or request.
const webSource=(file:string)=>{const local=join(process.cwd(),file),root=join(process.cwd(),'platform/web',file);return readFileSync(existsSync(local)?local:root,'utf8');};
const genericEmptyAction='請調整日期或篩選條件';
test('events empty state describes only the event search control, not absent date filters',()=>{
 const match=webSource('src/app/events/EventList.tsx').match(/<Empty title="尚未建立符合條件的事件" description="([^"]+)"\/>/);
 assert.ok(match,'EventList empty caller must pass its own description');
 const description=match[1]!;
 assert.match(description,/事件搜尋/);assert.match(description,/未收錄不代表現實中沒有相關事件/);
 assert.doesNotMatch(description,/日期|篩選/);assert.ok(!description.includes(genericEmptyAction));
});
test('video overview history empty state does not instruct absent controls or imply a time series',()=>{
 const source=webSource('src/lib/report-pages.tsx'),match=source.match(/<Empty title="尚無歷史觀測" description="([^"]+)" \/>/);
 assert.ok(match,'video history empty caller must pass its own description');
 const description=match[1]!;
 assert.match(description,/尚未儲存這部影片的歷史觀測/);assert.match(description,/無法據以建立歷史時間序列/);
 assert.doesNotMatch(description,/調整|日期|篩選/);
 assert.equal(source.split('<Empty title="尚無歷史觀測"').length,2,'exactly one history caller is changed');
});
