import {workerProfile} from '../../shared/worker-schema.js';
import {expect,it} from 'vitest';
import {mkdtemp,writeFile,symlink,utimes,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {backupReceipt,runQualityCommand} from '../src/quality-cli.js';
const sha='a'.repeat(64);
const proof=(now:Date)=>({status:'passed',archiveSha256:sha,database:'youtube_board_ts',capturedAt:now.toISOString(),targetServer:{host:'db',server_id:1,port:3306},offhost:{host:'local',originHost:'prod',archiveSha256Verified:true},productionOperations:false,sourceRowsRestored:false,rows:{allCountsAndMultisetSha256Exact:true},principals:{authenticationDefinitionsExact:true,grantMultisetsExact:true},schemaMetadataExact:true,triggerDefinitionsExact:true,triggerBehaviorExact:true,probeRowsRolledBack:true,cloneRemoved:true});
it('requires independent action gates, including a ready rollback gate before activation',async()=>{
 const env={APP_ENV:'test',TS_INGESTION_ENABLED:'true',TS_INGESTION_OWNERS:'tags.vocabulary.sync'},base=['--id=youtube-quality-20261013-unit','--parent=parent','--implementation='+'a'.repeat(40),'--execute'];
 for(const action of ['stage','activate','rollback'])await expect(runQualityCommand(['vocabulary:quality:'+action,...base],env)).rejects.toThrow('ownership');
 await expect(runQualityCommand(['vocabulary:quality:activate',...base],{...env,TS_INGESTION_OWNERS:env.TS_INGESTION_OWNERS+',tags.vocabulary.quality-activate'})).rejects.toThrow('ownership');
});
it('requires a regular bounded absolute receipt with fresh content time, not merely touched mtime',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'yt-quality-proof-test-')),path=join(dir,'proof.json'),now=new Date();
 try{
  await writeFile(path,JSON.stringify(proof(now)));expect(await backupReceipt(path,sha,now)).toMatchObject({archiveSha256:sha,database:'youtube_board_ts',capturedAt:now.toISOString()});
  await symlink(path,join(dir,'link'));await expect(backupReceipt(join(dir,'link'),sha,now)).rejects.toThrow('regular');
  await expect(backupReceipt('relative.json',sha,now)).rejects.toThrow('absolute');
  await writeFile(path,'x'.repeat(1024*1024+1));await expect(backupReceipt(path,sha,now)).rejects.toThrow('bounded');
  await writeFile(path,'{invalid');await expect(backupReceipt(path,sha,now)).rejects.toThrow('valid JSON');
  await writeFile(path,JSON.stringify(proof(new Date(+now-7*3600000))));await expect(backupReceipt(path,sha,now)).rejects.toThrow('capturedAt');
  await writeFile(path,JSON.stringify(proof(now)));await utimes(path,new Date(+now+120000),new Date(+now+120000));await expect(backupReceipt(path,sha,now)).rejects.toThrow('recent');
 }finally{await rm(dir,{recursive:true,force:true});}
});

it('keeps quality audit rights in a distinct operator profile without expanding normal vocabulary sync',()=>{
 expect(workerProfile('tags.vocabulary.sync').tables).not.toHaveProperty('ts_job_runs');
 const profile=workerProfile('tags.vocabulary.quality');expect(profile.tables.ts_job_runs).toEqual(['INSERT','SELECT']);
 expect(Object.keys(profile.tables).sort()).toEqual(['ts_job_runs','ts_vocabulary_current','ts_vocabulary_runs','ts_vocabulary_stage']);
});
