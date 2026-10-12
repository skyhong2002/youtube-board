import {strict as assert} from 'node:assert';
import {test} from 'node:test';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {firstGrapheme,localAvatarSource} from './media-presentation';
import {ChannelAvatar,avatarWebpSrcSet,nextAvatarStage} from '../components/ChannelAvatar';
import {VideoThumbnail,settledThumbnailState} from '../components/VideoThumbnail';
import {ImageConfigContext} from 'next/dist/shared/lib/image-config-context.shared-runtime';
import {imageConfigDefault} from 'next/dist/shared/lib/image-config';
import config from '../../next.config';
import type {ChannelAvatar as Asset} from '../../../shared/media-assets';
import {VIDEO_BOX_ASPECT,VIDEO_PICTURE_SIZES,VIDEO_SOURCE,coverWidthFactor} from '../app/_home/video-picture-sizes';
// Resolves a `sizes` attribute at a viewport width, for the subset of syntax VIDEO_PICTURE_SIZES uses.
function resolveSizes(sizes:string,vw:number):number {
 for(const entry of sizes.split(/,\s*/)){
  const m=entry.match(/^(?:\(max-width: (\d+)px\) )?(.+)$/)!;if(m[1]&&vw>Number(m[1]))continue;
  const px=m[2].match(/^(\d+)px$/);if(px)return Number(px[1]);
  const c=m[2].match(/^calc\(\(?100vw - (\d+)px\)?((?: [*/] [\d.]+)*)\)$/)!;
  let v=vw-Number(c[1]);for(const [,op,n] of c[2].matchAll(/ ([*/]) ([\d.]+)/g))v=op==='*'?v*Number(n):v/Number(n);return v;
 }
 throw new Error('no sizes entry');
}
const revision='a'.repeat(64),asset:Asset={url:`/media/channels/42/${revision}.png`,revision,width:192,height:192,cachedAt:'2026-10-12T00:00:00Z'};
test('avatars accept only local canonical revisioned assets, never raw source hotlinks',()=>{
 assert.equal(localAvatarSource(asset),asset.url);assert.equal(localAvatarSource(undefined),null);
 for(const patch of [{url:'https://yt3.ggpht.com/image.png'},{url:'//evil.test/image.png'},{url:asset.url+'?url=https://evil.test'},{revision:'b'.repeat(64)},{url:asset.url.replace('/42/','/042/')},{width:96},{url:asset.url.replace('/42/','/9007199254740992/')}])assert.equal(localAvatarSource({...asset,...patch} as Asset),null);
});
test('fallback is one full Unicode grapheme and does not duplicate adjacent source text',()=>{
 assert.equal(firstGrapheme(' 👩🏽‍💻新聞'),'👩🏽‍💻');assert.equal(firstGrapheme('e\u0301conomie'),'e\u0301');assert.equal(firstGrapheme('🇹🇼新聞'),'🇹🇼');assert.equal(firstGrapheme(''),'頻');
 const html=renderToStaticMarkup(createElement(ChannelAvatar,{title:'👩🏽‍💻新聞',size:24}));
 assert.match(html,/aria-hidden="true"/);assert.match(html,/👩🏽‍💻/);assert.match(html,/width:24px;height:24px;min-width:24px/);assert.doesNotMatch(html,/<img|role="img"/);
 const standalone=renderToStaticMarkup(createElement(ChannelAvatar,{title:'頻道名稱',decorative:false}));assert.match(standalone,/role="img" aria-label="頻道名稱"/);
});
test('valid cached avatars render unoptimized decorative images with reserved dimensions',()=>{
 const html=renderToStaticMarkup(createElement(ChannelAvatar,{avatar:asset,title:'新聞',size:24}));
 assert.match(html,/alt=""/);assert.match(html,/width="24" height="24"/);assert.ok(html.includes(`src="${asset.url}"`));assert.doesNotMatch(html,/_next\/image|yt3\./);
});
test('avatars offer bounded precomputed WebP derivatives sized to the rendered box, with the PNG as img fallback',()=>{
 const base=`/media/channels/42/${revision}`,srcSet=`${base}/48.webp 48w, ${base}/96.webp 96w, ${base}/192.webp 192w`;
 assert.equal(avatarWebpSrcSet(asset.url),srcSet);
 for(const size of [16,24,48,96]){
  const html=renderToStaticMarkup(createElement(ChannelAvatar,{avatar:asset,title:'新聞',size}));
  assert.match(html,/<picture[^>]*><source type="image\/webp"/);assert.ok(html.includes(`srcSet="${srcSet}"`)||html.includes(`srcset="${srcSet}"`),html);
  assert.ok(html.includes(`sizes="${size}px"`),html);assert.equal(html.match(/<img /g)?.length,1);
  assert.match(html,new RegExp(`<img [^>]*src="${asset.url}"[^>]*width="${size}" height="${size}"[^>]*loading="lazy"`));
  assert.ok(html.includes(`width:${size}px;height:${size}px;min-width:${size}px`));assert.doesNotMatch(html,/_next\/image|yt3\.|\.png\//);
 }
});
test('WebP derivatives are never derived from malformed or foreign avatar sources',()=>{
 for(const src of [null,'',`https://evil.test/media/channels/42/${revision}.png`,`//evil.test/media/channels/42/${revision}.png`,`/media/channels/042/${revision}.png`,`/media/channels/42/${revision}.png?x=1`,`/media/channels/42/${revision}.jpg`,`/media/channels/42/${'A'.repeat(64)}.png`,`/media/channels/42/../${revision}.png`])assert.equal(avatarWebpSrcSet(src),null);
 for(const patch of [{url:'https://yt3.ggpht.com/image.png'},{revision:'b'.repeat(64)},{width:96}]){
  const html=renderToStaticMarkup(createElement(ChannelAvatar,{avatar:{...asset,...patch} as Asset,title:'新聞',size:24}));
  assert.doesNotMatch(html,/<picture|<img|webp|\/media\//);
 }
});
test('avatar failures fall back WebP → PNG → placeholder without looping',()=>{
 const webp=`https://site.test/media/channels/42/${revision}/96.webp`,png=`https://site.test${asset.url}`;
 // currentSrc is the WebP candidate (or unknown) while img.src stays the PNG: retry the PNG once.
 assert.equal(nextAvatarStage('webp',webp),'png');assert.equal(nextAvatarStage('webp',''),'png');assert.equal(nextAvatarStage('webp',undefined),'png');
 // The browser already chose the PNG (no WebP support), so there is nothing left to retry.
 assert.equal(nextAvatarStage('webp',png),'failed');
 assert.equal(nextAvatarStage('png',png),'failed');assert.equal(nextAvatarStage('png',webp),'failed');assert.equal(nextAvatarStage('failed',png),'failed');
 // A new revision is a new remount key, so its failure state starts fresh.
 const other='c'.repeat(64),next={...asset,revision:other,url:`/media/channels/42/${other}.png`};
 assert.ok(renderToStaticMarkup(createElement(ChannelAvatar,{avatar:next,size:24})).includes(`/media/channels/42/${other}/48.webp`));
});
test('video picture sizes request the cover-crop width of each box, not the bare box width',()=>{
 assert.deepEqual(VIDEO_SOURCE,{width:320,height:180});
 assert.equal(coverWidthFactor(VIDEO_BOX_ASPECT.hero),1);assert.equal(coverWidthFactor(VIDEO_BOX_ASPECT.storyMobile),16/9);
 assert.ok(Math.abs(coverWidthFactor(VIDEO_BOX_ASPECT.storyDesktop)-16/9/1.25)<1e-9);assert.ok(Math.abs(coverWidthFactor(VIDEO_BOX_ASPECT.live)-4/3)<1e-9);
 const near=(actual:number,expected:number)=>assert.ok(Math.abs(actual-expected)<1,`${actual} ≉ ${expected}`);
 // [viewport, rendered story box width, its aspect] mirroring home.module.css.
 for(const [vw,box,aspect] of [[390,(390-62)*.28,VIDEO_BOX_ASPECT.storyMobile],[640,(640-62)*.28,VIDEO_BOX_ASPECT.storyMobile],[800,(800-104)*.18,VIDEO_BOX_ASPECT.storyDesktop],[1100,(1100-137)*.14,VIDEO_BOX_ASPECT.storyDesktop],[1440,143,VIDEO_BOX_ASPECT.storyDesktop]])
  near(resolveSizes(VIDEO_PICTURE_SIZES.story,vw),box*coverWidthFactor(aspect));
 // The ~92px mobile square needs ~164 logical px of a 16:9 source to fill its height.
 near(resolveSizes(VIDEO_PICTURE_SIZES.story,390),164);
 near(resolveSizes(VIDEO_PICTURE_SIZES.live,390),72*coverWidthFactor(VIDEO_BOX_ASPECT.live));
 near(resolveSizes(VIDEO_PICTURE_SIZES.hero,390),358);near(resolveSizes(VIDEO_PICTURE_SIZES.hero,1440),562);
 // Small covers never ask for more than the 320px source at 1x density.
 for(const vw of [320,390,640,800,1000,1152,1440])for(const v of ['story','live'] as const)assert.ok(resolveSizes(VIDEO_PICTURE_SIZES[v],vw)<=VIDEO_SOURCE.width,`${v}@${vw}`);
});
test('invalid video identities render fixed non-network placeholders',()=>{
 for(const id of ['','../../bad','https://example.test/asset','too-long-to-be-a-video-id']){
  const html=renderToStaticMarkup(createElement(VideoThumbnail,{videoId:id,width:96,height:54}));
  assert.doesNotMatch(html,/<img|https:/);assert.match(html,/width:96px;height:54px;min-width:96px/);assert.match(html,/aria-hidden="true"/);
  assert.match(html,/data-thumbnail-state="missing"/);assert.doesNotMatch(html,/data-thumbnail-src/);
 }
});
test('a valid thumbnail starts pending with its one canonical public source and is never reported loaded before decoding',()=>{
 const html=renderToStaticMarkup(createElement(ImageConfigContext.Provider,{value:{...imageConfigDefault,...config.images}},createElement(VideoThumbnail,{videoId:'dQw4w9WgXcQ',width:48,height:27})));
 assert.match(html,/data-thumbnail-state="pending"/);assert.match(html,/data-thumbnail-src="https:\/\/i\.ytimg\.com\/vi\/dQw4w9WgXcQ\/mqdefault\.jpg"/);
 assert.equal(html.match(/<img/g)?.length,1);assert.match(html,/loading="lazy"/);assert.doesNotMatch(html,/hqdefault|maxresdefault|sddefault/);
});
test('hydration settles only finished requests: lazy unrequested stays pending, naturalWidth decides loaded vs error',()=>{
 assert.equal(settledThumbnailState(null),null);
 assert.equal(settledThumbnailState({complete:true,naturalWidth:0,currentSrc:''}),null);
 assert.equal(settledThumbnailState({complete:false,naturalWidth:0,currentSrc:'https://x/a.jpg'}),null);
 assert.equal(settledThumbnailState({complete:true,naturalWidth:320,currentSrc:'/_next/image?url=a'}),'loaded');
 assert.equal(settledThumbnailState({complete:true,naturalWidth:0,currentSrc:'/_next/image?url=a'}),'error');
});
