import {Redis} from 'ioredis';
import type {KeywordWindowStore} from './home-keyword-cache.js';
const KEY='yt-ts:home:keyword-windows:v1';
/** Redis copy of the last successful homepage keyword windows (public ranking data only).
 * Every failure degrades to "no shared copy": short timeouts, no retries per command and
 * errors swallowed, so Redis can never fail or noticeably delay a homepage read. */
export function redisKeywordWindowStore<T>(env:NodeJS.ProcessEnv,ttlSeconds:number):(KeywordWindowStore<T>&{close():void})|undefined{
 if(!env.REDIS_URL)return undefined;
 let url:URL;try{url=new URL(env.REDIS_URL);}catch{return undefined;}
 if(env.APP_ENV!=='production'&&!['127.0.0.1','localhost','redis'].includes(url.hostname))return undefined;
 const redis=new Redis(url.toString(),{lazyConnect:true,connectTimeout:1000,commandTimeout:1000,maxRetriesPerRequest:0,enableOfflineQueue:false,retryStrategy:times=>Math.min(times*1000,30_000)});
 redis.on('error',()=>{});
 const ready=async()=>{if(redis.status==='wait')await redis.connect();};
 return {
  async read(){await ready();const raw=await redis.get(KEY);if(!raw)return null;const entry=JSON.parse(raw) as {at:unknown;value:T};return typeof entry?.at==='number'?{at:entry.at,value:entry.value}:null;},
  async write(entry){await ready();await redis.set(KEY,JSON.stringify(entry),'EX',ttlSeconds);},
  async clear(){await ready();await redis.del(KEY);},
  close(){redis.disconnect();},
 };
}
