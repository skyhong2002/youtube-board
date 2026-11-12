import {strict as assert} from 'node:assert';
import {test} from 'node:test';
import {timeChartOption,type ChartPoint} from './time-chart-option';
import {chartWindow} from './chart-window';
import type {BucketCoverage} from './bucket-coverage';

const theme={muted:'#71717a',line:'#e4e4e7',accent:'#cc0000',panel:'#ffffff',color:'#18181b',fontFamily:'sans-serif'};
const points=(n:number):ChartPoint[]=>Array.from({length:n},(_,i)=>({time:`2026-10-${String(i+1).padStart(2,'0')}`,value:i===2?null:i*10}));
type Zoom={type:string;show?:boolean;startValue:number;endValue:number;zoomLock:boolean;zoomOnMouseWheel?:boolean};
type Series={name:string;type:string;data:(number|null)[];connectNulls:boolean;itemStyle?:{color:string}};

test('a plain series is one line with gaps kept and the theme accent', () => {
 const data=points(5),option=timeChartOption({points:data,label:'觀看',unit:'次',compact:false,window:chartWindow(5),theme});
 const series=option.series as Series[];
 assert.equal(series.length,1);
 assert.deepEqual(series[0]!.data,[0,10,null,30,40]);
 assert.equal(series[0]!.connectNulls,false);
 assert.equal(series[0]!.itemStyle?.color,'#cc0000');
 assert.equal(option.yAxis.name,'次');
 assert.equal(option.aria.label.description,'觀看');
 // Default ECharts tooltip text without coverage.
 assert.equal('formatter' in option.tooltip,false);
});
test('the zoom window follows the chosen range; the slider and its bottom margin appear only past seven points', () => {
 const short=timeChartOption({points:points(7),label:'x',unit:'',compact:false,window:chartWindow(7),theme});
 assert.equal((short.dataZoom[1] as Zoom).show,false);
 assert.equal(short.grid.bottom,36);
 const window=chartWindow(40,10,19),long=timeChartOption({points:points(40),label:'x',unit:'',compact:false,window,theme});
 for(const zoom of long.dataZoom as Zoom[]){assert.equal(zoom.startValue,10);assert.equal(zoom.endValue,19);assert.equal(zoom.zoomLock,true);}
 assert.equal((long.dataZoom[0] as Zoom).zoomOnMouseWheel,false);
 assert.equal((long.dataZoom[1] as Zoom).show,true);
 assert.equal(long.grid.bottom,78);
 const compact=timeChartOption({points:points(40),label:'x',unit:'',compact:true,window,theme});
 assert.equal(compact.grid.bottom,56);
 assert.equal(compact.grid.top,30);
 assert.equal(compact.legend.show,false);
});
test('coverage splits the line and its tooltip names the bucket coverage', () => {
 const data=points(3),coverage:BucketCoverage[]=[{date:'2026-10-01',observed:28,status:'complete'},{date:'2026-10-02',observed:12,status:'partial'},{date:'2026-10-03',observed:28,status:'complete'}];
 const option=timeChartOption({points:data,label:'人物提及',unit:'次',coverage,compact:false,window:chartWindow(3),theme});
 assert.ok((option.series as Series[]).length>=2);
 const formatter=(option.tooltip as {formatter?:(params:unknown)=>string}).formatter;
 assert.ok(formatter);
 const text=formatter([{dataIndex:1}]);
 assert.match(text,/^2026-10-02　來源涵蓋 12\/28/);
 assert.match(text,/人物提及：10（未完整）$/);
});
