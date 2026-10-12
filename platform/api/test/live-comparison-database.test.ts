import {beforeAll,afterAll,it,describe,expect} from 'vitest';
import mysql,{type Connection,type ResultSetHeader} from 'mysql2/promise';
import type {SQL} from 'drizzle-orm';
import {MySqlDialect} from 'drizzle-orm/mysql-core';
import {assertTestDatabaseUrl} from '../../shared/test-database.js';
import {buildApp} from '../src/app.js';
import {createReader,type Reader,type Row} from '../src/db/client.js';
const url=process.env.TEST_DATABASE_URL?assertTestDatabaseUrl(process.env.TEST_DATABASE_URL):undefined,clock=()=>new Date('2038-09-20T00:00:00Z'),term='LiveComparisonFixture',groupName='LiveComparisonFixtureGroup',date='2038-09-19';
describe.skipIf(!url)('live comparison MariaDB source contracts',()=>{
 let db:Connection;const reader=createReader(url),app=buildApp({databaseUrl:url,clock,dataset:'fixture'}),inserted:number[]=[],groupIds:number[]=[];let newest=0;const selection=JSON.stringify([[3],[],[]]);
 const add=async(tag:string,day:string,views:string,or='')=>{const [r]=await db.execute<ResultSetHeader>("INSERT INTO urt_show_live_tag_date(ctime,mtime,the_date,tagid,tag_or,tag_not,tags_views,tags_video)VALUES('2038-09-20 08:00:00','2038-09-20 08:00:00',?,?,?,'',?,?)",[day,tag,or,views,JSON.stringify({[term]:{'01':2}})]);inserted.push(r.insertId);return r.insertId;};
 const payload=(n:number)=>JSON.stringify({[term]:{'01':n}});
 const lineage=async(status:string)=>db.execute("INSERT INTO ts_live_tag_cache_lineage(selection_key,the_date,vocabulary_version,coverage,rule_version,status,generated_at,unknown_view_videos)VALUES(?,?,'fixture','canonical','fixture',?,'2038-09-20 08:00:00',0)ON DUPLICATE KEY UPDATE status=VALUES(status)",[selection,date,status]);
 beforeAll(async()=>{
  db=await mysql.createConnection(url!);await db.execute('DELETE FROM ts_live_tag_cache_lineage WHERE selection_key=? AND the_date=?',[selection,date]);
  await add('3','2038-09-18',payload(5));await add('3',date,payload(999));newest=await add('3',date,payload(10));await add('53',date,payload(80));await add('53',date,payload(9),'1,13');
  for(const tag of [term,term,'']){const [r]=await db.execute<ResultSetHeader>('INSERT INTO tag_group(ctime,latest_time,group_name,tag)VALUES(?,?,?,?)',['2038-09-20 08:00:00','2038-09-20 08:00:00',groupName,tag]);groupIds.push(r.insertId);}
 });
 afterAll(async()=>{await app.close();await reader.close();if(db){if(inserted.length)await db.query('DELETE FROM urt_show_live_tag_date WHERE pk IN (?)',[inserted]);if(groupIds.length)await db.query('DELETE FROM tag_group WHERE pk IN (?)',[groupIds]);await db.execute('DELETE FROM ts_live_tag_cache_lineage WHERE selection_key=? AND the_date=?',[selection,date]);await db.end();}});
 const get=async(path:string,using=app)=>{const r=await using.inject(path);expect(r.statusCode,r.body).toBe(200);return r.json();};
 const keyword='/api/v1/keywords/'+term+'/live/trends',group='/api/v1/groups/'+groupName+'/live';
 const one='from='+date+'&to='+date;
 it('preserves distinct keyword/group defaults and latest-PK daily observations',async()=>{
  const k=await get(keyword);expect(k.data.period).toMatchObject({from:'2038-09-10',to:'2038-09-20'});expect(k.meta.coverage.requestedDates).toBe(11);
  const g=await get(group);expect(g.data.period).toMatchObject({from:'2038-08-21',to:date});expect(g.data.rows.filter((r:any)=>r.group==='泛藍'&&r.date===date)[0]).toMatchObject({value:15,observedDays:2});
 });
 it('honors keyword group precedence, video aliases and group-specific classification filters',async()=>{
  const k=await get(keyword+'?'+one+'&group=media&view=position&type=views');expect(k.data.rows[0]).toMatchObject({group:'旺中',value:80});
  for(const type of ['videos','count_videos','tags_video'])expect((await get(keyword+'?'+one+'&group=media&type='+type)).data.rows[0].value).toBe(2);
  for(const type of ['videos','count_videos'])expect((await get(group+'?'+one+'&type='+type)).data.rows[0].value).toBe(15);
  const g=await get(group+'?'+one+'&view=media_social');expect(g.data.rows[0]).toMatchObject({group:'旺中',value:9});expect(g.data.total).toBe(4);
 });
 it('discloses missing file-driven all definitions instead of inventing new category intersections',async()=>{const r=await get(group+'?'+one+'&all=1');expect(r.meta.coverage).toMatchObject({allExpansion:'unavailable',includeAllRequested:true,fileDefinitions:'unavailable',tagSetSource:'tag_group'});expect(r.data.notes.join(' ')).toContain('未推定額外組合');expect(r.data.rows).toHaveLength(4);});
 it('pending sidecars withhold the whole day rather than falling back to an older PK',async()=>{await lineage('pending');try{const r=await get(keyword+'?'+one);expect(r.data.rows[0]).toMatchObject({value:5,observedDays:1});expect(r.meta.coverage.groups[0].withheldDays).toBe(1);}finally{await db.execute('DELETE FROM ts_live_tag_cache_lineage WHERE selection_key=? AND the_date=?',[selection,date]);}});
 it('invalid hourly data is missing while a valid empty dictionary is observed zero',async()=>{
  for(const [value,observed]of [[JSON.stringify({[term]:null}),1],['{}',2],['not-json',1]]as const){await db.execute('UPDATE urt_show_live_tag_date SET tags_views=? WHERE pk=?',[value,newest]);const r=await get(keyword+'?'+one);expect(r.data.rows[0]).toMatchObject({value:5,observedDays:observed});}
  await db.execute('UPDATE urt_show_live_tag_date SET tags_views=? WHERE pk=?',[payload(10),newest]);
 });
 it('oversized daily blobs are refused before body transfer',async()=>{await db.execute('UPDATE urt_show_live_tag_date SET tags_views=? WHERE pk=?',[' '.repeat(1048577),newest]);try{const r=await get(keyword+'?'+one);expect(r.data.rows[0]).toMatchObject({value:5,observedDays:1});expect(r.meta.coverage.groups[0].oversizedDays).toBe(1);}finally{await db.execute('UPDATE urt_show_live_tag_date SET tags_views=? WHERE pk=?',[payload(10),newest]);}});
 it('rejects a same-size and same-mtime mutation between metadata and body reads',async()=>{
  const dialect=new MySqlDialect();let changed=false;const proxy:Reader={close:async()=>{},rows:async<T extends Row>(query:SQL)=>{const statement=dialect.sqlToQuery(query);if(!changed&&statement.sql.includes(' AS payload FROM')&&statement.params.includes(newest)){changed=true;await db.execute('UPDATE urt_show_live_tag_date SET tags_views=? WHERE pk=?',[payload(99),newest]);}return reader.rows<T>(query);}};
  const temporary=buildApp({reader:proxy,clock});try{const r=await get(keyword+'?'+one,temporary);expect(changed).toBe(true);expect(r.data.rows[0]).toMatchObject({value:5,observedDays:1});expect(r.meta.coverage.groups[0].changedDays).toBe(1);}finally{await temporary.close();await db.execute('UPDATE urt_show_live_tag_date SET tags_views=? WHERE pk=?',[payload(10),newest]);}
 });
 it('rechecks publication after a cache body was read',async()=>{
  await lineage('published');const dialect=new MySqlDialect();let changed=false;const proxy:Reader={close:async()=>{},rows:async<T extends Row>(query:SQL)=>{const statement=dialect.sqlToQuery(query),rows=await reader.rows<T>(query);if(!changed&&statement.sql.includes(' AS payload FROM')&&statement.params.includes(newest)){changed=true;await lineage('pending');}return rows;}};
  const temporary=buildApp({reader:proxy,clock});try{const r=await get(keyword+'?'+one,temporary);expect(changed).toBe(true);expect(r.data.rows[0]).toMatchObject({value:5,observedDays:1});expect(r.meta.coverage.groups[0].withheldDays).toBe(1);}finally{await temporary.close();await db.execute('DELETE FROM ts_live_tag_cache_lineage WHERE selection_key=? AND the_date=?',[selection,date]);}
 });
 it('group names retain database collation while stored terms preserve literal whitespace',async()=>{
  const [insert]=await db.execute<ResultSetHeader>('INSERT INTO tag_group(ctime,latest_time,group_name,tag)VALUES(?,?,?,?)',['2038-09-20 08:00:00','2038-09-20 08:00:00',groupName,' '+term]);groupIds.push(insert.insertId);
  await db.execute('UPDATE urt_show_live_tag_date SET tags_views=? WHERE pk=?',[JSON.stringify({[term]:{'01':10},[' '+term]:{'01':70}}),newest]);
  try{const r=await get('/api/v1/groups/'+groupName.toLowerCase()+'/live?'+one);expect(r.data.rows.find((r:any)=>r.group==='泛藍'&&r.term===' '+term)).toMatchObject({value:70,observedDays:2});expect(r.data.rows.find((r:any)=>r.group==='泛藍'&&r.term===term)).toMatchObject({value:15});}
  finally{await db.execute('DELETE FROM tag_group WHERE pk=?',[insert.insertId]);await db.execute('UPDATE urt_show_live_tag_date SET tags_views=? WHERE pk=?',[payload(10),newest]);}
 });
 it('rejects the raw term bound before any whitespace collisions could conceal truncation',async()=>{
  const name=groupName+'Limit';try{for(let i=0;i<201;i++){const [r]=await db.execute<ResultSetHeader>('INSERT INTO tag_group(ctime,latest_time,group_name,tag)VALUES(?,?,?,?)',['2038-09-20 08:00:00','2038-09-20 08:00:00',name,i===200?' item1':'item'+i]);groupIds.push(r.insertId);}expect((await app.inject('/api/v1/groups/'+name+'/live?'+one)).statusCode).toBe(400);}finally{await db.execute('DELETE FROM tag_group WHERE group_name=?',[name]);}
 });
 it('numeric overflow is unavailable and explicitly counted',async()=>{
  await db.execute('UPDATE urt_show_live_tag_date SET tags_views=? WHERE pk=?',[payload(Number.MAX_SAFE_INTEGER),newest]);try{const r=await get(keyword+'?'+one);expect(r.data.rows[0]).toMatchObject({value:null,observedDays:2});expect(r.meta.coverage.unsafeTotals).toBe(1);}finally{await db.execute('UPDATE urt_show_live_tag_date SET tags_views=? WHERE pk=?',[payload(10),newest]);}
 });
 it('allocates the aggregate body budget by newest date and discloses omitted days',async()=>{
  const large=JSON.stringify({[term]:{'01':1},padding:'x'.repeat(1024*1024-100)});
  const ids:number[]=[];try{for(let day=1;day<=17;day++)ids.push(await add('3','2037-11-'+String(day).padStart(2,'0'),large));
  const r=await get(keyword+'?from=2037-11-01&to=2037-11-17');expect(r.meta.coverage.groups[0]).toMatchObject({selectedDays:17,observedDays:16,budgetExceededDays:1,oversizedDays:0});
  expect(r.data.rows[0]).toMatchObject({date:'2037-11-01',value:null,observedDays:0});expect(r.data.rows[16]).toMatchObject({date:'2037-11-17',value:7,observedDays:7});}finally{if(ids.length)await db.query('DELETE FROM urt_show_live_tag_date WHERE pk IN (?)',[ids]);}
 });

});
