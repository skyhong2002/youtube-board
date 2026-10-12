import {beforeAll,afterAll,describe,it,expect} from 'vitest';
import mysql,{type Connection,type ResultSetHeader} from 'mysql2/promise';
import type {SQL} from 'drizzle-orm';
import {MySqlDialect} from 'drizzle-orm/mysql-core';
import {assertTestDatabaseUrl} from '../../shared/test-database.js';
import {createReader,type Reader,type Row} from '../src/db/client.js';
import type {Query} from '../src/reports/query.js';
import {registerLiveTagRanking,LIVE_TAG_LIMITS} from '../src/reports/live-tag-ranking.js';
const url=process.env.TEST_DATABASE_URL?assertTestDatabaseUrl(process.env.TEST_DATABASE_URL):undefined,clock=()=>new Date('2036-10-20T00:00:00Z'),tag='988731',date='2036-10-10',term='LiveTagRankingFixture',selection=JSON.stringify([[Number(tag)],[],[]]);
describe.skipIf(!url)('live tag ranking MariaDB bounds and publication',()=>{
 let db:Connection,newest:number;const reader=createReader(url),ids:number[]=[],lineageDates=new Set<string>(),dialect=new MySqlDialect();
 const payload=(n:number)=>JSON.stringify({[term]:{'01':n}});
 const add=async(day:string,views:string,sourceTag=tag)=>{const [r]=await db.execute<ResultSetHeader>("INSERT INTO urt_show_live_tag_date(ctime,mtime,the_date,tagid,tag_or,tag_not,tags_views,tags_video,count_videos,count_tags,total_views)VALUES('2036-10-20 08:00:00','2036-10-20 08:00:00',?,?,'','',?,?,4,1,20)",[day,sourceTag,views,payload(2)]);ids.push(r.insertId);return r.insertId;};
 const lineage=async(day:string,status:string)=>{lineageDates.add(day);await db.execute("INSERT INTO ts_live_tag_cache_lineage(selection_key,the_date,vocabulary_version,coverage,rule_version,status,generated_at,unknown_view_videos)VALUES(?,?,'fixture','canonical','fixture',?,'2036-10-20 08:00:00',0)ON DUPLICATE KEY UPDATE status=VALUES(status)",[selection,day,status]);};
 const clearLineage=async(day:string)=>db.execute('DELETE FROM ts_live_tag_cache_lineage WHERE selection_key=? AND the_date=?',[selection,day]);
 const handler=(using:Reader=reader)=>{let route:((p:Record<string,string>,q:Query)=>Promise<any>)|undefined;registerLiveTagRanking((_path,fn)=>{route=fn;},using,clock);return(q:Query={})=>route!({},{tagid:tag,...q});};
 const get=handler(),one={from:date,to:date};
 beforeAll(async()=>{db=await mysql.createConnection({uri:url!,timezone:'+08:00',dateStrings:true});await add('2036-10-09',payload(5));await add(date,payload(999));newest=await add(date,payload(10));await add('2036-10-19',payload(1000),'988732');});
 afterAll(async()=>{await reader.close();if(db){if(ids.length)await db.query('DELETE FROM urt_show_live_tag_date WHERE pk IN (?)',[ids]);for(const day of lineageDates)await clearLineage(day);await db.end();}});
 it('uses latest exact scope even with today=0, inclusive days and latest source revision',async()=>{
  for(const today of [undefined,'0']){const r=await get({today,type:'tags_views'});expect(r.period).toMatchObject({from:'2036-10-03',to:date,anchorSource:'latest-scoped-cache'});expect(r.evidenceCoverage.requestedDates).toBe(8);expect(r.rows[0]).toMatchObject({total:15,[date]:10});expect(r.limit).toBe(100);}
  expect((await get({...one,type:'tags_video'})).rows[0].total).toBe(2);expect((await get({days:'1',today:'1'})).period).toMatchObject({from:'2036-10-08',to:'2036-10-09'});
 });
 it('classifies pending absent-row dates and never falls back to an older published row',async()=>{
  await lineage('2036-10-08','pending');await lineage(date,'pending');try{const r=await get({from:'2036-10-08',to:date,type:'tags_views'});expect(r.evidenceCoverage).toMatchObject({withheldDays:2,observedDays:1,missingDays:0});expect(r.rows[0]).toMatchObject({total:5,[date]:null,'2036-10-08':null});}finally{await clearLineage(date);await clearLineage('2036-10-08');}
 });
 it('distinguishes malformed latest source, observed empty source and positive source',async()=>{
  try{await db.execute('UPDATE urt_show_live_tag_date SET tags_views=? WHERE pk=?',['broken',newest]);let r=await get({days:'1',type:'tags_views'});expect(r.evidenceCoverage.malformedDays).toBe(1);expect(r.rows[0]).toMatchObject({total:5,[date]:null});
   await db.execute('UPDATE urt_show_live_tag_date SET tags_views=? WHERE pk=?',['{}',newest]);r=await get({days:'1',type:'tags_views'});expect(r.evidenceCoverage.observedDays).toBe(2);expect(r.rows[0]).toMatchObject({total:5,[date]:0});
  }finally{await db.execute('UPDATE urt_show_live_tag_date SET tags_views=? WHERE pk=?',[payload(10),newest]);}
 });
 it('refuses oversized source before any body hash or transfer',async()=>{
  await db.execute('UPDATE urt_show_live_tag_date SET tags_views=? WHERE pk=?',['x'.repeat(LIVE_TAG_LIMITS.dayBytes+1),newest]);const queries:string[]=[];const proxy:Reader={close:async()=>{},rows:async<T extends Row>(q:SQL)=>{queries.push(dialect.sqlToQuery(q).sql);return reader.rows<T>(q);}};
  try{const r=await handler(proxy)(one);expect(r.evidenceCoverage.oversizedDays).toBe(1);expect(queries.some(q=>q.includes('SHA2('))).toBe(false);expect(r.rows).toEqual([]);}finally{await db.execute('UPDATE urt_show_live_tag_date SET tags_views=? WHERE pk=?',[payload(10),newest]);}
 });
 it('detects equal-size/equal-mtime changes after checksum selection',async()=>{
  let changed=false;const proxy:Reader={close:async()=>{},rows:async<T extends Row>(q:SQL)=>{const s=dialect.sqlToQuery(q);if(!changed&&s.sql.includes(' AS payload FROM')){changed=true;await db.execute('UPDATE urt_show_live_tag_date SET tags_views=? WHERE pk=?',[payload(99),newest]);}return reader.rows<T>(q);}};
  try{const r=await handler(proxy)(one);expect(changed).toBe(true);expect(r.evidenceCoverage.changedDays).toBe(1);expect(r.rows).toEqual([]);}finally{await db.execute('UPDATE urt_show_live_tag_date SET tags_views=? WHERE pk=?',[payload(10),newest]);}
 });
 it('detects a new latest revision inserted after payload transfer',async()=>{
  let inserted=0;const proxy:Reader={close:async()=>{},rows:async<T extends Row>(q:SQL)=>{const rows=await reader.rows<T>(q);if(!inserted&&dialect.sqlToQuery(q).sql.includes(' AS payload FROM'))inserted=await add(date,payload(77));return rows;}};
  try{const r=await handler(proxy)(one);expect(inserted).toBeGreaterThan(0);expect(r.evidenceCoverage.changedDays).toBe(1);expect(r.rows).toEqual([]);}finally{if(inserted)await db.execute('DELETE FROM urt_show_live_tag_date WHERE pk=?',[inserted]);}
 });
 it('rechecks publication after payload transfer and withholds changed generation identity',async()=>{
  for(const status of ['pending','published']){await lineage(date,'published');let changed=false;const proxy:Reader={close:async()=>{},rows:async<T extends Row>(q:SQL)=>{const rows=await reader.rows<T>(q);if(!changed&&dialect.sqlToQuery(q).sql.includes(' AS payload FROM')){changed=true;if(status==='pending')await lineage(date,'pending');else await db.execute("UPDATE ts_live_tag_cache_lineage SET vocabulary_version='new-fixture-version' WHERE selection_key=? AND the_date=?",[selection,date]);}return rows;}};
   try{const r=await handler(proxy)(one);expect(changed).toBe(true);expect(r.evidenceCoverage[status==='pending'?'withheldDays':'changedDays']).toBe(1);expect(r.rows).toEqual([]);}finally{await clearLineage(date);}
  }
 });
 it('bounds raw term cardinality before attempting ranking and preserves scalar counter nulls',async()=>{
  try{await db.execute('UPDATE urt_show_live_tag_date SET tags_views=? WHERE pk=?',[JSON.stringify(Object.fromEntries(Array.from({length:5001},(_,i)=>['t'+i,{'01':1}]))),newest]);const r=await get(one);expect(r.evidenceCoverage.termBudgetExceededDays).toBe(1);expect(r.sections[0].rows[0]).toMatchObject({countVideos:null,countTags:null,totalViews:null});}finally{await db.execute('UPDATE urt_show_live_tag_date SET tags_views=? WHERE pk=?',[payload(10),newest]);}
 });
 it('allocates the total body budget by newest source date and marks omitted dates unknown',async()=>{
  const large=JSON.stringify({[term]:{'01':1},padding:'x'.repeat(LIVE_TAG_LIMITS.dayBytes-100)}),largeIds:number[]=[];
  try{for(let i=1;i<=17;i++)largeIds.push(await add('2036-09-'+String(i).padStart(2,'0'),large));const r=await get({from:'2036-09-01',to:'2036-09-17',type:'tags_views'});expect(r.evidenceCoverage).toMatchObject({observedDays:16,budgetExceededDays:1,oversizedDays:0});expect(r.rows[0]).toMatchObject({total:16,'2036-09-01':null,'2036-09-17':1});}finally{if(largeIds.length)await db.query('DELETE FROM urt_show_live_tag_date WHERE pk IN (?)',[largeIds]);}
 });
});
