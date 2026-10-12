import {constants} from 'node:fs';
import {mkdir,open,lstat,realpath,rename,unlink,readdir,link} from 'node:fs/promises';
import {isAbsolute,join,resolve,dirname} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {channelAvatarUrl,isChannelAssetId,isMediaRevision,type ChannelAvatar,channelAvatarWebpUrl,AVATAR_WEBP_WIDTHS,type AvatarWebpWidth} from '../media-assets.js';

export const MEDIA_LIMITS=Object.freeze({manifestBytes:8*1024*1024,entries:50000,inputBytes:2*1024*1024,outputBytes:512*1024,pixels:16*1024*1024,dimension:4096,runBytes:32*1024*1024,revisions:16,webpBytes:64*1024});
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
async function atomicWrite(path:string,body:Buffer,signal?:AbortSignal){
 const temporary=path+'.'+randomUUID()+'.tmp';let handle;
 try{handle=await open(temporary,'wx',0o640);await handle.writeFile(body);await handle.sync();await handle.close();handle=undefined;signal?.throwIfAborted();await rename(temporary,path);await syncDirectory(dirname(path));}
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
export async function publishAvatar(root:string,manifest:AvatarManifest,input:{id:number;channelId:string;sourceUrl:string;png:Buffer;sourceWidth:number;sourceHeight:number;cachedAt:string},signal?:AbortSignal):Promise<ChannelAvatar>{
 signal?.throwIfAborted();
 if(!isChannelAssetId(input.id)||!validChannel(input.channelId)||input.png.length>MEDIA_LIMITS.outputBytes||!validPublishedPng(input.png))fail('INVALID_ASSET');
 root=await checkedRoot(root);const revision=hash(input.png),next:AvatarManifest={version:1,entries:{...manifest.entries,[input.id]:{channelId:input.channelId,revision,cachedAt:input.cachedAt,sourceHash:hash(input.sourceUrl),sourceWidth:input.sourceWidth,sourceHeight:input.sourceHeight,format:'png'}} as AvatarManifest['entries']};
 const metadata=Buffer.from(JSON.stringify(next));parseManifest(metadata);
 const channels=await directory(root,'channels',true),channel=await directory(channels,String(input.id),true),path=join(channel,revision+'.png');
 try{const old=await readBoundedFile(path,MEDIA_LIMITS.outputBytes);if(!old.equals(input.png))fail('INVALID_ASSET');}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;const files=await readdir(channel);if(files.length>=64||files.filter(f=>/^[a-f0-9]{64}\.png$/.test(f)).length>=MEDIA_LIMITS.revisions)fail('CACHE_REVISION_LIMIT');await writeImmutable(path,input.png);await readAvatarBytes(root,input.id,revision);}
 await publishAvatarDerivatives(root,input.id,revision,input.png,signal);
 signal?.throwIfAborted();
 await atomicWrite(join(root,'manifest.json'),metadata,signal);manifest.entries=next.entries;
 return {url:channelAvatarUrl(input.id,revision)!,revision,width:192,height:192,cachedAt:input.cachedAt};
}

/** Cheap format/dimension check; native decoding only happens in the writer subprocess. */
export function validAvatarWebp(bytes:Buffer,width:AvatarWebpWidth):boolean{
 if(bytes.length<30||bytes.length>MEDIA_LIMITS.webpBytes||bytes.toString('ascii',0,4)!=='RIFF'||bytes.toString('ascii',8,12)!=='WEBP'||bytes.readUInt32LE(4)+8!==bytes.length)return false;
 let at=12,canvas=false,image=false;
 while(at<bytes.length){
  if(at+8>bytes.length)return false;
  const type=bytes.toString('ascii',at,at+4),length=bytes.readUInt32LE(at+4),start=at+8;
  if(length>bytes.length-start)return false;
  let w:number|undefined,h:number|undefined;
  if(type==='ANIM'||type==='ANMF')return false;
  if(type==='VP8X'){if(canvas||length!==10||(bytes[start]!&2))return false;canvas=true;w=bytes.readUIntLE(start+4,3)+1;h=bytes.readUIntLE(start+7,3)+1;}
  if(type==='VP8 '){if(image||length<10||!bytes.subarray(start+3,start+6).equals(Buffer.from([0x9d,1,0x2a])))return false;image=true;w=bytes.readUInt16LE(start+6)&0x3fff;h=bytes.readUInt16LE(start+8)&0x3fff;}
  if(type==='VP8L'){if(image||length<5||bytes[start]!==0x2f)return false;image=true;const bits=bytes.readUInt32LE(start+1);w=(bits&0x3fff)+1;h=((bits>>>14)&0x3fff)+1;}
  if(w!==undefined&&(w!==width||h!==width))return false;
  at=start+length+(length%2);
 }
 return at===bytes.length&&image;
}
export async function readAvatarWebpBytes(root:string,id:number,revision:string,width:AvatarWebpWidth):Promise<Buffer>{
 if(!channelAvatarWebpUrl(id,revision,width))fail('INVALID_ASSET');
 const base=await checkedRoot(root),channels=await directory(base,'channels'),channel=await directory(channels,String(id)),derivatives=await directory(channel,revision);
 const bytes=await readBoundedFile(join(derivatives,width+'.webp'),MEDIA_LIMITS.webpBytes);
 if(!validAvatarWebp(bytes,width))fail('INVALID_ASSET');return bytes;
}
/** Exclusive publication never changes a served immutable URL, even after a codec upgrade. */
async function writeImmutable(path:string,body:Buffer){
 const temporary=path+'.'+randomUUID()+'.tmp';let handle;
 try{
  handle=await open(temporary,'wx',0o640);await handle.writeFile(body);await handle.sync();await handle.close();handle=undefined;
  try{await link(temporary,path);}catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;}
  await unlink(temporary);await syncDirectory(dirname(path));
 }finally{await handle?.close();await unlink(temporary).catch(()=>{});}
}
/** Caller holds withCacheWriter. Local PNG only; no requests/manifest edits/deletion. */
export async function publishAvatarDerivatives(root:string,id:number,revision:string,png?:Buffer,signal?:AbortSignal):Promise<number>{
 if(!channelAvatarUrl(id,revision))fail('INVALID_ASSET');
 const source=png??await readAvatarBytes(root,id,revision);
 if(source.length>MEDIA_LIMITS.outputBytes||!validPublishedPng(source)||hash(source)!==revision)fail('INVALID_ASSET');
 const missing:AvatarWebpWidth[]=[];
 for(const width of AVATAR_WEBP_WIDTHS){try{await readAvatarWebpBytes(root,id,revision,width);}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;missing.push(width);}}
 if(!missing.length)return 0;
 signal?.throwIfAborted();
 const {avatarWebpDerivatives}=await import('./webp-transform.js'),outputs=await avatarWebpDerivatives(source,signal);
 const base=await checkedRoot(root),channels=await directory(base,'channels'),channel=await directory(channels,String(id)),derivatives=await directory(channel,revision,true);
 let bytes=0;
 for(const width of missing){signal?.throwIfAborted();const body=outputs.get(width)!;if(!validAvatarWebp(body,width))fail('INVALID_ASSET');await writeImmutable(join(derivatives,width+'.webp'),body);await readAvatarWebpBytes(root,id,revision,width);bytes+=body.length;}
 return bytes;
}
