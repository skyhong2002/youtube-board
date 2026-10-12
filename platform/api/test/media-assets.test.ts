import {it,expect,afterEach} from 'vitest';
import Fastify from 'fastify';
import sharp from 'sharp';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {registerMediaAssets} from '../src/media-assets/index.js';
import {withCacheWriter,writableManifest,publishAvatar} from '../../shared/media-cache/store.js';
const roots:string[]=[],apps:ReturnType<typeof Fastify>[]=[],previous=process.env.MEDIA_CACHE_ROOT;
afterEach(async()=>{await Promise.all(apps.splice(0).map(a=>a.close()));await Promise.all(roots.splice(0).map(r=>rm(r,{recursive:true,force:true})));if(previous===undefined)delete process.env.MEDIA_CACHE_ROOT;else process.env.MEDIA_CACHE_ROOT=previous;});
function app(){const a=Fastify();registerMediaAssets(a);apps.push(a);return a;}
async function fixture(){const root=await mkdtemp(join(tmpdir(),'yt-media-http-'));roots.push(root);process.env.MEDIA_CACHE_ROOT=root;const png=await sharp({create:{width:192,height:192,channels:4,background:'#ff0000'}}).png().toBuffer();const asset=await withCacheWriter(root,async()=>publishAvatar(root,await writableManifest(root),{id:7,channelId:'UC'+'A'.repeat(22),sourceUrl:'https://yt3.ggpht.com/avatar',png,sourceWidth:192,sourceHeight:192,cachedAt:'2026-10-12T00:00:00.000Z'}));return {root,png,asset};}
it('serves immutable local PNG with HEAD/ETag and no source-provider dependency',async()=>{
 const {png,asset}=await fixture(),a=app(),r=await a.inject(asset.url);expect(r.statusCode).toBe(200);expect(r.rawPayload).toEqual(png);expect(r.headers).toMatchObject({'content-type':'image/png','cache-control':'public, max-age=31536000, immutable','x-content-type-options':'nosniff',etag:`"${asset.revision}"`});const head=await a.inject({method:'HEAD',url:asset.url});expect(head.statusCode).toBe(200);expect(head.body).toBe('');expect(head.headers['content-length']).toBe(String(png.length));const unchanged=await a.inject({url:asset.url,headers:{'if-none-match':`"${asset.revision}"`}});expect(unchanged.statusCode).toBe(304);expect(unchanged.body).toBe('');
});
it('missing roots/assets, malformed IDs/revisions and corrupted files return404 without redirects',async()=>{
 const a=app();delete process.env.MEDIA_CACHE_ROOT;expect((await a.inject('/media/channels/7/'+ 'a'.repeat(64)+'.png')).statusCode).toBe(404);const {root,asset}=await fixture();
 for(const url of ['/media/channels/07/'+asset.revision+'.png','/media/channels/9007199254740992/'+asset.revision+'.png','/media/channels/7/invalid.png','/media/channels/8/'+asset.revision+'.png']){const r=await a.inject(url);expect(r.statusCode).toBe(404);expect(r.headers.location).toBeUndefined();}
 await writeFile(join(root,'channels','7',asset.revision+'.png'),'corrupt');const bad=await a.inject(asset.url);expect(bad.statusCode).toBe(404);expect(bad.headers['cache-control']).toBe('no-store');
});
it('serves only precomputed finite WebP derivatives with distinct immutable ETags and HEAD',async()=>{
 const {asset}=await fixture(),a=app();
 for(const width of [48,96,192]){
  const url=`/media/channels/7/${asset.revision}/${width}.webp`,r=await a.inject(url);
  expect(r.statusCode).toBe(200);expect(r.headers['content-type']).toBe('image/webp');expect(r.headers['cache-control']).toContain('immutable');
  expect(await sharp(r.rawPayload).metadata()).toMatchObject({width,height:width,format:'webp'});
  const head=await a.inject({url,method:'HEAD'});expect(head.statusCode).toBe(200);expect(head.body).toBe('');expect(head.headers['content-length']).toBe(String(r.rawPayload.length));
  expect((await a.inject({url,headers:{'if-none-match':String(r.headers.etag)}})).statusCode).toBe(304);
 }
 for(const suffix of ['49.webp','048.webp','192.png','999999999999999999999.webp','../48.webp','%2e%2e%2f48.webp']){
  const r=await a.inject(`/media/channels/7/${asset.revision}/${suffix}`);expect(r.statusCode).toBe(404);
 }
 const missing=await a.inject(`/media/channels/8/${asset.revision}/48.webp`);expect(missing.statusCode).toBe(404);expect(missing.headers['cache-control']).toBe('no-store');
});
