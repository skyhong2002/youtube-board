import {setTimeout as pause} from 'node:timers/promises';
import {AVATAR_WEBP_WIDTHS} from '../media-assets.js';
import {MEDIA_LIMITS,MediaCacheError,checkedRoot,readManifest,readAvatarBytes,readAvatarWebpBytes,publishAvatarDerivatives,withCacheWriter} from './store.js';
export interface DerivativeBackfillOptions {root:string;execute?:boolean;afterId?:number;limit?:number;delayMs?:number;signal?:AbortSignal}
/** Current manifest revisions only. Cursor resumes a bounded, ascending prefix.
 * Existing files (including malformed ones) are never overwritten or removed. */
export async function backfillAvatarDerivatives(options:DerivativeBackfillOptions){
 const {root,execute=false,afterId=0,limit=100,delayMs=200}=options;
 if(!Number.isSafeInteger(afterId)||afterId<0||!Number.isSafeInteger(limit)||limit<1||limit>500||!Number.isSafeInteger(delayMs)||delayMs<100||delayMs>5000)throw new MediaCacheError('INVALID_BACKFILL_INPUT');
 await checkedRoot(root);
 const signal=AbortSignal.any([AbortSignal.timeout(120000),...(options.signal?[options.signal]:[])]);
 const work=async()=>{
  const manifest=await readManifest(root);if(!manifest)throw new MediaCacheError('INVALID_MANIFEST');
  const ids=Object.keys(manifest.entries).map(Number).filter(id=>id>afterId).sort((a,b)=>a-b),selected=ids.slice(0,limit);
  const result={execute,processed:0,planned:0,updated:0,fresh:0,failed:0,inputBytes:0,writtenBytes:0,lastProcessedId:afterId,truncated:ids.length>limit,failures:[] as Array<{id:number;code:string}>};
  for(const id of selected){
   if(signal.aborted||result.inputBytes+MEDIA_LIMITS.outputBytes>MEDIA_LIMITS.runBytes){result.truncated=true;break;}
   try{
    const revision=manifest.entries[String(id)]!.revision,png=await readAvatarBytes(root,id,revision);result.inputBytes+=png.length;
    let missing=false;for(const width of AVATAR_WEBP_WIDTHS){try{await readAvatarWebpBytes(root,id,revision,width);}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;missing=true;}}
    if(!missing)result.fresh++;
    else if(!execute)result.planned++;
    else{result.writtenBytes+=await publishAvatarDerivatives(root,id,revision,png,signal);result.updated++;}
   }catch(error){
    if(signal.aborted){result.truncated=true;break;}
    result.failed++;result.failures.push({id,code:error instanceof MediaCacheError?error.code:'CACHE_DERIVATIVE_FAILED'});
   }
   result.processed++;result.lastProcessedId=id;
   if(id!==selected.at(-1)){try{await pause(delayMs,undefined,{signal});}catch{result.truncated=true;break;}}
  }
  return result;
 };
 return execute?withCacheWriter(root,work):work();
}
