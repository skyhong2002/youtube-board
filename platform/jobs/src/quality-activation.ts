import {createHash} from 'node:crypto';
import type {Connection,RowDataPacket,ResultSetHeader} from 'mysql2/promise';
import {sql} from 'drizzle-orm';
import type {Reader} from '../../api/src/db/client.js';
import {videoTextDigest} from '../../api/src/reports/video-digest.js';
import {taipeiSql} from '@youtube-board/ingestion';
import {prepareQualityCandidate,type QualityCandidateSpec} from './quality-candidate.js';
import {SOURCE} from './vocabulary.js';
import {MATCH_RULE} from '../../shared/youtube-match-policy.js';
export interface QualityActivationSpec extends Omit<QualityCandidateSpec,'preparedAt'> {minFreshVideos:number;minCoverage:number;maxAgeHours:number}
export function validateActivationSpec(spec:QualityActivationSpec){
 if(!Number.isSafeInteger(spec.minFreshVideos)||spec.minFreshVideos<1||spec.minFreshVideos>50000||!Number.isFinite(spec.minCoverage)||spec.minCoverage<0.25||spec.minCoverage>1||!Number.isSafeInteger(spec.maxAgeHours)||spec.maxAgeHours<1||spec.maxAgeHours>24)throw Error('Activation requires explicit bounded freshness and coverage thresholds');
 return spec;
}
/** SELECT-only validation of the actual rolling seven-day window. Zero-match
 * markers count as processed only with a matching evidence count and rule. */
export async function inspectQualityCoverage(reader:Reader,spec:QualityActivationSpec,now:Date){
 validateActivationSpec(spec);if(!Number.isFinite(+now))throw Error('Invalid activation clock');
 const from=taipeiSql(new Date(+now-7*86400000)),until=taipeiSql(now);
 const rows=await reader.rows(sql`SELECT COUNT(*) AS source_videos,COALESCE(SUM(s.fresh),0) AS fresh_videos FROM (
 SELECT v.pk,CASE WHEN m.source_pk=v.pk AND BINARY m.source_text_sha256=BINARY ${videoTextDigest()}
 AND BINARY m.rule_version=BINARY ${MATCH_RULE} AND UNIX_TIMESTAMP(m.matched_at)>=${(+now-spec.maxAgeHours*3600000)/1000} AND UNIX_TIMESTAMP(m.matched_at)<=${+now/1000+60}
 AND m.evidence_count=(SELECT COUNT(*) FROM ts_video_tag_evidence e WHERE e.video_id=m.video_id AND e.vocabulary_version=m.vocabulary_version AND BINARY e.rule_version=BINARY ${MATCH_RULE})
 THEN 1 ELSE 0 END AS fresh FROM urt_video v LEFT JOIN ts_video_tag_matches m ON m.video_id=CONVERT(v.videoId USING ascii) AND BINARY m.video_id=BINARY v.videoId AND m.vocabulary_version=${spec.id}
 WHERE v.publishedAt>=${from} AND v.publishedAt<${until} AND NOT EXISTS(SELECT 1 FROM urt_video newer WHERE newer.videoId=v.videoId AND BINARY newer.videoId=BINARY v.videoId AND newer.pk>v.pk) LIMIT 100001) s`);
 const total=Number(rows[0]?.source_videos),fresh=Number(rows[0]?.fresh_videos);
 if(!Number.isSafeInteger(total)||!Number.isSafeInteger(fresh)||total<1||total>100000||fresh<0||fresh>total)throw Error('Activation coverage is unavailable or exceeds budget');
 const fraction=fresh/total,ready=fresh>=spec.minFreshVideos&&fraction>=spec.minCoverage;
 return {scope:'rolling-7d-observed' as const,ready,checkedAt:now.toISOString(),from,until,sourceVideos:total,freshVideos:fresh,coverageFraction:fraction,partial:fresh!==total,minFreshVideos:spec.minFreshVideos,minCoverage:spec.minCoverage,maxAgeHours:spec.maxAgeHours};
}
async function lockedQualityPair(db:Connection,spec:Omit<QualityCandidateSpec,'preparedAt'>,expectedCurrent:string,rollback=false){
 const [current]=await db.query<RowDataPacket[]>({sql:'SELECT run_id FROM ts_vocabulary_current WHERE source=? FOR UPDATE',timeout:5000},[SOURCE]);
 if(current.length!==1||current[0]?.run_id!==expectedCurrent)throw Error('Serving vocabulary changed before pointer update');
 const [runs]=await db.query<RowDataPacket[]>({sql:'SELECT id,status,CASE WHEN OCTET_LENGTH(snapshot)<=8388608 THEN snapshot ELSE NULL END AS snapshot FROM ts_vocabulary_runs WHERE id IN (?,?) ORDER BY id FOR UPDATE',timeout:5000},[spec.parentVersion,spec.id]);
 const parent=runs.find(r=>r.id===spec.parentVersion),candidate=runs.find(r=>r.id===spec.id);
 if(parent?.status!=='published'||candidate?.status!=='published'||typeof parent.snapshot!=='string'||typeof candidate.snapshot!=='string')throw Error('Published bounded quality pair is unavailable');
 const saved=JSON.parse(candidate.snapshot),preparedAt=saved?.qualityCandidate?.preparedAt;
 if(rollback){
  if(saved?.id!==spec.id||saved?.qualityCandidate?.parentVersion!==spec.parentVersion||saved?.qualityCandidate?.parentSnapshotSha256!==createHash('sha256').update(parent.snapshot).digest('hex'))throw Error('Rollback parent proof differs');
  return {previousVersion:spec.parentVersion,version:spec.id};
 }
 const expected=prepareQualityCandidate(parent.snapshot,{...spec,preparedAt});
 if(JSON.stringify(saved)!==JSON.stringify(expected.snapshot))throw Error('Candidate parent, implementation or immutable payload differs');
 return {previousVersion:spec.parentVersion,version:spec.id};
}
/** Caller holds BOTH vocabulary and video-evidence writer locks. Source ingestion
 * may continue: coverage is an observed cutoff, not a MyISAM snapshot guarantee. */
export async function activateQualityCandidate(db:Connection,reader:Reader,spec:QualityActivationSpec,ownership:()=>Promise<void>,now=new Date(),audit?:(coverage:Awaited<ReturnType<typeof inspectQualityCoverage>>)=>Promise<void>){
 await ownership();const coverage=await inspectQualityCoverage(reader,spec,now);if(!coverage.ready)throw Error('Candidate has not met the explicit activation coverage threshold');
 await db.beginTransaction();try{
  const pair=await lockedQualityPair(db,spec,spec.parentVersion);await ownership();
  const [result]=await db.execute<ResultSetHeader>({sql:'UPDATE ts_vocabulary_current SET run_id=? WHERE source=? AND run_id=?',timeout:5000},[spec.id,SOURCE,spec.parentVersion]);
  if(result.affectedRows!==1)throw Error('Serving pointer compare-and-swap failed');
  if(audit)await audit(coverage);await db.commit();return {status:'activated' as const,...pair,coverage,servingPointerChanged:true,rollback:{expectedCurrent:spec.id,targetVersion:spec.parentVersion}};
 }catch(error){await db.rollback().catch(()=>{});throw error;}
}
export async function rollbackQualityCandidate(db:Connection,spec:Omit<QualityCandidateSpec,'preparedAt'>,ownership:()=>Promise<void>,audit?:()=>Promise<void>){
 await ownership();await db.beginTransaction();try{
  const pair=await lockedQualityPair(db,spec,spec.id,true);await ownership();
  const [result]=await db.execute<ResultSetHeader>({sql:'UPDATE ts_vocabulary_current SET run_id=? WHERE source=? AND run_id=?',timeout:5000},[spec.parentVersion,SOURCE,spec.id]);
  if(result.affectedRows!==1)throw Error('Rollback pointer compare-and-swap failed');
  if(audit)await audit();await db.commit();return {status:'rolled-back' as const,...pair,servingPointerChanged:true};
 }catch(error){await db.rollback().catch(()=>{});throw error;}
}
