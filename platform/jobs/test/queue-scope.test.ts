import {it,expect,vi} from 'vitest';
import {assertQueueJob,consumerQueue,workflowQueueName,schedulerNamespace} from '../src/queue-scope.js';
import {tickSchedules,type ScheduleConfig} from '../src/scheduler.js';
it('each facade consumer matches exactly one workflow and producer queue',()=>{
 const env={TS_WORKER_SCHEMA_MODE:'facade',TS_WORKER_WORKFLOW:'youtube.videos.stats'},scope=consumerQueue(env);
 expect(scope.name).toBe(workflowQueueName('youtube.videos.stats',env));expect(scope.name).not.toBe(workflowQueueName('youtube.channels.stats',env));
 expect(()=>assertQueueJob(scope,'youtube.channels.stats',env)).toThrow('does not match');expect(()=>assertQueueJob({...scope,name:'youtube-board-ts'},'youtube.videos.stats',env)).toThrow('does not match');expect(()=>assertQueueJob(scope,'youtube.videos.stats',env)).not.toThrow();
 expect(()=>consumerQueue({TS_WORKER_SCHEMA_MODE:'facade'})).toThrow();expect(()=>consumerQueue({...env,TS_QUEUE_MODE:'shared'})).toThrow();
});
it('shared queue compatibility is explicit and scheduler watermarks do not overlap partitions',()=>{
 expect(consumerQueue({APP_ENV:'test'})).toEqual({name:'youtube-board-ts',workflow:null});expect(workflowQueueName('legacy-local-job',{})).toBe('youtube-board-ts');expect(()=>consumerQueue({TS_QUEUE_MODE:'typo'})).toThrow();
 expect(schedulerNamespace({})).toBe('youtube-board-ts');expect(schedulerNamespace({TS_QUEUE_MODE:'workflow'})).not.toBe('youtube-board-ts');expect(schedulerNamespace({TS_QUEUE_MODE:'workflow',TS_WORKER_WORKFLOW:'youtube.videos.stats'})).not.toBe(schedulerNamespace({TS_QUEUE_MODE:'workflow',TS_WORKER_WORKFLOW:'youtube.channels.stats'}));
});
it('profile-specific scheduler rejects another workflow before any queue mutation',async()=>{
 const enqueue=vi.fn(),config:ScheduleConfig={version:1,timezone:'Asia/Taipei',schedules:[{id:'x',workflow:'youtube.channels.stats',cron:'* * * * *',options:{limit:1}}]},env={APP_ENV:'test',TS_INGESTION_ENABLED:'true',TS_SCHEDULER_ENABLED:'true',TS_INGESTION_OWNERS:'youtube.channels.stats',TS_QUEUE_MODE:'workflow',TS_WORKER_WORKFLOW:'youtube.videos.stats'};
 await expect(tickSchedules(config,env,new Date(),1,enqueue)).rejects.toThrow('does not match');expect(enqueue).not.toHaveBeenCalled();
});
