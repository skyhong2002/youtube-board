import {createHash} from 'node:crypto';
import {workerProfile} from '../../shared/worker-schema.js';
import {batchQueueName,batchWorkflows,workflowBatch,workerBatchIds} from '../../shared/worker-batches.js';
/**
 * `shared`: one local queue. `workflow`: one queue per workflow (single-workflow facades).
 * `batch`: one serial queue per handoff batch (shared/worker-batches.ts); producers route every workflow to the
 * queue of the batch that owns it and a batch worker (TS_WORKER_BATCH) consumes only that queue.
 */
export type QueueMode='shared'|'workflow'|'batch';
export function queueMode(env:NodeJS.ProcessEnv):QueueMode{
 const facade=env.TS_WORKER_SCHEMA_MODE==='facade';
 const mode=env.TS_QUEUE_MODE??(facade?(env.TS_WORKER_BATCH?'batch':'workflow'):'shared');
 if(!['shared','workflow','batch'].includes(mode)||facade&&mode==='shared')throw new Error('Invalid worker queue isolation mode');
 if(env.TS_WORKER_BATCH&&mode!=='batch'||mode==='batch'&&env.TS_WORKER_WORKFLOW)throw new Error('Invalid worker queue isolation mode');
 return mode as QueueMode;
}
export function partitionedQueues(env:NodeJS.ProcessEnv){return queueMode(env)!=='shared';}
export function workflowQueueName(workflow:string,env:NodeJS.ProcessEnv){
 const mode=queueMode(env);if(mode==='shared')return 'youtube-board-ts';workerProfile(workflow);
 if(mode==='batch'){const batch=workflowBatch(workflow);if(!batch)throw new Error('Workflow is not assigned to a worker batch');return batchQueueName(batch);}
 return 'youtube-board-ts-wf-'+createHash('sha256').update(workflow).digest('hex').slice(0,24);
}
export interface ConsumerQueue {name:string;workflow:string|null;batch?:string}
export function consumerQueue(env:NodeJS.ProcessEnv):ConsumerQueue{
 const mode=queueMode(env);if(mode==='shared')return {name:'youtube-board-ts',workflow:null};
 if(mode==='batch'){const batch=env.TS_WORKER_BATCH??'';batchWorkflows(batch);return {name:batchQueueName(batch),workflow:null,batch};}
 const workflow=env.TS_WORKER_WORKFLOW??'';workerProfile(workflow);return {name:workflowQueueName(workflow,env),workflow};
}
/** Rejects a dequeued job outside the consumer's workflow or batch before any gate, source or DB access. */
export function assertQueueJob(queue:ConsumerQueue,workflow:string,env:NodeJS.ProcessEnv){
 if(queue.batch!==undefined){if(!batchWorkflows(queue.batch).includes(workflow)||queue.name!==workflowQueueName(workflow,env))throw new Error('Workflow does not match consumer batch queue and database profile');return;}
 if(queue.workflow!==null&&(workflow!==queue.workflow||queue.name!==workflowQueueName(workflow,env)))throw new Error('Workflow does not match consumer queue and database profile');
}
/** Queues that may hold a given queue ID, for read-only status lookups. */
export function statusQueues(env:NodeJS.ProcessEnv,owners:Iterable<string>):Array<{name:string;accepts:(workflow:string)=>boolean}>{
 const mode=queueMode(env);if(mode==='shared')return [{name:'youtube-board-ts',accepts:()=>true}];
 if(mode==='batch'){
  const batches=env.TS_WORKER_BATCH?[env.TS_WORKER_BATCH]:workerBatchIds.filter(batch=>[...owners].some(owner=>workflowBatch(owner)===batch));
  return batches.map(batch=>{const workflows=batchWorkflows(batch);return {name:batchQueueName(batch),accepts:(workflow:string)=>workflows.includes(workflow)};});
 }
 const workflows=env.TS_WORKER_WORKFLOW?[env.TS_WORKER_WORKFLOW]:[...owners];
 return workflows.map(workflow=>({name:workflowQueueName(workflow,env),accepts:(name:string)=>name===workflow}));
}
export function schedulerNamespace(env:NodeJS.ProcessEnv){
 const mode=queueMode(env);if(mode==='shared')return 'youtube-board-ts';
 if(mode==='batch')return env.TS_WORKER_BATCH?batchQueueName(env.TS_WORKER_BATCH):'youtube-board-ts-batch-queues';
 return env.TS_WORKER_WORKFLOW?workflowQueueName(env.TS_WORKER_WORKFLOW,env):'youtube-board-ts-workflow-queues';
}
