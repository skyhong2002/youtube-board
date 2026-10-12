import {createHash} from 'node:crypto';
import type {Connection,RowDataPacket} from 'mysql2/promise';
import {SOURCE,termKey,type VocabularySnapshot} from './vocabulary.js';
import {MATCH_RULE} from '../../shared/youtube-match-policy.js';
import {assertVocabularyBudget} from './vocabulary-budget.js';
const MAX_BYTES=8*1024*1024;
const digest=(body:string)=>createHash('sha256').update(body).digest('hex');
export interface QualityCandidateSpec {id:string;parentVersion:string;implementationSha:string;preparedAt:string}
/** Exact embedded pool reuse only. No source-pool refresh or serving activation. */
export function prepareQualityCandidate(raw:string,spec:QualityCandidateSpec){
 if(!/^youtube-quality-\d{8}-[a-z0-9-]{1,30}$/.test(spec.id)||! /^[A-Za-z0-9_-]{1,100}$/.test(spec.parentVersion)||spec.id===spec.parentVersion||! /^[a-f0-9]{40}$/.test(spec.implementationSha)||!Number.isFinite(Date.parse(spec.preparedAt))||new Date(spec.preparedAt).toISOString()!==spec.preparedAt||Buffer.byteLength(raw)>MAX_BYTES)throw Error('Invalid quality candidate request');
 const parent=JSON.parse(raw) as VocabularySnapshot;
 if(parent.id!==spec.parentVersion||parent.source!==SOURCE||!Array.isArray(parent.terms)||parent.termsStoredSeparately||!parent.terms.length||parent.terms.some(t=>typeof t.term!=='string'||t.key!==termKey(t.term)))throw Error('Quality candidate requires a bounded embedded source pool');
 assertVocabularyBudget(parent.terms);
 const snapshot={...parent,id:spec.id,matchingRule:MATCH_RULE,becameCurrent:false,qualityCandidate:{schemaVersion:1,parentVersion:parent.id,parentSnapshotSha256:digest(raw),implementationSha:spec.implementationSha,preparedAt:spec.preparedAt}};
 const payload=JSON.stringify(snapshot);if(Buffer.byteLength(payload)>MAX_BYTES)throw Error('Quality candidate snapshot exceeds byte budget');
 return {snapshot,payload,parentSnapshotSha256:digest(raw),termCount:parent.terms.length};
}
/** Caller holds the existing vocabulary writer lock and enforces execute gates.
 * Published means readable immutable pool; ts_vocabulary_current stays unchanged. */
export async function stageQualityCandidate(db:Connection,spec:QualityCandidateSpec,ownership:()=>Promise<void>){
 await ownership();await db.beginTransaction();
 try{
  const [parents]=await db.query<RowDataPacket[]>({sql:`SELECT r.id,r.window_since,r.window_until,CASE WHEN OCTET_LENGTH(r.snapshot)<=${MAX_BYTES} THEN r.snapshot ELSE NULL END AS snapshot,r.pages FROM ts_vocabulary_current c JOIN ts_vocabulary_runs r ON r.id=c.run_id WHERE c.source=? AND r.status=? FOR UPDATE`,timeout:5000},[SOURCE,'published']);
  const parent=parents[0];if(!parent||parent.id!==spec.parentVersion||typeof parent.snapshot!=='string')throw Error('Serving vocabulary changed before candidate preparation');
  const prepared=prepareQualityCandidate(parent.snapshot,spec);
  const [existing]=await db.query<RowDataPacket[]>({sql:`SELECT status,CASE WHEN OCTET_LENGTH(snapshot)<=${MAX_BYTES} THEN snapshot ELSE NULL END AS snapshot FROM ts_vocabulary_runs WHERE id=? FOR UPDATE`,timeout:5000},[spec.id]);
  if(existing[0]){
   const saved=JSON.parse(existing[0].snapshot),at=saved?.qualityCandidate?.preparedAt;
   if(typeof at!=='string'||!Number.isFinite(Date.parse(at))||new Date(at).toISOString()!==at)throw Error('Invalid existing candidate timestamp');
   const expected={...prepared.snapshot,qualityCandidate:{...prepared.snapshot.qualityCandidate,preparedAt:at}};
   if(existing[0].status!=='published'||JSON.stringify(saved)!==JSON.stringify(expected))throw Error('Quality candidate identity already has different contents');
   await db.commit();return {status:'already-staged' as const,id:spec.id,parentVersion:spec.parentVersion,termCount:prepared.termCount,servingPointerChanged:false};
  }
  await ownership();await db.execute({sql:'INSERT INTO ts_vocabulary_runs(id,window_since,window_until,status,pages,checkpoint_cursor,snapshot,published_at) VALUES(?,?,?,?,?,NULL,?,CURRENT_TIMESTAMP(3))',timeout:5000},[spec.id,parent.window_since,parent.window_until,'published',parent.pages,prepared.payload]);
  await db.commit();return {status:'staged' as const,id:spec.id,parentVersion:spec.parentVersion,termCount:prepared.termCount,parentSnapshotSha256:prepared.parentSnapshotSha256,servingPointerChanged:false};
 }catch(error){await db.rollback().catch(()=>{});throw error;}
}
