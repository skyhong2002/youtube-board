/**
 * Production worker topology (docs/laravel-scheduler-handoff-2026-10-18.md): one facade schema, one DB
 * principal, one serial queue and one worker process per handoff batch. Jobs of a batch run one at a
 * time in arrival order, as under the Laravel scheduler.
 *
 * `tags.videos.match.recent` and `channels.avatars.refresh` (systemd timers via ts-worker.py today) belong
 * to `cache`: they derive TS-owned data (keyword evidence, avatar derivatives) from already-ingested rows,
 * use no YouTube Data API quota and no Laravel-written tables, and already share one host lock with each
 * other. Putting them in `youtube-source` would queue a multi-minute matcher sweep in front of the
 * every-minute live polls and quota-bound fetches.
 */
const batches={
 cache:['reports.counts.build','reports.people.build','reports.tag_cloud.build','reports.tag_date.build','reports.keywords.cache','reports.schedule.build','reports.live.build','reports.live.clean','tags.videos.match.recent','channels.avatars.refresh'],
 'youtube-source':['youtube.channels.stats','youtube.channels.videos.general','youtube.channels.videos.live','youtube.channels.videos.live_group','youtube.tvbs.videos','youtube.videos.stats','youtube.videos.duration','youtube.live.cleanup','youtube.tag_videos.backfill'],
 // Minute live polls get their own serial queue: under Laravel they ran beside slower fetches, and a
 // multi-minute statistics or discovery run must not delay them.
 'youtube-live':['youtube.live.poll','youtube.tvbs.live.poll'],
 comments:['youtube.comments.queue','youtube.comments.fetch'],
 'ai-daily':['ai.daily','ai.daily.catchup','ai.channel','reports.ai_topic.build'],
 'ai-hourly':['ai.hourly'],
 'ai-mayor':['ai.mayor_person'],
 telegram:['notify.telegram.hourly','notify.telegram.daily'],
};
export type WorkerBatch=keyof typeof batches;
export const workerBatches:Readonly<Record<WorkerBatch,readonly string[]>>=Object.freeze(Object.fromEntries(Object.entries(batches).map(([batch,workflows])=>[batch,Object.freeze([...workflows])])) as Record<WorkerBatch,readonly string[]>);
export const workerBatchIds=Object.freeze(Object.keys(workerBatches) as WorkerBatch[]);

export function isWorkerBatch(value:unknown):value is WorkerBatch{return typeof value==='string'&&Object.hasOwn(workerBatches,value);}
export function batchWorkflows(batch:string):readonly string[]{if(!isWorkerBatch(batch))throw new Error('Unknown worker batch');return workerBatches[batch];}
/** The single batch whose queue and worker own a workflow, or null when no batch schedules it. */
export function workflowBatch(workflow:string):WorkerBatch|null{return workerBatchIds.find(batch=>workerBatches[batch].includes(workflow))??null;}
const suffix=(batch:string)=>{batchWorkflows(batch);return batch.replace(/-/g,'_');};
/** Facade schema and principal names; the local isolated lane appends `_rewrite` to the schema. */
export const batchFacadeSchema=(batch:string)=>'youtube_board_ts_worker_'+suffix(batch);
export const batchPrincipal=(batch:string)=>'youtube_ts_w_'+suffix(batch);
export const batchQueueName=(batch:string)=>{batchWorkflows(batch);return 'youtube-board-ts-batch-'+batch;};
// Rights union per batch: batchProfile() in worker-schema.ts.

