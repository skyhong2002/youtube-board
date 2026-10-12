import {it,expect} from 'vitest';
import type {SQL} from 'drizzle-orm';
import {MySqlDialect} from 'drizzle-orm/mysql-core';
import {DataQueryFailed,DataSourceUnavailable,type Reader,type Row} from '../src/db/client.js';
import {reports} from '../src/reports/service.js';
import {buildApp} from '../src/app.js';
import {keywordCandidateSource} from '../src/reports/keyword-candidates.js';
const dialect=new MySqlDialect();
function fixture(options:{coverageError?:Error;selectionError?:Error;empty?:boolean;quality?:boolean}={}){
 const queries:Array<ReturnType<typeof dialect.sqlToQuery>>=[];
 const reader:Reader={async rows<T extends Row>(q:SQL){const query=dialect.sqlToQuery(q);queries.push(query);let rows:Row[]=[];
  if(query.sql.includes('SELECT c.run_id'))rows=[{run_id:'published-v1',...(options.quality?{matching_rule:'youtube-quality-v2'}:{})}];
  else if(query.sql.includes('AS alias_snapshot_bytes'))rows=[{alias_snapshot_bytes:500,separate_terms:'true'}];
  else if(query.sql.includes('SELECT term_key,term FROM ts_vocabulary_terms'))rows=[{term_key:'a'.repeat(64),term:'AI'},{term_key:'b'.repeat(64),term:'ai'},{term_key:'c'.repeat(64),term:'rare'}];
  else if(query.sql.includes('AS sourceVideos')){if(options.coverageError)throw options.coverageError;rows=[{sourceVideos:1000000,freshVideos:1,staleVideos:2,unprocessedVideos:999997}];}
  else if(query.sql.includes('MIN(boundary')){if(options.selectionError)throw options.selectionError;rows=[{cutoff:options.empty?null:'2026-10-11 00:00:00',selected:options.empty?0:1,nulls:0}];}
  else if(query.sql.startsWith('SELECT COUNT(*) AS total'))rows=[{total:options.empty?0:1}];
  else if(query.sql.startsWith('SELECT v.pk'))rows=[{pk:1,videoId:'Candidate01',u_id:1,title:'A',channelTitle:'Channel',publishedAt:'2026-10-11 00:00:00',mtime:'2026-10-11 00:00:00'}];
  return rows as T[];
 },async close(){}};
 return {reader,queries};
}
it('materializes distinct exact term evidence before indexed byte-exact video lookup without truncating candidates',()=>{
 const query=dialect.sqlToQuery(keywordCandidateSource('v1','a'.repeat(64),"新聞' OR 1=1 --"));
 expect(query.sql).toContain('SELECT DISTINCT e.video_id FROM ts_video_tag_evidence e WHERE e.vocabulary_version=? AND e.term_key=? AND BINARY e.term=BINARY ?');
 expect(query.sql).toContain('STRAIGHT_JOIN urt_video v ON v.videoId=CONVERT(keyword_candidates.video_id USING utf8mb4) COLLATE utf8mb4_bin AND BINARY v.videoId=BINARY keyword_candidates.video_id');
 expect(query.sql).not.toContain('LIMIT');expect(query.sql).not.toContain("OR 1=1 --");expect(query.params).toEqual(['v1','a'.repeat(64),"新聞' OR 1=1 --"]);
});
it('uses candidate-first source for selection and count without requiring a date filter, preserving freshness, newest ID and exact evidence',async()=>{
 const f=fixture();const result=await reports(f.reader).videos({keyword:'rare'});
 expect(result.rows).toHaveLength(1);expect(result.total).toBe(1);
 const selection=f.queries.filter(q=>q.sql.includes('MIN(boundary')||q.sql.startsWith('SELECT v.pk')||q.sql.startsWith('SELECT COUNT(*) AS total'));
 expect(selection).toHaveLength(3);
 for(const q of selection){
  expect(q.sql).toContain('FROM (SELECT DISTINCT e.video_id');expect(q.sql).toContain('m.source_pk=v.pk');expect(q.sql).toContain('BINARY m.source_text_sha256=BINARY SHA2');
  expect(q.sql).toContain('AND BINARY e.term=BINARY ?');expect(q.sql).toContain('newer.pk>v.pk');expect(q.sql).toContain('BINARY newer.videoId=BINARY v.videoId');expect(q.sql).toContain('rule_version=');
 }
 const boundary=selection.find(q=>q.sql.includes('MIN(boundary'))!;expect(boundary.params.at(-1)).toBe(51);
 const rows=selection.find(q=>q.sql.startsWith('SELECT v.pk'))!;expect(rows.params.slice(-2)).toEqual([51,0]);
});
it('zero-match no-date listing remains an exact empty result without a video row fetch',async()=>{
 const f=fixture({empty:true});const result=await reports(f.reader).videos({keyword:'none'});
 expect(result).toMatchObject({rows:[],total:0,hasNext:false,totalStatus:'exact'});
 expect(f.queries.some(q=>q.sql.startsWith('SELECT v.pk'))).toBe(false);
});
it('keeps non-keyword video source and metric boundary logic unchanged',async()=>{
 const f=fixture();await reports(f.reader).videos({column:'viewCount',limit:'5',offset:'10'});
 expect(f.queries.some(q=>q.sql.includes('keyword_candidates'))).toBe(false);
 const boundary=f.queries.find(q=>q.sql.includes('MIN(boundary'))!;expect(boundary.sql).toContain('SELECT STRAIGHT_JOIN `v`.`viewCount`');expect(boundary.params.at(-1)).toBe(16);
});
it('returns usable results with null/unavailable coverage after deadline and retries coverage instead of caching partial success',async()=>{
 const f=fixture({coverageError:new DataSourceUnavailable()});const service=reports(f.reader);
 for(let i=0;i<2;i++){
  const result=await service.videos({keyword:'rare',from:'2026-10-01'});expect(result.rows).toHaveLength(1);
  expect(result.evidenceCoverage).toMatchObject({status:'synchronized',vocabularyVersion:'published-v1',coverageStatus:'unavailable',sourceVideos:null,freshVideos:null,staleVideos:null,unprocessedVideos:null,keywordMatchedVideos:1});
 }
 expect(f.queries.filter(q=>q.sql.includes('AS sourceVideos'))).toHaveLength(2);
});
it('preserves selection failures and coverage schema defects instead of disguising them as partial availability',async()=>{
 const bad=new DataQueryFailed('ER_BAD_FIELD_ERROR');await expect(reports(fixture({coverageError:bad}).reader).videos({keyword:'rare',from:'2026-10-01'})).rejects.toBe(bad);
 const down=new DataSourceUnavailable();await expect(reports(fixture({selectionError:down}).reader).videos({keyword:'rare'})).rejects.toBe(down);
});
it('reports the unavailable coverage warning in the public envelope without inventing zero or discarding rows',async()=>{
 const f=fixture({coverageError:new DataSourceUnavailable()});const app=buildApp({reader:f.reader});
 try{const r=await app.inject('/api/v1/keywords/rare/videos?from=2026-10-01');expect(r.statusCode).toBe(200);expect(r.headers['cache-control']).toBe('private, no-store');expect(r.json().data.rows).toHaveLength(1);expect(r.json().meta.coverage.coverageStatus).toBe('unavailable');expect(r.json().meta.warnings).toContain('比對涵蓋統計暫時無法取得；影片仍依有效比對證據顯示，未取得的統計不代表零。');}
 finally{await app.close();}
});

it('omits all-history coverage without scanning, preserving exact cached rows and explicit unknown statistics',async()=>{
 const f=fixture({coverageError:new Error('must never scan')});const service=reports(f.reader);
 for(let i=0;i<2;i++){const result=await service.videos({keyword:'rare'});expect(result.total).toBe(1);expect(result.evidenceCoverage).toMatchObject({coverageStatus:'not-calculated',sourceVideos:null,keywordMatchedVideos:1});}
 expect(f.queries.some(q=>q.sql.includes('AS sourceVideos'))).toBe(false);expect(f.queries.filter(q=>q.sql.includes('MIN(boundary'))).toHaveLength(1);
});

it.each([false,true])('rule quality=%s resolves actual case-alias pool keys and retains candidate-first freshness guards',async quality=>{
 const f=fixture({quality});await reports(f.reader).videos({keyword:'Ai'});
 const queries=f.queries.filter(q=>q.sql.includes('MIN(boundary')||q.sql.startsWith('SELECT COUNT(*) AS total'));
 expect(queries).toHaveLength(2);
 for(const q of queries){expect(q.sql).toContain('SELECT DISTINCT e.video_id');expect(q.sql).toContain('STRAIGHT_JOIN urt_video v ON v.videoId=CONVERT');expect(q.params).toContain('a'.repeat(64));expect(q.params).toContain('b'.repeat(64));expect(q.params).toContain('AI');expect(q.params).toContain('ai');expect(q.params).toContain(quality?'youtube-quality-v2':'exact-text-v1');expect(q.params).not.toContain('Ai');}
});
