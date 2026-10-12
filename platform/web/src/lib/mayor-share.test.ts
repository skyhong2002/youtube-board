import assert from 'node:assert/strict';
import test from 'node:test';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {MAYOR_EXPECTED_BUCKETS,coverageLabel,coverageSegments,mayorCoverage,mayorShares} from '../components/MayorShare';
import {TimeChart} from '../components/Charts';
import {coverageCount,coverageSeries,coverageTag,incompleteCoverageNote,type BucketCoverage} from './bucket-coverage';

const dates=['2026-10-09','2026-10-10','2026-10-11','2026-10-12'];
const series=(name:string,values:(number|null)[])=>({name,unit:'觀看引用',points:values.map((value,i)=>({time:dates[i]!,value}))});

test('shares fail closed when any candidate is missing; recorded zeros and all-zero dates stay 0',()=>{
 const [a,b]=mayorShares([series('甲',[0,30,null,10]),series('乙',[40,10,20,null])]);
 // Any missing candidate makes that date's denominator unknown: every share is null, never 100%.
 assert.deepEqual(a!.points.map(p=>p.value),[0,75,null,null]);
 assert.deepEqual(b!.points.map(p=>p.value),[100,25,null,null]);
 const none=mayorShares([series('甲',[null]),series('乙',[null])]);assert.deepEqual(none.map(s=>s.points[0]!.value),[null,null]);
 const zeros=mayorShares([series('甲',[0]),series('乙',[0])]);assert.deepEqual(zeros.map(s=>s.points[0]!.value),[0,0]);
 const nonFinite=mayorShares([series('甲',[5]),series('乙',[Number.NaN])]);assert.deepEqual(nonFinite.map(s=>s.points[0]!.value),[null,null]);
 // A shorter series means the other candidate is missing on the later dates.
 const short=mayorShares([series('甲',[1,2]),series('乙',[1])]);assert.deepEqual(short[0]!.points.map(p=>p.value),[50,null]);
});

test('coverage joins rows by date from observedBuckets only, unknown stays unknown',()=>{
 const rows=[{date:'2026-10-09',observedBuckets:28,'甲':0},{date:'2026-10-10',observedBuckets:27},{date:'2026-10-11',observedBuckets:23},{date:'2026-10-12',observedBuckets:19}];
 assert.deepEqual(mayorCoverage(rows,dates).map(c=>[c.observed,c.status]),[[28,'complete'],[27,'partial'],[23,'partial'],[19,'partial']]);
 // Row order does not matter; missing, null, non-integer, negative or >28 counts are unknown, never 0 or 28.
 const odd=mayorCoverage([{date:'2026-10-12',observedBuckets:19},{date:'2026-10-09',observedBuckets:null},{date:'2026-10-10',observedBuckets:'28'},{date:'2026-10-11',observedBuckets:29}],dates);
 assert.deepEqual(odd.map(c=>c.status),['unknown','unknown','unknown','partial']);
 assert.deepEqual(mayorCoverage(undefined,dates).map(c=>c.observed),[null,null,null,null]);
 assert.equal(mayorCoverage([{date:'2026-10-09',observedBuckets:0}],dates)[0]!.status,'partial');
 assert.equal(MAYOR_EXPECTED_BUCKETS,28);
});

test('coverage labels say 分類日桶 and observation incompleteness, not channels or decline',()=>{
 assert.equal(coverageLabel({date:'d',observed:19,status:'partial'}),'來源涵蓋 19/28 個分類日桶，觀測未完整');
 assert.equal(coverageLabel({date:'d',observed:28,status:'complete'}),'來源涵蓋 28/28 個分類日桶');
 assert.match(coverageLabel({date:'d',observed:null,status:'unknown'}),/涵蓋未知/);assert.match(coverageLabel(undefined),/涵蓋未知/);
 // Unknown is never presented as a known partial count.
 assert.doesNotMatch(coverageLabel({date:'d',observed:null,status:'unknown'}),/\d+\/28|未完整/);
 assert.deepEqual([coverageTag({date:'d',observed:28,status:'complete'}),coverageTag({date:'d',observed:19,status:'partial'}),coverageTag({date:'d',observed:null,status:'unknown'})],['','（未完整）','（涵蓋未知）']);
 assert.deepEqual([coverageCount({date:'d',observed:19,status:'partial'}),coverageCount({date:'d',observed:null,status:'unknown'})],['19/28','未知']);
 const note=incompleteCoverageNote(mayorCoverage([{date:'2026-10-11',observedBuckets:23},{date:'2026-10-12',observedBuckets:19}],dates))??'';
 assert.match(note,/^2026-10-09 涵蓋未知、2026-10-10 涵蓋未知、2026-10-11 23\/28、2026-10-12 19\/28 /);assert.match(note,/不代表聲量下降/);
 assert.equal(incompleteCoverageNote(mayorCoverage(dates.map(date=>({date,observedBuckets:28})),dates)),null);
 for(const c of [{date:'d',observed:19,status:'partial' as const},{date:'d',observed:null,status:'unknown' as const}])assert.doesNotMatch(coverageLabel(c),/頻道|目標|下降/);
});

test('chart segments: full-coverage zero stays solid; partial and unknown points are dashed hollow, nulls are gaps',()=>{
 const coverage=mayorCoverage([{date:'2026-10-09',observedBuckets:28},{date:'2026-10-10',observedBuckets:27},{date:'2026-10-11',observedBuckets:23},{date:'2026-10-12',observedBuckets:19}],dates);
 const guo=coverageSegments([0,12,8,null],coverage);
 // Oct 9 is a legitimate observed zero at 28/28: charted on the solid line and as the dashed line's start.
 assert.deepEqual(guo.solid,[0,null,null,null]);
 assert.deepEqual(guo.partial,[{value:0,hollow:false},{value:12,hollow:true},{value:8,hollow:true},null]);
 const allComplete=mayorCoverage(dates.map(date=>({date,observedBuckets:28})),dates);
 const full=coverageSegments([5,0,null,3],allComplete);assert.deepEqual(full.solid,[5,0,null,3]);assert.deepEqual(full.partial,[null,null,null,null]);
 const unknown=coverageSegments([1,2,3,4],mayorCoverage([],dates));assert.deepEqual(unknown.solid,[null,null,null,null]);assert.ok(unknown.partial.every(p=>p?.hollow));
 // A complete point next to a partial one with a null value does not start a dangling dashed segment.
 const gap=coverageSegments([5,null],[{date:'a',observed:28,status:'complete'},{date:'b',observed:20,status:'partial'}]);assert.deepEqual(gap.partial,[null,null]);
});

test('series: complete points get small solid markers (an isolated true zero stays visible), partial ones hollow',()=>{
 const coverage=[{date:'a',observed:20,status:'partial' as const},{date:'b',observed:28,status:'complete' as const},{date:'c',observed:null,status:'unknown' as const}];
 const [solid,partial]=coverageSeries('甲',[null,0,7],coverage,'#123456');
 assert.equal(solid!.name,'甲');assert.equal(partial!.name,'甲');
 assert.deepEqual(solid!.data,[null,0,null]);assert.equal(solid!.showSymbol,true);assert.equal(solid!.showAllSymbol,true);assert.equal(solid!.symbol,'circle');assert.ok(solid!.symbolSize>0);
 assert.deepEqual(partial!.data,[null,{value:0,symbol:'none',symbolSize:7},{value:7,symbol:'emptyCircle',symbolSize:7}]);assert.equal(partial!.lineStyle.type,'dashed');
});

const cov=(statuses:string)=>[...statuses].map((s,i)=>({date:`d${i}`,observed:s==='C'?28:s==='P'?20:null,status:(s==='C'?'complete':s==='P'?'partial':'unknown') as BucketCoverage['status']}));
/** Dashed series as [index, value, hollow] triples, one list per series, for compact assertions. */
const dashed=(values:(number|null)[],statuses:string)=>coverageSeries('甲',values,cov(statuses),'#000').slice(1).map(s=>(s.data as ({value:number;symbol:string}|null)[]).flatMap((p,i)=>p===null?[]:[[i,p.value,p.symbol==='emptyCircle']]));
/** Every pair of indices joined by a dashed segment (consecutive non-null points in one series). */
const dashedEdges=(values:(number|null)[],statuses:string)=>coverageSeries('甲',values,cov(statuses),'#000').slice(1).flatMap(s=>{const d=s.data as unknown[];return d.flatMap((p,i)=>p!==null&&d[i+1]!=null?[`${i}-${i+1}`]:[]);});

test('dashed runs never span a complete→complete interval (P,C,C,P)',()=>{
 assert.deepEqual(dashed([1,2,3,4],'PCCP'),[[[0,1,true],[1,2,false]],[[2,3,false],[3,4,true]]]);
 assert.deepEqual(dashedEdges([1,2,3,4],'PCCP'),['0-1','2-3']);
 // The solid series still carries the complete interval with markers.
 const [solid]=coverageSeries('甲',[1,2,3,4],cov('PCCP'),'#000');assert.deepEqual(solid!.data,[null,2,3,null]);
});
test('dashed runs: P,C,P is two runs sharing a complete neighbour; multiple and unknown runs; null gaps',()=>{
 assert.deepEqual(dashed([1,2,3],'PCP'),[[[0,1,true],[1,2,false]],[[1,2,false],[2,3,true]]]);
 // A run of several incomplete/unknown dates (mixed) is one series padded only at its ends.
 assert.deepEqual(dashed([1,2,3,4,5,6],'CPUCCU'),[[[0,1,false],[1,2,true],[2,3,true],[3,4,false]],[[4,5,false],[5,6,true]]]);
 assert.deepEqual(dashedEdges([1,2,3,4,5,6],'CPUCCU'),['0-1','1-2','2-3','4-5']);
 // A null inside a run breaks the dash; a null complete neighbour is not padded.
 assert.deepEqual(dashed([1,2,null,4,5],'CPPPC'),[[[0,1,false],[1,2,true],[3,4,true],[4,5,false]]]);
 assert.deepEqual(dashedEdges([1,2,null,4,5],'CPPPC'),['0-1','3-4']);
 assert.deepEqual(dashed([null,2,null],'CPC'),[[[1,2,true]]]);
 // A run with no finite value draws nothing; all-complete lines have no dashed series.
 assert.deepEqual(dashed([1,null,3],'CPC'),[]);assert.equal(coverageSeries('甲',[1,2],cov('CC'),'#000').length,1);
 // Every series shares the one legend name.
 assert.ok(coverageSeries('甲',[1,2,3,4],cov('PCCP'),'#000').every(s=>s.name==='甲'));
});
test('an isolated complete zero is a visible solid marker, not dropped or dashed',()=>{
 const series=coverageSeries('甲',[null,0,null],cov('CCC'),'#000');
 assert.equal(series.length,1);assert.deepEqual(series[0]!.data,[null,0,null]);assert.equal(series[0]!.showSymbol,true);
 const mixed=coverageSeries('甲',[null,0,null,7],cov('PCPP'),'#000');assert.deepEqual(mixed[0]!.data,[null,0,null,null]);
 assert.deepEqual(dashed([null,0,null,7],'PCPP'),[[[1,0,false],[3,7,true]]]);assert.deepEqual(dashedEdges([null,0,null,7],'PCPP'),[]);
});

test('raw candidate chart shows a coverage column and note only when coverage is given',()=>{
 const points=dates.map((time,i)=>({time,value:[0,12,null,8][i]!}));
 const coverage=mayorCoverage([{date:'2026-10-09',observedBuckets:28},{date:'2026-10-10',observedBuckets:27},{date:'2026-10-12',observedBuckets:19}],dates);
 const html=renderToStaticMarkup(createElement(TimeChart,{points,label:'甲',unit:'觀看引用',coverage}));
 assert.match(html,/<th class="[^"]*">分類日桶<\/th>/);assert.match(html,/>28\/28</);assert.match(html,/27\/28<small class="ml-1.5">未完整<\/small>/);assert.match(html,/未知<small class="ml-1.5">涵蓋未知<\/small>/);
 assert.match(html,/2026-10-10 27\/28/);assert.match(html,/不代表聲量下降/);
 // Raw values are preserved: the observed zero and the missing value keep their own rendering.
 assert.equal(html.match(/<tr class="group/g)?.length,4);
 const plain=renderToStaticMarkup(createElement(TimeChart,{points,label:'甲',unit:'觀看引用'}));
 assert.doesNotMatch(plain,/分類日桶|不代表聲量下降/);
});
