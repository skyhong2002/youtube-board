import {describe,it,expect,beforeAll,afterEach} from 'vitest';
import {mkdtemp,rm,readFile,writeFile,symlink,link,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {crc32} from 'node:zlib';
import type {ClientRequest,IncomingMessage} from 'node:http';
import sharp from 'sharp';
import {canonicalVideoThumbnail,channelAvatarUrl,isChannelAvatar} from '../../shared/media-assets.js';
import {readChannelAvatars,readCachedChannelIds} from '../../shared/media-cache/index.js';
import {MEDIA_LIMITS,MediaCacheError,withCacheWriter,writableManifest,publishAvatar,readAvatarBytes,readManifest} from '../../shared/media-cache/store.js';
import {avatarSourceUrl,publicMediaAddress,downloadAvatar,type MediaRequest} from '../../shared/media-cache/download.js';
import {normalizeAvatar} from '../../shared/media-cache/transform.js';
import {refreshChannelAvatars} from '../src/media-avatars.js';
const source='https://yt3.ggpht.com/avatar',channelId='UC'+'A'.repeat(22),now=new Date('2026-10-12T00:00:00Z'),roots:string[]=[];
let png:Buffer;const originalRoot=process.env.MEDIA_CACHE_ROOT;
beforeAll(async()=>{png=await sharp({create:{width:192,height:192,channels:4,background:'#ff0000'}}).png().toBuffer();});
afterEach(async()=>{if(originalRoot===undefined)delete process.env.MEDIA_CACHE_ROOT;else process.env.MEDIA_CACHE_ROOT=originalRoot;await Promise.all(roots.splice(0).map(p=>rm(p,{recursive:true,force:true})));});
async function root(){const r=await mkdtemp(join(tmpdir(),'yt-avatar-'));roots.push(r);return r;}
const input=(id=1)=>({id,channelId,sourceUrl:source});
const dependencies=()=>({download:async()=>png,transform:async()=>({png,sourceWidth:192,sourceHeight:192}),now:()=>now});
async function seed(r:string,id=1,bytes=png){return withCacheWriter(r,async()=>publishAvatar(r,await writableManifest(r),{...input(id),png:bytes,sourceWidth:192,sourceHeight:192,cachedAt:now.toISOString()}));}
function apngFixture(){
 const chunk=(type:string,data:Buffer)=>{const len=Buffer.alloc(4);len.writeUInt32BE(data.length);const body=Buffer.concat([Buffer.from(type),data]),crc=Buffer.alloc(4);crc.writeUInt32BE(crc32(body));return Buffer.concat([len,body,crc]);};
 const chunks:Array<{type:string;data:Buffer;raw:Buffer}>=[];for(let pos=8;pos<png.length;){const len=png.readUInt32BE(pos),type=png.toString('ascii',pos+4,pos+8);chunks.push({type,data:png.subarray(pos+8,pos+8+len),raw:png.subarray(pos,pos+12+len)});pos+=len+12;}
 const actl=Buffer.alloc(8);actl.writeUInt32BE(2,0);
 const fctl=(seq:number)=>{const d=Buffer.alloc(26);d.writeUInt32BE(seq,0);d.writeUInt32BE(192,4);d.writeUInt32BE(192,8);d.writeUInt16BE(1,20);d.writeUInt16BE(10,22);return chunk('fcTL',d);};
 const idat=Buffer.concat(chunks.filter(c=>c.type==='IDAT').map(c=>c.data)),seq=Buffer.alloc(4);seq.writeUInt32BE(2);
 return Buffer.concat([png.subarray(0,8),chunks[0]!.raw,chunk('acTL',actl),fctl(0),...chunks.filter(c=>!['IHDR','IEND'].includes(c.type)).map(c=>c.raw),fctl(1),chunk('fdAT',Buffer.concat([seq,idat])),chunks.at(-1)!.raw]);
}

describe('media identity and local cache',()=>{
 it('canonical URLs preserve exact case and reject arbitrary input',()=>{
  expect(canonicalVideoThumbnail('AbC_123xYz9')).toBe('https://i.ytimg.com/vi/AbC_123xYz9/mqdefault.jpg');
  for(const id of ['../secret','https://x.test','x','a'.repeat(12)])expect(canonicalVideoThumbnail(id)).toBeNull();
  expect(channelAvatarUrl(1,'a'.repeat(64))).toBe('/media/channels/1/'+ 'a'.repeat(64)+'.png');
  expect(channelAvatarUrl(0,'a'.repeat(64))).toBeNull();expect(channelAvatarUrl(1,'../x')).toBeNull();
 });
 it('missing cache is empty without DB or network and exact identity is required',async()=>{
  delete process.env.MEDIA_CACHE_ROOT;expect((await readChannelAvatars([input()])).size).toBe(0);expect((await readCachedChannelIds()).size).toBe(0);
  const r=await root();process.env.MEDIA_CACHE_ROOT=r;expect((await readChannelAvatars([input()])).size).toBe(0);
  const avatar=await seed(r);expect(isChannelAvatar(avatar)).toBe(true);expect((await readChannelAvatars([input()])).get(1)).toEqual(avatar);
  expect((await readChannelAvatars([{id:1,channelId:channelId.toLowerCase()}])).size).toBe(0);
  expect((await readCachedChannelIds()).has(1)).toBe(true);
  for(const changed of [{...avatar,url:'https://evil.test/x'},{...avatar,url:avatar.url.replace('/1/','/01/')},{...avatar,revision:'b'.repeat(64)},{...avatar,width:10},{...avatar,cachedAt:'2026-02-30T00:00:00.000Z'}])expect(isChannelAvatar(changed)).toBe(false);
 });
 it('manifest replacements invalidate memo immediately and corruption cannot reuse old identities',async()=>{
  const r=await root();process.env.MEDIA_CACHE_ROOT=r;await seed(r);expect((await readChannelAvatars([input()])).size).toBe(1);
  await writeFile(join(r,'manifest.json'),'broken');expect(await readManifest(r)).toBeNull();expect((await readCachedChannelIds()).size).toBe(0);expect((await readChannelAvatars([input()])).size).toBe(0);
  await expect(writableManifest(r)).rejects.toThrow('INVALID_MANIFEST');
 });
 it('symlink roots/files and hardlink blobs are refused',async()=>{
  const r=await root(),avatar=await seed(r),other=await root(),alias=join(other,'alias');await symlink(r,alias);expect(await readManifest(alias)).toBeNull();
  const file=join(r,'channels','1',avatar.revision+'.png');await link(file,join(other,'copy'));await expect(readAvatarBytes(r,1,avatar.revision)).rejects.toThrow('INVALID_CACHE_FILE');
  await rm(join(other,'copy'));await rm(file);await symlink(join(other,'unavailable'),file);await expect(readAvatarBytes(r,1,avatar.revision)).rejects.toThrow();
 });
 it('exclusive writer lock fails closed and release follows failure',async()=>{
  const r=await root();await withCacheWriter(r,async()=>{await expect(withCacheWriter(r,async()=>{})).rejects.toThrow('CACHE_WRITER_BUSY');});
  await expect(withCacheWriter(r,async()=>{throw Error('offline failure');})).rejects.toThrow('offline failure');await expect(withCacheWriter(r,async()=>true)).resolves.toBe(true);
 });
 it('identical revisions are stable; revision ceiling keeps the active last-good asset',async()=>{
  const r=await root(),first=await seed(r);expect(await seed(r)).toEqual(first);
  let last=first;for(let i=1;i<MEDIA_LIMITS.revisions;i++)last=await seed(r,1,Buffer.concat([png,Buffer.from([i])]));
  await expect(seed(r,1,Buffer.concat([png,Buffer.from([99])]))).rejects.toThrow('CACHE_REVISION_LIMIT');
  expect((await readManifest(r))?.entries['1']?.revision).toBe(last.revision);expect(await readAvatarBytes(r,1,first.revision)).toEqual(png);
 });
});

function transport(body:Buffer,config:{status?:number;mime?:string;length?:string;chunks?:readonly Buffer[]}={},inspect?:(options:Parameters<MediaRequest>[0])=>void):MediaRequest{
 return (options,callback)=>{inspect?.(options);const req=new EventEmitter() as ClientRequest;
  req.destroy=(()=>req) as ClientRequest['destroy'];req.end=(()=>{queueMicrotask(()=>{const res=new PassThrough() as unknown as PassThrough&IncomingMessage;res.statusCode=config.status??200;res.headers={'content-type':config.mime??'image/png',...(config.length===undefined?{}:{'content-length':config.length})};callback(res);if(!res.destroyed){for(const chunk of config.chunks??[body]){if(res.destroyed)break;res.write(chunk);}if(!res.destroyed)res.end();}});return req;}) as ClientRequest['end'];return req;
 };
}
describe('avatar download boundary (offline transport)',()=>{
 it('rejects arbitrary hosts, credentials, private/mapped/special IP ranges',()=>{
  for(const url of ['http://yt3.ggpht.com/x','https://yt3.ggpht.com.evil.test/x','https://foo.googleusercontent.com/x','https://user@yt3.ggpht.com/x','https://yt3.ggpht.com:444/x','https://yt3.ggpht.com/x#fragment','https://127.0.0.1/x','https://yt3.ggpht.com/%0a'])expect(()=>avatarSourceUrl(url)).toThrow('SOURCE_URL_REJECTED');
  for(const ip of ['127.0.0.1','10.0.0.1','100.85.214.25','169.254.169.254','192.168.1.1','198.18.0.1','203.0.113.4','224.0.0.1','::1','::ffff:127.0.0.1','fe80::1','fc00::1','2001:db8::1','2002:7f00:1::'])expect(publicMediaAddress(ip),ip).toBe(false);
  expect(publicMediaAddress('142.250.1.1')).toBe(true);expect(publicMediaAddress('2001:4860:4860::8888')).toBe(true);
 });
 it('checks every DNS answer and pins actual connection address with original TLS hostname',async()=>{
  let requests=0;await expect(downloadAvatar(source,{lookup:async()=>[{address:'142.250.1.1',family:4},{address:'10.0.0.1',family:4}],request:transport(png,{},()=>{requests++;})})).rejects.toThrow('SOURCE_ADDRESS_REJECTED');expect(requests).toBe(0);
  let options:Parameters<MediaRequest>[0]|undefined;expect(await downloadAvatar(source,{lookup:async()=>[{address:'142.250.1.1',family:4}],request:transport(png,{},o=>{options=o;})})).toEqual(png);
  expect(options).toMatchObject({hostname:'yt3.ggpht.com',servername:'yt3.ggpht.com',rejectUnauthorized:true,agent:false,family:4,autoSelectFamily:false});
  let pinned:unknown[]=[];(options!.lookup as Function)('changed.test',{},(...args:unknown[])=>{pinned=args;});expect(pinned).toEqual([null,'142.250.1.1',4]);
 });
 it('refuses redirects, spoofed MIME/body, oversized declared/streamed bodies and run budgets',async()=>{
  const lookup=async()=>[{address:'142.250.1.1',family:4}];
  for(const [body,config,code]of [[png,{status:302},'REDIRECT_REJECTED'],[png,{mime:'text/html'},'IMAGE_TYPE_REJECTED'],[Buffer.from('<svg/>'),{},'IMAGE_TYPE_REJECTED'],[png,{length:String(MEDIA_LIMITS.inputBytes+1)},'DOWNLOAD_TOO_LARGE'],[png,{chunks:[png,Buffer.alloc(MEDIA_LIMITS.inputBytes)]},'DOWNLOAD_TOO_LARGE'],[png,{length:'1'},'DOWNLOAD_FAILED']] as const)await expect(downloadAvatar(source,{lookup,request:transport(body,config)})).rejects.toThrow(code);
  await expect(downloadAvatar(source,{lookup,request:transport(png),consume:()=>{throw Error();}})).rejects.toThrow('RUN_BYTE_BUDGET');
 });
 it('cancellation during DNS never initiates a request',async()=>{
  const abort=new AbortController();let calls=0;const result=downloadAvatar(source,{signal:abort.signal,lookup:async()=>new Promise(()=>{}),request:transport(png,{},()=>{calls++;})});abort.abort();await expect(result).rejects.toThrow('DOWNLOAD_TIMEOUT');expect(calls).toBe(0);
 });
 it('cancellation after response headers destroys both stream and pinned request',async()=>{
  const abort=new AbortController();let destroyed=false,response:PassThrough&IncomingMessage|undefined;
  const request:MediaRequest=(_options,callback)=>{const req=new EventEmitter() as ClientRequest;req.destroy=(()=>{destroyed=true;return req;}) as ClientRequest['destroy'];req.end=(()=>{queueMicrotask(()=>{response=new PassThrough() as unknown as PassThrough&IncomingMessage;response.statusCode=200;response.headers={'content-type':'image/png'};callback(response);abort.abort();});return req;}) as ClientRequest['end'];return req;};
  await expect(downloadAvatar(source,{signal:abort.signal,lookup:async()=>[{address:'142.250.1.1',family:4}],request})).rejects.toThrow('DOWNLOAD_TIMEOUT');expect(destroyed).toBe(true);expect(response?.destroyed).toBe(true);
 });
});

describe('bounded raster transformation and refresh',()=>{
 it('normalizes raster to192PNG and rejects malformed, nonraster and oversized dimensions',async()=>{
  const small=await sharp({create:{width:32,height:16,channels:3,background:'#abcdef'}}).jpeg().toBuffer(),r=await normalizeAvatar(small),m=await sharp(r.png).metadata();expect(r).toMatchObject({sourceWidth:32,sourceHeight:16});expect(m).toMatchObject({width:192,height:192,format:'png'});
  await expect(normalizeAvatar(Buffer.from('<svg/>'))).rejects.toThrow('IMAGE_TYPE_REJECTED');await expect(normalizeAvatar(png.subarray(0,24))).rejects.toThrow('IMAGE_TYPE_REJECTED');
  const large=await sharp({create:{width:5000,height:16,channels:3,background:'#abcdef'}}).png().toBuffer();await expect(normalizeAvatar(large)).rejects.toThrow('IMAGE_TRANSFORM_FAILED');
 });
 it('rejects animation even when the decoder defaults to its first frame',async()=>{
  const raw=Buffer.concat([Buffer.alloc(16*16*3,10),Buffer.alloc(16*16*3,200)]),animated=await sharp(raw,{raw:{width:16,height:32,channels:3,pageHeight:16}}).webp({loop:0,delay:[100,100]}).toBuffer();expect((await sharp(animated).metadata()).pages).toBe(2);await expect(normalizeAvatar(animated)).rejects.toThrow('IMAGE_TRANSFORM_FAILED');
 });
 it('rejects real APNG when libvips does not expose pages and preserves the active asset',async()=>{
  const animated=apngFixture();expect((await sharp(animated).metadata()).pages).toBeUndefined();await expect(normalizeAvatar(animated)).rejects.toThrow('IMAGE_ANIMATION_REJECTED');
  const r=await root(),first=await seed(r),result=await refreshChannelAvatars({root:r,channels:[{...input(),sourceUrl:source+'/animated'}],execute:true,assertOwnership:async()=>{}},{download:async()=>animated,now:()=>now});
  expect(result.results).toEqual([{id:1,status:'failed',code:'IMAGE_ANIMATION_REJECTED'}]);expect((await readManifest(r))?.entries['1']?.revision).toBe(first.revision);expect(await readAvatarBytes(r,1,first.revision)).toEqual(png);
 });
 it('dry run creates no cache or downloads and execute requires explicit ownership',async()=>{
  const r=join(await root(),'absent');let calls=0;const dry=await refreshChannelAvatars({root:r,channels:[input()]},{download:async()=>{calls++;return png;}});expect(dry.results[0]?.status).toBe('planned');expect(dry.lastProcessedId).toBeNull();expect(calls).toBe(0);await expect(readFile(join(r,'manifest.json'))).rejects.toThrow();await expect(refreshChannelAvatars({root:r,channels:[input()],execute:true})).rejects.toThrow('REFRESH_EXECUTION_DISABLED');
 });
 it('fresh cache skips network and failed refresh retains last-good bytes/metadata',async()=>{
  const r=await root(),first=await seed(r);let calls=0;const deps={...dependencies(),download:async()=>{calls++;throw Error('never disclose provider body');}};
  const fresh=await refreshChannelAvatars({root:r,channels:[input()],execute:true,assertOwnership:async()=>{}},deps);expect(fresh.results[0]?.status).toBe('fresh');expect(calls).toBe(0);
  const failed=await refreshChannelAvatars({root:r,channels:[{...input(),sourceUrl:source+'/changed'}],execute:true,assertOwnership:async()=>{}},deps);expect(failed.results[0]).toEqual({id:1,status:'failed',code:'DOWNLOAD_FAILED'});expect(JSON.stringify(failed)).not.toContain('provider');expect((await readManifest(r))?.entries['1']?.revision).toBe(first.revision);expect(await readAvatarBytes(r,1,first.revision)).toEqual(png);
 });
 it('invalid legacy identities are per-item failures; processing is bounded and cursor honest',async()=>{
  const r=await root(),result=await refreshChannelAvatars({root:r,channels:[{...input(1),channelId:'legacy'},input(2),input(3)],limit:2,execute:true,assertOwnership:async()=>{}},dependencies());expect(result.results.map(r=>r.status)).toEqual(['failed','updated']);expect(result.results[0]?.code).toBe('INVALID_CHANNEL_ID');expect(result).toMatchObject({lastProcessedId:2,truncated:true});
 });
 it('ownership loss before publication is fatal and no avatar pointer is committed',async()=>{
  const r=await root();let checks=0;await expect(refreshChannelAvatars({root:r,channels:[input()],execute:true,assertOwnership:async()=>{if(++checks===3)throw Error('ownership lost');}},dependencies())).rejects.toThrow('ownership lost');expect(await readManifest(r)).toBeNull();
 });
 it('run byte limit stops before untouched later IDs and does not claim their completion',async()=>{
  const r=await root(),result=await refreshChannelAvatars({root:r,channels:Array.from({length:20},(_,i)=>input(i+1)),execute:true,assertOwnership:async()=>{}},{...dependencies(),download:async()=>Buffer.alloc(MEDIA_LIMITS.inputBytes)});
  expect(result).toMatchObject({downloadedBytes:MEDIA_LIMITS.runBytes,lastProcessedId:16,truncated:true});expect(result.results).toHaveLength(16);
 });
 it('run cancellation stops publication and leaves the cursor before the interrupted batch',async()=>{
  const r=await root(),abort=new AbortController(),result=await refreshChannelAvatars({root:r,channels:Array.from({length:4},(_,i)=>({...input(i+1),sourceUrl:source+'/'+(i+1)})),signal:abort.signal,execute:true,assertOwnership:async()=>{}},{...dependencies(),download:async url=>{if(url.endsWith('/4'))abort.abort();return png;}});
  expect(result).toMatchObject({lastProcessedId:2,truncated:true});expect(result.results.map(item=>item.id)).toEqual([1,2]);expect(Object.keys((await readManifest(r))!.entries)).toEqual(['1','2']);
 });
 it.each([3,4])('budget interruption at item %i cannot skip the unfinished item or publish across it',async interruptedId=>{
  const r=await root(),result=await refreshChannelAvatars({root:r,channels:Array.from({length:4},(_,i)=>({...input(i+1),sourceUrl:source+'/'+(i+1)})),execute:true,assertOwnership:async()=>{}},{...dependencies(),download:async url=>{if(url.endsWith('/'+interruptedId))throw new MediaCacheError('RUN_BYTE_BUDGET');return png;}});
  expect(result).toMatchObject({lastProcessedId:interruptedId-1,truncated:true});expect(result.results.map(item=>item.id)).toEqual(Array.from({length:interruptedId-1},(_,i)=>i+1));expect(Object.keys((await readManifest(r))!.entries)).toEqual(Array.from({length:interruptedId-1},(_,i)=>String(i+1)));
 });
 it('completed fresh and ordinary failed items remain in the contiguous prefix before a budget stop',async()=>{
  const r=await root();await seed(r);const result=await refreshChannelAvatars({root:r,channels:[input(1),{...input(2),sourceUrl:source+'/bad'},{...input(3),sourceUrl:source+'/budget'},input(4)],execute:true,assertOwnership:async()=>{}},{...dependencies(),download:async url=>{throw new MediaCacheError(url.endsWith('/budget')?'RUN_BYTE_BUDGET':'DOWNLOAD_STATUS');}});
  expect(result).toMatchObject({lastProcessedId:2,truncated:true});expect(result.results.map(item=>item.status)).toEqual(['fresh','failed']);expect(Object.keys((await readManifest(r))!.entries)).toEqual(['1']);
 });
});
