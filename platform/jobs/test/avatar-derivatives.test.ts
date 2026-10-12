import {it,expect,afterEach,vi} from 'vitest';
import * as webpEncoder from '../../shared/media-cache/webp-transform.js';
import sharp from 'sharp';
import {mkdtemp,rm,readFile,writeFile,symlink,link,stat,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {withCacheWriter,writableManifest,publishAvatar,readAvatarWebpBytes,publishAvatarDerivatives,MEDIA_LIMITS} from '../../shared/media-cache/store.js';
import {channelAvatarWebpUrl,AVATAR_WEBP_WIDTHS} from '../../shared/media-assets.js';
import {avatarWebpDerivatives} from '../../shared/media-cache/webp-transform.js';
import {backfillAvatarDerivatives} from '../../shared/media-cache/derivative-backfill.js';
const roots:string[]=[];
afterEach(async()=>{await Promise.all(roots.splice(0).map(r=>rm(r,{recursive:true,force:true})));});
async function fixture(){const root=await mkdtemp(join(tmpdir(),'yt-webp-'));roots.push(root);const png=await sharp({create:{width:192,height:192,channels:4,background:'#f00'}}).png().toBuffer();const asset=await withCacheWriter(root,async()=>publishAvatar(root,await writableManifest(root),{id:7,channelId:'UC'+'a'.repeat(22),sourceUrl:'https://yt3.ggpht.com/avatar',png,sourceWidth:192,sourceHeight:192,cachedAt:'2026-10-12T00:00:00.000Z'}));return {root,png,asset,dir:join(root,'channels','7',asset.revision)};}
it('keeps PNG and manifest contract; finite derivatives are stable, bounded and never rewritten',async()=>{
 const {root,png,asset,dir}=await fixture(),manifest=await readFile(join(root,'manifest.json'));
 expect(await readFile(join(root,'channels','7',asset.revision+'.png'))).toEqual(png);
 for(const width of AVATAR_WEBP_WIDTHS){const bytes=await readAvatarWebpBytes(root,7,asset.revision,width);expect(bytes.length).toBeLessThanOrEqual(MEDIA_LIMITS.webpBytes);expect(await sharp(bytes).metadata()).toMatchObject({width,height:width,format:'webp'});}
 const file=join(dir,'48.webp'),before=await stat(file);
 expect(await withCacheWriter(root,()=>publishAvatarDerivatives(root,7,asset.revision))).toBe(0);
 expect((await stat(file)).mtimeMs).toBe(before.mtimeMs);expect(await readFile(join(root,'manifest.json'))).toEqual(manifest);
 expect(channelAvatarWebpUrl(7,asset.revision,48)).toBe(`/media/channels/7/${asset.revision}/48.webp`);
 for(const width of [0,16,49,640,NaN])expect(channelAvatarWebpUrl(7,asset.revision,width)).toBeNull();
 expect(channelAvatarWebpUrl(0,asset.revision,48)).toBeNull();expect(channelAvatarWebpUrl(7,'../x',48)).toBeNull();
});
it('rejects symlinks, hardlinks, bad dimensions and oversized blobs without replacing existing files',async()=>{
 const {root,asset,dir}=await fixture(),file=join(dir,'48.webp'),copy=join(root,'copy');
 await link(file,copy);await expect(readAvatarWebpBytes(root,7,asset.revision,48)).rejects.toThrow('INVALID_CACHE_FILE');await rm(copy);
 await rm(file);await symlink(join(dir,'96.webp'),file);await expect(readAvatarWebpBytes(root,7,asset.revision,48)).rejects.toThrow();await rm(file);
 await writeFile(file,await readFile(join(dir,'96.webp')));await expect(readAvatarWebpBytes(root,7,asset.revision,48)).rejects.toThrow('INVALID_ASSET');
 await expect(withCacheWriter(root,()=>publishAvatarDerivatives(root,7,asset.revision))).rejects.toThrow('INVALID_ASSET');
 await writeFile(file,Buffer.alloc(MEDIA_LIMITS.webpBytes+1));await expect(readAvatarWebpBytes(root,7,asset.revision,48)).rejects.toThrow('INVALID_CACHE_FILE');
 await rm(dir,{recursive:true});await symlink(root,dir);await expect(readAvatarWebpBytes(root,7,asset.revision,48)).rejects.toThrow('INVALID_CACHE_DIRECTORY');
});
it('dry run does not write; bounded execute repairs only missing derivatives and respects writer lock',async()=>{
 const {root,asset,dir}=await fixture(),manifest=await readFile(join(root,'manifest.json'));await rm(join(dir,'48.webp'));
 const dry=await backfillAvatarDerivatives({root});expect(dry).toMatchObject({execute:false,planned:1,updated:0,lastProcessedId:7});expect(await readdir(dir)).toEqual(['192.webp','96.webp']);
 await withCacheWriter(root,async()=>{await expect(backfillAvatarDerivatives({root,execute:true})).rejects.toThrow('CACHE_WRITER_BUSY');});
 const run=await backfillAvatarDerivatives({root,execute:true,limit:1});expect(run).toMatchObject({updated:1,failed:0,lastProcessedId:7});expect((await readAvatarWebpBytes(root,7,asset.revision,48)).length).toBeGreaterThan(0);expect(await readFile(join(root,'manifest.json'))).toEqual(manifest);
 expect(await backfillAvatarDerivatives({root,afterId:7})).toMatchObject({processed:0,lastProcessedId:7});
 for(const options of [{limit:501},{delayMs:0},{afterId:-1}])await expect(backfillAvatarDerivatives({root,...options})).rejects.toThrow('INVALID_BACKFILL_INPUT');
});
it('encoder rejects non192PNG, oversize and pre-aborted work',async()=>{
 const wrong=await sharp({create:{width:48,height:48,channels:3,background:'#f00'}}).png().toBuffer();await expect(avatarWebpDerivatives(wrong)).rejects.toThrow('IMAGE_TRANSFORM_FAILED');
 await expect(avatarWebpDerivatives(Buffer.alloc(MEDIA_LIMITS.outputBytes+1))).rejects.toThrow('INVALID_ASSET');
 const {png}=await fixture(),animation=Buffer.alloc(12);animation.write('acTL',4,'ascii');await expect(avatarWebpDerivatives(Buffer.concat([png.subarray(0,33),animation,png.subarray(33)]))).rejects.toThrow('IMAGE_ANIMATION_REJECTED');
 const abort=new AbortController();abort.abort();await expect(avatarWebpDerivatives(png,abort.signal)).rejects.toThrow();
});

it('cancellation after derivative encoding preserves the old manifest and refresh cursor',async()=>{
 const {root}=await fixture(),before=await readFile(join(root,'manifest.json'));
 const png=await sharp({create:{width:192,height:192,channels:4,background:'#00f'}}).png().toBuffer();
 const abort=new AbortController(),encode=webpEncoder.avatarWebpDerivatives;
 const spy=vi.spyOn(webpEncoder,'avatarWebpDerivatives').mockImplementation(async(bytes,signal)=>{const result=await encode(bytes,signal);abort.abort();return result;});
 try{
  const {refreshChannelAvatars}=await import('../src/media-avatars.js');
  const result=await refreshChannelAvatars({root,channels:[{id:7,channelId:'UC'+'a'.repeat(22),sourceUrl:'https://yt3.ggpht.com/changed'}],execute:true,signal:abort.signal,assertOwnership:async()=>{}},{download:async()=>png,transform:async()=>({png,sourceWidth:192,sourceHeight:192})});
  expect(spy).toHaveBeenCalledOnce();expect(result).toMatchObject({truncated:true,lastProcessedId:null,results:[]});
  expect(await readFile(join(root,'manifest.json'))).toEqual(before);
 }finally{spy.mockRestore();}
});
