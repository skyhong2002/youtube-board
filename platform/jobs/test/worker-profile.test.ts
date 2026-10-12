import {it,expect} from 'vitest';
import {registeredWorkflows} from '../src/workflow-registry.js';
import {VOCABULARY_JOB} from '../src/vocabulary.js';
import {workerProfile,assertWorkerEndpoint} from '../../shared/worker-schema.js';
import {consumerQueue,workflowQueueName,assertQueueJob} from '../src/queue-scope.js';
it('every executable registry workflow and vocabulary synchronization has a profile',()=>{
 for(const name of [...registeredWorkflows,VOCABULARY_JOB])expect(()=>workerProfile(name),name).not.toThrow();
});
it('vocabulary synchronization uses the same partition for producer and exact consumer',()=>{
 const env={TS_WORKER_SCHEMA_MODE:'facade',TS_WORKER_WORKFLOW:VOCABULARY_JOB},scope=consumerQueue(env);expect(scope.workflow).toBe(VOCABULARY_JOB);expect(scope.name).toBe(workflowQueueName(VOCABULARY_JOB,env));expect(()=>assertQueueJob(scope,VOCABULARY_JOB,env)).not.toThrow();expect(()=>assertQueueJob(scope,'tags.vocabulary.import',env)).toThrow();
});
it('production worker facade requires an explicit approved DB endpoint, independent of account origin',()=>{
 const env={APP_ENV:'production',DB_HOST:'worker-db.internal',TS_WORKER_DATABASE_HOST:'worker-db.internal'};expect(()=>assertWorkerEndpoint(env,'worker-db.internal')).not.toThrow();for(const patch of [{DB_HOST:undefined},{TS_WORKER_DATABASE_HOST:undefined},{TS_WORKER_DATABASE_HOST:'elsewhere'},{TS_WORKER_DATABASE_HOST:'bad host'}])expect(()=>assertWorkerEndpoint({...env,...patch},'worker-db.internal')).toThrow();expect(()=>assertWorkerEndpoint({APP_ENV:'test'},'127.0.0.1')).not.toThrow();
});
