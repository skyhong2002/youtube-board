import {utcPublicationWindow} from '../src/reports/query.js';
import {keywordVideoCacheKey} from '../src/reports/keyword-video-cache.js';
import {reports} from '../src/reports/service.js';
import {it,expect,vi} from 'vitest';
import {buildApp} from '../src/app.js';
import {MySqlDialect} from 'drizzle-orm/mysql-core';
import {homeExploration} from '../src/reports/home-exploration.js';
import {keywordDisplayMap,rankKeywordWindows} from '../src/reports/home-keyword-ranking.js';
import {vocabulary} from '../src/reports/vocabulary.js';
import {PoolUnavailable,rankingPoolWindows,type RankedPoolClient,type RankedPool} from '../src/reports/tag-ranked-pool.js';
import type {Reader,Row} from '../src/db/client.js';
const now=new Date('2026-10-14T14:15:00Z'),windows=rankingPoolWindows(now);
const pool=(period:'today'|'week',terms:string[]):RankedPool=>({entries:terms.map((tag,i)=>({tag,tagId:'fixture',rank:i+1,score:3,articleCount:4,mediaCount:2,media:{a:2,b:2}})),provenance:{source:'https://tag.observe.tw',snapshotId:period,policyVersion:'fixture',noiseFilterVersion:'fixture',window:windows[period],computedAt:now.toISOString(),asOf:now.toISOString(),expiresAt:new Date(+now+86400000).toISOString(),basisId:'fixture',basisMedia:['a','b'],eligibleTotal:terms.length,checksum:'fixture',gate:'early',qualification:'two-media-with-two-distinct-articles-each'}});
const client=(today:string[],week:string[]):RankedPoolClient=>({load:async w=>pool(w.since===windows.today.since?'today':'week',w.since===windows.today.since?today:week)});
function reader(){const queries:{sql:string;params:unknown[]}[]=[],dialect=new MySqlDialect();const data:Reader={close:async()=>{},rows:async query=>{
 const q=dialect.sqlToQuery(query);queries.push(q);
 if(q.sql.includes('AS source_meta'))return [{id:'fixture-v1',source_meta:{coverage:'all-current-indexed-article-tags',matchingRule:'exact-text-v1'}}] as never;
 if(q.sql.includes('1 AS source_videos'))return [{pk:1,u_id:1,publishedAt:'2026-10-14 20:00:00',video_id:'abcdefghijk',vocabulary_version:'fixture-v1',viewCount:10,fresh:1,unprocessed:0,matched_epoch:+now}] as never;
 if(q.sql.includes('SELECT DISTINCT e.term_key'))return [{term_key:'a',term:'OpenAI'},{term_key:'b',term:'OPENAI'},{term_key:'country',term:'中共'},{term_key:'generic',term:'表示'}] as never;
 if(q.sql.includes('AS heat_score'))return ['today','week'].map(window_key=>({window_key,g:'a',n:1,t:1,m:1,v:10,channel_count:1,heat_score:3,representative_pk:1})) as never;
 if(q.sql.includes('SELECT c.run_id'))return [{run_id:'fixture-v1'}] as never;
 if(q.sql.includes('SELECT r.id,r.snapshot'))return [{id:'fixture-v1',snapshot:{terms:[{key:'a',term:'OpenAI',articleCount:3,media:[]},{key:'g',term:'表示',articleCount:99,media:[]},{key:'y',term:'Yahoo',articleCount:99,media:[]}]}}] as never;
 if(q.sql.includes('FROM urt_count')||q.sql.includes('FROM urt_tag')||q.sql.includes('FROM urt_video v WHERE v.pk')||q.sql.includes('DATE(matched.publishedAt)'))return [];
 throw Error('Unexpected query: '+q.sql.slice(0,100));
 }};return {data,queries};}
it('binds separate exact-label eligibility cohorts before SQL aggregation and top40',async()=>{const r=reader(),out=await homeExploration(r.data,now,undefined,client(['OPENAI','中共'],['OpenAI','中共']));
 expect(out.keywordToday.rows[0]).toMatchObject({term:'OPENAI',sourceTerms:[{key:'b',term:'OPENAI'}],videoCount:1});expect(out.keywords.rows[0]).toMatchObject({term:'OpenAI',sourceTerms:[{key:'a',term:'OpenAI'}]});
 expect(out.keywords.rankingPool).toMatchObject({status:'available',provenance:{window:windows.week},comparisonBasis:'current-eligible-terms'});
 const q=r.queries.find(q=>q.sql.includes('AS heat_score'))!;expect(q.sql).not.toContain(' eligible');expect(q.sql).toContain('matched.window_key=w.window_key');
 const filters=[...q.sql.matchAll(/e\.term_key IN \(([^)]*)\)/g)].map(m=>{const offset=(q.sql.slice(0,m.index).match(/\?/g)??[]).length,size=(m[1].match(/\?/g)??[]).length;return q.params.slice(offset,offset+size);});expect(filters).toEqual([['a'],['b'],['a'],['b']]);expect(q.params).not.toContain('country');expect(q.params).not.toContain('generic');
 expect(new Date(out.keywordToday.to).toISOString()).toBe('2026-10-14T14:09:59.000Z');
 const daily=r.queries.find(q=>q.sql.includes("CONCAT(matched.window_key,':',DATE"));expect(daily?.sql).toContain("GROUP BY CONCAT(matched.window_key,':',DATE(matched.publishedAt))");
});
it('complete empty pools return no ranking SQL and do not fall back to raw terms',async()=>{const r=reader(),out=await homeExploration(r.data,now,undefined,client([],[]));expect(out.keywords).toMatchObject({status:'synchronized',rows:[],rankingPool:{status:'available'}});expect(out.keywordToday.rows).toEqual([]);expect(r.queries.some(q=>q.sql.includes('AS heat_score'))).toBe(false);});
it('unavailable pools fail closed but preserve independent channel categories',async()=>{const r=reader(),out=await homeExploration(r.data,now,undefined,{load:async()=>{throw new PoolUnavailable('contract');}});expect(out.categories.status).toBe('available');for(const s of [out.keywords,out.keywordToday])expect(s).toMatchObject({status:'unavailable',rows:[],rankingPool:{status:'unavailable',reason:'contract'}});expect(r.queries.some(q=>q.sql.includes('1 AS source_videos'))).toBe(false);});
it('applies qualification before the top40 selection so unqualified filler cannot replace it',()=>{const terms:Row[]=Array.from({length:80},(_,i)=>({term_key:String(i),term:'具體議題'+i})),eligible=new Set(terms.slice(40).map(r=>String(r.term))),d=keywordDisplayMap(terms,eligible);const records=[...d.byKey].map(([g])=>({window_key:'week',g,n:1,t:1,m:1,v:1,channel_count:1,heat_score:3}));expect(rankKeywordWindows(records,d,[],{today:false,week:false}).week.map(r=>r.term)).toEqual(expect.arrayContaining([...eligible]));expect(d.exclusions.reasons['upstream-window-not-qualified']).toBe(40);});
it('raw vocabulary retains every row and exposes each window qualification or static source exclusion',async()=>{const r=reader(),out=await vocabulary(r.data,{},client(['OpenAI'],[]),now);expect(out.rows).toHaveLength(3);expect(out.rows.find(r=>r.term==='OpenAI')?.rankingEligibility).toEqual({today:null,week:'upstream-window-not-qualified'});expect(out.rows.find(r=>r.term==='表示')?.rankingEligibility).toEqual({today:'upstream-window-not-qualified',week:'upstream-window-not-qualified'});expect(out.rows.find(r=>r.term==='Yahoo')?.rankingEligibility).toEqual({today:'youtube-source-or-platform',week:'youtube-source-or-platform'});});

it('rolling24h remains nonempty in duration across Taipei midnight, while seven-day midnight stays fixed',()=>{const a=rankingPoolWindows(new Date('2026-10-14T16:01:00Z'));expect(Date.parse(a.today.until)-Date.parse(a.today.since)).toBe(86400000);expect(a.today.since).toBe('2026-10-13T16:00:00.000Z');expect(a.week.since).toBe('2026-10-08T16:00:00.000Z');});
it('exact evidence windows reject missing, rollover, future and inverted timestamps',()=>{expect(utcPublicationWindow(windows.today.since,windows.today.until,now)).toEqual(windows.today);for(const [since,until] of [[undefined,windows.today.until],[windows.today.since,undefined],['2026-02-30T00:00:00.000Z',windows.today.until],[windows.today.until,windows.today.since],[windows.today.since,'2027-01-01T00:00:00.000Z']])expect(()=>utcPublicationWindow(since,until,now)).toThrow();});
it('exact timestamp evidence requests have distinct cache keys, including malformed repeats',()=>{const base={keyword:'AI',...windows.today};expect(keywordVideoCacheKey(base)).not.toBe(keywordVideoCacheKey({...base,since:windows.week.since}));expect(keywordVideoCacheKey(base)).not.toBe(keywordVideoCacheKey({...base,since:[base.since]}));});
it('evidence SQL uses the same half-open publication interval and rejects mixing calendar filters',async()=>{
 const queries:{sql:string;params:unknown[]}[]=[],dialect=new MySqlDialect();
 const data:Reader={close:async()=>{},rows:async q=>{const compiled=dialect.sqlToQuery(q);queries.push(compiled);return (compiled.sql.includes('AS selected')?[{selected:0,nulls:0,cutoff:null}]:[]) as never;}};
 const service=reports(data,()=>now);
 await service.videos({...windows.today});
 const bounded=queries.filter(q=>q.sql.includes('v.publishedAt>=')&&q.sql.includes('v.publishedAt<'));
 expect(bounded.length).toBeGreaterThan(0);for(const q of bounded)expect(q.params).toEqual(expect.arrayContaining(['2026-10-13 22:10:00','2026-10-14 22:10:00']));
 await expect(service.videos({...windows.today,days:'1'})).rejects.toThrow('cannot be mixed');
});
it('ranked evidence retains only qualified exact aliases while raw evidence keeps both',async()=>{
 const queries:{sql:string;params:unknown[]}[]=[],dialect=new MySqlDialect();
 const data:Reader={close:async()=>{},rows:async q=>{const compiled=dialect.sqlToQuery(q);queries.push(compiled);
  if(compiled.sql.includes('SELECT c.run_id,'))return [{run_id:'fixture-v1',matching_rule:'exact-text-v1'}] as never;
  if(compiled.sql.includes('AS alias_snapshot_bytes'))return [{alias_snapshot_bytes:10,separate_terms:true}] as never;
  if(compiled.sql.includes('SELECT term_key,term FROM ts_vocabulary_terms'))return [{term_key:'a'.repeat(64),term:'OpenAI'},{term_key:'b'.repeat(64),term:'OPENAI'}] as never;
  return (compiled.sql.includes('AS selected')?[{selected:0,nulls:0,cutoff:null}]:[]) as never;
 }};
 const service=reports(data,()=>now,undefined,client(['OPENAI'],['OpenAI']));
 await service.videos({keyword:'OPENAI',...windows.today,rankingPool:'early'});
 const qualified=queries.find(q=>q.sql.includes('AS selected'))!;expect(qualified.params).toContain('OPENAI');expect(qualified.params).not.toContain('OpenAI');
 queries.length=0;await service.videos({keyword:'OPENAI',...windows.today});expect(queries.find(q=>q.sql.includes('AS selected'))!.params).toContain('OpenAI');
 expect(keywordVideoCacheKey({keyword:'OPENAI',...windows.today,rankingPool:'early'})).not.toBe(keywordVideoCacheKey({keyword:'OPENAI',...windows.today}));
 await expect(reports(data,()=>now).videos({keyword:'OPENAI',...windows.today,rankingPool:'early'})).rejects.toThrow('unavailable');
});
it('runtime fixture dataset stays offline by default, even without options.dataset',async()=>{
 const previous=process.env.DATASET_KIND;process.env.DATASET_KIND='fixture';const fetchSpy=vi.spyOn(globalThis,'fetch').mockRejectedValue(Error('unexpected network'));
 const app=buildApp({reader:reader().data,clock:()=>now});
 try{const result=await app.inject('/api/v1/vocabulary');expect(result.statusCode).toBe(200);expect(fetchSpy).not.toHaveBeenCalled();}finally{await app.close();fetchSpy.mockRestore();if(previous===undefined)delete process.env.DATASET_KIND;else process.env.DATASET_KIND=previous;}
});
