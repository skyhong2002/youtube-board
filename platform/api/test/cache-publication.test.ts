import { it,expect } from 'vitest';
import { publishedReportRow, publishedLiveTagCache, publishedTagCache, inspectReportRows, unknownViewVideos, unknownViewMeta, unknownViewNotes } from '../src/reports/cache-lineage.js';
import type { Reader } from '../src/db/client.js';
import { reportCacheKey } from '../../shared/report-cache-key.js';
it('generic cache publication hides pending snapshots but shows unknown-view ones like Laravel',async()=>{
 const row={pk:1};let status='pending',unknown=0;
 const reader={rows:async()=>[{present:1,cache_key:reportCacheKey({u_id:2,days:7}),status,unknown_view_videos:unknown}],close:async()=>{}} as unknown as Reader;
 expect(await publishedReportRow(reader,'urt_show_cloud',{u_id:2,days:7},row)).toBeUndefined();
 status='published';unknown=3;const shown=await publishedReportRow(reader,'urt_show_cloud',{u_id:2,days:7},row);expect(shown).toMatchObject({...row,_unknownViewVideos:3});
 expect(unknownViewVideos([shown])).toBe(3);expect(unknownViewMeta([shown])).toEqual({unknown_view_videos:3});
 unknown=0;expect(await publishedReportRow(reader,'urt_show_cloud',{u_id:2,days:7},row)).toMatchObject({...row,_unknownViewVideos:0});
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
it('unknown-view counts are exposed for tag-date and report rows; pending remains withheld',async()=>{
 let calls=0;const reader={rows:async()=>calls++===0?[{present:1}]:[{the_date:'2026-10-10',status:'published',unknown_view_videos:2,vocabulary_version:'v',coverage:'c',rule_version:'r'},{the_date:'2026-10-11',status:'pending',unknown_view_videos:0}],close:async()=>{}} as unknown as Reader;
 const rows=await publishedTagCache(reader,[{the_date:'2026-10-10',total_views:500},{the_date:'2026-10-11'},{the_date:'2026-10-12'}],{tagid:'4'});
 expect(rows.map(r=>r.the_date)).toEqual(['2026-10-10','2026-10-12']);expect(rows[0]).toMatchObject({total_views:500,_unknownViewVideos:2});expect(rows[1]!._unknownViewVideos).toBeUndefined();
 expect(unknownViewVideos(rows)).toBe(2);expect(unknownViewNotes(2)[0]).toContain('2 部影片尚無觀看數');expect(unknownViewNotes(0)).toEqual([]);
 // Imported rows with no sidecar keep Laravel's legacy wire shape.
 expect(unknownViewMeta([{the_date:'2026-10-12'},undefined])).toEqual({});
 const keys={data_name:'tags_all'};let reads=0;const report={rows:async()=>reads++===0?[{present:1}]:[{cache_key:reportCacheKey(keys),status:'published',unknown_view_videos:4,vocabulary_version:'v',coverage:'c',rule_version:'r'}],close:async()=>{}} as unknown as Reader;
 const [read]=await inspectReportRows(report,'urt_show_data',[{keys,row:{pk:9}}]);expect(read).toMatchObject({status:'published',row:{pk:9,_unknownViewVideos:4}});
});
