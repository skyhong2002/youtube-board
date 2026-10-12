import {it,expect} from 'vitest';
import {MySqlDialect} from 'drizzle-orm/mysql-core';
import {buildApp} from '../src/app.js';
import {mayorPersonSummary,mayorPersonNarrative} from '../src/reports/mayor-person.js';
import {mayorObservations,readMayorBuckets,type MayorBuckets} from '../src/reports/mayor.js';
const day='2020-02-20',before='2020-02-19',candidates=['蔣萬安','沈伯洋'];
function source(rows:[string,string,Record<string,number>][]):Pick<MayorBuckets,'byDate'>{const byDate:MayorBuckets['byDate']=new Map();for(const [date,tag,values]of rows){const tags=byDate.get(date)??new Map();tags.set(tag,new Map(Object.entries(values)));byDate.set(date,tags);}return{byDate};}
it('missing observations stay null, while complete recorded zero is an explicit zero',()=>{
 const absent=mayorPersonSummary(day,candidates[0]!,candidates,source([]));expect(absent.daily).toMatchObject({observedCategories:0,total:null,observedTotal:null,complete:false});expect(absent.rolling).toMatchObject({value:null,sharePercent:null,observedBuckets:0});expect(absent.change).toBeNull();
 const zero=mayorPersonSummary(day,candidates[0]!,candidates,source([day,before].flatMap(date=>['3','4','5','6'].map(tag=>[date,tag,{}] as [string,string,Record<string,number>]))));expect(zero.daily).toMatchObject({observedCategories:4,total:0,observedTotal:0});expect(zero.change).toBe(0);expect(zero.rolling.sharePercent).toBe(0);expect(zero.largestObservedCategories).toEqual([]);expect(mayorPersonNarrative(zero,'觀看引用',0).join(' ')).toContain('名單合計為零');
});
it('partial daily sources cannot become a complete total or comparable previous-day delta',()=>{
 const data=source([[day,'3',{'蔣萬安':6,'沈伯洋':2}],[before,'3',{'蔣萬安':2}]]),summary=mayorPersonSummary(day,'蔣萬安',candidates,data);
 expect(summary.daily).toMatchObject({observedTotal:6,total:null,observedCategories:1,complete:false});expect(summary.change).toBeNull();
 expect(summary.rolling).toMatchObject({value:8,cityTotal:10,sharePercent:80,observedBuckets:2,complete:false});
 expect(summary.rolling.sharePercent).toBe(mayorObservations([day],candidates,data)[0]!['蔣萬安：占比']);expect(mayorPersonNarrative(summary,'觀看引用',2).join(' ')).toContain('整體日差暫不計算');
});
it('complete category observations give a neutral signed delta and retain ties',()=>{
 const data=source([day,before].flatMap(date=>['3','4','5','6'].map((tag,i)=>[date,tag,{'蔣萬安':date===day?(i<2?4:1):1}] as [string,string,Record<string,number>]))),summary=mayorPersonSummary(day,'蔣萬安',candidates,data);
 expect(summary.daily.total).toBe(10);expect(summary.previous.total).toBe(4);expect(summary.change).toBe(6);expect(summary.largestObservedCategories).toEqual(['泛藍','泛綠']);
 const prose=mayorPersonNarrative(summary,'影片引用',8).join(' ');expect(prose).toContain('並列');expect(prose).toContain('增加 6');expect(prose).not.toMatch(/防守|澄清|放大|訊息主軸|行程|選戰/);
});
it('a person outside the configured city keeps observations but never enters its share denominator',()=>{
 const data=source([[day,'3',{'蔣萬安':2,'名單外人物':20}]]),summary=mayorPersonSummary(day,'名單外人物',candidates,data);
 expect(summary.rolling).toMatchObject({value:20,cityTotal:2,sharePercent:null,candidateInConfiguration:false});expect(mayorPersonNarrative(summary,'觀看引用',1).join(' ')).toContain('七日人物占比不計算');
});
it('seven-day summary excludes older observations and rejects unsafe totals',()=>{
 const data=source([['2020-02-13','3',{'蔣萬安':999}],[day,'3',{'蔣萬安':3,'沈伯洋':1}]]),summary=mayorPersonSummary(day,'蔣萬安',candidates,data);expect(summary.rolling.value).toBe(3);expect(summary.rolling.sharePercent).toBe(75);
 expect(()=>mayorPersonSummary(day,'蔣萬安',candidates,source([[day,'3',{'蔣萬安':Number.MAX_SAFE_INTEGER}],[day,'4',{'蔣萬安':1}]]))).toThrow('precision');
});
it('shared reader enforces explicit range limits before any source query',async()=>{
 let reads=0;const reader={rows:async()=>{reads++;return[];},close:async()=>{}};
 await expect(readMayorBuckets(reader,'2020-01-01','2022-01-01','tags_views')).rejects.toThrow('372days');await expect(readMayorBuckets(reader,'2020-02-30',day,'tags_views')).rejects.toThrow();expect(reads).toBe(0);
});
it('person API validates filters before reads and renders neutral empty-source coverage',async()=>{
 const statements:string[]=[],dialect=new MySqlDialect(),app=buildApp({clock:()=>new Date('2026-10-12T01:00:00Z'),reader:{rows:async q=>{statements.push(dialect.sqlToQuery(q).sql);return[];},close:async()=>{}}});
 try{
  for(const suffix of ['?type=unknown','?type=views&type=videos','?date=2020-02-30','?limit=201'])expect((await app.inject('/api/v1/mayor/cities/taipei/people/'+encodeURIComponent('蔣萬安')+suffix)).statusCode).toBe(400);expect(statements).toHaveLength(0);
  const r=await app.inject('/api/v1/mayor/cities/taipei/people/'+encodeURIComponent('蔣萬安')+'/days/'+day+'?type=views');expect(r.statusCode,r.body).toBe(200);expect(r.json().data.summary.daily.observedTotal).toBeNull();expect(r.json().meta.coverage).toMatchObject({date:day,dateSource:'explicit',metric:'tags_views',dailyObservedCategories:0,comparableDays:false,rollingObservedBuckets:0});expect(r.json().data.metrics).toHaveLength(5);expect(r.json().data.notes.join(' ')).toContain('不能判定為零');expect(statements.filter(s=>s.includes('FROM urt_show_tag_date a')).every(s=>s.includes('MAX(b.pk)')&&s.includes('LIMIT 1489'))).toBe(true);
 }finally{await app.close();}
});

it('an out-of-list absent exact key remains recorded zero while its city share stays unavailable',()=>{
 const data=source(['3','4','5','6'].map(tag=>[day,tag,{'蔣萬安':2}] as [string,string,Record<string,number>])),summary=mayorPersonSummary(day,'名單外人物',candidates,data);
 expect(summary.daily).toMatchObject({observedTotal:0,total:0,observedCategories:4,complete:true});expect(summary.rolling).toMatchObject({value:0,candidateInConfiguration:false,sharePercent:null,observedBuckets:4});
});
