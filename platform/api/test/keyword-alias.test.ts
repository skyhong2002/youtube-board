import {expect,it} from 'vitest';
import {sql} from 'drizzle-orm';
import {MySqlDialect} from 'drizzle-orm/mysql-core';
import type {Reader} from '../src/db/client.js';
import {maintainedKeywordIdentities,keywordTextContains} from '../src/reports/keyword-alias.js';
import {asciiCaseFold,asciiLiteralPattern} from '../../shared/ascii-case.js';
import {keywordCloudFromEvidence,keywordDayFromEvidence,type MetricVideo} from '../../shared/cache-metrics.js';
const identity=(term:string,key:string)=>({term,term_key:key.repeat(64)});
function reader(rows:unknown[],run:unknown={alias_snapshot_bytes:500,separate_terms:'true'}){let n=0;return {close:async()=>{},rows:async()=>++n===1?[run]:rows} as Reader;}
it('resolves only actual upstream keys with ASCII case equivalence, preserving spaces and non-ASCII distinctions',async()=>{
 expect(await maintainedKeywordIdentities(reader([identity('AI','b'),identity('ai','a'),identity('ＡＩ','0')]),'v','Ai')).toEqual([{key:'a'.repeat(64),term:'ai'},{key:'b'.repeat(64),term:'AI'}]);
 expect(await maintainedKeywordIdentities(reader([identity('İ','a')]),'v','i')).toEqual([]);
 expect(await maintainedKeywordIdentities(reader([identity('交通 ','a')]),'v','交通')).toEqual([]);
 expect(await maintainedKeywordIdentities(reader([]),'v','absent')).toEqual([]);
 expect(asciiCaseFold('AI İ ß ＡＩ 交通 ')).toBe('ai İ ß ＡＩ 交通 ');
});
it('bounds alias count and source snapshot before processing identities',async()=>{
 await expect(maintainedKeywordIdentities(reader([], {alias_snapshot_bytes:17*1024*1024}),'v','ai')).rejects.toThrow('budget');
 await expect(maintainedKeywordIdentities(reader(Array.from({length:1025},()=>identity('AI','a'))),'v','ai')).rejects.toThrow('budget');
 await expect(maintainedKeywordIdentities(reader([{term:'AI',term_key:'malformed'}]),'v','ai')).rejects.toThrow('Dashboard query failed');
});
it('candidate text patterns escape every non-ASCII byte and regex/wildcard character literally',()=>{
 expect(asciiLiteralPattern('A.%_')).toBe('[Aa]\\x2e\\x25\\x5f');
 const dialect=new MySqlDialect(),query=dialect.sqlToQuery(keywordTextContains(sql`v.title`,'AI.交通'));
 expect(query.sql).toContain('AS BINARY) REGEXP BINARY ?');expect(query.params).toEqual([asciiLiteralPattern('AI.交通')]);
 expect(dialect.sqlToQuery(keywordTextContains(sql`v.title`,'交通')).sql).toContain('LOCATE(CAST(? AS BINARY)');
});
it('keyword metrics resolve subject case only while retaining original output labels and existing weights',()=>{
 const videos:MetricVideo[]=[{videoId:'fixture',uId:1,publishedAt:'2038-05-12',viewCount:100,matches:[{term:'ai',field:'title'},{term:'記者',field:'description'}]}];
 for(const term of ['AI','ai','Ai']){
  expect(keywordCloudFromEvidence(videos,term)).toEqual(keywordCloudFromEvidence(videos,'ai'));
  expect(keywordDayFromEvidence(videos,term)).toMatchObject({count_videos:1,tags_json:{ai:1,記者:1}});
 }
 expect(keywordCloudFromEvidence(videos,'ai').tags_result.ai?.weight).toBe((100*Math.sqrt(2/3)).toFixed(2));
 for(const term of ['ai ','ＡＩ','記者 '])expect(keywordDayFromEvidence(videos,term).count_videos).toBe(0);
});
