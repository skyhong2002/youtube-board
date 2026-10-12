import {createHash} from 'node:crypto';
import {workerProfile} from '../../shared/worker-schema.js';
export function partitionedQueues(env:NodeJS.ProcessEnv){
 const mode=env.TS_QUEUE_MODE??(env.TS_WORKER_SCHEMA_MODE==='facade'?'workflow':'shared');
 if(!['shared','workflow'].includes(mode)||env.TS_WORKER_SCHEMA_MODE==='facade'&&mode!=='workflow')throw new Error('Invalid worker queue isolation mode');return mode==='workflow';
}
export function workflowQueueName(workflow:string,env:NodeJS.ProcessEnv){
 if(!partitionedQueues(env))return 'youtube-board-ts';workerProfile(workflow);return 'youtube-board-ts-wf-'+createHash('sha256').update(workflow).digest('hex').slice(0,24);
}
export function consumerQueue(env:NodeJS.ProcessEnv){
 if(!partitionedQueues(env))return {name:'youtube-board-ts',workflow:null};const workflow=env.TS_WORKER_WORKFLOW??'';workerProfile(workflow);return {name:workflowQueueName(workflow,env),workflow};
}
export function assertQueueJob(queue:{name:string;workflow:string|null},workflow:string,env:NodeJS.ProcessEnv){
 if(queue.workflow!==null&&(workflow!==queue.workflow||queue.name!==workflowQueueName(workflow,env)))throw new Error('Workflow does not match consumer queue and database profile');
}
export function schedulerNamespace(env:NodeJS.ProcessEnv){return !partitionedQueues(env)?'youtube-board-ts':env.TS_WORKER_WORKFLOW?workflowQueueName(env.TS_WORKER_WORKFLOW,env):'youtube-board-ts-workflow-queues';}
