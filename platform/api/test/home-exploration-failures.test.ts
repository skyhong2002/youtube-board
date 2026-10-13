import {describe,it,expect,vi} from 'vitest';
import {MySqlDialect} from 'drizzle-orm/mysql-core';
import {DataSourceUnavailable,DataQueryFailed,type Reader,type Row} from '../src/db/client.js';
import {homeExploration} from '../src/reports/home-exploration.js';
import {homeDiagnosticSink,type HomeDiagnostic} from '../src/reports/home-diagnostics.js';
const now=new Date('2026-10-13T00:00:00Z');
const version={id:'v1',source_meta:{coverage:'all-current-indexed-article-tags',matchingRule:'exact-text-v1'}};
const source={pk:1,u_id:1,publishedAt:'2026-10-13 01:00:00',video_id:'abcdefghijk',vocabulary_version:'v1',viewCount:10,unprocessed:1,fresh:0,matched_epoch:null};
type Stage='categories'|'versions'|'sources'|'labels'|'current';
function reader(overrides:Partial<Record<Stage,()=>Row[]>>={}):Reader {
 const dialect=new MySqlDialect();
 return {close:async()=>{},rows:async query=>{
  const sql=dialect.sqlToQuery(query).sql;
  const stage=sql.includes('FROM urt_count')?'categories':sql.includes('AS source_meta')?'versions':sql.includes('1 AS source_videos')?'sources':sql.includes('SELECT DISTINCT e.term_key')?'labels':sql.includes('SELECT c.run_id')?'current':null;
  if(stage)return (overrides[stage]?.()??(stage==='versions'?[version]:stage==='current'?[{run_id:'v1'}]:[])) as never;
  if(sql.includes('FROM urt_tag'))return [];
  throw new Error('Unexpected mocked query');
 }};
}
describe('DB-free home failures',()=>{
 it.each(['categories','sources'] as const)('isolates %s source unavailability with private diagnostics',async stage=>{
  const diagnostic=vi.fn(),error=new DataSourceUnavailable(new Error('SQL private-token params=password'));
  const result=await homeExploration(reader({[stage]:()=>{throw error;}}),now,diagnostic);
  expect(stage==='categories'?result.categories:result.keywords).toMatchObject({status:'unavailable',reason:'data-source-unavailable',rows:[]});
  expect(stage==='categories'?result.keywords.status:result.categories.status).toBe(stage==='categories'?'synchronized':'available');
  if(stage==='sources')expect(result.keywordToday).toMatchObject({reason:'data-source-unavailable',sourceVideos:null});
  expect(diagnostic).toHaveBeenCalledExactlyOnceWith({section:stage==='categories'?'categories':'keywords',stage:stage==='categories'?'category-source':'video-source',reason:'data-source-unavailable',UTC:now.toISOString()});
  expect(JSON.stringify(diagnostic.mock.calls)).not.toContain('private-token');
 });
 it.each(['categories','sources','labels'] as const)('enforces the %s cap',async stage=>{
  const diagnostic=vi.fn(),result=await homeExploration(reader({[stage]:()=>Array(stage==='labels'?25001:100001).fill(stage==='sources'?source:{})}),now,diagnostic);
  expect(stage==='categories'?result.categories:result.keywords).toMatchObject({status:'unavailable',reason:'source-cap',rows:[]});
  expect(diagnostic.mock.calls[0]?.[0]).toMatchObject({reason:'source-cap',stage:stage==='categories'?'category-source':stage==='sources'?'video-source':'term-labels'});
 });
 it.each([
  {categories:()=>[{u_id:1,tags:'1',view_week:'9007199254740992'}]},
  {sources:()=>[{...source,pk:'9007199254740992'}]},
  {sources:()=>[{...source,fresh:1,unprocessed:1}]},
 ])('rejects unsafe or inconsistent values',async overrides=>{
  const result=await homeExploration(reader(overrides),now);
  expect(overrides.categories?result.categories:result.keywords).toMatchObject({status:'unavailable',reason:'precision',rows:[]});
 });
 it('preserves not-synchronized contract',async()=>{
  const diagnostic=vi.fn(),result=await homeExploration(reader({versions:()=>[]}),now,diagnostic);
  for(const section of [result.keywords,result.keywordToday])expect(section).toMatchObject({status:'not-synchronized',reason:null,version:null,rows:[]});
  expect(diagnostic).toHaveBeenCalledExactlyOnceWith({section:'keywords',stage:'vocabulary',reason:'not-synchronized',UTC:now.toISOString()});
 });
 it('distinguishes a version change without changing API source-cap reason',async()=>{
  const diagnostic=vi.fn(),result=await homeExploration(reader({current:()=>[{run_id:'v2'}]}),now,diagnostic);
  for(const section of [result.keywords,result.keywordToday])expect(section).toMatchObject({status:'unavailable',reason:'source-cap',version:null});
  expect(diagnostic).toHaveBeenCalledExactlyOnceWith({section:'keywords',stage:'version-check',reason:'version-changed',UTC:now.toISOString()});
 });
 it.each(['categories','sources'] as const)('propagates unexpected %s schema errors',async stage=>{
  const error=new DataQueryFailed('ER_BAD_FIELD_ERROR'),diagnostic=vi.fn();
  await expect(homeExploration(reader({[stage]:()=>{throw error;}}),now,diagnostic)).rejects.toBe(error);
  expect(diagnostic).not.toHaveBeenCalled();
 });
 it('contains optional callback failure',async()=>{
  const result=await homeExploration(reader({sources:()=>{throw new DataSourceUnavailable();}}),now,()=>{throw new Error('sink');});
  expect(result.keywords.reason).toBe('data-source-unavailable');
 });
});
describe('bounded diagnostics',()=>{
 const record:HomeDiagnostic={section:'keywords',stage:'video-source',reason:'source-cap',UTC:'untrusted'};
 it('throttles each tuple independently at the minute boundary',()=>{
  let at=now.getTime();const sink=vi.fn(),emit=homeDiagnosticSink(sink,()=>new Date(at));
  emit(record);at+=59999;emit(record);emit({...record,reason:'precision'});emit({...record,section:'categories'});
  expect(sink).toHaveBeenCalledTimes(3);at+=1;emit(record);expect(sink).toHaveBeenCalledTimes(4);
 });
 it('reconstructs only allowed fields using its UTC clock',()=>{
  const sink=vi.fn(),emit=homeDiagnosticSink(sink,()=>now);
  emit({...record,sql:'SELECT secret',params:['password'],error:{message:'private'}} as HomeDiagnostic);
  expect(sink).toHaveBeenCalledExactlyOnceWith('HOME_SECTION_UNAVAILABLE '+JSON.stringify({section:'keywords',stage:'video-source',reason:'source-cap',UTC:now.toISOString()})+'\n');
  for(const field of ['section','stage','reason'])emit({...record,[field]:'SQL secret'} as HomeDiagnostic);
  expect(sink).toHaveBeenCalledTimes(1);
 });
 it('contains sink failure and throttles failed attempts and clock rollback',()=>{
  let at=now.getTime();const sink=vi.fn(()=>{throw new Error('closed');}),emit=homeDiagnosticSink(sink,()=>new Date(at));
  expect(()=>emit(record)).not.toThrow();emit(record);at-=1000;emit(record);expect(sink).toHaveBeenCalledTimes(1);
  at=now.getTime()+60000;emit(record);expect(sink).toHaveBeenCalledTimes(2);
 });
 it('contains clock failures and invalid timestamps',()=>{
  const sink=vi.fn();expect(()=>homeDiagnosticSink(sink,()=>{throw new Error('clock');})(record)).not.toThrow();
  homeDiagnosticSink(sink,()=>new Date(NaN))(record);expect(sink).not.toHaveBeenCalled();
 });
});
