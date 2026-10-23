import {it,expect,vi} from 'vitest';
import {createHash} from 'node:crypto';
import {createRankedPoolClient,poolEntryLine,rankingPoolWindows,type PoolEntry} from '../src/reports/tag-ranked-pool.js';
const now=new Date('2026-10-14T15:49:00Z'),window=rankingPoolWindows(now).week;
const digest=(text:string)=>createHash('sha256').update(text).digest('hex');
function fixture(n=2){
 const entries:PoolEntry[]=Array.from({length:n},(_,i)=>({tag:'議題'+String(i).padStart(5,'0'),tagId:'',rank:i+1,score:3,articleCount:4,mediaCount:2,media:{b:2,a:2}}));for(const e of entries)e.tagId=digest(e.tag);
 const content={schemaVersion:'ranking-pool-1',policyVersion:'window-ranking-v1:test',available:true,incompleteReason:null,window:{...window,basis:'published_at',timezone:'UTC'},category:'news',order:'score',gate:'early',computedAt:now.toISOString(),asOf:now.toISOString(),expiresAt:new Date(+now+86400000).toISOString(),basis:{id:'news-fixture',media:['a','b'],coverageFrom:'2026-09-01T00:00:00.000Z'},upstreamVocabularyId:null,noiseFilterVersion:digest('noise'),qualification:{gate:'early',distinctArticles:true,minTwiceMedia:2,minMedia:2,minArticlesAtOneMedia:0},sourceCoverage:{kind:'fixture',sourceArticleCount:100,candidateTotal:n},eligibleTotal:n,truncated:false,defaultPageSize:500,totalPages:Math.ceil(n/500),pageChecksums:[],checksum:{algorithm:'sha256',serialization:'canonical-entry-jsonl-v1',value:digest(entries.map(poolEntryLine).join(''))}};
 const manifest={snapshotId:digest(JSON.stringify(content)),...content};
 return {entries,manifest};
}
function transport(f=fixture(),mutate:(data:any,path:string)=>void=()=>{}){
 return vi.fn(async(url:URL|RequestInfo,options?:RequestInit)=>{
  const path=String(url),u=new URL(path);expect(u.origin).toBe('https://tag.observe.tw');expect(options?.headers).toEqual({accept:'application/json',DNT:'1','Sec-GPC':'1'});expect(options?.redirect).toBe('manual');expect(options?.credentials).toBe('omit');
  let data:any;
  if(u.pathname==='/api/v1/ranking-pools')data=structuredClone(f.manifest);
  else{const cursor=u.searchParams.get('cursor'),offset=cursor?Number(Buffer.from(cursor,'base64url').toString()):0;data={...structuredClone(f.manifest),offset,limit:2000,totalPages:Math.ceil(f.entries.length/2000),entries:structuredClone(f.entries.slice(offset,offset+2000)),nextCursor:offset+2000<f.entries.length?Buffer.from(String(offset+2000)).toString('base64url'):null};}
  mutate(data,path);return new Response(JSON.stringify(data),{headers:{'content-type':'application/json'}});
 });
}
it('uses rolling24h and seven Taipei calendar dates with a shared exact cutoff',()=>{expect(rankingPoolWindows(now)).toEqual({today:{since:'2026-10-13T15:40:00.000Z',until:'2026-10-14T15:40:00.000Z'},week:{since:'2026-10-07T16:00:00.000Z',until:'2026-10-14T15:40:00.000Z'}});});
it('reads every page beyond500 and verifies complete checksum, exact counts and score',async()=>{const f=fixture(2001),fetch=transport(f),client=createRankedPoolClient({fetch,clock:()=>now});const r=await client.load(window);expect(r.entries).toHaveLength(2001);expect(r.provenance.eligibleTotal).toBe(2001);expect(fetch).toHaveBeenCalledTimes(3);});
it('distinguishes complete empty pools from unavailable snapshots',async()=>{const client=createRankedPoolClient({fetch:transport(fixture(0)),clock:()=>now});expect((await client.load(window)).entries).toEqual([]);const fetch=vi.fn(async()=>new Response('{}',{status:503}));await expect(createRankedPoolClient({fetch,clock:()=>now}).load(window)).rejects.toThrow('unavailable');});
it.each(['snapshot','window','qualification','truncated','count','checksum','offset','extraEntryField','tagIdentity','articleCount','media','score','duplicate','cursor'])('fails closed for %s',async flaw=>{
 const fetch=transport(fixture(),(d,path)=>{
  const page=path.includes('/ranking-pools/');
  if(!page&&flaw==='snapshot')d.snapshotId=digest('tamper');
  if(!page&&flaw==='window')d.window.until='2026-10-14T15:30:00.000Z';
  if(!page&&flaw==='qualification')d.qualification.distinctArticles=false;
  if(!page&&flaw==='truncated')d.truncated=true;
  if(!page&&flaw==='count')d.eligibleTotal=1;
  if(page&&flaw==='checksum')d.checksum.value=digest('wrong');
  if(page&&flaw==='offset')d.offset=1;
  if(page&&flaw==='extraEntryField')d.entries[0].privateToken='never-output';
  if(page&&flaw==='tagIdentity')d.entries[0].tagId=digest('wrong-label');
  if(page&&flaw==='articleCount')d.entries[0].articleCount=5;
  if(page&&flaw==='media')d.entries[0].media={a:3,b:1};
  if(page&&flaw==='score')d.entries[0].score=4;
  if(page&&flaw==='duplicate')d.entries[1]=d.entries[0];
  if(page&&flaw==='cursor')d.nextCursor='loop';
 });await expect(createRankedPoolClient({fetch,clock:()=>now}).load(window)).rejects.toThrow('contract');
});
it('does not emit raw body, secret fields or upstream URLs on a failure',async()=>{const fetch=vi.fn(async()=>new Response('{"secret":"private-token"}',{headers:{'content-type':'application/json'}}));try{await createRankedPoolClient({fetch,clock:()=>now}).load(window);throw Error('accepted');}catch(e){expect(String(e)).not.toContain('private-token');}});
it('coalesces concurrent anonymous requests, caches immutable results and prevents caller mutation',async()=>{const fetch=transport(),client=createRankedPoolClient({fetch,clock:()=>now});const [a,b]=await Promise.all([client.load(window),client.load(window)]);a.entries[0]!.tag='mutated';expect(b.entries[0]!.tag).not.toBe('mutated');expect((await client.load(window)).entries[0]!.tag).not.toBe('mutated');expect(fetch).toHaveBeenCalledTimes(2);});
it('obeys Retry-After and never silently returns a raw-vocabulary fallback',async()=>{const fetch=vi.fn(async()=>new Response('{}',{status:429,headers:{'retry-after':'600'}})),client=createRankedPoolClient({fetch,clock:()=>now});await expect(client.load(window)).rejects.toThrow('rate-limited');await expect(client.load(window)).rejects.toThrow('rate-limited');expect(fetch).toHaveBeenCalledTimes(1);});
it('honors HTTP-date and arbitrarily long delta Retry-After without shortening the cooldown',async()=>{
 for(const retry of [new Date(+now+600000).toUTCString(),'9'.repeat(400)]){
  let time=now;const fetch=vi.fn(async()=>new Response('{}',{status:429,headers:{'retry-after':retry}})),client=createRankedPoolClient({fetch,clock:()=>time});
  await expect(client.load(window)).rejects.toThrow('rate-limited');time=new Date(+now+61000);await expect(client.load(window)).rejects.toThrow('rate-limited');expect(fetch).toHaveBeenCalledTimes(1);
 }
});
it('bounds a noncooperative transport and cancels a late response body',async()=>{let release:(r:Response)=>void=()=>{},cancel=vi.fn();const fetch=vi.fn(()=>new Promise<Response>(r=>{release=r;})),client=createRankedPoolClient({fetch,clock:()=>now,timeoutMs:15});await expect(client.load(window)).rejects.toThrow('deadline');release(new Response(new ReadableStream({cancel}),{headers:{'content-type':'application/json'}}));await new Promise(r=>setTimeout(r,5));expect(cancel).toHaveBeenCalledOnce();});
it('preserves special Unicode and punctuation whole labels in canonical serialization',()=>{const e={...fixture().entries[0]!,tag:'AI／美中 & <測試> 😀'};expect(JSON.parse(poolEntryLine(e)).tag).toBe(e.tag);expect(poolEntryLine(e)).toContain('"media":{"a":2,"b":2}');});
it('backs off 5xx and network failures, reports sanitized transitions and recovers',async()=>{
 let time=now,mode:'503'|'network'|'ok'='503';const ok=transport(),events:unknown[]=[];
 const fetch=vi.fn(async(url:URL|RequestInfo,options?:RequestInit)=>{if(mode==='network')throw new TypeError('connect ECONNREFUSED 10.0.0.1');return mode==='ok'?ok(url,options):new Response('{"secret":"x"}',{status:503});});
 const client=createRankedPoolClient({fetch,clock:()=>time,onEvent:e=>events.push(e)});
 await expect(client.load(window)).rejects.toThrow('unavailable');expect(fetch).toHaveBeenCalledTimes(1);
 expect(events).toEqual([{event:'failure',reason:'unavailable',status:503,retryAfter:null,upstreamReason:null,cooldownUntil:new Date(+now+30000).toISOString(),UTC:now.toISOString()}]);
 // Renders during the backoff never reach upstream.
 for(let i=0;i<5;i++)await expect(client.load(window)).rejects.toThrow('unavailable');expect(fetch).toHaveBeenCalledTimes(1);expect(events).toHaveLength(1);
 time=new Date(+now+30000);mode='network';await expect(client.load(window)).rejects.toThrow('unavailable');expect(fetch).toHaveBeenCalledTimes(2);
 expect(events.at(-1)).toEqual({event:'failure',reason:'unavailable',status:null,retryAfter:null,upstreamReason:null,cooldownUntil:new Date(+time+60000).toISOString(),UTC:time.toISOString()});
 time=new Date(+time+59000);await expect(client.load(window)).rejects.toThrow('unavailable');expect(fetch).toHaveBeenCalledTimes(2);
 time=new Date(+time+1000);mode='ok';expect((await client.load(window)).entries).toHaveLength(2);
 expect(events.at(-1)).toEqual({event:'recovered',reason:null,status:200,retryAfter:null,upstreamReason:null,cooldownUntil:null,UTC:time.toISOString()});
 expect(JSON.stringify(events)).not.toMatch(/secret|ECONNREFUSED|10\.0\.0\.1|tag\.observe|ranking-pools/);
});
it('reports Retry-After and the cooldown window of a 429, then resumes after it',async()=>{
 let time=now,limited=true;const ok=transport(),events:any[]=[];
 const fetch=vi.fn(async(url:URL|RequestInfo,options?:RequestInit)=>limited?new Response('{}',{status:429,headers:{'retry-after':'120'}}):ok(url,options));
 const client=createRankedPoolClient({fetch,clock:()=>time,onEvent:e=>events.push(e)});
 await expect(client.load(window)).rejects.toThrow('rate-limited');
 expect(events).toEqual([{event:'failure',reason:'rate-limited',status:429,retryAfter:'120',upstreamReason:null,cooldownUntil:new Date(+now+120000).toISOString(),UTC:now.toISOString()}]);
 time=new Date(+now+119000);await expect(client.load(window)).rejects.toThrow('rate-limited');expect(fetch).toHaveBeenCalledTimes(1);
 time=new Date(+now+120000);limited=false;expect((await client.load(window)).entries).toHaveLength(2);expect(events.at(-1).event).toBe('recovered');
 const unbounded=createRankedPoolClient({fetch:vi.fn(async()=>new Response('{}',{status:429,headers:{'retry-after':'9'.repeat(40)}})),clock:()=>now,onEvent:e=>events.push(e)});
 await expect(unbounded.load(window)).rejects.toThrow('rate-limited');expect(events.at(-1)).toMatchObject({retryAfter:'>9999999999',cooldownUntil:'unbounded'});
 for(const [raw,label] of [[new Date(+now+600000).toUTCString(),new Date(+now+600000).toUTCString()],['soon','invalid'],['x'.repeat(100),'invalid']] as const){
  const seen:any[]=[],c=createRankedPoolClient({fetch:vi.fn(async()=>new Response('{}',{status:429,headers:{'retry-after':raw}})),clock:()=>now,onEvent:e=>seen.push(e)});
  await expect(c.load(window)).rejects.toThrow('rate-limited');expect(seen).toEqual([expect.objectContaining({retryAfter:label})]);
 }
});
it('keeps serving a valid cached pool while another window is cooling down',async()=>{
 const ok=transport();let fail=false;const today=rankingPoolWindows(now).today;
 const fetch=vi.fn(async(url:URL|RequestInfo,options?:RequestInit)=>fail?new Response('{}',{status:502}):ok(url,options));
 const client=createRankedPoolClient({fetch,clock:()=>now});
 await client.load(window);const calls=fetch.mock.calls.length;fail=true;
 await expect(client.load(today)).rejects.toThrow('unavailable');expect((await client.load(window)).entries).toHaveLength(2);expect(fetch).toHaveBeenCalledTimes(calls+1);
});
it('never lets a later 5xx relabel a longer 429 cooldown, and contains a failing diagnostics clock',async()=>{
 let time=now,mode=429;const today=rankingPoolWindows(now).today;
 const fetch=vi.fn(async()=>new Response('{}',mode===429?{status:429,headers:{'retry-after':'3600'}}:{status:503}));
 const client=createRankedPoolClient({fetch,clock:()=>time});
 await expect(client.load(window)).rejects.toThrow('rate-limited');mode=503;time=new Date(+now+10000);
 await expect(client.load(today)).rejects.toThrow('rate-limited');expect(fetch).toHaveBeenCalledTimes(1);
 let calls=0;const broken=createRankedPoolClient({fetch:vi.fn(async()=>new Response('{}',{status:503})),clock:()=>++calls>2?new Date(NaN):now,onEvent:()=>{throw new Error('sink');}});
 await expect(broken.load(window)).rejects.toThrow('unavailable');
});
it('reports the upstream reason label from a refusal body, never other body fields',async()=>{
 const json={'content-type':'application/json; charset=utf-8'};
 const cases:[Response,string|null][]=[
  [new Response(JSON.stringify({error:'ranking pool unavailable',available:false,incompleteReason:'snapshot-store-cap',window:{since:'x'},basis:{media:['a','b']}}),{status:503,headers:json}),'snapshot-store-cap'],
  [new Response(JSON.stringify({error:'ranking pool producer busy',available:false,incompleteReason:'producer-busy'}),{status:429,headers:{...json,'retry-after':'30'}}),'producer-busy'],
  [new Response(JSON.stringify({incompleteReason:'Bad Reason <x>'}),{status:503,headers:json}),null],
  [new Response(JSON.stringify({incompleteReason:'snapshot-store-cap',pad:'x'.repeat(20000)}),{status:503,headers:json}),null],
  [new Response('{"incompleteReason":"snapshot-store-cap"}',{status:503,headers:{'content-type':'text/html'}}),null],
 ];
 for(const [response,label] of cases){
  const events:any[]=[],client=createRankedPoolClient({fetch:vi.fn(async()=>response),clock:()=>now,onEvent:e=>events.push(e)});
  await expect(client.load(window)).rejects.toThrow(response.status===429?'rate-limited':'unavailable');
  expect(events).toEqual([expect.objectContaining({event:'failure',status:response.status,upstreamReason:label})]);
  expect(JSON.stringify(events)).not.toMatch(/basis|window|pad|Bad Reason/);
 }
});
