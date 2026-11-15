import {it,expect,vi} from 'vitest';
import {parseYoutubePreview,youtubePreviewResolver} from '../src/manage/youtube-preview.js';
const id='abcdefghijk',channelId='UCabcdefghijklmnopqrstuv';
const page=(extra={},live={})=>'var ytInitialPlayerResponse = '+JSON.stringify({videoDetails:{videoId:id,title:'Title {"}',channelId,author:'Owner',...extra},microformat:{playerMicroformatRenderer:{liveBroadcastDetails:live}}})+';';
it('distinguishes current, upcoming, ended and ordinary content without using database absence',()=>{
 expect(parseYoutubePreview(page({isLiveContent:true},{isLiveNow:true}),id)?.broadcast).toBe('live');
 expect(parseYoutubePreview(page({isUpcoming:true}),id)?.broadcast).toBe('upcoming');
 expect(parseYoutubePreview(page({isLiveContent:true},{endTimestamp:'2026-11-15T00:00:00Z'}),id)?.broadcast).toBe('ended');
 expect(parseYoutubePreview(page(),id)?.broadcast).toBe('video');
 expect(parseYoutubePreview(page({isLiveContent:true}),id)?.broadcast).toBe('unknown');
 expect(parseYoutubePreview(page(),id)).toMatchObject({channelId,channelTitle:'Owner',title:'Title {"}'});
 expect(parseYoutubePreview(page(),'other123456')).toBeNull();
 expect(parseYoutubePreview('var ytInitialPlayerResponse = {nope;',id)).toBeNull();
 expect(parseYoutubePreview(page({channelId:'bad'}),id)).toBeNull();
});
it('bounds requests, coalesces in-flight lookups and caches successful responses',async()=>{
 const fetcher=vi.fn(async(_url:Parameters<typeof fetch>[0],_init?:RequestInit)=>new Response(page({isLive:true}))),resolve=youtubePreviewResolver(fetcher);
 const [a,b]=await Promise.all([resolve(id),resolve(id)]);expect(a).toEqual(b);expect(a?.broadcast).toBe('live');
 await resolve(id);expect(fetcher).toHaveBeenCalledTimes(1);
 expect(fetcher.mock.calls[0]?.[0]).toBe(`https://www.youtube.com/watch?v=${id}&hl=en`);
 expect(await resolve('https://evil.test')).toBeNull();expect(fetcher).toHaveBeenCalledTimes(1);
});
it('fails closed for unavailable, oversized and redirected provider replies',async()=>{
 for(const fetcher of [async()=>new Response('blocked',{status:403}),async()=>new Response('x'.repeat(3_000_001)),async()=>{throw Error('redirect');}])expect(await youtubePreviewResolver(fetcher)(id)).toBeNull();
});
