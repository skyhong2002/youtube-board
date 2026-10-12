import {it,expect} from 'vitest';
import {createHash} from 'node:crypto';
import {MySqlDialect} from 'drizzle-orm/mysql-core';
import type {SQL} from 'drizzle-orm';
import type {Reader,Row} from '../src/db/client.js';
import type {Query} from '../src/reports/query.js';
import {decodeLiveTagDay,liveTagOptions,liveTagPeriod,registerLiveTagRanking,LIVE_TAG_LIMITS} from '../src/reports/live-tag-ranking.js';
const clock=()=>new Date('2036-10-20T00:00:00Z'),dialect=new MySqlDialect();
function source(pk:number,date:string,payload:string,extra:Row={}){return {pk,the_date:date,ctime:'2036-10-20 08:00:00',mtime:'2036-10-20 08:00:00',payload_bytes:Buffer.byteLength(payload),payload,count_videos:4,count_tags:2,total_views:20,...extra};}
function fixture(sources:Row[]=[],settings:{latest?:string;stops?:Row[];lineage?:Row[];secondLineage?:Row[];omitBody?:boolean}={}){
 const queries:ReturnType<MySqlDialect['sqlToQuery']>[]=[];let publicationReads=0;
 const reader:Reader={close:async()=>{},rows:async<T extends Row>(input:SQL)=>{
  const q=dialect.sqlToQuery(input);queries.push(q);let result:Row[]=[];
  if(q.sql.includes('MAX(the_date) AS latest'))result=settings.latest?[{latest:settings.latest}]:[];
  else if(q.sql.includes('SELECT tag FROM tags'))result=settings.stops??[];
  else if(q.sql.includes('information_schema.tables'))result=[{present:settings.lineage?1:0}];
  else if(q.sql.includes('SELECT * FROM `ts_live_tag_cache_lineage`')){publicationReads++;result=(publicationReads>1?settings.secondLineage:settings.lineage)??settings.lineage??[];}
  else if(q.sql.includes(' AS payload_bytes'))result=sources.map(({payload,...row})=>row);
  else if(q.sql.includes(' AS payload_hash'))result=sources.filter(row=>q.params.includes(row.pk)).map(row=>({pk:row.pk,payload_hash:createHash('sha256').update(String(row.payload)).digest('hex')}));
  else if(q.sql.includes(' AS payload FROM'))result=settings.omitBody?[]:sources.filter(row=>q.params.includes(row.pk)).map(row=>({pk:row.pk,payload:row.payload}));
  else if(q.sql.startsWith('SELECT pk FROM urt_show_live_tag_date'))result=sources.filter(row=>q.params.includes(row.pk)).map(row=>({pk:row.pk}));
  else throw new Error('Unexpected SQL '+q.sql);
  return result as T[];
 }};
 let handler:((p:Record<string,string>,q:Query)=>Promise<any>)|undefined;registerLiveTagRanking((path,fn)=>{expect(path).toBe('/live/tags');handler=fn;},reader,clock);
 return {get:(q:Query={})=>handler!({},q),queries};
}
it('uses latest exact scope for omitted/zero/nonzero offsets and inclusive legacy day offsets',()=>{
 for(const today of [undefined,'0'])expect(liveTagPeriod(liveTagOptions({today}),clock,'2036-10-10')).toMatchObject({from:'2036-10-03',to:'2036-10-10',anchorSource:'latest-scoped-cache'});
 expect(liveTagPeriod(liveTagOptions({}),clock,'2036-10-10').dates).toHaveLength(8);
 expect(liveTagPeriod(liveTagOptions({days:'1',today:'2'}),clock,'2036-10-10').dates).toEqual(['2036-10-07','2036-10-08']);
 expect(liveTagPeriod(liveTagOptions({from:'2036-10-01',to:'2036-10-01',today:'3'}),clock,'2036-10-10').dates).toEqual(['2036-10-01']);
 expect(liveTagPeriod(liveTagOptions({}),clock).anchorSource).toBe('taipei-clock');expect(liveTagOptions({}).limit).toBe(100);
});
it('rejects unknown/ambiguous/oversized query inputs before reading any source',async()=>{
 const f=fixture();for(const q of [{type:['tags_video','tags_views']},{today:'366'},{days:'91'},{days:'0'},{from:'2036-02-30'},{from:'2036-10-11',to:'2036-10-10'},{from:'2036-01-01',to:'2036-10-10'},{tagid:'1 2'},{tagid:['1','2']},{type:'constructor'},{date:'2036-10-10'},{q:'silently ignored'},{limit:'201'}])await expect(f.get(q)).rejects.toThrow();expect(f.queries).toHaveLength(0);
});
it('decodes envelopes while preserving same-named literal words, zero, invalid terms and trim collisions',()=>{
 expect(decodeLiveTagDay('{"views":{"01":7},"data":{"01":2}}')).toMatchObject({status:'observed',values:new Map([['views',7],['data',2]])});
 expect(decodeLiveTagDay('{"tags_views":{"甲":{"01":0},"乙":[1,8]}}')).toMatchObject({status:'observed',values:new Map([['甲',0],['乙',8]])});
 for(const json of ['{}','[]','{"tags_views":{}}','{"tags_views":[]}'])expect(decodeLiveTagDay(json)).toMatchObject({status:'observed',values:new Map()});
 for(const json of ['broken','null','3'])expect(decodeLiveTagDay(json).status).toBe('malformed');
 const malformed=decodeLiveTagDay('{"x":{"01":null},"y":{"01":true},"z":{"01":2,"02":-1},"term":{"01":1}," term ":{"01":2}}');expect(malformed).toMatchObject({status:'observed',values:new Map([['x',null],['y',null],['z',null],['term',null]]),malformedTerms:4});
 expect(decodeLiveTagDay(JSON.stringify(Object.fromEntries(Array.from({length:5001},(_,i)=>['t'+i,{'01':1}])))).status).toBe('term-budget-exhausted');
});
it('keeps missing days null, observed empty dictionaries zero and ranks only valid positive observations',async()=>{
 const f=fixture([source(2,'2036-10-10','{}'),source(1,'2036-10-09','{"甲":{"01":10},"乙":{"01":1}}')],{latest:'2036-10-10'}),r=await f.get({from:'2036-10-08',to:'2036-10-10'});
 expect(r.rows[0]).toMatchObject({term:{value:'甲'},total:10,score:230.3,observedDays:2,'2036-10-08':null,'2036-10-09':10,'2036-10-10':0});
 expect(r.evidenceCoverage).toMatchObject({requestedDates:3,selectedDays:2,observedDays:2,missingDays:1});expect(r.sections[0].rows[0].countVideos).toBeNull();
 expect(r.filters.find((v:any)=>v.key==='from').value).toBe('2036-10-08');expect(r.navigation[0].href).toContain('from=2036-10-07');expect(r.limit).toBe(100);
});
it('filters fixed/local stopwords and parameterizes canonical exact category selection',async()=>{
 const f=fixture([source(1,'2036-10-10','{"YouTube":{"01":99},"本機排除":{"01":55},"甲":{"01":2}}')],{latest:'2036-10-10',stops:[{tag:'本機排除'}]}),r=await f.get({tagid:'4,3,4',or:'2,1',not:'9',from:'2036-10-10',to:'2036-10-10',type:'tags_video'});
 expect(r.rows.map((v:any)=>v.term.value)).toEqual(['甲']);expect(r.rows[0]).toMatchObject({score:2,total:2});expect(f.queries[0]!.params).toEqual(['3,4','1,2','9']);
 const metadata=f.queries.find(q=>q.sql.includes(' AS payload_bytes'))!;expect(metadata.sql).toContain('OCTET_LENGTH(`tags_video`)');expect(metadata.sql).not.toContain('tags_views');expect(metadata.sql).toContain('SELECT MAX(pk)');
 const body=f.queries.find(q=>q.sql.includes(' AS payload FROM'))!;expect(body.sql).toContain('SHA2(CAST(`tags_video` AS BINARY),256)');expect(body.sql).toContain('SELECT MAX(newest.pk)');expect(body.sql).toContain('mtime <=>');
 expect(r.navigation[0].href).toContain('tagid=3%2C4');
 expect(r.filters.filter((v:any)=>['tagid','or','not'].includes(v.key))).toEqual([{key:'tagid',label:'同時符合分類',type:'text',value:'3,4'},{key:'or',label:'符合任一分類',type:'text',value:'1,2'},{key:'not',label:'排除分類',type:'text',value:'9'}]);
});
it('exposes empty editable taxonomy controls without inventing a route or default scope',async()=>{
 const f=fixture(),r=await f.get();expect(r.filters.filter((v:any)=>['tagid','or','not'].includes(v.key)).map((v:any)=>[v.key,v.value])).toEqual([['tagid',''],['or',''],['not','']]);expect(f.queries[0]!.params).toEqual(['','','']);
});
it('withholds a pending absent-row date and refuses publication changed after body read',async()=>{
 const row=source(1,'2036-10-10','{"甲":{"01":2}}'),pending={the_date:'2036-10-09',status:'pending',unknown_view_videos:0},lineage={the_date:'2036-10-10',status:'published',unknown_view_videos:0,vocabulary_version:'v1',coverage:'full',rule_version:'r1'};
 const f=fixture([row],{latest:'2036-10-10',lineage:[pending,lineage],secondLineage:[pending,{...lineage,status:'pending'}]}),r=await f.get({from:'2036-10-09',to:'2036-10-10'});
 expect(r.rows).toEqual([]);expect(r.evidenceCoverage).toMatchObject({withheldDays:2,missingDays:0,observedDays:0});expect(r.updatedAt).toBeNull();
});
it('distinguishes changed bytes, malformed JSON and oversized bodies before hashing/transferring',async()=>{
 const oversized=fixture([source(1,'2036-10-10','x',{payload_bytes:LIVE_TAG_LIMITS.dayBytes+1})],{latest:'2036-10-10'}),r=await oversized.get();expect(r.evidenceCoverage.oversizedDays).toBe(1);expect(oversized.queries.some(q=>q.sql.includes('SHA2('))).toBe(false);
 const missing=await fixture([source(1,'2036-10-10','{"甲":{"01":2}}')],{latest:'2036-10-10',omitBody:true}).get();expect(missing.evidenceCoverage.changedDays).toBe(1);
 const malformed=await fixture([source(1,'2036-10-10','broken')],{latest:'2036-10-10'}).get();expect(malformed.evidenceCoverage.malformedDays).toBe(1);
});
it('reports malformed per-term evidence as null instead of zero without erasing another valid term',async()=>{
 const r=await fixture([source(2,'2036-10-10','{"甲":null,"乙":{"01":4}}'),source(1,'2036-10-09','{"甲":{"01":2}}')],{latest:'2036-10-10'}).get({days:'1',type:'tags_views'});
 expect(r.rows.find((v:any)=>v.term.value==='甲')).toMatchObject({total:2,observedDays:1,'2036-10-10':null});expect(r.evidenceCoverage).toMatchObject({malformedTermDays:1,partiallyMalformedDays:1});
});
it('unsafe aggregate sums are unavailable and listed separately rather than rounded',async()=>{
 const payload=JSON.stringify({甲:{'01':Number.MAX_SAFE_INTEGER}}),r=await fixture([source(2,'2036-10-10',payload),source(1,'2036-10-09',payload)],{latest:'2036-10-10'}).get({days:'1',type:'tags_views'});
 expect(r.rows[0]).toMatchObject({score:null,total:null,observedDays:2});expect(r.evidenceCoverage.unsafeTotals).toBe(1);
});
it('exclusion overflow fails closed rather than presenting a partially filtered ranking',async()=>{
 const f=fixture([],{stops:Array.from({length:10001},()=>({tag:'x'}))});await expect(f.get()).rejects.toMatchObject({statusCode:422});expect(f.queries.some(q=>q.sql.includes(' AS payload_bytes'))).toBe(false);
});
it('allocates shared bytes newest first and never hashes the excluded older day',async()=>{
 const payload=JSON.stringify({甲:{'01':1},padding:'x'.repeat(LIVE_TAG_LIMITS.dayBytes-100)}),sources=Array.from({length:17},(_,i)=>source(100001+i,'2036-10-'+String(17-i).padStart(2,'0'),payload)),f=fixture(sources,{latest:'2036-10-17'});
 const r=await f.get({from:'2036-10-01',to:'2036-10-17',type:'tags_video'});expect(r.evidenceCoverage).toMatchObject({observedDays:16,budgetExceededDays:1});expect(r.rows[0]).toMatchObject({'2036-10-01':null,'2036-10-17':1,total:16});
 const hashes=f.queries.find(q=>q.sql.includes(' AS payload_hash'))!;expect(hashes.params).not.toContain(100017);
});
it('counts raw term-days before stopword filtering and withholds the entire over-budget day',async()=>{
 const payload=JSON.stringify(Object.fromEntries(Array.from({length:5000},(_,i)=>['term'+i,{'01':1}]))),sources=Array.from({length:41},(_,i)=>source(200001+i,new Date(Date.parse('2036-10-20')-i*86400000).toISOString().slice(0,10),payload));
 const r=await fixture(sources,{latest:'2036-10-20'}).get({days:'40',type:'tags_video'});expect(r.evidenceCoverage).toMatchObject({observedDays:40,termBudgetExceededDays:1});expect(r.total).toBe(5000);expect(r.rows).toHaveLength(100);expect(r.rows[0].total).toBe(40);
});
it('preserves the largest safe integer when numeric scores do not need decimal rounding',async()=>{
 const r=await fixture([source(1,'2036-10-10',JSON.stringify({甲:{'01':Number.MAX_SAFE_INTEGER}}))],{latest:'2036-10-10'}).get({from:'2036-10-10',to:'2036-10-10',type:'tags_views'});expect(r.rows[0]).toMatchObject({score:Number.MAX_SAFE_INTEGER,total:Number.MAX_SAFE_INTEGER});
});
