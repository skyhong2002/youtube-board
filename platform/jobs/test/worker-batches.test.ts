import {describe,it,expect} from 'vitest';
import {registeredWorkflows} from '../src/workflow-registry.js';
import {workerBatches,workerBatchIds,batchWorkflows,workflowBatch,batchFacadeSchema,batchPrincipal,batchQueueName} from '../../shared/worker-batches.js';
import {batchProfile,workerProfile,workerSchema} from '../../shared/worker-schema.js';
import {assertQueueJob,consumerQueue,queueMode,schedulerNamespace,statusQueues,workflowQueueName} from '../src/queue-scope.js';

const expected={
 cache:['reports.counts.build','reports.people.build','reports.tag_cloud.build','reports.tag_date.build','reports.keywords.cache','reports.schedule.build','reports.live.build','reports.live.clean','reports.channel_cloud.build','reports.keyword_cloud.build','reports.keyword_relations.build','tags.videos.match.recent','channels.avatars.refresh'],
 'youtube-source':['youtube.channels.stats','youtube.channels.videos.general','youtube.channels.videos.live','youtube.channels.videos.live_group','youtube.tvbs.videos','youtube.videos.stats','youtube.videos.duration','youtube.live.cleanup','youtube.tag_videos.backfill'],
 'youtube-live':['youtube.live.poll','youtube.tvbs.live.poll'],
 comments:['youtube.comments.queue','youtube.comments.fetch'],
 'ai-daily':['ai.daily','ai.daily.catchup','ai.channel','reports.ai_topic.build','ai.days_refresh'],
 'ai-hourly':['ai.hourly'],
 'ai-mayor':['ai.mayor_person'],
 telegram:['notify.telegram.hourly','notify.telegram.daily'],
};
const union=(workflows:readonly string[])=>{const tables:Record<string,string[]>={};for(const w of workflows)for(const[t,r]of Object.entries(workerProfile(w).tables))tables[t]=[...new Set([...(tables[t]??[]),...r])].sort();return tables;};
const facadeEnv=(batch:string,patch:NodeJS.ProcessEnv={})=>({TS_WORKER_SCHEMA_MODE:'facade',DB_DATABASE:batchFacadeSchema(batch),TS_WORKER_BATCH:batch,...patch});

describe('worker batch registry',()=>{
 it('maps the handoff batches to their TS workflows, each workflow in exactly one batch',()=>{
  expect(Object.fromEntries(workerBatchIds.map(b=>[b,[...workerBatches[b]]]))).toEqual(expected);
  const all=workerBatchIds.flatMap(b=>workerBatches[b]);expect(new Set(all).size).toBe(all.length);
  for(const workflow of all){expect(registeredWorkflows,workflow).toContain(workflow);expect(()=>workerProfile(workflow)).not.toThrow();expect(workflowBatch(workflow)).toBe(workerBatchIds.find(b=>workerBatches[b].includes(workflow)));}
  // Operator-only repairs, vocabulary synchronization and retired Laravel jobs are never batch-routed.
  // reports.channel_cloud.build was retired with Laravel but came back on 2026-10-20 to fill the empty channel clouds.
  for(const workflow of ['youtube.comments.reset','youtube.channels.adopt','youtube.channels.retire','tags.vocabulary.sync','tags.vocabulary.import','reports.groups.build','reports.keywords.build','__proto__'])expect(workflowBatch(workflow),workflow).toBeNull();
  for(const bad of ['unknown','__proto__','toString','Cache',''])expect(()=>batchWorkflows(bad)).toThrow('Unknown worker batch');
  expect(Object.isFrozen(workerBatches)&&Object.isFrozen(workerBatches.cache)).toBe(true);
 });
 it('derives valid facade schema, principal and queue names per batch',()=>{
  expect(workerBatchIds.map(b=>[batchFacadeSchema(b),batchPrincipal(b),batchQueueName(b)])).toContainEqual(['youtube_board_ts_worker_youtube_source','youtube_ts_w_youtube_source','youtube-board-ts-batch-youtube-source']);
  for(const b of workerBatchIds){expect(batchFacadeSchema(b)).toMatch(/^youtube_board_ts_worker_[a-z0-9_]+$/);expect(batchPrincipal(b)).toMatch(/^youtube_ts_w_[a-z0-9_]{1,19}$/);expect(batchQueueName(b)).not.toMatch(/:/);}
  expect(new Set(workerBatchIds.map(batchQueueName)).size).toBe(workerBatchIds.length);expect(()=>batchFacadeSchema('nope')).toThrow();
 });
 it('grants each batch the table-level union of its profiles, including cross-batch dependencies',()=>{
  for(const b of workerBatchIds){const profile=batchProfile(b);expect(profile.tables).toEqual(union(workerBatches[b]));for(const rights of Object.values(profile.tables))for(const r of rights)expect(['SELECT','INSERT','UPDATE','DELETE']).toContain(r);}
  // ai.daily runs the tag-video backfill and the channel stage; ai.hourly refreshes general channel videos.
  const includes=(batch:string,dependency:string)=>{const tables=batchProfile(batch).tables;for(const[t,r]of Object.entries(workerProfile(dependency).tables))expect(tables[t],batch+' '+t).toEqual(expect.arrayContaining(r));};
  includes('ai-daily','youtube.tag_videos.backfill');includes('ai-daily','ai.channel');includes('ai-hourly','youtube.channels.videos.general');
  expect(batchProfile('ai-daily').dependencies).toEqual(expect.arrayContaining(['ai.channel','youtube.tag_videos.backfill']));
  expect(batchProfile('ai-daily').tables.ingestion_youtube_quota_daily).toContain('UPDATE');
  // Derived caches never need comment, quota or Laravel lock rights; source fetchers never touch Telegram state.
  for(const t of ['urt_comment','ingestion_youtube_quota_daily','cache_locks'])expect(batchProfile('cache').tables,t).not.toHaveProperty(t);
  // People rotation reads Laravel's politician group and tag max counts, read-only.
  for(const t of ['tag_group','tags'])expect(batchProfile('cache').tables[t],t).toEqual(['SELECT']);
  expect(Object.keys(batchProfile('youtube-source').tables).some(t=>t.startsWith('telegram_'))).toBe(false);
 });
 it('binds one batch facade carrying the union; single-workflow facades keep their exact shape',()=>{
  const schema=workerSchema(facadeEnv('ai-daily'))!;
  expect(schema).toMatchObject({facade:'youtube_board_ts_worker_ai_daily',workflow:null,batch:'ai-daily',workflows:expected['ai-daily'],tables:batchProfile('ai-daily').tables});
  for(const[t,target]of Object.entries(schema.mapping))expect(target).toEqual({schema:t.startsWith('ts_')?'youtube_board_ts':'youtube_board',table:t});
  expect(workerSchema(facadeEnv('cache',{DB_DATABASE:'youtube_board_ts_worker_cache_rewrite'}))?.facade).toBe('youtube_board_ts_worker_cache_rewrite');
  expect(workerSchema(facadeEnv('cache',{TS_LARAVEL_LOCK_STORE:'database'}))?.tables.cache_locks).toEqual(['SELECT','INSERT','UPDATE','DELETE']);
  expect(()=>workerSchema(facadeEnv('cache',{TS_WORKER_WORKFLOW:'reports.counts.build'}))).toThrow('either one workflow or one batch');
  for(const facade of ['youtube_board_ts_worker_comments','youtube_board_ts_worker','youtube_board_ts_worker_cachex'])expect(()=>workerSchema(facadeEnv('cache',{DB_DATABASE:facade}))).toThrow('does not belong');
  expect(()=>workerSchema(facadeEnv('nope',{DB_DATABASE:'youtube_board_ts_worker_nope'}))).toThrow('Unknown worker batch');
  const single=workerSchema({TS_WORKER_SCHEMA_MODE:'facade',DB_DATABASE:'youtube_board_ts_worker_recent',TS_WORKER_WORKFLOW:'tags.videos.match.recent'})!;
  expect(Object.keys(single).sort()).toEqual(['dependencies','facade','mapping','source','state','tables','workflow']);expect(single.workflow).toBe('tags.videos.match.recent');expect(single.tables).toEqual(workerProfile('tags.videos.match.recent').tables);
 });
});

describe('batch queue routing',()=>{
 const producer={TS_QUEUE_MODE:'batch'};
 it('selects batch mode explicitly or from a batch facade, and refuses ambiguous scopes',()=>{
  expect(queueMode(facadeEnv('cache'))).toBe('batch');expect(queueMode(producer)).toBe('batch');
  expect(queueMode({TS_WORKER_SCHEMA_MODE:'facade',TS_WORKER_WORKFLOW:'tags.videos.match.recent'})).toBe('workflow');expect(queueMode({})).toBe('shared');
  for(const env of [{...facadeEnv('cache'),TS_QUEUE_MODE:'workflow'},{...facadeEnv('cache'),TS_QUEUE_MODE:'shared'},{TS_QUEUE_MODE:'batch',TS_WORKER_WORKFLOW:'youtube.videos.stats'},{TS_WORKER_BATCH:'cache'},{TS_QUEUE_MODE:'batches'}])expect(()=>queueMode(env)).toThrow('Invalid worker queue isolation mode');
 });
 it('routes every batch workflow to its batch queue and fails closed for unassigned workflows',()=>{
  for(const b of workerBatchIds)for(const w of workerBatches[b])expect(workflowQueueName(w,producer),w).toBe(batchQueueName(b));
  for(const w of ['tags.vocabulary.sync','youtube.comments.reset'])expect(()=>workflowQueueName(w,producer)).toThrow('not assigned to a worker batch');
  expect(()=>workflowQueueName('unknown',producer)).toThrow();
  // Existing modes are unchanged.
  expect(workflowQueueName('youtube.videos.stats',{})).toBe('youtube-board-ts');expect(workflowQueueName('youtube.videos.stats',{TS_QUEUE_MODE:'workflow'})).toMatch(/^youtube-board-ts-wf-[a-f0-9]{24}$/);
 });
 it('a batch consumer accepts exactly its own workflows from its own queue',()=>{
  const env=facadeEnv('cache'),scope=consumerQueue(env);expect(scope).toEqual({name:'youtube-board-ts-batch-cache',workflow:null,batch:'cache'});
  for(const w of expected.cache)expect(()=>assertQueueJob(scope,w,env)).not.toThrow();
  for(const w of ['youtube.videos.stats','ai.daily','notify.telegram.hourly','tags.vocabulary.sync','unknown'])expect(()=>assertQueueJob(scope,w,env),w).toThrow();
  expect(()=>assertQueueJob({...scope,name:batchQueueName('comments')},'reports.counts.build',env)).toThrow('does not match consumer batch');
  expect(()=>consumerQueue({TS_QUEUE_MODE:'batch'})).toThrow('Unknown worker batch');
 });
 it('keeps scheduler watermarks and status lookups within the batch topology',()=>{
  expect(schedulerNamespace(producer)).toBe('youtube-board-ts-batch-queues');expect(schedulerNamespace(facadeEnv('cache'))).toBe('youtube-board-ts-batch-cache');
  expect(new Set([schedulerNamespace(producer),schedulerNamespace({}),schedulerNamespace({TS_QUEUE_MODE:'workflow'})]).size).toBe(3);
  const queues=statusQueues(producer,['reports.counts.build','reports.live.clean','ai.hourly']);
  expect(queues.map(q=>q.name)).toEqual(['youtube-board-ts-batch-cache','youtube-board-ts-batch-ai-hourly']);
  expect(queues[0]!.accepts('reports.live.clean')).toBe(true);expect(queues[0]!.accepts('ai.hourly')).toBe(false);
  expect(statusQueues(facadeEnv('telegram'),[]).map(q=>q.name)).toEqual(['youtube-board-ts-batch-telegram']);
  expect(statusQueues({},['x'])[0]!.accepts('anything')).toBe(true);
 });
});
