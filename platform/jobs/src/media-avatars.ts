import {createHash} from 'node:crypto';
import {isChannelAssetId} from '../../shared/media-assets.js';
import {downloadAvatar,avatarSourceUrl,MediaHttpStatusError,type DownloadOptions} from '../../shared/media-cache/download.js';
import {resolveChannelAvatar} from '../../shared/media-cache/channel-page.js';
import {readResolutions,writeResolutions,currentResolution,resolutionResult,type AvatarResolution} from '../../shared/media-cache/resolutions.js';
import {normalizeAvatar,type AvatarRaster} from '../../shared/media-cache/transform.js';
import {MEDIA_LIMITS,MediaCacheError,withCacheWriter,writableManifest,publishAvatar,readAvatarBytes,validChannel} from '../../shared/media-cache/store.js';

export interface AvatarRefreshChannel {id:number;channelId:string;sourceUrl:string|null}
export interface AvatarRefreshOptions {root?:string;channels:AvatarRefreshChannel[];execute?:boolean;limit?:number;maxAgeDays?:number;resolveMissing?:boolean;signal?:AbortSignal;assertOwnership?:()=>Promise<void>}
export interface AvatarRefreshResult {execute:boolean;results:Array<{id:number;status:'planned'|'fresh'|'updated'|'failed'|'missing-source';code?:string;httpStatus?:number}>;lastProcessedId:number|null;truncated:boolean;downloadedBytes:number}
export interface AvatarRefreshDependencies {download?:(url:string,options:DownloadOptions)=>Promise<Buffer>;resolve?:(channelId:string,options:DownloadOptions)=>Promise<string>;transform?:(bytes:Buffer,signal?:AbortSignal)=>Promise<AvatarRaster>;now?:()=>Date}
const fallbackEligible=(error:unknown)=>error instanceof MediaHttpStatusError?[404,410].includes(error.httpStatus):error instanceof MediaCacheError&&error.code==='SOURCE_URL_REJECTED';
export const MAX_CHANNEL_PAGE_RESOLUTIONS=20;
/** Adapter supplies ownership gates and a bounded SELECT-only channel batch.
 * Optional channel-page lookup changes only own cache state, never source tables. */
export async function refreshChannelAvatars(options:AvatarRefreshOptions,deps:AvatarRefreshDependencies={}):Promise<AvatarRefreshResult>{
 const limit=options.limit??100,maxAge=options.maxAgeDays??7;
 if(!Number.isSafeInteger(limit)||limit<1||limit>500||!Number.isSafeInteger(maxAge)||maxAge<1||maxAge>90||options.resolveMissing!==undefined&&typeof options.resolveMissing!=='boolean'||options.channels.length>501||options.channels.some((c,i)=>!isChannelAssetId(c.id)||typeof c.channelId!=='string'||c.channelId.length>256||i>0&&c.id<=options.channels[i-1]!.id||c.sourceUrl!==null&&typeof c.sourceUrl!=='string'))throw new MediaCacheError('INVALID_REFRESH_INPUT');
 const selected=options.channels.slice(0,limit),result:AvatarRefreshResult={execute:options.execute===true,results:[],lastProcessedId:null,truncated:options.channels.length>limit,downloadedBytes:0};
 if(!result.execute){result.results=selected.map(c=>({id:c.id,status:'planned'}));return result;}
 const root=options.root??process.env.MEDIA_CACHE_ROOT;if(!root||!options.assertOwnership)throw new MediaCacheError('REFRESH_EXECUTION_DISABLED');
 await options.assertOwnership();
 const signal=AbortSignal.any([AbortSignal.timeout(120000),...(options.signal?[options.signal]:[])]),now=(deps.now??(()=>new Date()))();
 if(!Number.isFinite(+now)||+now<0)throw new MediaCacheError('INVALID_REFRESH_TIME');
 return withCacheWriter(root,async()=>{
  const manifest=await writableManifest(root),resolutions=options.resolveMissing?await readResolutions(root):null;let resolutionChanged=false,pageRequests=0;
  const consume=(bytes:number)=>{result.downloadedBytes+=bytes;if(result.downloadedBytes>MEDIA_LIMITS.runBytes)throw new MediaCacheError('RUN_BYTE_BUDGET');};
  const fetchRaster=async(url:string)=>{
   avatarSourceUrl(url);let consumed=0;
   const body=await (deps.download??downloadAvatar)(url,{signal,consume:n=>{consumed+=n;consume(n);}});
   if(body.length>MEDIA_LIMITS.inputBytes)throw new MediaCacheError('DOWNLOAD_TOO_LARGE');if(consumed<body.length)consume(body.length-consumed);
   signal.throwIfAborted();return (deps.transform??normalizeAvatar)(body,signal);
  };
  const fresh=async(c:AvatarRefreshChannel,url:string)=>{
   const existing=manifest.entries[String(c.id)],sourceHash=createHash('sha256').update(url).digest('hex');
   if(existing?.channelId!==c.channelId||existing.sourceHash!==sourceHash||Date.parse(existing.cachedAt)>+now||+now-Date.parse(existing.cachedAt)>=maxAge*86400000)return false;
   try{await readAvatarBytes(root,c.id,existing.revision);return true;}catch{return false;}
  };
  type Prepared={channel:AvatarRefreshChannel;status:'prepared'|'fresh'|'failed'|'missing-source'|'interrupted';code?:string;httpStatus?:number;raster?:AvatarRaster;sourceUrl?:string;resolution?:AvatarResolution|null};
  const prepare=async(c:AvatarRefreshChannel):Promise<Prepared>=>{
   await options.assertOwnership!();
   if(!validChannel(c.channelId))return {channel:c,status:'failed',code:'INVALID_CHANNEL_ID'};
   const cached=resolutions?currentResolution(resolutions,c.id,c.channelId,c.sourceUrl,+now):null;
   let resolving=false,ownershipLost=false;
   try{
    if(c.sourceUrl&&await fresh(c,c.sourceUrl))return {channel:c,status:'fresh'};
    if(cached&&cached.retryAfter>+now)return {channel:c,status:'failed',code:'RESOLUTION_BACKOFF'};
    if(cached?.url&&cached.expiresAt>+now){
     if(await fresh(c,cached.url))return {channel:c,status:'fresh'};
     resolving=true;
     try{return {channel:c,status:'prepared',sourceUrl:cached.url,raster:await fetchRaster(cached.url),resolution:cached};}
     catch(error){if(!fallbackEligible(error))throw error;}
    }else if(c.sourceUrl){
     try{return {channel:c,status:'prepared',sourceUrl:c.sourceUrl,raster:await fetchRaster(c.sourceUrl),...(resolutions?{resolution:null}:{})};}
     catch(error){if(!resolutions||!fallbackEligible(error))throw error;}
    }else if(!resolutions)return {channel:c,status:'missing-source'};
    if(!resolutions)throw new MediaCacheError('RESOLUTION_DISABLED');
    resolving=true;try{await options.assertOwnership!();}catch(error){ownershipLost=true;throw error;}signal.throwIfAborted();
    if(pageRequests>=MAX_CHANNEL_PAGE_RESOLUTIONS)throw new MediaCacheError('RESOLUTION_RUN_LIMIT');pageRequests++;
    const url=await (deps.resolve??resolveChannelAvatar)(c.channelId,{signal,consume});
    avatarSourceUrl(url);signal.throwIfAborted();
    return {channel:c,status:'prepared',sourceUrl:url,raster:await fetchRaster(url),resolution:resolutionResult(c.channelId,c.sourceUrl,url,+now)};
   }catch(error){
    if(ownershipLost)throw error;
    const code=error instanceof MediaCacheError?error.code:'DOWNLOAD_FAILED';
    if(signal.aborted||code==='RUN_BYTE_BUDGET'||code==='RESOLUTION_RUN_LIMIT')return {channel:c,status:'interrupted'};
    return {channel:c,status:'failed',code,...(error instanceof MediaHttpStatusError?{httpStatus:error.httpStatus}:{}),...(resolving?{resolution:resolutionResult(c.channelId,c.sourceUrl,null,+now)}:{})};
   }
  };
  batches:for(let at=0;at<selected.length;at+=2){
   if(signal.aborted||result.downloadedBytes>=MEDIA_LIMITS.runBytes){result.truncated=true;break;}
   const prepared=await Promise.all(selected.slice(at,at+2).map(prepare));
   for(const item of prepared){
    // Cursor and resolver metadata cover only the completed contiguous prefix.
    if(signal.aborted||item.status==='interrupted'){result.truncated=true;break batches;}
    if(item.status==='prepared'){
     await options.assertOwnership!();
     if(signal.aborted){result.truncated=true;break batches;}
     try{await publishAvatar(root,manifest,{...item.channel,sourceUrl:item.sourceUrl!,...item.raster!,cachedAt:now.toISOString()},signal);result.results.push({id:item.channel.id,status:'updated'});}
     catch(error){if(signal.aborted){result.truncated=true;break batches;}result.results.push({id:item.channel.id,status:'failed',code:error instanceof MediaCacheError?error.code:'CACHE_PUBLISH_FAILED'});item.resolution=undefined;}
    }else result.results.push({id:item.channel.id,status:item.status,...(item.code?{code:item.code}:{}),...(item.httpStatus?{httpStatus:item.httpStatus}:{})});
    if(resolutions&&item.resolution!==undefined){resolutionChanged=true;if(item.resolution===null)delete resolutions.entries[String(item.channel.id)];else resolutions.entries[String(item.channel.id)]=item.resolution;}
    result.lastProcessedId=item.channel.id;
   }
  }
  if(resolutions&&resolutionChanged){await options.assertOwnership!();await writeResolutions(root,resolutions);}
  return result;
 });
}
