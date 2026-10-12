import { it,expect } from 'vitest';
import { cacheCommands,validateCacheArguments,executeCacheWorkflow } from '../src/cache-cli.js';
const now=new Date('2026-10-12T00:00:00Z');
it('cache queue/CLI validator rejects unknown, duplicate, overcap and conflicting flags before I/O',()=>{
 for(const args of [['reports:tag-date:build','--video-limit=100001'],['reports:counts:build','--limit=0'],['reports:counts:build','--execute','--dry-run'],['reports:tag-date:build','--tagid=1','--tagid=2'],['reports:tag-date:build','--from=2026-02-30'],['reports:keyword-relations:build'],['reports:keyword-cloud:build','--subject='],['reports:tag-month:build','--subject=AI','--month=2026-13']])expect(()=>validateCacheArguments(args,now)).toThrow();
 expect(Object.keys(cacheCommands)).toHaveLength(16);
});
it('canonical selections, calendar windows and cache identities stay deterministic',()=>{
 const args=validateCacheArguments(['reports:tag-date:build','--tagid=3,1,3','--days=2'],now);expect(args.input).toMatchObject({tagIds:[1,3],from:'2026-10-11',to:'2026-10-12'});
 expect(validateCacheArguments(['reports:tag-month:build','--subject=AI','--month=2026-09'],now).input).toMatchObject({from:'2026-09-01',to:'2026-09-30'});
 expect(()=>validateCacheArguments(['reports:tag-month:build','--subject=AI','--month=2026-10'],now)).toThrow('closed month');
 expect(validateCacheArguments(['reports:people:build'],now).input).toMatchObject({tagIds:[13],days:37});
 expect(validateCacheArguments(['reports:keywords:cache'],now).input.orTagIds).toEqual([1,2,13,14]);
});
it('scheduled cache execute checks exact gates before connection',async()=>{
 await expect(executeCacheWorkflow(['reports:counts:build','--execute'],{APP_ENV:'production',TS_INGESTION_ENABLED:'true',TS_INGESTION_OWNERS:'reports.counts.build',TS_INGESTION_PRODUCTION_ENABLED:'true',TS_INGESTION_WRITE_ALLOWLIST:'reports.counts.build'},true)).rejects.toThrow('Scheduler is disabled');
});
