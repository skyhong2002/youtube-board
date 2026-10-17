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
it('Laravel batch-1 command lines validate with Laravel clamps and defaults',()=>{
 // Laravel clamps instead of rejecting: counts 100, live.build 100, live.clean 200, schedule 200 / 168 hours.
 expect(validateCacheArguments(['reports:counts:build','--execute','--limit=500'],now).limit).toBe(100);
 expect(validateCacheArguments(['reports:live:clean','--execute','--limit=500'],now).limit).toBe(200);
 expect(validateCacheArguments(['reports:live:build','--execute','--hours=24','--limit=500'],now)).toMatchObject({limit:100,hours:24});
 expect(validateCacheArguments(['reports:schedule:build','--execute','--limit=100'],now)).toMatchObject({limit:100,hours:1});
 expect(validateCacheArguments(['reports:schedule:build','--hours=500'],now).hours).toBe(168);
 // tags_all: 31 calendar days with a 7-day recent window by default; video-limit up to the streamed cap.
 const keywords=validateCacheArguments(['reports:keywords:cache','--execute','--days=31','--recent-days=7','--video-limit=100000'],now);
 expect(keywords.input).toMatchObject({days:31,from:'2026-09-12',to:'2026-10-12',orTagIds:[1,2,13,14],videoLimit:100000});expect(keywords.recentDays).toBe(7);
 expect(validateCacheArguments(['reports:keywords:cache'],now)).toMatchObject({recentDays:7,input:{days:31,videoLimit:50000}});
 expect(validateCacheArguments(['reports:keywords:cache','--days=5','--recent-days=9'],now).recentDays).toBe(5);
 expect(()=>validateCacheArguments(['reports:keywords:cache','--days=91'],now)).toThrow();
 // Tag cloud: Laravel period list in one run, rolling windows, and room for 90-day production volumes.
 const cloud=validateCacheArguments(['reports:tag-cloud:build','--execute','--days=1,3,7,30,90','--tagid=1','--channel-limit=1000','--video-limit=600000'],now);
 expect(cloud.daysList).toEqual([1,3,7,30,90]);expect(cloud.input).toMatchObject({tagIds:[1],channelLimit:1000,videoLimit:600000});
 expect(validateCacheArguments(['reports:tag-cloud:build','--tagid=1'],now)).toMatchObject({daysList:[1,3,7,30,90],input:{channelLimit:1000,videoLimit:50000}});
 expect(validateCacheArguments(['reports:tag-cloud:build','--tagid=1','--days=30'],now).daysList).toEqual([30]);
 for(const args of [['reports:tag-cloud:build','--days=366'],['reports:tag-cloud:build','--days=1,,3'],['reports:tag-cloud:build','--days=1,2,3,4,5,6,7,8,9,10,11'],['reports:tag-cloud:build','--video-limit=1000001'],['reports:tag-date:build','--video-limit=600000']])expect(()=>validateCacheArguments(args,now)).toThrow();
 // Tag date keeps Laravel per-date caps and accepts --date-limit.
 expect(validateCacheArguments(['reports:tag-date:build','--tagid=1','--days=2','--date-limit=400','--channel-limit=1000','--video-limit=10000','--execute'],now).input).toMatchObject({from:'2026-10-11',to:'2026-10-12'});
 expect(()=>validateCacheArguments(['reports:tag-date:build','--date-limit=401'],now)).toThrow();
 // People: scheduled Laravel rotation (5 names, offset=auto) is the default.
 expect(validateCacheArguments(['reports:people:build','--execute','--limit=5','--offset=auto','--days=37','--tagid=13','--keyword-limit=5000'],now)).toMatchObject({limit:5,offset:'auto',input:{tagIds:[13],days:37}});
 expect(validateCacheArguments(['reports:people:build','--channel-limit=1000','--days=37','--tagid=13','--video-limit=10000','--execute'],now)).toMatchObject({limit:5,offset:'auto',input:{channelLimit:1000,videoLimit:10000}});
 expect(validateCacheArguments(['reports:people:build','--offset=7','--limit=999'],now)).toMatchObject({offset:7,limit:200});
 for(const args of [['reports:people:build','--tagid=1,2'],['reports:people:build','--offset=x'],['reports:people:build','--from=2026-10-01'],['reports:people:build','--days=366'],['reports:people:build','--group=\u0001']])expect(()=>validateCacheArguments(args,now)).toThrow();
});
