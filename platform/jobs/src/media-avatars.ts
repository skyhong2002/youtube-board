import {createHash} from 'node:crypto';
import {isChannelAssetId} from '../../shared/media-assets.js';
import {downloadAvatar,avatarSourceUrl,type DownloadOptions} from '../../shared/media-cache/download.js';
import {normalizeAvatar,type AvatarRaster} from '../../shared/media-cache/transform.js';
import {MEDIA_LIMITS,MediaCacheError,withCacheWriter,writableManifest,publishAvatar,readAvatarBytes,validChannel} from '../../shared/media-cache/store.js';

export interface AvatarRefreshChannel {id:number;channelId:string;sourceUrl:string|null}
export interface AvatarRefreshOptions {root?:string;channels:AvatarRefreshChannel[];execute?:boolean;limit?:number;maxAgeDays?:number;signal?:AbortSignal;assertOwnership?:()=>Promise<void>}
export interface AvatarRefreshResult {execute:boolean;results:Array<{id:number;status:'planned'|'fresh'|'updated'|'failed'|'missing-source';code?:string}>;lastProcessedId:number|null;truncated:boolean;downloadedBytes:number}
export interface AvatarRefreshDependencies {download?:(url:string,options:DownloadOptions)=>Promise<Buffer>;transform?:(bytes:Buffer,signal?:AbortSignal)=>Promise<AvatarRaster>;now?:()=>Date}

/** Adapter supplies ownership gates and a bounded SELECT-only channel batch.
 * Does not select DB rows, advance cursors, register schedules or read credentials. */
export async function refreshChannelAvatars(options:AvatarRefreshOptions,deps:AvatarRefreshDependencies={}):Promise<AvatarRefreshResult>{
 const limit=options.limit??100,maxAge=options.maxAgeDays??7;
 if(!Number.isSafeInteger(limit)||limit<1||limit>500||!Number.isSafeInteger(maxAge)||maxAge<1||maxAge>90||options.channels.length>501||options.channels.some((c,i)=>!isChannelAssetId(c.id)||typeof c.channelId!=='string'||c.channelId.length>256||i>0&&c.id<=options.channels[i-1]!.id||c.sourceUrl!==null&&typeof c.sourceUrl!=='string'))throw new MediaCacheError('INVALID_REFRESH_INPUT');
 const selected=options.channels.slice(0,limit),result:AvatarRefreshResult={execute:options.execute===true,results:[],lastProcessedId:null,truncated:options.channels.length>limit,downloadedBytes:0};
 if(!result.execute){result.results=selected.map(c=>({id:c.id,status:'planned'}));return result;}
 const root=options.root??process.env.MEDIA_CACHE_ROOT;if(!root||!options.assertOwnership)throw new MediaCacheError('REFRESH_EXECUTION_DISABLED');
 await options.assertOwnership();
 const signal=AbortSignal.any([AbortSignal.timeout(120000),...(options.signal?[options.signal]:[])]),now=(deps.now??(()=>new Date()))();
 return withCacheWriter(root,async()=>{
  const manifest=await writableManifest(root);
  const consume=(bytes:number)=>{result.downloadedBytes+=bytes;if(result.downloadedBytes>MEDIA_LIMITS.runBytes)throw new MediaCacheError('RUN_BYTE_BUDGET');};
  const prepare=async(c:AvatarRefreshChannel)=>{
   await options.assertOwnership!();
   if(!validChannel(c.channelId))return {channel:c,status:'failed' as const,code:'INVALID_CHANNEL_ID'};
   if(!c.sourceUrl)return {channel:c,status:'missing-source' as const};
   try{
    avatarSourceUrl(c.sourceUrl);
    const existing=manifest.entries[String(c.id)],sourceHash=createHash('sha256').update(c.sourceUrl).digest('hex');
    if(existing?.channelId===c.channelId&&existing.sourceHash===sourceHash&&Date.parse(existing.cachedAt)<=+now&&+now-Date.parse(existing.cachedAt)<maxAge*86400000){try{await readAvatarBytes(root,c.id,existing.revision);return {channel:c,status:'fresh' as const};}catch{/* Retry a missing or damaged optional file. */}}
    let consumed=0;const body=await (deps.download??downloadAvatar)(c.sourceUrl,{signal,consume:n=>{consumed+=n;consume(n);}});
    // Injected offline transports must obey the same full-body/run cap.
    if(body.length>MEDIA_LIMITS.inputBytes)throw new MediaCacheError('DOWNLOAD_TOO_LARGE');if(consumed<body.length)consume(body.length-consumed);
    signal.throwIfAborted();const raster=await (deps.transform??normalizeAvatar)(body,signal);return {channel:c,status:'prepared' as const,raster};
   }catch(error){
    const code=error instanceof MediaCacheError?error.code:'DOWNLOAD_FAILED';
    if(signal.aborted||code==='RUN_BYTE_BUDGET')return {channel:c,status:'interrupted' as const};
    return {channel:c,status:'failed' as const,code};
   }
  };
  batches:for(let at=0;at<selected.length;at+=2){
   if(signal.aborted||result.downloadedBytes>=MEDIA_LIMITS.runBytes){result.truncated=true;break;}
   const prepared=await Promise.all(selected.slice(at,at+2).map(prepare));
   for(const item of prepared){
    // The cursor describes a completed contiguous prefix. Never skip a run-level
    // interruption or publish a later concurrently prepared item across that gap.
    if(signal.aborted||item.status==='interrupted'){result.truncated=true;break batches;}
    if(item.status==='prepared'){
     await options.assertOwnership!();
     if(signal.aborted){result.truncated=true;break batches;}
     try{await publishAvatar(root,manifest,{...item.channel,sourceUrl:item.channel.sourceUrl!,...item.raster,cachedAt:now.toISOString()},signal);result.results.push({id:item.channel.id,status:'updated'});}
     catch(error){if(signal.aborted){result.truncated=true;break batches;}result.results.push({id:item.channel.id,status:'failed',code:error instanceof MediaCacheError?error.code:'CACHE_PUBLISH_FAILED'});}
    }else result.results.push({id:item.channel.id,status:item.status,...('code'in item?{code:item.code}:{})});
    result.lastProcessedId=item.channel.id;
   }
  }
  return result;
 });
}
