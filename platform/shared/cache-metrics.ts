import {asciiCaseFold} from './ascii-case.js';
/** Pure YouTube metrics shared by the approved cache writers and SELECT-only fallback. */
export class CacheMetricBound extends Error {readonly statusCode=422;}
export interface MetricMatch {term:string;field:'title'|'description'}
export interface MetricVideo {videoId:string;uId:number;publishedAt:string;viewCount:unknown;matches:MetricMatch[]}
const safeSum=(a:number,b:number)=>{const n=a+b;if(!Number.isSafeInteger(n))throw new CacheMetricBound('Cache count exceeds safe integer range');return n;};
/** Streaming form of tagMetricsFromEvidence: long cache windows add videos page by page instead of holding them all. */
export function tagMetricsAccumulator() {
  const counts = new Map<string, number>(), videoCounts = new Map<string, number>(), views = new Map<string, number>(); let totalViews = 0, countTags = 0, unknownViews = 0, videos = 0;
  return {
    add(video: Pick<MetricVideo, 'viewCount' | 'matches'>) {
      videos++;
      if (video.viewCount === null || video.viewCount === undefined) unknownViews++;
      const count = Number(video.viewCount ?? 0);
      if (!Number.isSafeInteger(count) || count < 0) throw new CacheMetricBound('Invalid video view count in cache source');
      totalViews += count;
      if (!Number.isSafeInteger(totalViews)) throw new CacheMetricBound('View sum exceeds safe integer range');
      const matched = new Map<string, number>();
      for (const item of video.matches) matched.set(item.term, (matched.get(item.term) ?? 0) + (item.field === 'title' ? 2 : 1));
      for (const [term, occurrences] of matched) { counts.set(term, (counts.get(term) ?? 0) + occurrences); videoCounts.set(term, (videoCounts.get(term) ?? 0) + 1); views.set(term, safeSum(views.get(term) ?? 0, count)); countTags += occurrences; }
    },
    result() {
      const score = [...counts].map(([tag, count]) => [tag, count * (Math.log(Array.from(tag).length + 0.5) - 0.5)] as const).filter(([, value]) => value > 0).sort((a, b) => b[1] - a[1]);
      return { unknown_view_videos: unknownViews, count_videos: videos, count_tags: countTags, total_views: totalViews, tags_count: score.length, tags_result: Object.fromEntries(score.map(([tag, value]) => [tag, value.toFixed(3)])), tags_video: Object.fromEntries([...videoCounts].sort((a, b) => b[1] - a[1])), tags_views: Object.fromEntries([...views].sort((a, b) => b[1] - a[1])) };
    },
  };
}
export function tagMetricsFromEvidence(videos: MetricVideo[]) {
  const accumulator = tagMetricsAccumulator();
  for (const video of videos) accumulator.add(video);
  return accumulator.result();
}
export function keywordCloudFromEvidence(videos:MetricVideo[],subject:string){
 const folded=asciiCaseFold(subject),selected=videos.filter(v=>v.matches.some(m=>asciiCaseFold(m.term)===folded)),terms=new Map<string,{videos:number;views:number;weight:number}>();let occurrences=0,unknownViews=0;
 for(const v of selected){const counts=new Map<string,number>();for(const m of v.matches)counts.set(m.term,(counts.get(m.term)??0)+(m.field==='title'?2:1));
  const total=[...counts.values()].reduce((a,b)=>a+b,0),subjectCount=[...counts].reduce((sum,[term,count])=>sum+(asciiCaseFold(term)===folded?count:0),0),factor=Math.sqrt(subjectCount/total),view=Number(v.viewCount??0);if(!Number.isSafeInteger(view)||view<0)throw new CacheMetricBound('Invalid video view count in cache source');if(v.viewCount===null||v.viewCount===undefined)unknownViews++;occurrences=safeSum(occurrences,total);
  for(const term of counts.keys()){const old=terms.get(term)??{videos:0,views:0,weight:0};old.videos++;old.views=safeSum(old.views,view);old.weight+=view*factor;if(!Number.isFinite(old.weight)||old.weight>Number.MAX_SAFE_INTEGER)throw new CacheMetricBound('Cache weight exceeds safe numeric range');terms.set(term,old);}
 }
 return {unknown_view_videos:unknownViews,count_channels:new Set(selected.map(v=>v.uId)).size,count_videos:selected.length,count_tags:occurrences,tags_count:terms.size,tags_result:Object.fromEntries([...terms].sort((a,b)=>b[1].weight-a[1].weight).map(([term,m])=>[term,{...m,weight:m.weight.toFixed(2)}])),videos_json:Object.fromEntries(selected.map(v=>[v.videoId,{u_id:v.uId,views:v.viewCount===null?null:Number(v.viewCount),published_at:v.publishedAt}]))};
}
export function keywordDayFromEvidence(videos:MetricVideo[],subject:string){
 const folded=asciiCaseFold(subject),selected=videos.map(v=>({v,terms:new Set(v.matches.map(m=>m.term))})).filter(r=>[...r.terms].some(term=>asciiCaseFold(term)===folded)),counts=new Map<string,number>();for(const {terms}of selected)for(const term of terms)counts.set(term,(counts.get(term)??0)+1);
 return {count_channels:new Set(selected.map(r=>r.v.uId)).size,count_videos:selected.length,count_tags:counts.size,videos_json:Object.fromEntries(selected.map(r=>[r.v.videoId,r.v.uId])),tags_json:Object.fromEntries([...counts].sort((a,b)=>b[1]-a[1]))};
}
