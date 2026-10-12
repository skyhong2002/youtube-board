import {constants} from 'node:fs';
import {mkdir,open,lstat,realpath,rename,unlink,readdir} from 'node:fs/promises';
import {isAbsolute,join,resolve,dirname} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {channelAvatarUrl,isChannelAssetId,isMediaRevision,type ChannelAvatar} from '../media-assets.js';

export const MEDIA_LIMITS=Object.freeze({manifestBytes:8*1024*1024,entries:50000,inputBytes:2*1024*1024,outputBytes:512*1024,pixels:16*1024*1024,dimension:4096,runBytes:32*1024*1024,revisions:16});
export class MediaCacheError extends Error {constructor(public readonly code:string){super(code);}}
export interface AvatarEntry {channelId:string;revision:string;cachedAt:string;sourceHash:string;sourceWidth:number;sourceHeight:number;format:'png'}
export interface AvatarManifest {version:1;entries:Record<string,AvatarEntry>}
const validChannel=(value:unknown):value is string=>typeof value==='string'&&/^UC[A-Za-z0-9_-]{22}$/.test(value);
export {validChannel};
const hash=(value:Buffer|string)=>createHash('sha256').update(value).digest('hex');
const fail=(code:string):never=>{throw new MediaCacheError(code);};
export async function checkedRoot(root:string,create=false):Promise<string>{
 if(!isAbsolute(root)||resolve(root)!==root)fail('INVALID_CACHE_ROOT');
 if(create)await mkdir(root,{recursive:true,mode:0o750});
 const stat=await lstat(root);if(!stat.isDirectory()||stat.isSymbolicLink()||await realpath(root)!==root)fail('INVALID_CACHE_ROOT');
 return root;
}
async function directory(parent:string,name:string,create=false){
 const path=join(parent,name);if(create){await mkdir(path,{mode:0o750}).catch(e=>{if(e.code!=='EEXIST')throw e;});await syncDirectory(parent);}
 const stat=await lstat(path);if(!stat.isDirectory()||stat.isSymbolicLink())fail('INVALID_CACHE_DIRECTORY');return path;
}
async function syncDirectory(path:string){const handle=await open(path,constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW);try{await handle.sync();}finally{await handle.close();}}
export async function readBoundedFile(path:string,maximum:number):Promise<Buffer>{
 const handle=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
 try{
  const stat=await handle.stat();if(!stat.isFile()||stat.nlink!==1||stat.size>maximum)fail('INVALID_CACHE_FILE');
  const chunks:Buffer[]=[];let size=0;
  while(true){const chunk=Buffer.alloc(Math.min(65536,maximum+1-size)),{bytesRead}=await handle.read(chunk,0,chunk.length,null);if(!bytesRead)break;size+=bytesRead;if(size>maximum)fail('CACHE_FILE_TOO_LARGE');chunks.push(chunk.subarray(0,bytesRead));}
  return Buffer.concat(chunks,size);
 }finally{await handle.close();}
}
export function parseManifest(bytes:Buffer):AvatarManifest{
 if(bytes.length>MEDIA_LIMITS.manifestBytes)fail('INVALID_MANIFEST');
 let decoded:unknown;try{decoded=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{fail('INVALID_MANIFEST');}
 if(!decoded||typeof decoded!=='object'||Array.isArray(decoded))fail('INVALID_MANIFEST');
 const value=decoded as AvatarManifest;if(value.version!==1||!value.entries||typeof value.entries!=='object'||Array.isArray(value.entries)||Object.keys(value).some(k=>!['version','entries'].includes(k)))fail('INVALID_MANIFEST');
 const entries=Object.entries(value.entries);if(entries.length>MEDIA_LIMITS.entries)fail('INVALID_MANIFEST');
 for(const [id,item]of entries){
  if(!/^[1-9]\d*$/.test(id)||!isChannelAssetId(Number(id))||!item||typeof item!=='object'||Array.isArray(item)||Object.keys(item).length!==7||Object.keys(item).some(k=>!['channelId','revision','cachedAt','sourceHash','sourceWidth','sourceHeight','format'].includes(k)))fail('INVALID_MANIFEST');
  if(!validChannel(item.channelId)||!isMediaRevision(item.revision)||!isMediaRevision(item.sourceHash)||typeof item.cachedAt!=='string'||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(item.cachedAt)||!Number.isFinite(Date.parse(item.cachedAt))||new Date(item.cachedAt).toISOString()!==item.cachedAt)fail('INVALID_MANIFEST');
  if(![item.sourceWidth,item.sourceHeight].every(n=>Number.isSafeInteger(n)&&n>=16&&n<=MEDIA_LIMITS.dimension)||(item as AvatarEntry&{format?:string}).format!=='png')fail('INVALID_MANIFEST');
 }
 return value;
}
async function manifestOrThrow(root:string):Promise<AvatarManifest>{return parseManifest(await readBoundedFile(join(await checkedRoot(root),'manifest.json'),MEDIA_LIMITS.manifestBytes));}
const metadataCache=new Map<string,{key:string;until:number;value:AvatarManifest|null}>();
/** Metadata stat on each request, bytes/JSON cached for5s; replacements invalidate
 * immediately. Invalid/missing replacements never return stale identity mappings. */
export async function readManifest(root:string):Promise<AvatarManifest|null>{
 try{
  await checkedRoot(root);const stat=await lstat(join(root,'manifest.json'),{bigint:true});
  if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1n||stat.size>BigInt(MEDIA_LIMITS.manifestBytes))throw Error();
  const key=[stat.dev,stat.ino,stat.size,stat.mtimeNs,stat.ctimeNs].join(':'),cached=metadataCache.get(root);
  if(cached?.key===key&&cached.until>Date.now())return cached.value;
  let value:AvatarManifest|null;try{value=await manifestOrThrow(root);}catch{value=null;}
  if(metadataCache.size>=4&&!metadataCache.has(root))metadataCache.delete(metadataCache.keys().next().value!);
  metadataCache.set(root,{key,until:Date.now()+5000,value});return value;
 }catch{metadataCache.delete(root);return null;}
}
export async function writableManifest(root:string):Promise<AvatarManifest>{
 try{return await manifestOrThrow(root);}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return {version:1,entries:Object.create(null)};throw error;}
}
async function atomicWrite(path:string,body:Buffer){
 const temporary=path+'.'+randomUUID()+'.tmp';let handle;
 try{handle=await open(temporary,'wx',0o640);await handle.writeFile(body);await handle.sync();await handle.close();handle=undefined;await rename(temporary,path);await syncDirectory(dirname(path));}
 finally{await handle?.close();await unlink(temporary).catch(()=>{});}
}
export async function withCacheWriter<T>(root:string,work:()=>Promise<T>):Promise<T>{
 root=await checkedRoot(root,true);const path=join(root,'.refresh.lock');let lock;
 try{lock=await open(path,'wx',0o600);}catch{fail('CACHE_WRITER_BUSY');}
 try{return await work();}finally{await lock!.close();await unlink(path);}
}
export async function readAvatarBytes(root:string,id:number,revision:string):Promise<Buffer>{
 if(!channelAvatarUrl(id,revision))fail('INVALID_ASSET');
 const base=await checkedRoot(root),channels=await directory(base,'channels'),channel=await directory(channels,String(id));
 const bytes=await readBoundedFile(join(channel,revision+'.png'),MEDIA_LIMITS.outputBytes);
 if(!validPublishedPng(bytes)||hash(bytes)!==revision)fail('INVALID_ASSET');return bytes;
}
function validPublishedPng(bytes:Buffer){return bytes.length>=24&&bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))&&bytes.toString('ascii',12,16)==='IHDR'&&bytes.readUInt32BE(16)===192&&bytes.readUInt32BE(20)===192;}
/** Caller holds the cache-wide writer lock. Old revisions intentionally remain. */
export async function publishAvatar(root:string,manifest:AvatarManifest,input:{id:number;channelId:string;sourceUrl:string;png:Buffer;sourceWidth:number;sourceHeight:number;cachedAt:string}):Promise<ChannelAvatar>{
 if(!isChannelAssetId(input.id)||!validChannel(input.channelId)||input.png.length>MEDIA_LIMITS.outputBytes||!validPublishedPng(input.png))fail('INVALID_ASSET');
 root=await checkedRoot(root);const revision=hash(input.png),next:AvatarManifest={version:1,entries:{...manifest.entries,[input.id]:{channelId:input.channelId,revision,cachedAt:input.cachedAt,sourceHash:hash(input.sourceUrl),sourceWidth:input.sourceWidth,sourceHeight:input.sourceHeight,format:'png'}} as AvatarManifest['entries']};
 const metadata=Buffer.from(JSON.stringify(next));parseManifest(metadata);
 const channels=await directory(root,'channels',true),channel=await directory(channels,String(input.id),true),path=join(channel,revision+'.png');
 try{const old=await readBoundedFile(path,MEDIA_LIMITS.outputBytes);if(!old.equals(input.png))fail('INVALID_ASSET');}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;const files=await readdir(channel);if(files.length>=64||files.filter(f=>/^[a-f0-9]{64}\.png$/.test(f)).length>=MEDIA_LIMITS.revisions)fail('CACHE_REVISION_LIMIT');await atomicWrite(path,input.png);}
 await atomicWrite(join(root,'manifest.json'),metadata);manifest.entries=next.entries;
 return {url:channelAvatarUrl(input.id,revision)!,revision,width:192,height:192,cachedAt:input.cachedAt};
}
