import {afterEach,describe,expect,it,vi} from 'vitest';
import {sql} from 'drizzle-orm';
const mocks=vi.hoisted(()=>({createPool:vi.fn()}));
vi.mock('mysql2/promise',()=>({default:{createPool:mocks.createPool}}));
import {createReader,DataSourceUnavailable} from '../src/db/client.js';
import {dataSourceReporter} from '../src/db/diagnostics.js';
import {readerOperation,readerPoolObservation,READER_OPERATIONS,type ReaderFailureObservation} from '../src/db/observation.js';
afterEach(()=>{vi.useRealTimers();vi.restoreAllMocks();vi.clearAllMocks();});
function logs(){const rows:Record<string,any>[]=[];vi.spyOn(process.stderr,'write').mockImplementation(value=>{rows.push(JSON.parse(String(value)));return true;});return rows;}
function deferred<T>(){let resolve!:(value:T)=>void,reject!:(reason:unknown)=>void;const promise=new Promise<T>((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};}

describe('fixed reader operations and lease observations',()=>{
 it('uses fixed fallback shapes and never accepts an arbitrary operation',()=>{
  expect(readerOperation('SELECT password FROM urt_video WHERE title=?')).toBe('video-read');
  expect(readerOperation('SELECT secret FROM ts_video_tag_evidence')).toBe('evidence-read');
  expect(readerOperation('SELECT secret FROM private_table')).toBe('other');
  expect(readerOperation('SELECT secret FROM urt_video','secret SQL' as any)).toBe('other');
  expect(readerOperation('anything','home-ranking')).toBe('home-ranking');
 });
 it('distinguishes queued, expired queued and active leases without retaining payloads',()=>{
  let time=100;const tracker=readerPoolObservation(()=>time),a=tracker.queue('home-ranking'),b=tracker.queue('derived-taxonomy-source');
  time=120;tracker.acquired(a);time=160;tracker.expire(b);
  expect(tracker.snapshot()).toEqual({active:1,queued:1,expiredQueued:1,connectionLimit:6,queueLimit:24,activeOperations:[{operation:'home-ranking',count:1,oldestMs:40}],queuedOperations:[{operation:'derived-taxonomy-source',count:1,oldestMs:60}]});
  tracker.abandon(b);tracker.release(a);expect(tracker.snapshot()).toMatchObject({active:0,queued:0,expiredQueued:0});
 });
 it('captures the failed statement before destroy and removes the released lease afterward',async()=>{
  vi.useFakeTimers();const output=logs(),query=deferred<never>();
  const first={execute:vi.fn(()=>query.promise),destroy:vi.fn(),release:vi.fn()};
  const second={execute:vi.fn().mockRejectedValue({errno:1969,message:'secret SQL'}),destroy:vi.fn(),release:vi.fn()};
  const getConnection=vi.fn().mockResolvedValueOnce(first).mockResolvedValueOnce(second);
  mocks.createPool.mockReturnValue({getConnection,end:vi.fn()});const reader=createReader('mysql://secret');
  const failed=reader.rows(sql`SELECT ${'private parameter'} AS value`,{operation:'home-ranking',statementMs:15000}).catch(e=>e);
  await vi.advanceTimersByTimeAsync(27);query.reject({errno:1969,message:'private error',sql:'private SQL'});await failed;
  expect(output[0]).toMatchObject({operation:'home-ranking',phase:'statement',durationMs:27,statementMs:27,pool:{active:1,queued:0,activeOperations:[{operation:'home-ranking',count:1,oldestMs:27}]}});
  expect(first.destroy).toHaveBeenCalledOnce();expect(first.release).not.toHaveBeenCalled();
  expect(first.execute.mock.calls[0]).toEqual([{sql:'SET STATEMENT max_statement_time=15 FOR SELECT ? AS value',timeout:16000},['private parameter']]);
  await vi.advanceTimersByTimeAsync(30000);await reader.rows(sql`SELECT 2`,{operation:'derived-taxonomy-source'}).catch(()=>{});
  expect(output[1]?.pool.activeOperations).toEqual([{operation:'derived-taxonomy-source',count:1,oldestMs:0}]);
  expect(JSON.stringify(output)).not.toMatch(/private|secret|SELECT/);
 });
 it('identifies the six active holders when admission/acquisition fails and drains late leases',async()=>{
  vi.useFakeTimers();const output=logs(),busy=Array.from({length:6},()=>deferred<any>()),waiting=Array.from({length:24},()=>deferred<any>());
  const connections=busy.map(d=>({execute:vi.fn(()=>d.promise),release:vi.fn(),destroy:vi.fn()}));
  let n=0;const getConnection=vi.fn(()=>{const index=n++;return index<6?Promise.resolve(connections[index]):waiting[index-6]!.promise;});
  mocks.createPool.mockReturnValue({getConnection,end:vi.fn()});const reader=createReader('mysql://fixture',{acquireMs:10,statementMs:1000});
  const active=connections.map(()=>reader.rows(sql`SELECT 1`,{operation:'home-ranking'}));await vi.advanceTimersByTimeAsync(1);
  const pending=waiting.map(()=>reader.rows(sql`SELECT 2`,{operation:'derived-taxonomy-source'}).catch(e=>e));
  await expect(reader.rows(sql`SELECT 3`,{operation:'readiness'})).rejects.toMatchObject({category:'pool-admission'});
  expect(output[0]).toMatchObject({operation:'readiness',phase:'admission',pool:{active:6,queued:24,expiredQueued:0,connectionLimit:6,queueLimit:24,activeOperations:[{operation:'home-ranking',count:6}],queuedOperations:[{operation:'derived-taxonomy-source',count:24}]}});
  await vi.advanceTimersByTimeAsync(10);expect((await Promise.all(pending)).every(e=>e.category==='connection-acquire')).toBe(true);
  expect(output[1]).toMatchObject({operation:'derived-taxonomy-source',phase:'acquire',durationMs:10,pool:{active:6,queued:24,expiredQueued:1}});
  const lateRelease=vi.fn();for(const waiter of waiting)waiter.resolve({release:lateRelease});for(const d of busy)d.resolve([[],[]]);await Promise.all(active);await vi.advanceTimersByTimeAsync(0);
  expect(lateRelease).toHaveBeenCalledTimes(24);expect(connections.every(c=>c.release.mock.calls.length===1)).toBe(true);
  const fail={execute:vi.fn().mockRejectedValue({code:'ECONNRESET'}),destroy:vi.fn(),release:vi.fn()};getConnection.mockResolvedValue(fail);
  await reader.rows(sql`SELECT 4`,{operation:'home-summary'}).catch(()=>{});
  expect(output.at(-1)).toMatchObject({category:'driver',pool:{active:1,queued:0,expiredQueued:0,activeOperations:[{operation:'home-summary',count:1}]}});
  expect(getConnection).toHaveBeenCalledTimes(31);
 });
 it('keeps existing per-category rate bounds and reconstructs nested log fields',()=>{
  const write=vi.fn();let now=0;const report=dataSourceReporter(write,()=>now),tracker=readerPoolObservation(()=>0);
  const detail:ReaderFailureObservation={operation:'home-ranking',phase:'statement',durationMs:5,acquireMs:1,statementMs:4,pool:tracker.snapshot()};
  report(new DataSourceUnavailable(undefined,'statement-deadline'),'reader',detail);
  for(const operation of READER_OPERATIONS)for(let i=0;i<5;i++)report(new DataSourceUnavailable(undefined,'statement-deadline'),'reader',{...detail,operation});
  expect(write).toHaveBeenCalledOnce();now=30000;
  report(new DataSourceUnavailable(undefined,'statement-deadline'),'reader',{...detail,operation:'secret' as any,sql:'secret',pool:{...detail.pool,sql:'secret',activeOperations:[{operation:'secret' as any,count:1,oldestMs:2,sql:'secret'}]}} as any);
  const record=JSON.parse(write.mock.calls[1]![0]);expect(record.operation).toBe('other');expect(record.suppressed).toBe(READER_OPERATIONS.length*5);expect(Object.keys(record.suppressedOperations)).toHaveLength(READER_OPERATIONS.length);
  expect(record.pool.activeOperations).toEqual([{operation:'other',count:1,oldestMs:2}]);expect(JSON.stringify(write.mock.calls)).not.toContain('secret');
 });
 it('does not let a failed diagnostic sink replace the driver failure',async()=>{
  vi.spyOn(process.stderr,'write').mockImplementation(()=>{throw new Error('sink');});
  const c={execute:vi.fn().mockRejectedValue({errno:1969}),destroy:vi.fn(),release:vi.fn()};mocks.createPool.mockReturnValue({getConnection:vi.fn().mockResolvedValue(c),end:vi.fn()});
  await expect(createReader('mysql://fixture').rows(sql`SELECT 1`,{operation:'home-ranking'})).rejects.toMatchObject({category:'statement-deadline'});expect(c.destroy).toHaveBeenCalledOnce();
 });
});
