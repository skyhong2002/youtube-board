import {expect,it} from 'vitest';
import {prepareQualityCandidate} from '../src/quality-candidate.js';
import {SOURCE,termKey} from '../src/vocabulary.js';
const original={id:'existing-window',source:SOURCE,window:{since:'2026-10-10T16:00:00.000Z',until:'2026-10-11T16:00:00.000Z'},publishedAt:'2026-10-12T11:58:36.157Z',coverage:'observed-article-window',terms:[{key:termKey('新聞'),term:'新聞',articleCount:5,media:['來源'],provenance:'upstream-article-tag-origin-unspecified'},{key:termKey('AI'),term:'AI',articleCount:3,media:[],provenance:'upstream-article-tag-origin-unspecified'}]};
const spec={id:'youtube-quality-20261013-f2',parentVersion:original.id,implementationSha:'a'.repeat(40),preparedAt:'2026-10-12T19:00:00.000Z'};
it('preserves every source term and acquisition timestamp in a distinct non-serving candidate',()=>{
 const raw=JSON.stringify(original),r=prepareQualityCandidate(raw,spec);
 expect(r.snapshot.terms).toEqual(original.terms);expect(r.snapshot.window).toEqual(original.window);expect(r.snapshot.publishedAt).toBe(original.publishedAt);expect(r.snapshot.becameCurrent).toBe(false);expect(r.snapshot.matchingRule).toBe('youtube-quality-v2');expect(r.snapshot.id).toBe(spec.id);expect(JSON.stringify(original)).toBe(raw);expect(r.parentSnapshotSha256).toMatch(/^[a-f0-9]{64}$/);
});
it('refuses unsupported full-pool, changed parent, invalid identity and empty pool',()=>{
 for(const value of [{...original,id:'other'},{...original,termsStoredSeparately:true},{...original,terms:[]},{...original,source:'https://other.test'}])expect(()=>prepareQualityCandidate(JSON.stringify(value),spec)).toThrow();
 for(const change of [{id:original.id},{implementationSha:'tag'},{preparedAt:'2026-02-30T00:00:00.000Z'},{parentVersion:'wrong'}])expect(()=>prepareQualityCandidate(JSON.stringify(original),{...spec,...change})).toThrow();
});

import {stageQualityCandidate} from '../src/quality-candidate.js';
import type {Connection,RowDataPacket} from 'mysql2/promise';
import {randomUUID} from 'node:crypto';
import {connectDatabase} from '../src/database.js';
import {isolatedTestEnv} from '../../shared/test-database.js';
function transactionFixture(options:{parent?:string;existing?:unknown;failInsert?:boolean}={}){
 const calls:string[]=[];
 const db={beginTransaction:async()=>{calls.push('begin');},commit:async()=>{calls.push('commit');},rollback:async()=>{calls.push('rollback');},query:async(q:{sql:string})=>{
  if(q.sql.includes('ts_vocabulary_current'))return [[{id:options.parent??original.id,snapshot:JSON.stringify(original),window_since:original.window.since,window_until:original.window.until,pages:1}]];
  return [options.existing?[{status:'published',snapshot:JSON.stringify(options.existing)}]:[]];
 },execute:async(q:{sql:string})=>{calls.push(q.sql);if(options.failInsert)throw Error('injected insert failure');return [{}];}} as unknown as Connection;
 return {db,calls};
}
it('rolls back when serving parent changes or insert fails, without writing the serving pointer',async()=>{
 for(const option of [{parent:'changed'},{failInsert:true}]){
  const {db,calls}=transactionFixture(option);await expect(stageQualityCandidate(db,spec,async()=>{})).rejects.toThrow();
  expect(calls).toContain('rollback');expect(calls).not.toContain('commit');expect(calls.some(c=>/UPDATE.*ts_vocabulary_current|INSERT.*ts_vocabulary_current/.test(c))).toBe(false);
 }
});
it('accepts an identical staged candidate on retry and refuses changed content',async()=>{
 const prepared=prepareQualityCandidate(JSON.stringify(original),spec);
 const same=transactionFixture({existing:prepared.snapshot});
 expect(await stageQualityCandidate(same.db,{...spec,preparedAt:'2026-10-12T20:00:00.000Z'},async()=>{})).toMatchObject({status:'already-staged',servingPointerChanged:false});
 expect(same.calls).toEqual(['begin','commit']);
 const changed=transactionFixture({existing:{...prepared.snapshot,terms:[]}});await expect(stageQualityCandidate(changed.db,spec,async()=>{})).rejects.toThrow('different contents');expect(changed.calls).toContain('rollback');
});
it('rechecks ownership inside the transaction before insertion',async()=>{
 const f=transactionFixture();let checks=0;await expect(stageQualityCandidate(f.db,spec,async()=>{if(++checks===2)throw Error('lost ownership');})).rejects.toThrow('lost ownership');expect(f.calls).toEqual(['begin','rollback']);
});
it.skipIf(process.env.JOBS_DB_TEST!=='1')('real transactions preserve serving pointer, retry idempotently and roll back inserted candidate on failure',async()=>{
 const db=await connectDatabase(isolatedTestEnv()),suffix=randomUUID().replaceAll('-','').slice(0,16),parentId='quality-parent-'+suffix,id='youtube-quality-20261013-'+suffix;
 const raw=JSON.stringify({...original,id:parentId}),localSpec={...spec,id,parentVersion:parentId};
 const [saved]=await db.query<RowDataPacket[]>('SELECT run_id FROM ts_vocabulary_current WHERE source=?',[SOURCE]);
 try{
  await db.execute('INSERT INTO ts_vocabulary_runs(id,window_since,window_until,status,pages,snapshot) VALUES(?,?,?,?,?,?)',[parentId,original.window.since,original.window.until,'published',1,raw]);
  await db.execute('INSERT INTO ts_vocabulary_current(source,run_id) VALUES(?,?) ON DUPLICATE KEY UPDATE run_id=VALUES(run_id)',[SOURCE,parentId]);
  expect(await stageQualityCandidate(db,localSpec,async()=>{})).toMatchObject({status:'staged'});
  expect(await stageQualityCandidate(db,{...localSpec,preparedAt:'2026-10-13T00:00:00.000Z'},async()=>{})).toMatchObject({status:'already-staged'});
  const [current]=await db.query<RowDataPacket[]>('SELECT run_id FROM ts_vocabulary_current WHERE source=?',[SOURCE]);expect(current[0]?.run_id).toBe(parentId);
  const [rows]=await db.query<RowDataPacket[]>('SELECT snapshot FROM ts_vocabulary_runs WHERE id=?',[id]);expect(JSON.parse(rows[0]!.snapshot).terms).toEqual(original.terms);
  const failedId=id+'-fail';
  const failing={query:db.query.bind(db),beginTransaction:db.beginTransaction.bind(db),commit:db.commit.bind(db),rollback:db.rollback.bind(db),execute:async(...args:any[])=>{await (db.execute as any)(...args);throw Error('injected post-insert failure');}} as unknown as Connection;
  await expect(stageQualityCandidate(failing,{...localSpec,id:failedId},async()=>{})).rejects.toThrow('post-insert');
  const [absent]=await db.query<RowDataPacket[]>('SELECT id FROM ts_vocabulary_runs WHERE id=?',[failedId]);expect(absent).toEqual([]);
  await expect(stageQualityCandidate(db,{...localSpec,id:failedId,parentVersion:'lost-parent'},async()=>{})).rejects.toThrow('Serving vocabulary changed');
 }finally{
  if(saved[0])await db.execute('UPDATE ts_vocabulary_current SET run_id=? WHERE source=?',[saved[0].run_id,SOURCE]);else await db.execute('DELETE FROM ts_vocabulary_current WHERE source=?',[SOURCE]);
  await db.execute('DELETE FROM ts_vocabulary_runs WHERE id IN (?,?,?)',[parentId,id,id+'-fail']);await db.end();
 }
});
