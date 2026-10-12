import type {HomeData} from '../contracts.js';
import {keywordVideoCache} from './keyword-video-cache.js';
/** One anonymous dataset per reader instance. Coalesce cold requests and cache only
 * successful sections. Authentication/HTTP cache policy remains outside this cache.
 * Each caller gets its own decoded object so media enrichment cannot cross requests. */
export function homeResultCache(now:()=>number=()=>performance.now()){
 const cached=keywordVideoCache<HomeData>({ttlMs:60_000,maxKeys:1,maxPending:1,maxBytes:3*1024*1024,maxResultBytes:1024*1024,now,
  cacheable:value=>value.tagsStatus==='available'&&value.exploration?.categories.status==='available'&&value.exploration.keywords.status==='synchronized'&&value.exploration.keywordToday.status==='synchronized'});
 return (load:()=>Promise<HomeData>)=>cached({},undefined,load);
}
