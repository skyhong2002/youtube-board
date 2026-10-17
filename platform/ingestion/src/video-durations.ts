import type { RowDataPacket } from 'mysql2/promise';
import { cap, isRunStoppingYoutubeError } from './channel-jobs.js';
import { clearItemBackoff, recordItemBackoff } from './backoff.js';
import { taipeiSql, upsert, update, selectOne } from './legacy-db.js';
import type { SourceJobContext } from './video-statistics.js';
export async function videoDurationsJob(ctx: SourceJobContext, input: { videoId?: string; limit: number; enqueueMissing: boolean }) {
  cap(input.limit, 50); const job = 'youtube.videos.duration', at = taipeiSql(ctx.now);
  const [rows] = await ctx.db.query<RowDataPacket[]>(`SELECT v.pk, v.videoId, v.u_id, v.publishedAt, d.pk_video FROM urt_video v LEFT JOIN urt_video_duration d ON d.videoId = v.videoId AND BINARY d.videoId = BINARY v.videoId LEFT JOIN ts_youtube_item_backoff b ON b.workflow = ? AND b.video_id = v.videoId AND BINARY b.video_id = BINARY v.videoId WHERE d.duration IS NULL AND d.mtime IS NULL AND ${input.videoId ? 'v.videoId = BINARY ?' : 'd.duration IS NULL AND (d.stime IS NULL OR d.stime <= ?) AND (b.retry_after IS NULL OR b.retry_after <= ?)'} ${input.enqueueMissing ? '' : 'AND d.pk_video IS NOT NULL'} ORDER BY (d.pk_video IS NULL), d.pk_video, v.publishedAt DESC, v.pk DESC LIMIT ?`, [job, ...(input.videoId ? [input.videoId] : [at, at]), input.limit]);
  const enqueued:string[]=[], applied: string[] = [], skipped: { videoId: string; reason: string }[] = [];
  // Laravel VideoDurationsPreview: an explicit video, or more ready queue rows than 20% of the batch (counted after enqueueing).
  const wouldCallApi = rows.length > 0 && (!!input.videoId || rows.length > Math.floor(input.limit * 0.2));
  if (!ctx.execute || !rows.length) return { mode: ctx.execute ? 'execute' : 'dry-run', selected: rows.length, wouldCallApi, apiAttempts: 0, applied, skipped, enqueued };
  for(const row of rows) { if(!row.pk_video) { await ctx.assertOwnership(); await upsert(ctx.db,'urt_video_duration',{videoId:row.videoId},{ctime:at,u_id:row.u_id,publishedAt:row.publishedAt,duration:null,mtime:null,stime:null});enqueued.push(row.videoId);row.pk_video=(await selectOne(ctx.db,'urt_video_duration',{videoId:row.videoId}))!.pk_video; } }
  if (!wouldCallApi) return { mode: 'execute', selected: rows.length, wouldCallApi, apiAttempts: 0, applied, skipped, enqueued };
  await ctx.assertOwnership(); let details: Awaited<ReturnType<SourceJobContext['youtube']['videoContentDetails']>>;
  try { details=await ctx.youtube.videoContentDetails(rows.map(r => r.videoId)); }
  catch(error) {
    if(isRunStoppingYoutubeError(error))return {mode:'execute',selected:rows.length,apiAttempts:ctx.youtube.attemptsMade,applied,skipped,enqueued,stoppedReason:error.code};
    // Laravel api_batch_failed: any other request failure gives the batch the five-minute retry cooldown.
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
