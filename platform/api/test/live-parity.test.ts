import {it,expect} from 'vitest';
import {sql} from 'drizzle-orm';
import {MySqlDialect} from 'drizzle-orm/mysql-core';
import {livePeriod,livePeriodControls} from '../src/reports/live-period.js';
import {liveSamples,loadLiveLogs,LIVE_READ_LIMITS,visibleLiveTags} from '../src/reports/live-observations.js';
import {buildApp} from '../src/app.js';
const clock=()=>new Date('2026-10-11T17:00:00Z');
it('live day and period defaults use Taipei today with exact explicit dates and bounded ranges',()=>{expect(livePeriod({},clock)).toMatchObject({from:'2026-10-12',to:'2026-10-12'});expect(livePeriod({date:'2026-10-10'},clock)).toMatchObject({from:'2026-10-10',to:'2026-10-10'});expect(livePeriod({from:'2026-10-10'},clock,'2026-10-09')).toMatchObject({from:'2026-10-10',to:'2026-10-12'});expect(livePeriod({days:'3'},clock).dates).toHaveLength(3);expect(livePeriod({date:'',from:'',to:'',days:''},clock).to).toBe('2026-10-12');for(const q of [{date:'2026-02-30'},{from:'2026-10-12',to:'2026-10-11'},{date:'2022-11-18'},{date:'2026-10-13'},{days:'91'},{date:['2026-10-10','2026-10-11']}])expect(()=>livePeriod(q,clock)).toThrow();});
it('live navigation preserves filters but drops offset and range when moving to an adjacent day',()=>{const q={tagid:'1',or:'48,49',not:'2',q:'a&b',limit:'20',offset:'20',from:'2026-10-10',to:'2026-10-11'},controls=livePeriodControls(q,livePeriod(q,clock));const previous=new URL(controls.navigation![0]!.href,'https://example.test');expect(previous.searchParams.get('date')).toBe('2026-10-09');expect(previous.searchParams.get('q')).toBe('a&b');expect(previous.searchParams.has('from')).toBe(false);expect(previous.searchParams.has('offset')).toBe(false);expect(controls.filters?.map(f=>f.key)).toEqual(['date','from','to','q','tagid','or','not']);});
it('live sample parsing rejects malformed time/counts and combines minute-second duplicate keys by measured maximum',()=>{const p=liveSamples(JSON.stringify({'01:00':5,'01:00:00':3,'02:00':0,'25:00':9,'01:00junk':9,'03:00':-1,'04:00':true}));expect([...p.samples]).toEqual([['01:00:00',5],['02:00:00',0]]);expect(p.invalid).toBe(4);expect(liveSamples('[]').malformed).toBe(true);expect(visibleLiveTags('[1][13][48][102][1]',new Map([[1,'個人'],[13,'新聞'],[48,'台灣']])).map(t=>t.id)).toEqual([1,48]);});
it('metadata-first live loading rejects excessive rows and never requests over-budget log bodies',async()=>{const dialect=new MySqlDialect(),calls:string[]=[];const metadata=Array.from({length:66},(_,i)=>({pk:i+1,videoId:'X',log_bytes:LIVE_READ_LIMITS.rowBytes}));const reader={rows:async(query:any)=>{const q=dialect.sqlToQuery(query);calls.push(q.sql);return (calls.length===1?metadata:metadata.slice(0,64).map(r=>({...r,log_json:'{"01:00":4}'}))) as any;},close:async()=>{}};const result=await loadLiveLogs(reader,sql`1=1`);expect(calls).toHaveLength(2);expect(calls[0]).toContain('OCTET_LENGTH(l.log_json)');expect(calls[1]).toContain('SUM(COALESCE(OCTET_LENGTH(log_json)');expect(result.coverage).toMatchObject({sourceRows:66,skippedLogRows:2,partialLogEvidence:true});expect(result.rows[65]!.samples.size).toBe(0);expect(result.rows[65]!.partial).toBe(true);await expect(loadLiveLogs({rows:async()=>Array.from({length:20001},()=>({})) as any,close:async()=>{}},sql`1=1`)).rejects.toMatchObject({statusCode:422});});
it('live malformed query values fail before any reader calls',async()=>{let calls=0;const app=buildApp({reader:{rows:async()=>{calls++;return[];},close:async()=>{}},clock});try{for(const path of ['/live/periods?date=2026-02-30','/live/days/abc','/live/days/2026-02-30','/live/periods?to=2026-10-10','/live/days/2026-10-10?to=2026-10-11','/live/days?from=2026-10-12&to=2026-10-11','/live/days/2026-10-10?date=a&date=b','/live/current?hours=0','/live/current?hours=1&hours=2','/live/current?or=abc'])expect((await app.inject('/api/v1'+path)).statusCode).toBe(400);expect(calls).toBe(0);}finally{await app.close();}});

it('live range accepts exactly90days and navigation never crosses the earliest or current date',()=>{
 expect(livePeriod({from:'2026-07-15',to:'2026-10-12'},clock).dates).toHaveLength(90);
 expect(()=>livePeriod({from:'2026-07-14',to:'2026-10-12'},clock)).toThrow();
 expect(livePeriodControls({},livePeriod({date:'2022-11-19'},clock)).navigation!.map(n=>n.label)).toEqual(['今日','下一日']);
 expect(livePeriodControls({},livePeriod({},clock)).navigation!.map(n=>n.label)).toEqual(['上一日','今日']);
});
it('period source window and controls share one clock sample across Taipei midnight',async()=>{
 const {registerLiveHistory}=await import('../src/reports/live-history.js');let ticks=0;const handlers=new Map<string,any>(),queries:{sql:string;params:unknown[]}[]=[],dialect=new MySqlDialect();
 registerLiveHistory((path,handler)=>handlers.set(path,handler),{rows:async(q)=>{queries.push(dialect.sqlToQuery(q));return[];},close:async()=>{}},()=>new Date(ticks++===0?'2026-10-11T15:59:59Z':'2026-10-11T16:00:01Z'));
 const result=await handlers.get('/live/periods')({},{});expect(ticks).toBe(1);expect(result.evidenceCoverage).toMatchObject({from:'2026-10-11',to:'2026-10-11'});expect(result.description).toBe('觀測日期 2026-10-11');expect(queries[0]!.params).toContain('2026-10-11');
});
it('group-hour pending lineage withholds the entire date and changed bodies are missing with an explanation',async()=>{
 const {registerLiveExtra}=await import('../src/reports/live-extra.js');const dialect=new MySqlDialect();
 for(const mode of ['pending','changed','missing-body'] as const){
  const handlers=new Map<string,any>();let bodies=0;
  registerLiveExtra((path,handler)=>handlers.set(path,handler),{rows:async(q)=>{const query=dialect.sqlToQuery(q).sql;
   if(query.includes('information_schema.tables'))return [{present:1}] as any;
   if(query.includes('SELECT * FROM'))return [{the_date:'2026-10-11',status:mode==='pending'?'pending':'published',unknown_view_videos:0}] as any;
   if(query.includes('AS hour_bytes'))return [{pk:1,the_date:'2026-10-11',mtime:'2026-10-11 12:00:00',hour_bytes:10}] as any;
   if(query.includes('AS body_bytes')){bodies++;return (mode==='missing-body'?[]:[{body_bytes:20,hour_result:'{"00":{"views":99,"count":2}}'}]) as any;}
   throw new Error('Unexpected query');
  },close:async()=>{}},clock);
  const result=await handlers.get('/live/groups/:group/hours')({group:'media'},{date:'2026-10-11'});
  expect(Object.values(result.rows[0]).slice(1).every(v=>v===null)).toBe(true);
  expect(result.notes.join(' ')).toContain(mode==='pending'?'已隱藏該日期所有版本':'讀取時變更');if(mode==='pending')expect(bodies).toBe(0);else expect(bodies).toBeGreaterThan(0);
 }
});

it('cleared group-hour date and metric select the latest scoped cache day with views default',async()=>{
 const {registerLiveExtra}=await import('../src/reports/live-extra.js');const handlers=new Map<string,any>(),dialect=new MySqlDialect();let latestReads=0;
 registerLiveExtra((path,handler)=>handlers.set(path,handler),{rows:async(q)=>{const compiled=dialect.sqlToQuery(q);if(compiled.sql.includes('MAX(the_date)')){latestReads++;return [{latest:'2026-10-09'}] as any;}if(compiled.sql.includes('AS hour_bytes')){expect(compiled.params).toContain('2026-10-09');return [];}throw new Error('Unexpected query');},close:async()=>{}},clock);
 const result=await handlers.get('/live/groups/:group/hours')({group:'media'},{date:'',type:''});expect(latestReads).toBeGreaterThan(0);expect(result.title).toContain('2026-10-09');expect(result.filters.find((f:any)=>f.key==='type').value).toBe('views');expect(result.rows.every((r:any)=>Object.values(r).slice(1).every(v=>v===null))).toBe(true);expect(result.notes.join(' ')).not.toMatch(/讀取時變更|已隱藏該日期所有版本/);
});
