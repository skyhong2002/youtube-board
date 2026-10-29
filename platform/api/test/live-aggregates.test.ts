import {it,expect} from 'vitest';
import {MySqlDialect} from 'drizzle-orm/mysql-core';
import {aggregatePeriod} from '../src/reports/live-aggregate-period.js';
import {hourCacheCells} from '../src/reports/live-hour-matrix.js';
import {checkedLiveSum,LIVE_DAILY_GROUPS} from '../src/reports/live-stored-aggregates.js';
import {buildApp} from '../src/app.js';
const clock=()=>new Date('2026-10-12T10:00:00Z'),reader={rows:async()=>[{latest:'2026-10-10'}] as any,close:async()=>{}};
it('aggregate defaults preserve latest-log and inclusive days-back windows without altering daily rank defaults',async()=>{
 for(const mode of ['channels','hours','daily'] as const){const p=await aggregatePeriod(reader,{},clock,mode);expect(p).toMatchObject({from:'2026-10-03',to:'2026-10-10'});expect(p.dates).toHaveLength(8);}
 expect(await aggregatePeriod(reader,{date:'2026-10-09',from:'2026-10-01'},clock,'channels')).toMatchObject({from:'2026-10-09',to:'2026-10-09'});
 expect(await aggregatePeriod(reader,{today:'2',days:'1'},clock,'hours')).toMatchObject({from:'2026-10-07',to:'2026-10-08'});
 expect(await aggregatePeriod(reader,{from:'year'},clock,'daily')).toMatchObject({from:'2026-01-01',to:'2026-10-10'});
});
it('aggregate date limits preserve31day lookback and reject malformed or overlarge explicit ranges',async()=>{
 expect((await aggregatePeriod(reader,{days:'31',to:'2026-10-12'},clock,'hours')).dates).toHaveLength(32);
 for(const q of [{from:'2026-01-01',to:'2026-10-12'},{date:'2026-02-30'},{from:'2026-10-12',to:'2026-10-11'},{to:'2026-10-13'}])await expect(aggregatePeriod(reader,q,clock,'hours')).rejects.toThrow();
 expect(()=>checkedLiveSum(Number.MAX_SAFE_INTEGER,1)).toThrow();
});
it('hour cache parser retains genuine zero, count/videos aliases and null missing values without coercing booleans',()=>{
 const cells=hourCacheCells('{"0":{"views":0,"count":0},"01":{"views":12,"videos":3},"02":{"views":true,"count":-1},"25":{"views":99}}')!;
 expect(cells.get('00')).toEqual({views:0,videos:0});expect(cells.get('01')).toEqual({views:12,videos:3});expect(cells.has('02')).toBe(false);expect(cells.has('25')).toBe(false);expect(hourCacheCells('[]')).toBe(null);
});
it('daily comparison taxonomy splits the camp group and adds the talk-show stance group',()=>{expect(Object.keys(LIVE_DAILY_GROUPS)).toEqual(['party','news','main','media','china','talk']);expect(LIVE_DAILY_GROUPS.news.ids).toHaveLength(14);expect(LIVE_DAILY_GROUPS.party).toEqual({name:'陣營政黨',ids:[3,6,4,5]});expect(LIVE_DAILY_GROUPS.talk).toEqual({name:'談話立場',ids:[48,49]});});
it('invalid aggregate filters and units fail before any reader request',async()=>{let calls=0;const app=buildApp({reader:{rows:async()=>{calls++;return[];},close:async()=>{}},clock});try{for(const path of ['/live/hours?type=invalid','/live/trends/daily?group=constructor','/live/trends/daily?type=bad','/live/trends/daily?tagid=3','/live/trends/daily?q=x','/live/trends/daily?or=3','/live/trends/daily?not=3','/live/trends/daily?date=2026-10-12','/live/hours?date=2026-10-12','/live/channels?date=2026-02-30','/live/hours?or=bad'])expect((await app.inject('/api/v1'+path)).statusCode).toBe(400);expect(calls).toBe(0);}finally{await app.close();}});
it('pending hourly date without a cache row cannot fall through to source samples',async()=>{const dialect=new MySqlDialect();let sourceReads=0;const app=buildApp({reader:{rows:async(q)=>{const query=dialect.sqlToQuery(q).sql;if(query.includes('information_schema.tables'))return[{present:1}] as any;if(query.includes('ts_live_tag_cache_lineage'))return[{the_date:'2026-10-12',status:'pending',unknown_view_videos:0}] as any;if(query.includes('urt_video_live_log'))sourceReads++;return[];},close:async()=>{}},clock});try{const r=await app.inject('/api/v1/live/hours?from=2026-10-12&to=2026-10-12');expect(r.statusCode).toBe(200);expect(r.json().meta.coverage.withheldDates).toEqual(['2026-10-12']);expect(r.json().data.rows.every((row:any)=>row['2026-10-12']===null)).toBe(true);expect(sourceReads).toBe(0);}finally{await app.close();}});
it('hourly overlarge, malformed and concurrently changed caches remain missing instead of silently using source logs',async()=>{const dialect=new MySqlDialect();for(const mode of ['large','malformed','changed','empty']){let sourceReads=0;const app=buildApp({reader:{rows:async(q)=>{const query=dialect.sqlToQuery(q).sql;if(query.includes('AS hour_bytes'))return[{pk:1,the_date:'2026-10-12',mtime:'2026-10-12 12:00:00',hour_bytes:mode==='large'?131073:mode==='empty'?2:5}] as any;if(query.includes('information_schema'))return[];if(query.includes('AS body_bytes'))return[{pk:1,mtime:'2026-10-12 12:00:00',body_bytes:mode==='changed'?6:mode==='empty'?2:5,hour_result:mode==='empty'?'{}':'oops!'}] as any;if(query.includes('urt_video_live_log'))sourceReads++;return[];},close:async()=>{}},clock});try{const r=await app.inject('/api/v1/live/hours?from=2026-10-12&to=2026-10-12');expect(r.statusCode).toBe(200);expect(r.json().data.rows.every((row:any)=>row['2026-10-12']===null)).toBe(true);expect(sourceReads).toBe(0);expect(r.json().data.notes.join(' ')).toContain('快取缺值');}finally{await app.close();}}});

it('derived start clamps to the source boundary and year uses the requested end year',async()=>{
 expect(await aggregatePeriod(reader,{to:'2022-11-20'},clock,'channels')).toMatchObject({from:'2022-11-19',startClamped:true});
 expect(await aggregatePeriod(reader,{from:'year',to:'2025-05-01'},clock,'daily')).toMatchObject({from:'2025-01-01',to:'2025-05-01'});
 await expect(aggregatePeriod(reader,{to:'2022-11-20',today:'3'},clock,'hours')).rejects.toThrow();
});
it('partial sample dates are identified individually in hourly provenance',async()=>{const dialect=new MySqlDialect();const app=buildApp({reader:{rows:async(q)=>{const query=dialect.sqlToQuery(q).sql;if(query.includes('AS log_bytes'))return[{pk:1,videoId:'Partial0001',the_date:'2026-10-12',log_bytes:131073}] as any;return[];},close:async()=>{}},clock});try{const r=await app.inject('/api/v1/live/hours?from=2026-10-12&to=2026-10-12');expect(r.statusCode).toBe(200);expect(r.json().meta.coverage.partialSourceDates).toEqual(['2026-10-12']);expect(r.json().data.sections[0].rows[0].source).toBe('部分來源取樣');}finally{await app.close();}});
it('SQL aggregate overflow is refused instead of converted to inaccurate numbers',async()=>{const dialect=new MySqlDialect();const app=buildApp({reader:{rows:async(q)=>{const query=dialect.sqlToQuery(q).sql;return(query.includes('SUM(l.max_current)')?[{the_date:'2026-10-12',tags:'[3]',sum_current:'9007199254740992',count_rows:'2'}]:[]) as any;},close:async()=>{}},clock});try{expect((await app.inject('/api/v1/live/trends/daily?from=2026-10-12&to=2026-10-12')).statusCode).toBe(422);}finally{await app.close();}});

it('source rows without sample bodies disclose no usable hourly samples',async()=>{const dialect=new MySqlDialect();const app=buildApp({reader:{rows:async(q)=>{return(dialect.sqlToQuery(q).sql.includes('AS log_bytes')?[{pk:1,videoId:'Empty000001',the_date:'2026-10-12',log_bytes:0}]:[]) as any;},close:async()=>{}},clock});try{const r=await app.inject('/api/v1/live/hours?from=2026-10-12&to=2026-10-12');expect(r.statusCode).toBe(200);expect(r.json().data.sections[0].rows[0].source).toBe('無可用來源取樣');}finally{await app.close();}});
it('daily trend adds legacy shares and period/metric/group tabs that keep or replace the period',async()=>{const dialect=new MySqlDialect();const app=buildApp({reader:{rows:async(q)=>{const query=dialect.sqlToQuery(q).sql;return(query.includes('SUM(l.max_current)')?[{the_date:'2026-10-11',tags:'[3]',sum_current:'300',count_rows:'3'},{the_date:'2026-10-11',tags:'[4]',sum_current:'100',count_rows:'1'}]:query.includes('FROM urt_tag')?[{tag_id:3,tag_name:'泛藍'},{tag_id:4,tag_name:'泛綠'},{tag_id:6,tag_name:'泛白'},{tag_id:5,tag_name:'泛紅'}]:[]) as any;},close:async()=>{}},clock});
 try{const r=await app.inject('/api/v1/live/trends/daily?from=2026-10-10&to=2026-10-11');expect(r.statusCode).toBe(200);const d=r.json().data;
  expect(d.title).toContain('陣營政黨');expect(d.series.map((s:any)=>s.name)).toEqual(['泛藍','泛白','泛綠','泛紅']);
  expect(d.rows[0]).toMatchObject({total:300,observations:3,viewShare:75,observationShare:75});expect(d.rows[2]).toMatchObject({viewShare:25,observationShare:25});expect(d.rows[1]).toMatchObject({total:null,viewShare:null});
  expect(d.filters.map((f:any)=>f.key)).not.toContain('group');
  const [period,metric,switches]=d.tabRows;expect(metric.items.map((i:any)=>[i.label,i.active])).toEqual([['正值觀測列數',false],['來源列峰值加總',true]]);expect(period.items.map((i:any)=>i.label)).toEqual(['一週','十天','一個月','一季']);expect(period.items.some((i:any)=>i.active)).toBe(false);
  expect(period.items[2].href).toBe('/live/trends/daily?group=party&type=total_views&days=30');
  const talk=switches.items.find((i:any)=>i.label==='談話立場');expect(talk.href).toBe('/live/trends/daily?from=2026-10-10&to=2026-10-11&group=talk&type=total_views');
  const week=(await app.inject('/api/v1/live/trends/daily')).json().data;expect(week.tabRows[0].items[0].active).toBe(true);
 }finally{await app.close();}});
