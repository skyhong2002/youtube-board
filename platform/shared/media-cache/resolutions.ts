import {constants} from 'node:fs';
import {open,rename,unlink} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {avatarSourceUrl} from './download.js';
import {checkedRoot,readBoundedFile,MediaCacheError,validChannel} from './store.js';
import {isChannelAssetId} from '../media-assets.js';

export const RESOLUTION_LIMITS=Object.freeze({entries:2000,bytes:6*1024*1024,ttlMs:7*86400000,backoffMs:6*3600000});
export interface AvatarResolution {channelId:string;sourceHash:string;url:string|null;attemptedAt:number;expiresAt:number;retryAfter:number}
export interface AvatarResolutions {version:1;entries:Record<string,AvatarResolution>}
export const sourceFingerprint=(source:string|null)=>createHash('sha256').update(source??'').digest('hex');
const fail=():never=>{throw new MediaCacheError('INVALID_RESOLUTIONS');};
/** Worker-only file. Not served publicly or read in request handlers. */
export function parseResolutions(bytes:Buffer):AvatarResolutions {
 if(bytes.length>RESOLUTION_LIMITS.bytes)return fail();
 let raw:unknown;try{raw=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{return fail();}
 if(!raw||typeof raw!=='object'||Array.isArray(raw))return fail();
 const state=raw as AvatarResolutions;
 if(state.version!==1||!state.entries||typeof state.entries!=='object'||Array.isArray(state.entries)||Object.keys(state).length!==2||Object.keys(state.entries).length>RESOLUTION_LIMITS.entries)return fail();
 for(const [id,e]of Object.entries(state.entries)){
  if(!/^[1-9]\d*$/.test(id)||!isChannelAssetId(Number(id))||!e||typeof e!=='object'||Array.isArray(e)||Object.keys(e).sort().join(',')!=='attemptedAt,channelId,expiresAt,retryAfter,sourceHash,url')return fail();
  if(!validChannel(e.channelId)||typeof e.sourceHash!=='string'||!/^[a-f0-9]{64}$/.test(e.sourceHash)||![e.attemptedAt,e.expiresAt,e.retryAfter].every(n=>Number.isSafeInteger(n)&&n>=0&&n<=8640000000000000))return fail();
  if(e.url!==null){try{if(avatarSourceUrl(e.url).href!==e.url)return fail();}catch{return fail();}if(e.expiresAt!==e.attemptedAt+RESOLUTION_LIMITS.ttlMs||e.retryAfter!==0)return fail();}
  else if(e.expiresAt!==0||e.retryAfter!==e.attemptedAt+RESOLUTION_LIMITS.backoffMs)return fail();
 }
 return state;
}
export async function readResolutions(root:string):Promise<AvatarResolutions>{
 try{return parseResolutions(await readBoundedFile(join(await checkedRoot(root),'avatar-resolutions.json'),RESOLUTION_LIMITS.bytes));}
 catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return {version:1,entries:Object.create(null)};throw error;}
}
export function currentResolution(state:AvatarResolutions,id:number,channelId:string,source:string|null,now:number):AvatarResolution|null {
 const row=state.entries[String(id)];
 return row&&row.channelId===channelId&&row.sourceHash===sourceFingerprint(source)&&row.attemptedAt<=now?row:null;
}
export function resolutionResult(channelId:string,source:string|null,url:string|null,now:number):AvatarResolution {
 return {channelId,sourceHash:sourceFingerprint(source),url,attemptedAt:now,expiresAt:url===null?0:now+RESOLUTION_LIMITS.ttlMs,retryAfter:url===null?now+RESOLUTION_LIMITS.backoffMs:0};
}
/** Caller holds cache writer + workflow ownership locks; bounded newest-entry retention. */
export async function writeResolutions(root:string,state:AvatarResolutions):Promise<void>{
 root=await checkedRoot(root);
 const entries=Object.entries(state.entries).sort((a,b)=>b[1].attemptedAt-a[1].attemptedAt||Number(a[0])-Number(b[0])).slice(0,RESOLUTION_LIMITS.entries);
 const body=Buffer.from(JSON.stringify({version:1,entries:Object.fromEntries(entries)}));parseResolutions(body);
 const path=join(root,'avatar-resolutions.json'),temporary=path+'.'+randomUUID()+'.tmp';let handle;
 try{handle=await open(temporary,'wx',0o640);await handle.writeFile(body);await handle.sync();await handle.close();handle=undefined;await rename(temporary,path);const directory=await open(root,constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW);try{await directory.sync();}finally{await directory.close();}}
 finally{await handle?.close();await unlink(temporary).catch(()=>{});}
 state.entries=Object.fromEntries(entries);
}
