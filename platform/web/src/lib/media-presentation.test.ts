import {strict as assert} from 'node:assert';
import {test} from 'node:test';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {firstGrapheme,localAvatarSource} from './media-presentation';
import {ChannelAvatar} from '../components/ChannelAvatar';
import {VideoThumbnail} from '../components/VideoThumbnail';
import type {ChannelAvatar as Asset} from '../../../shared/media-assets';
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
test('invalid video identities render fixed non-network placeholders',()=>{
 for(const id of ['','../../bad','https://example.test/asset','too-long-to-be-a-video-id']){
  const html=renderToStaticMarkup(createElement(VideoThumbnail,{videoId:id,width:96,height:54}));
  assert.doesNotMatch(html,/<img|https:/);assert.match(html,/width:96px;height:54px;min-width:96px/);assert.match(html,/aria-hidden="true"/);
 }
});
