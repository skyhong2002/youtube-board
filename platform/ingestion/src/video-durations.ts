import { isYoutubeItemFailure, YoutubeError } from './quota.js';
import type { RowDataPacket } from 'mysql2/promise';
import { cap } from './channel-jobs.js';
import { clearItemBackoff, recordItemBackoff } from './backoff.js';
import { taipeiSql, upsert, update, selectOne } from './legacy-db.js';
import type { SourceJobContext } from './video-statistics.js';
export async function videoDurationsJob(ctx: SourceJobContext, input: { videoId?: string; limit: number; enqueueMissing: boolean }) {
  cap(input.limit, 50); const job = 'youtube.videos.duration', at = taipeiSql(ctx.now);
  const [rows] = await ctx.db.query<RowDataPacket[]>(`SELECT v.pk, v.videoId, v.u_id, v.publishedAt, d.pk_video FROM urt_video v LEFT JOIN urt_video_duration d ON BINARY d.videoId = BINARY v.videoId LEFT JOIN ts_youtube_item_backoff b ON b.workflow = ? AND BINARY b.video_id = BINARY v.videoId WHERE d.duration IS NULL AND d.mtime IS NULL AND ${input.videoId ? 'BINARY v.videoId = BINARY ?' : 'd.duration IS NULL AND (d.stime IS NULL OR d.stime <= ?) AND (b.retry_after IS NULL OR b.retry_after <= ?)'} ${input.enqueueMissing ? '' : 'AND d.pk_video IS NOT NULL'} ORDER BY (d.pk_video IS NULL), d.pk_video, v.publishedAt DESC, v.pk DESC LIMIT ?`, [job, ...(input.videoId ? [input.videoId] : [at, at]), input.limit]);
  const enqueued:string[]=[], applied: string[] = [], skipped: { videoId: string; reason: string }[] = [];
  if (!ctx.execute || !rows.length) return { mode: ctx.execute ? 'execute' : 'dry-run', selected: rows.length, apiAttempts: 0, applied, skipped, enqueued };
  for(const row of rows) { if(!row.pk_video) { await ctx.assertOwnership(); await upsert(ctx.db,'urt_video_duration',{videoId:row.videoId},{ctime:at,u_id:row.u_id,publishedAt:row.publishedAt,duration:null,mtime:null,stime:null});enqueued.push(row.videoId);row.pk_video=(await selectOne(ctx.db,'urt_video_duration',{videoId:row.videoId}))!.pk_video; } }
  await ctx.assertOwnership(); let details: Awaited<ReturnType<SourceJobContext['youtube']['videoContentDetails']>>;
  try { details=await ctx.youtube.videoContentDetails(rows.map(r => r.videoId)); }
  catch(error) {
    if(error instanceof YoutubeError && !isYoutubeItemFailure(error))return {mode:'execute',selected:rows.length,apiAttempts:ctx.youtube.attemptsMade,applied,skipped,enqueued,stoppedReason:error.code};
    if(!isYoutubeItemFailure(error))return {mode:'execute',selected:rows.length,apiAttempts:ctx.youtube.attemptsMade,applied,skipped,enqueued,stoppedReason:'source-request-failed'};
    for(const row of rows){await ctx.assertOwnership();await update(ctx.db,'urt_video_duration',{pk_video:row.pk_video},{stime:taipeiSql(new Date(ctx.now.getTime()+5*60000))});await recordItemBackoff(ctx.db,job,row.videoId,'api-batch-item-rejected',ctx.now);skipped.push({videoId:row.videoId,reason:'api-batch-item-rejected'});}
    return {mode:'execute',selected:rows.length,apiAttempts:ctx.youtube.attemptsMade,applied,skipped,enqueued};
  }
  for (const row of rows) {
    await ctx.assertOwnership(); const detail = details.get(row.videoId);
    if (!detail || detail.durationSeconds === 0) { await update(ctx.db,'urt_video_duration',{pk_video:row.pk_video},{stime:taipeiSql(new Date(ctx.now.getTime()+5*60000))}); await recordItemBackoff(ctx.db, job, row.videoId, 'api-item-missing-or-not-final', ctx.now); skipped.push({ videoId: row.videoId, reason: 'api-item-missing-or-not-final' }); continue; }
    try {
      await upsert(ctx.db, 'urt_video_duration', { videoId: row.videoId }, { ...(row.pk_video ? {} : { ctime: at, u_id: row.u_id, publishedAt: row.publishedAt }), duration: detail.durationSeconds, caption: detail.caption, mtime: at, stime: at });
      await clearItemBackoff(ctx.db, job, row.videoId); applied.push(row.videoId);
    } catch {
      await ctx.assertOwnership(); await recordItemBackoff(ctx.db,job,row.videoId,'item-write-failed',ctx.now);skipped.push({videoId:row.videoId,reason:'item-write-failed'});
    }
  }
  return { mode: 'execute', selected: rows.length, apiAttempts: ctx.youtube.attemptsMade, applied, skipped, enqueued };
}
