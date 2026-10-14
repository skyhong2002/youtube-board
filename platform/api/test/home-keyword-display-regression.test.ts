import {expect,it} from 'vitest';
import {MySqlDialect} from 'drizzle-orm/mysql-core';
import type {Reader} from '../src/db/client.js';
import {homeExploration} from '../src/reports/home-exploration.js';
import {tagDisplayExclusion} from '../../shared/youtube-match-policy.js';

// Terms from the user's production screenshot, not a synthetic estimate of
// noise prevalence. The old snapshot rule must remain usable without reimport.
const noise=['新聞','看','訂閱','YouTube','Facebook','FB','Instagram','instagram','IG','LINE','台灣','台北','平台','直播','LIVE','會員','下載','連結','分享','影片','全新','主播','節目','資訊','家','Yahoo','合作媒體','美國','民進黨'];
const retained=['沈伯洋','川普','台積電','24小時'];
it('applies screenshot exclusions before ranking both legacy-rule windows without deleting raw evidence',async()=>{
 const dialect=new MySqlDialect(),terms=[...noise,...retained].map((term,i)=>({term_key:i.toString(16).padStart(64,'0'),term})),before=JSON.stringify(terms),queries:{sql:string;params:unknown[]}[]=[];
 const excluded=terms.filter(t=>noise.includes(t.term)).map(t=>t.term_key);
 const reader:Reader={close:async()=>{},rows:async query=>{
  const q=dialect.sqlToQuery(query);queries.push(q);
  if(q.sql.includes('AS source_meta'))return [{id:'legacy',source_meta:{matchingRule:'exact-text-v1'}}] as never;
  if(q.sql.includes('FROM urt_count')||q.sql.includes('FROM urt_tag'))return [];
  if(q.sql.includes('1 AS source_videos'))return [{pk:1,u_id:1,publishedAt:'2026-10-14 01:00:00',video_id:'abcdefghijk',vocabulary_version:'legacy',viewCount:null,unprocessed:0,fresh:1,matched_epoch:Date.parse('2026-10-14T00:00:00Z')}] as never;
  if(q.sql.includes('SELECT DISTINCT e.term_key'))return terms as never;
  if(q.sql.includes('SUM(6*(1-POW')){
   // Every excluded key must already be bound inside WHERE, before GROUP BY
   // and LIMIT. A browser-only filter would leave the raw top40 misleading.
   expect(q.sql.indexOf('e.term_key NOT IN')).toBeGreaterThan(0);
   expect(q.sql.indexOf('e.term_key NOT IN')).toBeLessThan(q.sql.indexOf('GROUP BY fv.pk'));
   for(const key of excluded)expect(q.params).toContain(key);
   return ['week','today'].flatMap(window_key=>terms.filter(t=>retained.includes(t.term)).map(t=>({window_key,g:t.term_key,n:1,t:1,m:0,v:0,channel_count:1,heat_score:3,representative_pk:1}))) as never;
  }
  if(q.sql.includes('SELECT DATE(matched.publishedAt)'))return [];
  if(q.sql.includes('SELECT v.pk,v.videoId'))return [];
  if(q.sql.includes('SELECT c.run_id'))return [{run_id:'legacy'}] as never;
  throw new Error('Unexpected report query');
 }};
 const result=await homeExploration(reader,new Date('2026-10-14T04:00:00Z'));
 for(const summary of [result.keywords,result.keywordToday]){
  expect(summary.status).toBe('synchronized');expect(summary.ruleVersion).toBe('exact-text-v1');
  expect(summary.rows.map(r=>r.term)).toEqual(retained);
  expect(summary.rows.every(r=>r.views===null)).toBe(true);
  expect(summary.exclusions?.terms).toBe(noise.length);
  expect(summary.exclusions?.reasons['youtube-source-or-platform']).toBe(2);
 }
 expect(JSON.stringify(terms)).toBe(before);
 for(const term of noise)expect(tagDisplayExclusion(term),term).not.toBeNull();
 for(const term of retained)expect(tagDisplayExclusion(term),term).toBeNull();
 expect(queries.filter(q=>q.sql.includes('SUM(6*(1-POW')).length).toBe(1);
});
