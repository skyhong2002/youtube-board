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
it('uses Taipei calendar windows and a shared exact cutoff, never rolling24h',()=>{expect(rankingPoolWindows(now)).toEqual({today:{since:'2026-10-13T16:00:00.000Z',until:'2026-10-14T15:40:00.000Z'},week:{since:'2026-10-07T16:00:00.000Z',until:'2026-10-14T15:40:00.000Z'}});});
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
it('bounds a noncooperative transport and cancels a late response body',async()=>{let release:(r:Response)=>void=()=>{},cancel=vi.fn();const fetch=vi.fn(()=>new Promise<Response>(r=>{release=r;})),client=createRankedPoolClient({fetch,clock:()=>now,timeoutMs:15});await expect(client.load(window)).rejects.toThrow('deadline');release(new Response(new ReadableStream({cancel}),{headers:{'content-type':'application/json'}}));await new Promise(r=>setTimeout(r,5));expect(cancel).toHaveBeenCalledOnce();});
it('preserves special Unicode and punctuation whole labels in canonical serialization',()=>{const e={...fixture().entries[0]!,tag:'AI／美中 & <測試> 😀'};expect(JSON.parse(poolEntryLine(e)).tag).toBe(e.tag);expect(poolEntryLine(e)).toContain('"media":{"a":2,"b":2}');});
