import {createHash} from 'node:crypto';
import {MATCH_RULE} from '../../shared/youtube-match-policy.js';
import {descriptionExclusions,loadDescriptionTemplateProfiles,templateProfileProof,type DescriptionTemplateProfile} from './description-templates.js';
import { taipeiSql } from '@youtube-board/ingestion';
import { sourceTextFingerprint } from '../../shared/video-fingerprint.js';
import type { Connection, RowDataPacket } from 'mysql2/promise';
import { SOURCE, type VocabularySnapshot } from './vocabulary.js';
import { matchVocabularyWithExclusions, type MatchEvidence,type SourceTermIdentity } from './match.js';
import { assertExecute, executionPolicy } from './policy.js';
import { connectDatabase, withWriterLock } from './database.js';
import { loadVocabularySnapshot } from './load-vocabulary.js';
export const VIDEO_EVIDENCE_JOB = 'tags.videos.match';
export {MATCH_RULE};
export const VIDEO_QUALITY_JOB='tags.videos.quality';
export const VIDEO_QUALITY_MAX_BYTES=256*1024;
export const videoQualityKey=(version:string,videoId:string)=>createHash('sha256').update(JSON.stringify([version,videoId])).digest('hex');
export interface VideoInput { channelId:number; pk: number; videoId: string; title: string; description: string; observedAt: string | null }
export interface StoredEvidence extends MatchEvidence { snippet: string; snippetStart: number }
export function evidenceForVideo(video: VideoInput, snapshot: VocabularySnapshot,profile:DescriptionTemplateProfile) {
  if (!/^[A-Za-z0-9_-]{11}$/.test(video.videoId) || !Number.isSafeInteger(video.pk) || video.pk < 1) throw new Error('Invalid source video identity');
  if(!profile||profile.ruleVersion!==MATCH_RULE||profile.channelId!==video.channelId||!Number.isSafeInteger(video.channelId)||video.channelId<1||!/^[a-f0-9]{64}$/.test(profile.digest))throw new Error('Matching requires a current channel template profile');
  const sourceHash = sourceTextFingerprint(video.title, video.description),spans=descriptionExclusions(video,profile),matched=matchVocabularyWithExclusions(video,snapshot,spans);
  // Alias arrays are shared while matching but JSON expands them per occurrence.
  // Bound that amplification before constructing or serializing the quality audit.
  const aliasSizes=new Map<SourceTermIdentity[],number>();let aliasBytes=0;
  for(const item of [...matched.evidence,...matched.excluded])if(item.sourceTerms){
    let size=aliasSizes.get(item.sourceTerms);
    if(size===undefined){size=2;for(const identity of item.sourceTerms){size+=Buffer.byteLength(JSON.stringify(identity))+1;if(size>VIDEO_QUALITY_MAX_BYTES)throw new Error('Video quality audit exceeds cap');}aliasSizes.set(item.sourceTerms,size);}
    aliasBytes+=size;if(aliasBytes>VIDEO_QUALITY_MAX_BYTES)throw new Error('Video quality audit exceeds cap');
  }
  const evidence:StoredEvidence[] = matched.evidence.map(item => {
    const text = video[item.field];
    // Retain original UTF-16 index coordinates, including for astral characters.
    const snippetStart = Math.max(0, item.start - 40);
    return { ...item,method:MATCH_RULE, snippet: text.slice(snippetStart, item.end + 40), snippetStart };
  });
  const acceptedAliases=evidence.filter(item=>item.sourceTerms).map(({termKey,field,start,end,sourceTerms})=>({termKey,field,start,end,sourceTerms}));
  const quality={schemaVersion:1,ruleVersion:MATCH_RULE,vocabularyVersion:snapshot.id,videoId:video.videoId,sourcePk:video.pk,sourceHash,profile:templateProfileProof(profile),spans,acceptedAliases,excluded:matched.excluded.map(item=>({...item,method:MATCH_RULE}))};
  const qualityJson=JSON.stringify(quality);if(Buffer.byteLength(qualityJson)>VIDEO_QUALITY_MAX_BYTES)throw new Error('Video quality audit exceeds cap');
  return { sourceHash, evidence,quality,qualityJson };
}
/** Binary protocol payload bounded below max_allowed_packet; transaction and
 * candidate-version deletion semantics remain owned by storeVideoEvidence. */
export function evidenceInsertBatches(videoId:string,version:string,evidence:StoredEvidence[]){
 const batches:Array<Array<Array<string|number>>> = [];let batch:Array<Array<string|number>>=[],bytes=512;
 for(const e of evidence){
  const row=[videoId,version,e.termKey,e.term,e.source,e.field,e.start,e.end,e.text,e.snippet,e.snippetStart,e.method];
  const size=128+row.reduce<number>((n,value)=>n+(typeof value==='string'?Buffer.byteLength(value)+8:8),0);
  if(size+512>256*1024)throw new Error('Evidence insert row exceeds byte cap');
  if(batch.length&&(batch.length>=100||bytes+size>256*1024)){batches.push(batch);batch=[];bytes=512;}
  batch.push(row);bytes+=size;
 }
 if(batch.length)batches.push(batch);return batches;
}
export async function storeVideoEvidence(db: Connection, video: VideoInput, snapshot: VocabularySnapshot,profile:DescriptionTemplateProfile): Promise<{ status: 'written' | 'unchanged'; count: number }> {
  if(snapshot.matchingRule!==MATCH_RULE)throw new Error('Quality writes require an explicit candidate vocabulary rule');
  const { sourceHash, evidence,qualityJson } = evidenceForVideo(video, snapshot,profile);
  await db.beginTransaction();
  try {
    const [existing] = await db.query<RowDataPacket[]>('SELECT source_text_sha256, rule_version, evidence_count FROM ts_video_tag_matches WHERE video_id = ? AND vocabulary_version = ? FOR UPDATE', [video.videoId, snapshot.id]);
    const [audit]=await db.query<RowDataPacket[]>("SELECT JSON_UNQUOTE(JSON_EXTRACT(result,'$.profile.digest')) AS profile_digest FROM ts_job_runs WHERE job_key=? AND execution_key=? AND status='complete'",[VIDEO_QUALITY_JOB,videoQualityKey(snapshot.id,video.videoId)]);
    if (existing[0]?.source_text_sha256 === sourceHash && existing[0]?.rule_version === MATCH_RULE&&audit[0]?.profile_digest===profile.digest) {
      await db.execute('UPDATE ts_video_tag_matches SET source_pk = ?, source_observed_at = ? WHERE video_id = ? AND vocabulary_version = ?', [video.pk, video.observedAt, video.videoId, snapshot.id]);
      await writeQualityAudit(db,snapshot.id,video.videoId,'complete',qualityJson);
      await db.commit(); return { status: 'unchanged', count: existing[0].evidence_count };
    }
    await db.execute('INSERT INTO ts_video_tag_matches (video_id, vocabulary_version, source_pk, source_text_sha256, source_observed_at, rule_version, evidence_count) VALUES (?, ?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE source_pk = VALUES(source_pk), source_text_sha256 = VALUES(source_text_sha256), source_observed_at = VALUES(source_observed_at), rule_version = VALUES(rule_version), evidence_count = VALUES(evidence_count), matched_at = CURRENT_TIMESTAMP(3)', [video.videoId, snapshot.id, video.pk, sourceHash, video.observedAt, MATCH_RULE, evidence.length]);
    await db.execute('DELETE FROM ts_video_tag_evidence WHERE video_id = ? AND vocabulary_version = ?', [video.videoId, snapshot.id]);
    for(const batch of evidenceInsertBatches(video.videoId,snapshot.id,evidence))await db.execute('INSERT INTO ts_video_tag_evidence (video_id, vocabulary_version, term_key, term, source, field_name, start_offset, end_offset, matched_text, snippet, snippet_start, rule_version) VALUES '+batch.map(()=>'(?,?,?,?,?,?,?,?,?,?,?,?)').join(','),batch.flat());
    await writeQualityAudit(db,snapshot.id,video.videoId,'complete',qualityJson);
    await db.commit();
    return { status: 'written', count: evidence.length };
  } catch (error) { await db.rollback().catch(() => undefined); throw error; }
}
async function writeQualityAudit(db:Connection,version:string,videoId:string,status:string,result:string){
  if(Buffer.byteLength(result)>VIDEO_QUALITY_MAX_BYTES)throw new Error('Video quality audit exceeds cap');
  await db.execute('INSERT INTO ts_job_runs(job_key,execution_key,status,result) VALUES(?,?,?,?) ON DUPLICATE KEY UPDATE status=VALUES(status),result=VALUES(result)',[VIDEO_QUALITY_JOB,videoQualityKey(version,videoId),status,result]);
}
/** A failed profile never leaves an earlier v2 marker looking current. Historical
 * evidence remains inspectable, but its marker is withheld until a successful retry. */
export async function storeUnavailableVideoQuality(db:Connection,video:VideoInput,snapshot:VocabularySnapshot,reason:string){
  if(snapshot.matchingRule!==MATCH_RULE)throw new Error('Quality writes require an explicit candidate vocabulary rule');
  if(!/^[A-Za-z0-9_-]{11}$/.test(video.videoId)||!Number.isSafeInteger(video.pk)||video.pk<1)return;
  const result=JSON.stringify({schemaVersion:1,ruleVersion:MATCH_RULE,status:'unavailable',reason,vocabularyVersion:snapshot.id,videoId:video.videoId,sourcePk:video.pk,sourceHash:sourceTextFingerprint(video.title,video.description)});
  await db.beginTransaction();try{
    await db.execute("UPDATE ts_video_tag_matches SET rule_version='quality-unavailable-v2' WHERE video_id=? AND vocabulary_version=?",[video.videoId,snapshot.id]);
    await writeQualityAudit(db,snapshot.id,video.videoId,'unavailable',result);await db.commit();
  }catch(error){await db.rollback().catch(()=>{});throw error;}
}
export interface MatchBatchInput { afterPk: number; limit: number; version?: string; changedSince?: string; execute: boolean }
export async function matchVideoBatch(input: MatchBatchInput, env: NodeJS.ProcessEnv) {
  if (!Number.isSafeInteger(input.afterPk) || input.afterPk < 0 || !Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > 500) throw new Error('Matching requires nonnegative afterPk and limit 1–500');
  if (input.changedSince && (!/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(input.changedSince) || !Number.isFinite(Date.parse(input.changedSince)))) throw new Error('changedSince requires an ISO timestamp with timezone');
  const policy = executionPolicy(env, input.execute ? 'execute' : 'dry-run');
  if (input.execute) assertExecute(VIDEO_EVIDENCE_JOB, policy);
  const db = await connectDatabase(env);
  const work = async (check: () => Promise<void>) => {
    const snapshot = await loadVocabularySnapshot(db, input.version);
    if(input.execute&&snapshot.matchingRule!==MATCH_RULE)throw new Error('Quality writes require an explicit candidate vocabulary rule');
    const [rows] = await db.query<RowDataPacket[]>(`SELECT pk, u_id, videoId, title, description, mtime FROM urt_video WHERE pk > ?${input.changedSince ? ' AND mtime >= ?' : ''} ORDER BY pk ASC LIMIT ?`, [input.afterPk, ...(input.changedSince ? [taipeiSql(new Date(input.changedSince))] : []), input.limit + 1]);
    const selected=rows.slice(0,input.limit),profiles=await loadDescriptionTemplateProfiles(db,selected.map(row=>Number(row.u_id)).filter(id=>Number.isSafeInteger(id)&&id>0),taipeiSql(new Date()));
    const results: { pk: number; videoId: string | null; status: string; count: number; reason?: string }[] = [];
    for (const row of selected) {
      const video: VideoInput = { channelId:Number(row.u_id),pk: Number(row.pk), videoId: row.videoId, title: row.title ?? '', description: row.description ?? '', observedAt: row.mtime ?? null };
      await check();
      let preview: ReturnType<typeof evidenceForVideo>;const profile=profiles.get(video.channelId);
      try { if(!profile?.profile)throw new Error('Unavailable template profile');preview = evidenceForVideo(video, snapshot,profile.profile); }
      catch { const reason=profile?.reason??'invalid-matching-input';if(input.execute)await storeUnavailableVideoQuality(db,video,snapshot,reason);results.push({ pk: video.pk, videoId: video.videoId ?? null, status: 'invalid', count: 0, reason }); continue; }
      if (input.execute) results.push({ pk: video.pk, videoId: video.videoId, ...await storeVideoEvidence(db, video, snapshot,profile!.profile!) });
      else results.push({ pk: video.pk, videoId: video.videoId, status: 'preview', count: preview.evidence.length });
    }
    return { mode: policy.mode, vocabularyVersion: snapshot.id, coverage: snapshot.coverage, processed: results.length, nextAfterPk: rows.length > input.limit ? Number(rows[input.limit - 1]!.pk) : null, results, externalCalls: 0 };
  };
  try { return input.execute ? await withWriterLock(db, VIDEO_EVIDENCE_JOB, work) : await work(async () => {}); }
  finally { await db.end(); }
}
