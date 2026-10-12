import { it, expect, vi } from 'vitest';
import { runScheduleCycle, type ScheduleConfig } from '../src/scheduler.js';
import { requestWorkflowShutdown } from '../../shared/shutdown.js';
import { QueueInputConflict, type redisConnection } from '../src/worker.js';
it('shutdown never reclassifies a possibly accepted submission as unattempted', async () => {
 const config: ScheduleConfig = { version: 1, timezone: 'Asia/Taipei', schedules: ['first','second','third'].map(id => ({id, workflow:'youtube.videos.stats',cron:'* * * * *', options:{limit:1}})) };
 const env={APP_ENV:'test',TS_INGESTION_ENABLED:'true',TS_SCHEDULER_ENABLED:'true',TS_INGESTION_OWNERS:'youtube.videos.stats'};
 const redis={ping:async()=> 'PONG',get:async()=>null,xadd:vi.fn().mockResolvedValue('1-0'),eval:vi.fn(),quit:async()=>{},disconnect(){}};
 const enqueue=vi.fn(async()=>{requestWorkflowShutdown();throw new QueueInputConflict('unknown','SUBMISSION_UNOBSERVED','ambiguous-id');});
 const result=await runScheduleCycle(config,env,new Date('2032-01-01T00:00:00Z'),(()=>redis) as unknown as typeof redisConnection,enqueue);
 expect(result.aborted).toBe(true);expect(result.runs).toHaveLength(6);
 expect(result.runs[0]).toMatchObject({state:'SUBMISSION_UNOBSERVED',queueId:'ambiguous-id'});
 expect(result.runs.slice(1).every(run=>run.state==='SHUTDOWN_ABORTED')).toBe(true);
 expect(enqueue).toHaveBeenCalledTimes(1);expect(redis.eval).not.toHaveBeenCalled();
});
