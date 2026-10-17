import {it,expect,vi,beforeEach} from 'vitest';
import {createHash} from 'node:crypto';
const mocks=vi.hoisted(()=>({queueConstruct:vi.fn(),workerConstruct:vi.fn(),getJob:vi.fn(),add:vi.fn(),close:vi.fn(),quit:vi.fn(),eval:vi.fn(),execute:vi.fn()}));
vi.mock('bullmq',()=>({Queue:class{constructor(...args:unknown[]){mocks.queueConstruct(...args);}getJob=mocks.getJob;add=mocks.add;close=mocks.close;},Worker:class{constructor(...args:unknown[]){mocks.workerConstruct(...args);}close=mocks.close;}}));
vi.mock('ioredis',()=>({Redis:class{quit=mocks.quit;eval=mocks.eval;disconnect(){}on(){}}}));
vi.mock('../src/workflow-registry.js',async original=>({...await original<typeof import('../src/workflow-registry.js')>(),executeRegisteredWorkflow:mocks.execute}));
import {startWorker,enqueueWorkflow,workflowQueueStatus} from '../src/worker.js';
import {tickSchedules,type ScheduleConfig} from '../src/scheduler.js';

const gates={APP_ENV:'test',TS_INGESTION_ENABLED:'true',TS_SCHEDULER_ENABLED:'true'};
const cacheWorker={...gates,TS_WORKER_SCHEMA_MODE:'facade',DB_DATABASE:'youtube_board_ts_worker_cache_rewrite',TS_WORKER_BATCH:'cache',TS_INGESTION_OWNERS:'reports.counts.build,reports.live.build'};
beforeEach(()=>{vi.resetAllMocks();mocks.close.mockResolvedValue(undefined);mocks.quit.mockResolvedValue(undefined);mocks.eval.mockResolvedValue(2);mocks.getJob.mockResolvedValue(undefined);mocks.add.mockImplementation(async(name:string,data:unknown,opts:{jobId:string})=>({id:opts.jobId,name,data,getState:async()=>'waiting'}));mocks.execute.mockResolvedValue({status:'completed'});});

it('a batch worker consumes one serial batch queue and refuses jobs outside its batch before execution',async()=>{
 const handle=startWorker(cacheWorker);
 const [name,consume,options]=mocks.workerConstruct.mock.calls[0] as [string,(job:unknown)=>Promise<unknown>,{concurrency:number;maxStalledCount:number}];
 expect(name).toBe('youtube-board-ts-batch-cache');expect(options).toMatchObject({concurrency:1,maxStalledCount:0});
 for(const job of ['youtube.videos.stats','ai.daily','tags.vocabulary.sync'])await expect(consume({name:job,data:{options:{}}})).rejects.toThrow('does not match consumer batch');
 expect(mocks.execute).not.toHaveBeenCalled();
 await consume({name:'reports.live.clean',data:{options:{limit:1}}});
 // Gates are rechecked by the dispatcher for every dequeued job with the worker environment.
 expect(mocks.execute).toHaveBeenCalledWith('reports.live.clean',{options:{limit:1}},cacheWorker);
 await handle.close();
});

it('a batch worker does not start unless one of its own workflows is authorized',()=>{
 expect(()=>startWorker({...cacheWorker,TS_INGESTION_OWNERS:'youtube.videos.stats'})).toThrow('No authorized scheduled workflow');
 expect(()=>startWorker({...cacheWorker,TS_WORKER_WORKFLOW:'reports.counts.build'})).toThrow();
 expect(mocks.workerConstruct).not.toHaveBeenCalled();
});

it('producers route to the owning batch queue with the same deterministic queue identity and gates',async()=>{
 const producer={...gates,TS_QUEUE_MODE:'batch',TS_INGESTION_OWNERS:'reports.counts.build,youtube.videos.stats'};
 const cache=await enqueueWorkflow('reports.counts.build','run-1',{options:{limit:100}},producer);
 const source=await enqueueWorkflow('youtube.videos.stats','run-1',{options:{limit:25}},producer);
 expect(mocks.queueConstruct.mock.calls.map(c=>c[0])).toEqual(['youtube-board-ts-batch-cache','youtube-board-ts-batch-youtube-source']);
 expect(cache.id).toBe(createHash('sha256').update(JSON.stringify(['reports.counts.build','run-1'])).digest('hex'));expect(source.id).not.toBe(cache.id);
 expect(mocks.add.mock.calls[0]?.[2]).toMatchObject({attempts:1});
 await expect(enqueueWorkflow('reports.live.clean','run-1',{options:{}},producer)).rejects.toThrow('ownership');
 await expect(enqueueWorkflow('tags.vocabulary.sync','run-1',{options:{since:'2026-10-10T00:00:00Z',until:'2026-10-11T00:00:00Z'}},{...producer,TS_INGESTION_OWNERS:'tags.vocabulary.sync'})).rejects.toThrow('not assigned to a worker batch');
 expect(mocks.add).toHaveBeenCalledTimes(2);
});

it('the scheduler enqueues each due entry into its batch queue and validates routes before any mutation',async()=>{
 const config:ScheduleConfig={version:1,timezone:'Asia/Taipei',schedules:[
  {id:'counts',workflow:'reports.counts.build',cron:'* * * * *',options:{limit:100}},
  {id:'stats',workflow:'youtube.videos.stats',cron:'* * * * *',options:{limit:25}},
  {id:'hourly',workflow:'ai.hourly',cron:'* * * * *',options:{}},
 ]};
 const producer={...gates,TS_QUEUE_MODE:'batch',TS_INGESTION_OWNERS:'reports.counts.build,youtube.videos.stats,ai.hourly'};
 const runs=await tickSchedules(config,producer,new Date('2032-01-01T00:00:00Z'),1);
 expect(runs.map(r=>[r.schedule,r.queue,r.state])).toEqual([['counts','youtube-board-ts-batch-cache','waiting'],['stats','youtube-board-ts-batch-youtube-source','waiting'],['hourly','youtube-board-ts-batch-ai-hourly','waiting']]);
 expect(mocks.queueConstruct.mock.calls.map(c=>c[0])).toEqual(runs.map(r=>r.queue));
 const enqueue=vi.fn();
 await expect(tickSchedules(config,{...producer,TS_WORKER_BATCH:'cache'},new Date(),1,enqueue)).rejects.toThrow('declared worker batch');
 await expect(tickSchedules({...config,schedules:[...config.schedules,{id:'vocab',workflow:'tags.vocabulary.sync',cron:'0 1 * * *',options:{},window:'previous-day'}]},{...producer,TS_INGESTION_OWNERS:producer.TS_INGESTION_OWNERS+',tags.vocabulary.sync'},new Date(),1,enqueue)).rejects.toThrow('not assigned to a worker batch');
 expect(enqueue).not.toHaveBeenCalled();
});

it('status lookups search only owned batch queues and reject a job from another batch',async()=>{
 const producer={...gates,TS_QUEUE_MODE:'batch',TS_INGESTION_OWNERS:'reports.counts.build,ai.hourly'},id='a'.repeat(64);
 mocks.getJob.mockResolvedValueOnce(undefined).mockResolvedValueOnce({name:'ai.hourly',returnvalue:{status:'completed'},timestamp:1,attemptsMade:1,getState:async()=>'completed'});
 expect(await workflowQueueStatus(id,producer)).toMatchObject({workflow:'ai.hourly',state:'completed'});
 expect(mocks.queueConstruct.mock.calls.map(c=>c[0])).toEqual(['youtube-board-ts-batch-cache','youtube-board-ts-batch-ai-hourly']);
 mocks.getJob.mockResolvedValueOnce({name:'ai.hourly',getState:async()=>'completed'});
 await expect(workflowQueueStatus(id,producer)).rejects.toThrow('profile mismatch');
});
