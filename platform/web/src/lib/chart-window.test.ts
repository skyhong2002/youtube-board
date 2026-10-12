import {strict as assert} from 'node:assert';
import {test} from 'node:test';
import {chartTimeLabel,chartWindow,moveChartWindow} from './chart-window';
import {dateTime} from './format';
test('hourly UTC instants display in Asia/Taipei across midnight; date-only labels stay date-only',()=>{
 // 15:00Z and 16:00Z on 10-11 are 23:00 on 10-11 and 00:00 on 10-12 in Taipei.
 const before=chartTimeLabel('2026-10-11T15:00:00Z'),after=chartTimeLabel('2026-10-11T16:00:00Z');
 assert.equal(before,dateTime('2026-10-11T15:00:00Z'));assert.equal(after,dateTime('2026-10-11T16:00:00Z'));
 assert.match(before,/^2026\/10\/11\b/);assert.match(after,/^2026\/10\/12\b/);assert.match(after,/\d{2}:00$/);
 assert.equal(chartTimeLabel('2026-10-11T16:00:00.000Z'),after);assert.equal(chartTimeLabel('2026-10-12T00:00:00+08:00'),after);
 for(const value of ['2026-10-11','2026-10','第 3 週'])assert.equal(chartTimeLabel(value),value);
});
test('chart window moves only through loaded indices, retains width and clamps endpoints',()=>{assert.deepEqual(chartWindow(100),{start:0,end:99});assert.deepEqual(moveChartWindow(100,{start:70,end:99},-1),{start:40,end:69});assert.deepEqual(moveChartWindow(100,{start:70,end:99},1),{start:70,end:99});assert.deepEqual(moveChartWindow(100,{start:10,end:39},-1),{start:0,end:29});assert.deepEqual(chartWindow(0),{start:0,end:0});assert.deepEqual(chartWindow(5,NaN,Infinity),{start:0,end:4});});
