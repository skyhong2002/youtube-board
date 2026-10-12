import {createHash} from 'node:crypto';
import {it,expect} from 'vitest';
import {MySqlDialect} from 'drizzle-orm/mysql-core';
import type {Reader,Row} from '../src/db/client.js';
import type {Register} from '../src/reports/table.js';
import type {Query} from '../src/reports/query.js';
import {registerLiveTaxonomyVideos,taxonomyPageSamples} from '../src/reports/live-taxonomy-videos.js';
import {registerLiveContinuous,continuousPeriod,continuousStats} from '../src/reports/live-continuous.js';
const clock=()=>new Date('2026-10-12T10:00:00Z'),dialect=new MySqlDialect();
type Call={sql:string;params:unknown[]};
function stub(resolve:(call:Call)=>Row[]){const calls:Call[]=[],reader:Reader={close:async()=>{},rows:async(query)=>{const call=dialect.sqlToQuery(query);calls.push(call);return resolve(call) as any;}};return {reader,calls};}
function handlers(reader:Reader){const map=new Map<string,Parameters<Register>[1]>(),register:Register=(path,handler)=>map.set(path,handler);registerLiveTaxonomyVideos(register,reader,clock);registerLiveContinuous(register,reader,clock);return map;}
const invoke=async(reader:Reader,path:string,q:Query={},p:Record<string,string>={})=>await handlers(reader).get(path)!(p,q) as any;
const sample=(pk:number,raw:string|null,extra:Row={})=>({pk,videoId:'LiveAa00001',u_id:5,the_date:'2026-10-12',ctime:'2026-10-12 18:00:00',mtime:null,max_current:20,sample_bytes:raw===null?null:Buffer.byteLength(raw),sample_hash:createHash('sha256').update(raw??'').digest('hex'),log_json:raw,...extra});
it('taxonomy default is one Taipei date and explicit date changes both SQL bounds and visible navigation',async()=>{
 const {reader,calls}=stub(({sql})=>sql.includes('COUNT(*) AS total')?[{total:0}]:[]);
 for(const q of [{},{date:'2026-10-09'},{from:'2026-10-10',to:'2026-10-11'}]){
  calls.length=0;const data=await invoke(reader,'/tags/:id/live/videos',{...q,tagid:'3',or:'1,2',not:'48',q:'News'}, {id:'9'});
  const from='from'in q?q.from:'date'in q?q.date:'2026-10-12',to='to'in q?q.to:from;
  expect(data.evidenceCoverage).toMatchObject({from,to,observationUnit:'positive-source-log-row'});
  expect(calls[0]!.params).toEqual(expect.arrayContaining([from,to,'%[3]%','%[9]%','%[1]%','%[2]%','%[48]%','%News%']));
  expect(calls[0]!.sql).toContain('l.max_current>0');expect(calls[0]!.sql).not.toContain('GROUP BY');
  expect(data.navigation[0].href).toContain('/tags/9/live/videos?');expect(data.navigation[0].href).toContain('tagid=3%2C9');expect(data.navigation[0].href).toContain('or=1%2C2');expect(data.navigation[0].href).toContain('not=48');
 }
 const days=await invoke(reader,'/tags/live/videos',{days:'3'});expect(days.evidenceCoverage).toMatchObject({from:'2026-10-10',to:'2026-10-12'});expect(days.filters.find((f:any)=>f.key==='days').value).toBe('3');expect(days.filters.find((f:any)=>f.key==='date').value).toBe('');
});
it('invalid taxonomy dates and filters reject before SQL rather than silently changing periods',async()=>{
 const {reader,calls}=stub(()=>[]);
 for(const q of [{date:'2026-02-30'},{from:'2026-10-12',to:'2026-10-11'},{to:'2026-10-12'},{from:'2026-01-01',to:'2026-10-12'},{days:'91'},{today:'0'},{tagid:'bad'},{date:'2026-10-13'}])await expect(invoke(reader,'/tags/live/videos',q)).rejects.toThrow();
 expect(calls).toHaveLength(0);
});
it('taxonomy keeps duplicate video/date log identities and bounds exact-id display and sample enrichment to the page',async()=>{
 const source=[sample(1,'{"01:00":0,"02:00":40,"25:00":50}',{title:'Retained title',tags:'[3]',tags_bytes:3}),sample(2,null,{the_date:'2026-10-11',max_current:10})];
 const {reader,calls}=stub(({sql})=>sql.includes('COUNT(*) AS total')?[{total:200}]:sql.includes('SHA2(')?source:sql.includes('AS log_json FROM')?[source[0]!]:sql.includes('FROM urt_tag')?[{tag_id:3,tag_name:'測試分類'}]:[]);
 const data=await invoke(reader,'/tags/live/videos',{from:'2026-10-11',to:'2026-10-12',limit:'2'});
 expect(data.total).toBe(200);expect(data.rows.map((r:any)=>r.sourceLogId)).toEqual([1,2]);expect(data.rows.map((r:any)=>r.date)).toEqual(['2026-10-12','2026-10-11']);expect(data.rows[0]).toMatchObject({video:{value:'Retained title'},peak:20,tags:'測試分類',samples:{value:'0 → 40'}});expect(data.evidenceCoverage.invalidSamples).toBe(1);
 const metadata=calls.find(c=>c.sql.includes('SHA2('))!,body=calls.find(c=>c.sql.includes('AS log_json FROM'))!;
 expect(metadata.sql).toContain('BINARY s2.videoId=BINARY l.videoId');expect(metadata.sql).toContain('BINARY v2.videoId=BINARY l.videoId');expect(metadata.sql).toContain('LEFT(');expect(metadata.params.slice(-2)).toEqual([2,0]);expect(body.params.slice(-2)).toEqual([1,1]);expect(body.sql).toContain('SUM(');
});
it('taxonomy sample evidence detects same-size mutations and discloses oversized malformed and empty bodies',async()=>{
 const a=sample(1,'{"01:00":4}'),b=sample(2,'bad'),c=sample(3,null),d=sample(4,'{}',{sample_bytes:131073});
 const {reader,calls}=stub(()=>[{...a,log_json:'{"01:00":8}'},b]);const result=await taxonomyPageSamples(reader,[a,b,c,d]);
 expect(result.coverage).toMatchObject({changedSampleRows:1,malformedSampleRows:1,emptySampleRows:1,skippedSampleRows:1,partialSampleEvidence:true});expect(result.samples.get(1)?.values).toEqual([]);expect(calls[0]!.params.slice(-3)).toEqual([1,2,2]);
 await expect(taxonomyPageSamples(reader,[{...a,sample_bytes:-1}])).rejects.toThrow();
});
it('taxonomy enforces an aggregate sample byte budget even when every individual row fits',async()=>{
 const raw=' '.repeat(131072),metadata=Array.from({length:200},(_,index)=>sample(index+1,raw));const {reader,calls}=stub(()=>[]);
 const result=await taxonomyPageSamples(reader,metadata);expect(result.coverage).toMatchObject({selectedLogRows:200,skippedSampleRows:136,changedSampleRows:64,sampleTotalByteCap:8388608});expect(calls).toHaveLength(1);expect(calls[0]!.params.at(-1)).toBe(64);
});
it('continuous history anchors to latest source date even when today=0 and exposes explicit date precedence',async()=>{
 const {reader,calls}=stub(()=>[{latest:'2026-10-08'}]);
 for(const q of [{},{today:'0'}])expect(await continuousPeriod(reader,q,clock)).toMatchObject({from:'2026-10-02',to:'2026-10-08',anchorSource:'latest-log-date'});
 expect(await continuousPeriod(reader,{today:'2',days:'1'},clock)).toMatchObject({from:'2026-10-06',to:'2026-10-06'});
 calls.length=0;expect(await continuousPeriod(reader,{from:'2026-10-01',to:'2026-10-04',today:'7'},clock)).toMatchObject({from:'2026-10-01',to:'2026-10-04',anchorSource:'explicit-endpoint'});expect(calls).toHaveLength(0);
 expect((await continuousPeriod(reader,{to:'2026-10-12',days:'90'},clock)).dates).toHaveLength(90);
});
it('continuous rejects malformed inputs before reading the anchor and malformed anchors fail closed',async()=>{
 const {reader,calls}=stub(()=>[]);
 for(const q of [{hours:'0'},{tagid:'bad'},{date:'2026-02-30'},{days:'91'},{from:'2026-10-11',to:'2026-10-10'},{date:'2026-10-10',to:'2026-10-09'},{today:'-1'}])await expect(invoke(reader,'/live/continuous',q)).rejects.toThrow();expect(calls).toHaveLength(0);
 const broken=stub(()=>[{latest:'tomorrow'}]);await expect(continuousPeriod(broken.reader,{},clock)).rejects.toThrow('Dashboard query failed.');
});
it('continuous daily means preserve real zero and missing peaks with safe intermediate sums',()=>{
 expect(continuousStats([{the_date:'2026-10-10',peak:0,source_rows:2},{the_date:'2026-10-11',peak:20,source_rows:1},{the_date:'2026-10-12',peak:null,source_rows:1}],'2026-10-12')).toEqual({todayPeak:null,periodAverage:10,periodPeak:20,observedDays:2,sourceLogRows:4});
 expect(continuousStats([],'2026-10-12')).toMatchObject({todayPeak:null,periodAverage:null,periodPeak:null,observedDays:0});
 expect(continuousStats([{peak:Number.MAX_SAFE_INTEGER,source_rows:1},{peak:Number.MAX_SAFE_INTEGER,source_rows:1}],'2026-10-12').periodAverage).toBe(Number.MAX_SAFE_INTEGER);
});
it('continuous enriches selected byte-exact IDs only, exposes all controls and keeps unknown history null',async()=>{
 const active=[{pk:1,videoId:'LiveAa00001',u_id:3,concurrentViewers:50,title:'Retained A'},{pk:2,videoId:'Liveaa00001',u_id:3,concurrentViewers:30,title:'Retained B'}];
 const {reader,calls}=stub(({sql})=>sql.includes('COUNT(*) AS total')?[{total:400}]:sql.includes('FROM urt_video_live l')?active:sql.includes('GROUP BY BINARY videoId')?[{videoId:'LiveAa00001',the_date:'2026-10-12',peak:0,source_rows:2}]:[]);
 const data=await invoke(reader,'/live/continuous',{date:'2026-10-12',days:'1',limit:'2'});
 expect(data.total).toBe(400);expect(data.rows[0]).toMatchObject({todayPeak:0,periodAverage:0,sourceLogRows:2});expect(data.rows[1]).toMatchObject({todayPeak:null,periodAverage:null,sourceLogRows:0});
 const history=calls.find(c=>c.sql.includes('GROUP BY BINARY videoId'))!;expect(history.params).toEqual(['LiveAa00001','Liveaa00001','LiveAa00001','Liveaa00001','2026-10-12','2026-10-12',3]);expect(history.sql).toContain('WHERE videoId IN (?,?) AND BINARY videoId IN (?,?)');expect(history.sql).toContain('MAX(CASE WHEN max_current>=0');
 expect(data.filters.map((f:any)=>f.key)).toEqual(expect.arrayContaining(['date','to','from','days','today','hours','tagid','or','not']));expect(data.filters.find((f:any)=>f.key==='date').value).toBe('2026-10-12');expect(data.filters.find((f:any)=>f.key==='to').value).toBe('');expect(data.evidenceCoverage.historyRowCap).toBe(2);
});
