import {YOUTUBE_VIDEO_ID,YOUTUBE_CHANNEL_ID} from '../../../shared/channel-admin.js';
import type {YoutubeContentPreview} from '../../../shared/content-admin.js';
const object=(v:unknown):Record<string,unknown>=>v&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:{};
/** Read data only; never evaluate page scripts, and never use recommended-video metadata. */
export function parseYoutubePreview(html:string,id:string):YoutubeContentPreview|null{
 const marker=/\bytInitialPlayerResponse\s*=\s*/.exec(html);if(!marker)return null;
 const start=marker.index+marker[0].length;if(html[start]!=='{')return null;
 let depth=0,quoted=false,escaped=false,end=-1;
 for(let i=start;i<html.length;i++){
  const c=html[i];if(quoted){if(escaped)escaped=false;else if(c==='\\')escaped=true;else if(c==='"')quoted=false;}
  else if(c==='"')quoted=true;else if(c==='{')depth++;else if(c==='}'&&--depth===0){end=i+1;break;}
 }
 if(end<0)return null;
 try{
  const player=object(JSON.parse(html.slice(start,end))),details=object(player.videoDetails),micro=object(object(player.microformat).playerMicroformatRenderer),live=object(micro.liveBroadcastDetails);
  if(details.videoId!==id||typeof details.channelId!=='string'||!YOUTUBE_CHANNEL_ID.test(details.channelId)||typeof details.title!=='string')return null;
  const broadcast=live.isLiveNow===true||details.isLive===true?'live':details.isUpcoming===true?'upcoming':typeof live.endTimestamp==='string'?'ended':details.isLiveContent===true?'unknown':'video';
  return {videoId:id,title:details.title.slice(0,500),channelId:details.channelId,channelTitle:typeof details.author==='string'?details.author.slice(0,256):details.channelId,broadcast};
 }catch{return null;}
}
/** Public watch-page metadata only: fixed host, no cookies, no redirects, bounded bytes/time/concurrency/cache. */
export function youtubePreviewResolver(fetcher:typeof fetch=fetch){
 const cache=new Map<string,{until:number;value:YoutubeContentPreview|null}>(),pending=new Map<string,Promise<YoutubeContentPreview|null>>();
 return async(id:string):Promise<YoutubeContentPreview|null>=>{
  if(!YOUTUBE_VIDEO_ID.test(id))return null;
  const hit=cache.get(id);if(hit&&hit.until>Date.now())return hit.value;
  if(pending.has(id))return pending.get(id)!;if(pending.size>=4)return null;
  const task=(async()=>{
   let response:Response|undefined;
   try{
    response=await fetcher(`https://www.youtube.com/watch?v=${id}&hl=en`,{redirect:'error',credentials:'omit',signal:AbortSignal.timeout(6000),headers:{Accept:'text/html'}});
    if(!response.ok||!response.body||Number(response.headers.get('content-length')??0)>3_000_000)return null;
    const reader=response.body.getReader(),decoder=new TextDecoder();let html='',bytes=0;
    try{while(true){const part=await reader.read();if(part.done)break;bytes+=part.value.byteLength;if(bytes>3_000_000)return null;html+=decoder.decode(part.value,{stream:true});}html+=decoder.decode();return parseYoutubePreview(html,id);}
    finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
   }catch{return null;}finally{await response?.body?.cancel().catch(()=>{});}
  })().then(value=>{if(cache.size>=100)cache.delete(cache.keys().next().value!);cache.set(id,{until:Date.now()+(value?45000:10000),value});return value;}).finally(()=>pending.delete(id));
  pending.set(id,task);return task;
 };
}
