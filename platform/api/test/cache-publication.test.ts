import { it,expect } from 'vitest';
import { publishedReportRow, publishedLiveTagCache } from '../src/reports/cache-lineage.js';
import type { Reader } from '../src/db/client.js';
import { reportCacheKey } from '../../shared/report-cache-key.js';
it('generic cache publication hides pending and unknown-value snapshots',async()=>{
 const row={pk:1};let status='pending',unknown=0;
 const reader={rows:async()=>[{present:1,cache_key:reportCacheKey({u_id:2,days:7}),status,unknown_view_videos:unknown}],close:async()=>{}} as unknown as Reader;
 expect(await publishedReportRow(reader,'urt_show_cloud',{u_id:2,days:7},row)).toBeUndefined();
 status='published';unknown=1;expect(await publishedReportRow(reader,'urt_show_cloud',{u_id:2,days:7},row)).toBeUndefined();
 unknown=0;expect(await publishedReportRow(reader,'urt_show_cloud',{u_id:2,days:7},row)).toMatchObject(row);
 expect(reportCacheKey({u_id:2,days:7})).toBe(reportCacheKey({days:'7',u_id:'2'}));expect(reportCacheKey({tagid:'3,1,3',tag:'AI',days:3})).toBe(reportCacheKey({tagid:'1,3',tag:'AI',days:'3'}));
});
it('live date publication has its own sidecar and preserves missing days',async()=>{
 let calls=0;const reader={rows:async()=>calls++===0?[{present:1}]:[{the_date:'2026-10-12',status:'pending',unknown_view_videos:0}],close:async()=>{}} as unknown as Reader;
 expect(await publishedLiveTagCache(reader,[{the_date:'2026-10-12'},{the_date:'2026-10-11'}],{tagid:'13'})).toEqual([{the_date:'2026-10-11'}]);
});
it('today cache exposes its actual partial-window observation cutoff',async()=>{
 let calls=0;const reader={rows:async()=>calls++===0?[{present:1}]:[{the_date:'2026-10-12',status:'published',unknown_view_videos:0,window_from:'2026-10-12',window_to:'2026-10-12',window_closed:0,generated_at:'2026-10-12 10:00:00'}]} as unknown as Reader;
 expect((await publishedLiveTagCache(reader,[{the_date:'2026-10-12'}],{tagid:'13,13'}))[0]?._cacheWindow).toEqual({from:'2026-10-12',to:'2026-10-12',closed:false,observedUntil:'2026-10-12 10:00:00'});
});
