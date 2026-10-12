import {afterEach,it,expect,vi} from 'vitest';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {TagArticleSource} from '../src/tag-source.js';
import {HttpSnapshotSource} from '../src/snapshot-client.js';
import {TagHttpClient,retryAfterMs,tagHttpOptions} from '../src/tag-http.js';
const url='https://tag.observe.tw/api/v1/articles';
afterEach(()=>vi.useRealTimers());
it('paces the first and concurrent anonymous requests at least1100ms apart',async()=>{
 vi.useFakeTimers();vi.setSystemTime(0);const times:number[]=[],fetcher=vi.fn<typeof fetch>(async()=>{times.push(Date.now());return new Response('{}');}),client=new TagHttpClient(fetcher);
 const requests=Promise.all([client.get(url),client.get(url),client.get(url)]);await vi.advanceTimersByTimeAsync(1099);expect(fetcher).not.toHaveBeenCalled();await vi.advanceTimersByTimeAsync(2201);await requests;expect(times).toEqual([1100,2200,3300]);
 for(const [,init]of fetcher.mock.calls){expect(init?.headers).not.toHaveProperty('x-api-key');expect(init?.redirect).toBe('error');}
 expect(()=>new TagHttpClient(fetcher,{intervalMs:1099})).toThrow('1100');
});
it('keyed requests retain a100ms floor and send the key only to the fixed origin',async()=>{
 vi.useFakeTimers();vi.setSystemTime(0);const fetcher=vi.fn<typeof fetch>(async()=>new Response('{}')),client=new TagHttpClient(fetcher,{apiKey:'fixture-tag-key'});
 const request=client.get(url);await vi.advanceTimersByTimeAsync(100);await request;expect(fetcher.mock.calls[0]?.[1]?.headers).toHaveProperty('x-api-key','fixture-tag-key');
 await expect(client.get('https://elsewhere.invalid/api/v1/articles')).rejects.toThrow('URL');expect(fetcher).toHaveBeenCalledTimes(1);expect(()=>new TagHttpClient(fetcher,{apiKey:'fixture-tag-key',intervalMs:99})).toThrow('100');
});
it('429 retries honor cooldown, cancel each response body, and stop after two retries',async()=>{
 vi.useFakeTimers();vi.setSystemTime(0);const times:number[]=[],responses:Response[]=[],fetcher=vi.fn<typeof fetch>(async()=>{times.push(Date.now());const response=new Response('upstream private body',{status:429,headers:{'retry-after':'2'}});vi.spyOn(response.body!,'cancel');responses.push(response);return response;});
 const promise=expect(new TagHttpClient(fetcher).get(url)).rejects.toThrow('HTTP 429 retry budget exhausted');await vi.advanceTimersByTimeAsync(5100);await promise;expect(times).toEqual([1100,3100,5100]);expect(responses.every(r=>vi.mocked(r.body!.cancel).mock.calls.length===1)).toBe(true);
});
it('retries the identical URL on429 success but never retries transport or ordinary errors',async()=>{
 vi.useFakeTimers();vi.setSystemTime(0);const fetcher=vi.fn<typeof fetch>().mockResolvedValueOnce(new Response('',{status:429,headers:{'retry-after':'0'}})).mockResolvedValueOnce(new Response('{}'));const done=new TagHttpClient(fetcher).get(url+'?cursor=1_1');await vi.advanceTimersByTimeAsync(2200);expect((await done).ok).toBe(true);expect(fetcher.mock.calls.map(c=>c[0])).toEqual([url+'?cursor=1_1',url+'?cursor=1_1']);
 const bad=vi.fn<typeof fetch>().mockRejectedValue(new Error('fixture-tag-key secret body'));const failed=expect(new TagHttpClient(bad,{apiKey:'fixture-tag-key'}).get(url)).rejects.toThrow(/^Tag source transport failed; checkpoint retained$/);await vi.advanceTimersByTimeAsync(100);await failed;expect(bad).toHaveBeenCalledTimes(1);
 const unavailable=vi.fn<typeof fetch>(async()=>new Response('',{status:503})),single=new TagHttpClient(unavailable).get(url);await vi.advanceTimersByTimeAsync(1100);expect((await single).status).toBe(503);expect(unavailable).toHaveBeenCalledTimes(1);
});
it('Retry-After HTTP dates and malformed values are bounded without retrying before long cooldowns',()=>{
 const now=Date.parse('2026-10-12T00:00:00Z');expect(retryAfterMs('Mon, 12 Oct 2026 00:00:04 GMT',now,1100)).toBe(4000);expect(retryAfterMs('Mon, 12 Oct 2026 00:00:00 GMT',now+1000,1100)).toBe(0);
 for(const value of [null,'invalid','-1','1.5'])expect(retryAfterMs(value,now,1100)).toBe(1100);
 for(const value of ['61','999999999999999999999999999999','Mon, 12 Oct 2026 01:00:00 GMT'])expect(()=>retryAfterMs(value,now,1100)).toThrow('retry budget');
});
it('shutdown interrupts pacing/cooldown without sending another request',async()=>{
 vi.useFakeTimers();vi.setSystemTime(0);const abort=new AbortController(),fetcher=vi.fn<typeof fetch>(async()=>new Response('',{status:429,headers:{'retry-after':'60'}})),client=new TagHttpClient(fetcher,{},abort.signal);
 const rejected=expect(client.get(url)).rejects.toThrow();await vi.advanceTimersByTimeAsync(1100);abort.abort();await rejected;await vi.advanceTimersByTimeAsync(60000);expect(fetcher).toHaveBeenCalledTimes(1);
});
it('loads env or bounded protected file keys without leaking values/paths on errors',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'tag-http-test-')),file=join(directory,'key');try{
  expect(await tagHttpOptions({})).toEqual({});expect(await tagHttpOptions({TAG_SOURCE_API_KEY:'fixture-key'})).toEqual({apiKey:'fixture-key'});
  await writeFile(file,'fixture-file-key\n',{mode:0o600});expect(await tagHttpOptions({TAG_SOURCE_API_KEY_FILE:file})).toEqual({apiKey:'fixture-file-key'});
  await expect(tagHttpOptions({TAG_SOURCE_API_KEY:'fixture-key',TAG_SOURCE_API_KEY_FILE:file})).rejects.toThrow('only one');
  await expect(tagHttpOptions({TAG_SOURCE_API_KEY:'fixture-key\nsecret'})).rejects.toThrow(/^Invalid tag API key configuration$/);
  await writeFile(file,'x'.repeat(4099));await expect(tagHttpOptions({TAG_SOURCE_API_KEY_FILE:file})).rejects.toThrow(/^Cannot read protected tag API key file$/);
  await expect(tagHttpOptions({TAG_SOURCE_API_KEY_FILE:join(directory,'missing')})).rejects.toThrow(/^Cannot read protected tag API key file$/);
  await expect(tagHttpOptions({TAG_SOURCE_INTERVAL_MS:'100'})).rejects.toThrow('1100');expect(await tagHttpOptions({TAG_SOURCE_API_KEY:'fixture-key',TAG_SOURCE_INTERVAL_MS:'150'})).toMatchObject({intervalMs:150});
 }finally{await rm(directory,{recursive:true,force:true});}
});

it('article and full-snapshot body errors cannot echo secret-bearing upstream diagnostics',async()=>{
 vi.useFakeTimers();vi.setSystemTime(0);const fetcher=vi.fn<typeof fetch>(async()=>new Response(new ReadableStream({start(controller){controller.error(new Error('fixture-tag-key upstream body'));}})));
 const article=new TagArticleSource(fetcher,{apiKey:'fixture-tag-key'}),snapshot=new HttpSnapshotSource(fetcher,{apiKey:'fixture-tag-key'});
 const a=expect(article.page({since:'2026-10-10T00:00:00Z',until:'2026-10-11T00:00:00Z'},null)).rejects.toThrow(/^Tag source body read failed or exceeds cap$/),b=expect(snapshot.current()).rejects.toThrow(/^Vocabulary body read failed or exceeds byte cap$/);
 await vi.advanceTimersByTimeAsync(100);await Promise.all([a,b]);
});
