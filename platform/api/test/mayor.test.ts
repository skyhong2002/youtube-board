import {it,expect} from 'vitest';
import {MySqlDialect} from 'drizzle-orm/mysql-core';
import {buildApp} from '../src/app.js';
import {foldCandidateAliases,mayorMetric,mayorPeriod,mayorWeights} from '../src/reports/mayor.js';
import {cities} from '../src/reports/city-definitions.js';
const clock=()=>new Date('2026-10-12T17:00:00Z'),dialect=new MySqlDialect();
const metadata={pk:1,tagid:'3',the_date:'2026-10-01',ctime:'2026-10-01 12:00:00',mtime:'2026-10-01 12:00:00',payload_bytes:40,payload_hash:'fixture'};
async function request(path:string,respond:(sql:string,params:unknown[])=>any[]){const app=buildApp({clock,reader:{rows:async q=>{const compiled=dialect.sqlToQuery(q);return respond(compiled.sql,compiled.params);},close:async()=>{}}});try{return await app.inject('/api/v1'+path);}finally{await app.close();}}
it('mayor dates default to Taipei yesterday, preserve explicit today/from/to and latest fallback',()=>{
 expect(mayorPeriod({},clock)).toMatchObject({from:'2026-09-13',to:'2026-10-12',explicit:false});
 expect(mayorPeriod({today:'0',days:'1'},clock)).toMatchObject({from:'2026-10-13',to:'2026-10-13',explicit:true});
 expect(mayorPeriod({from:'2026-10-01'},clock).to).toBe('2026-10-13');
 expect(mayorPeriod({days:'1'},clock,'2026-10-01').to).toBe('2026-10-01');
 expect(()=>mayorPeriod({from:'2026-10-02',to:'2026-10-01'},clock)).toThrow();expect(()=>mayorPeriod({days:'367'},clock)).toThrow();
});
it('mayor accepts maintained metric aliases and rejects unknown keys before reads',async()=>{
 expect(['tags_view','views','videos','result'].map(mayorMetric)).toEqual(['tags_views','tags_views','tags_video','tags_result']);
 let calls=0;const r=await request('/mayor?type=constructor',()=>{calls++;return[];});expect(r.statusCode).toBe(400);expect(calls).toBe(0);
});
it('implicit fallback changes date then metric, and exposes final scope/coverage',async()=>{
 let latestReads=0;const r=await request('/mayor?days=1',(sql,params)=>{
 if(sql.includes('AS latest_date')){latestReads++;return[{latest_date:'2026-10-01'}];}
 if(sql.includes('AS payload_bytes'))return params.includes('2026-10-01')?[metadata]:[];
 if(sql.includes('AS payload'))return[{...metadata,payload:sql.includes('`tags_video`')?'{"蔣萬安":3,"沈伯洋":1}':'{}'}];return[];
 });expect(r.statusCode,r.body).toBe(200);const result=r.json();expect(latestReads).toBe(1);expect(result.meta.coverage).toMatchObject({fallbackDate:'2026-10-01',metric:'tags_video',from:'2026-10-01',observedBuckets:1,expectedBuckets:28});expect(result.data.rows[0]).toMatchObject({'蔣萬安':3,'蔣萬安：占比':75,observedBuckets:1});expect(result.data.series[0].unit).toBe('影片引用');
});
it('explicit dates never use latest fallback and explicit views never silently switch metric',async()=>{
 const queried:string[]=[];const r=await request('/mayor?from=2026-10-01&to=2026-10-01&type=views',sql=>{queried.push(sql);return[];});expect(r.statusCode).toBe(200);expect(queried.some(s=>s.includes('AS latest_date')||s.includes('`tags_video`'))).toBe(false);expect(r.json().data.rows[0]['蔣萬安']).toBeNull();
});
it('pending lineage without a cache row is withheld and cannot become a source zero',async()=>{
 const r=await request('/mayor?from=2026-10-01&to=2026-10-01&type=views',sql=>sql.includes('information_schema')?[{present:1}]:sql.includes('ts_tag_cache_lineage')?[{the_date:'2026-10-01',status:'pending',unknown_view_videos:0}]:[]);expect(r.statusCode).toBe(200);expect(r.json().meta.coverage.withheldBuckets).toBe(4);expect(r.json().data.rows[0]['蔣萬安']).toBeNull();
});
it('oversized and concurrently changed payloads are not transferred or treated as zero',async()=>{
 for(const mode of ['oversized','changed']){let bodyReads=0;const r=await request('/mayor?from=2026-10-01&to=2026-10-01&type=views',sql=>{if(sql.includes('AS payload_bytes'))return[{...metadata,payload_bytes:mode==='oversized'?131073:40}];if(sql.includes('AS payload'))bodyReads++;return[];});expect(r.statusCode).toBe(200);expect(r.json().data.rows[0]['蔣萬安']).toBeNull();expect(r.json().meta.coverage[mode==='oversized'?'oversizedBuckets':'changedBuckets']).toBe(1);if(mode==='oversized')expect(bodyReads).toBe(0);}
});
it('genuine empty maps preserve measured zero while malformed caches stay missing',async()=>{
 for(const [payload,expected] of [['{}',0],['broken',null]] as const){const r=await request('/mayor?from=2026-10-01&to=2026-10-01&type=views',sql=>sql.includes('AS payload_bytes')?[metadata]:sql.includes('AS payload')?[{...metadata,payload}]:[]);expect(r.statusCode).toBe(200);expect(r.json().data.rows[0]['蔣萬安']).toBe(expected);}
});
it('total payload budget is checked before any body transfer',async()=>{
 let bodies=0;const r=await request('/mayor?days=30&type=views',sql=>{if(sql.includes('AS payload_bytes'))return Array.from({length:65},(_,i)=>({...metadata,pk:i+1,tagid:String(3+i%4),the_date:'2026-09-'+String(13+Math.floor(i/4)).padStart(2,'0'),payload_bytes:131072}));if(sql.includes('AS payload'))bodies++;return[];});expect(r.statusCode).toBe(422);expect(bodies).toBe(0);
});

it('empty from/to retain yesterday/latest behavior while present empty today means today',()=>{
 expect(mayorPeriod({from:'',to:''},clock)).toMatchObject({to:'2026-10-12',explicit:false});
 expect(mayorPeriod({from:'',to:''},clock,'2026-10-01')).toMatchObject({to:'2026-10-01',explicit:false});
 expect(mayorPeriod({today:''},clock)).toMatchObject({to:'2026-10-13',explicit:true});
});
it('mayor flat maps preserve exact keys, negative clamp, and distinguish missing payloads',()=>{
 for(const raw of ['null','  ','{"result":{"蔣萬安":3}}','[{"tag":"蔣萬安","count":3}]'])expect(mayorWeights(raw)).toBeNull();
 expect(mayorWeights('{}')?.size).toBe(0);expect(mayorWeights('{" 蔣萬安":3,"沈伯洋":-2,"郭璽":"1e2"}')).toEqual(new Map([[' 蔣萬安',3],['郭璽',100]]));
});
it('lineage republished during body read cannot attribute old bytes to new provenance',async()=>{
 let checks=0;const r=await request('/mayor?from=2026-10-01&to=2026-10-01&type=views',sql=>{
 if(sql.includes('AS payload_bytes'))return[metadata];if(sql.includes('AS payload'))return[{...metadata,payload:'{"蔣萬安":3}'}];if(sql.includes('information_schema'))return[{present:1}];
 if(sql.includes('ts_tag_cache_lineage'))return[{the_date:'2026-10-01',status:'published',unknown_view_videos:0,vocabulary_version:++checks>4?'new':'old',rule_version:'rule',coverage:'full',generated_at:'2026-10-01 12:00:00'}];return[];
 });expect(r.statusCode).toBe(200);expect(r.json().meta.coverage.changedBuckets).toBe(1);expect(r.json().data.rows[0]['蔣萬安']).toBeNull();
});
it('explicit dates still allow omitted-type fallback and expose positive-data status',async()=>{
 const r=await request('/mayor?from=2026-10-01&to=2026-10-01',sql=>sql.includes('AS payload_bytes')?[metadata]:sql.includes('AS payload')?[{...metadata,payload:sql.includes('`tags_video`')?'{"蔣萬安":2}':'{}'}]:[]);
 expect(r.statusCode).toBe(200);expect(r.json().meta.coverage).toMatchObject({fallbackDate:null,metric:'tags_video',dataAvailable:true});
});
it('mayor counts press spellings under the registered name and keeps the CEC roster',()=>{
 expect(Object.fromEntries(foldCandidateAliases(new Map([['溫世政',5],['温世政',2],['許淑華',9]])))).toEqual({温世政:7,許淑華:9});
 expect(Object.fromEntries(foldCandidateAliases(new Map([['溫世政',3]])))).toEqual({温世政:3});
 expect(Object.values(cities).reduce((n,c)=>n+Object.keys(c.candidates).length,0)).toBe(81);
 expect(Object.keys(cities.nantou!.candidates)).toEqual(['許淑華','温世政']);
});
it('mayor bucket coverage spans every charted date while table rows stay paginated',async()=>{
 const r=await request('/mayor/cities/taipei?from=2026-07-19&to=2026-10-16',()=>[]);expect(r.statusCode).toBe(200);
 const data=r.json().data;expect(data.series[0].points).toHaveLength(90);expect(data.rows).toHaveLength(50);
 expect(data.bucketCoverage).toHaveLength(90);expect(data.bucketCoverage.at(-1)).toEqual({date:'2026-10-16',observedBuckets:0});
});
