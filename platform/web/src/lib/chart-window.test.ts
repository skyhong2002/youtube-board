import {strict as assert} from 'node:assert';
import {test} from 'node:test';
import {chartWindow,moveChartWindow} from './chart-window';
test('chart window moves only through loaded indices, retains width and clamps endpoints',()=>{assert.deepEqual(chartWindow(100),{start:0,end:99});assert.deepEqual(moveChartWindow(100,{start:70,end:99},-1),{start:40,end:69});assert.deepEqual(moveChartWindow(100,{start:70,end:99},1),{start:70,end:99});assert.deepEqual(moveChartWindow(100,{start:10,end:39},-1),{start:0,end:29});assert.deepEqual(chartWindow(0),{start:0,end:0});assert.deepEqual(chartWindow(5,NaN,Infinity),{start:0,end:4});});
