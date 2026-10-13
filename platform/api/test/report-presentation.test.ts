/**
 * Pure/mock presentation regressions (P0 ledger R2-tag102-days-1, R2-tag102-trends-1).
 * No database, createReader, buildApp, listener or network: dayRanking is called directly and
 * registerTagDays handlers are driven by a queued fake Reader with a fixed clock.
 * This proves API payload strings only, not rendered pages or visual acceptance.
 */
import {describe,expect,test} from 'vitest';
import type {Reader,Row} from '../src/db/client.js';
import {dayRanking,detailNumber} from '../src/reports/day-ranking.js';
import {registerTagDays,trendSeriesLabels} from '../src/reports/tag-days.js';

type Cell={value:string;href:string;detail:string}|null;
const longDecimal=/\d\.\d{4,}/;

describe('dayRanking matrix detail presentation',()=>{
 test('detailNumber formats ledger float artifacts deterministically',()=>{
  expect(detailNumber(192.46099999999998)).toBe('192.461');
  expect(detailNumber(129.79500000000002)).toBe('129.795');
  expect(detailNumber(0.1+0.2)).toBe('0.3');
  expect(detailNumber(1234.5678)).toBe('1,234.568');
  expect(detailNumber(0)).toBe('0');
  expect(detailNumber(-0)).toBe('0');
  expect(detailNumber(-1e-17)).toBe('0');
  expect(detailNumber(-1.5)).toBe('-1.5');
 });

 const dates=['2026-10-01','2026-10-02','2026-10-03'];
 const fixture=(lineage?:[unknown,unknown])=>new Map<string,Row>([
  ['2026-10-01',{the_date:'2026-10-01',count_channels:'2',count_videos:'3',total_views:'10',tags_result:JSON.stringify({甲:0.1,乙:1.1,零:0,停:9}),...(lineage?{_cacheLineage:lineage[0]}:{})}],
  ['2026-10-02',{the_date:'2026-10-02',count_channels:'1',count_videos:'1',total_views:'0',tags_result:JSON.stringify({甲:0.2,乙:2.2}),...(lineage?{_cacheLineage:lineage[1]}:{})}],
 ]);
 const stop=new Set(['停']);

 test('raw-value mode keeps raw numbers, ranks, links, zero and missing cells',()=>{
  // Precondition: these sums really carry binary artifacts in the raw data.
  expect(String(0.1+0.2)).toBe('0.30000000000000004');expect(String(1.1+2.2)).toBe('3.3000000000000003');
  const r=dayRanking(dates,fixture(),'tags_result',false,stop,false);
  expect(r.diff).toBe(false);expect(r.comparable).toBe(true);
  expect(r.rows.map(x=>[x.date,x.rank,x.term,x.dailyValue,x.periodTotal,x.value])).toEqual([
   ['2026-10-01',1,'乙',1.1,1.1+2.2,1.1],['2026-10-01',2,'甲',0.1,0.1+0.2,0.1],['2026-10-01',3,'零',0,0,0],
   ['2026-10-02',1,'乙',2.2,1.1+2.2,2.2],['2026-10-02',2,'甲',0.2,0.1+0.2,0.2],
  ]);
  expect(r.rows.some(x=>x.term==='停')).toBe(false);
  expect(r.matrix).toHaveLength(3);
  const [first,second,third]=r.matrix as unknown as Record<string,Cell|number>[];
  expect(first!['2026-10-01']).toEqual({value:'乙',href:'/keywords/%E4%B9%99/videos',detail:'當日 1.1 · 當日 1.1 · 期間合計 3.3'});
  expect(first!['2026-10-02']).toEqual({value:'乙',href:'/keywords/%E4%B9%99/videos',detail:'當日 2.2 · 當日 2.2 · 期間合計 3.3'});
  expect(second!['2026-10-01']).toEqual({value:'甲',href:'/keywords/%E7%94%B2/videos',detail:'當日 0.1 · 當日 0.1 · 期間合計 0.3'});
  // Real zero stays a distinct, displayed zero; a date without cache stays null, not zero.
  expect(third!['2026-10-01']).toEqual({value:'零',href:'/keywords/%E9%9B%B6/videos',detail:'當日 0 · 當日 0 · 期間合計 0'});
  expect(third!['2026-10-02']).toBeNull();expect(first!['2026-10-03']).toBeNull();
  expect(r.metrics.find(m=>m.date==='2026-10-03')).toMatchObject({channels:null,videos:null,views:null,status:'unavailable'});
  expect(r.metrics.find(m=>m.date==='2026-10-02')).toMatchObject({views:0,status:'available'});
 });

 test('difference mode keeps exact raw arithmetic and formats all three detail numbers',()=>{
  const r=dayRanking(dates,fixture(),'tags_result',true,stop,false);
  expect(r.diff).toBe(true);
  for(const x of r.rows){
   expect(x.value).toBe(x.dailyValue-x.periodTotal!/dates.length);
   expect(x.total).toBe(x.periodTotal);
  }
  for(const date of dates.slice(0,2)){const day=r.rows.filter(x=>x.date===date);expect(day.map(x=>x.rank)).toEqual(day.map((_,i)=>i+1));for(let i=1;i<day.length;i++)expect(day[i-1]!.value).toBeGreaterThanOrEqual(day[i]!.value);}
  for(const row of r.matrix)for(const date of dates){const cell=row[date] as unknown as Cell;if(!cell)continue;const raw=r.rows.find(x=>x.date===date&&x.term===cell.value)!;
   expect(cell.detail).toBe(`差值 ${detailNumber(raw.value)} · 當日 ${detailNumber(raw.dailyValue)} · 期間合計 ${detailNumber(raw.periodTotal!)}`);
   expect(cell.detail).not.toMatch(longDecimal);expect(cell.detail).not.toMatch(/-0(?![.\d])/);}
 });

 test('incomparable lineage keeps unknown total text and disables diff',()=>{
  const r=dayRanking(dates,fixture([{version:'v1',rule:'r',coverage:'c'},{version:'v2',rule:'r',coverage:'c'}]),'tags_result',true,stop,false);
  expect(r.comparable).toBe(false);expect(r.diff).toBe(false);
  expect(r.rows.every(x=>x.periodTotal===null&&x.total===null)).toBe(true);
  const cell=(r.matrix[1] as unknown as Record<string,Cell>)['2026-10-01'];
  expect(cell).toEqual({value:'甲',href:'/keywords/%E7%94%B2/videos',detail:'當日 0.1 · 當日 0.1 · 期間合計 不相容／無法確認'});
 });
});

describe('tag trend series presentation (mock reader, fixed clock)',()=>{
 const sources:Row[]=[
  {pk:1,ctime:'2026-10-08 01:00:00',mtime:'2026-10-08 01:00:00',the_date:'2026-10-08',count_channels:'2',count_videos:'4',total_views:'100'},
  {pk:2,ctime:'2026-10-09 01:00:00',mtime:'2026-10-09 01:00:00',the_date:'2026-10-09',count_channels:'0',count_videos:'0',total_views:'0'},
  {pk:3,ctime:'2026-10-10 01:00:00',mtime:'2026-10-10 01:00:00',the_date:'2026-10-10',count_channels:'1',count_videos:'2',total_views:null},
 ];
 const run=async(type:string)=>{
  // Queue: size probe, source rows, lineage-sidecar existence (absent => legacy rows unchanged).
  const queue:Row[][]=[[{source_rows:3,payload_bytes:0,largest:0}],sources.map(r=>({...r})),[{present:0}]];let calls=0;
  const reader:Reader={rows:async<T extends Row>()=>{calls++;const next=queue.shift();if(!next)throw new Error('unexpected query');return next as T[];},close:async()=>{}};
  const handlers=new Map<string,(p:Record<string,string>,q:Record<string,string>)=>Promise<unknown>>();
  registerTagDays((path,handler)=>{handlers.set(path,handler as never);},reader,()=>new Date('2026-10-13T04:00:00Z'));
  const result=await handlers.get('/tags/:id/trends')!({id:'102'},{days:'3',type}) as {series:{name:string;unit:string;points:{time:string;value:number|null}[]}[];filters:{key:string;value:string}[];notes:string[];evidenceCoverage:{metric:string};rows:Record<string,unknown>[]};
  expect(calls).toBe(3);expect(queue).toHaveLength(0);return result;
 };
 const times=['2026-10-09','2026-10-10','2026-10-11','2026-10-12'];
 const cases:[string,string,string,string,(number|null)[]][]=[
  ['total_views','total_views','七日已知累計觀看加總','次',[100,100,100,100]],
  ['count_videos','count_videos','七日已知影片數','部',[4,6,6,6]],
  ['average','average','七日已知資料每部影片累計觀看','次',[25,null,null,null]],
  ['views_video','average','七日已知資料每部影片累計觀看','次',[25,null,null,null]],
 ];
 test.each(cases)('type=%s uses Chinese series label, raw metric key and unchanged points',async(requested,metric,label,unit,values)=>{
  expect(trendSeriesLabels[metric]).toBe(label);
  const r=await run(requested);
  expect(r.series).toHaveLength(1);
  expect(r.series[0]).toEqual({name:label,unit,points:times.map((time,i)=>({time,value:values[i]}))});
  expect(r.filters.find(f=>f.key==='type')?.value).toBe(metric);
  expect(r.evidenceCoverage.metric).toBe(metric);
  // Cumulative views are not daily increments; missing days are not zero-filled.
  expect(r.notes.some(n=>n.includes('不是每日新增觀看'))).toBe(true);
  expect(r.notes.some(n=>n.includes('缺日和未知欄位不補零'))).toBe(true);
  expect(r.rows.map(x=>x.views)).toEqual([100,100,100,100]);
  expect(r.rows.map(x=>x.average)).toEqual([25,null,null,null]);
 });
});
