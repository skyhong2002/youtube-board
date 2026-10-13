import {createHash} from 'node:crypto';
import {describe,it,expect,vi} from 'vitest';
import {createTagRelationsClient,F1_RELATIONS_CONTRACT,type TagRelation} from '../src/reports/tag-relations-client.js';
import {createKeywordRelationsReport} from '../src/reports/keyword-relations.js';
const tag='沈伯洋',hash=(text:string)=>createHash('sha256').update(text,'utf8').digest('hex');
// Public OpenAPI fixture: no account/private reason or production secrets.
const payload=()=>({tag,tagId:hash(tag),truncated:true,relations:[
 {id:'group-membership:'+hash(tag)+':7',type:'is-a',target:{id:'group:7',label:'政治人物',href:'/group/7/'},source:'rule',sourceDetail:'legacy',createdAt:null,status:'approved',inherited:true,depth:2},
 {id:'relation:10',type:'alias',target:{id:hash('別名'),label:'別名',href:'/tag/'+encodeURIComponent('別名')+'/'},source:'submission',sourceDetail:'submission',createdAt:'2026-10-12T01:00:00.000Z',status:'approved',inherited:false,depth:1},
]});
const fallback=async(value:string)=>({tag:value,href:'https://tag.observe.tw/tag/'+encodeURIComponent(value)+'/',existingSource:true});
const mock=(fn:()=>Promise<Response>)=>vi.fn(fn) as unknown as typeof fetch;
const transport=(body:unknown=payload())=>mock(async()=>new Response(JSON.stringify(body),{headers:{'content-type':'application/json'}}));
describe('offline F1 relations contract',()=>{
 it('defaults to disabled current tag fallback and records provenance',async()=>{
  const fetch=transport(),result=await createTagRelationsClient({fetch,fallback})(tag);
  expect(fetch).not.toHaveBeenCalled();expect(result).toMatchObject({status:'fallback',reason:'disabled',data:null,fallback:{tag,existingSource:true}});
  expect(F1_RELATIONS_CONTRACT).toMatchObject({candidateSHA:'b8d030c747f87c997800371e33e1ab2d168ad257',deployed:false});
 });
 it('preserves IDs, source, legacy null time, inheritance and aliases',async()=>{
  const fetch=transport(),result=await createTagRelationsClient({enabled:true,fetch,fallback})(tag);
  expect(result).toMatchObject({status:'available',data:payload(),reason:null});expect(JSON.stringify(result)).not.toContain('sameAs');
  expect(fetch).toHaveBeenCalledWith('https://tag.observe.tw/api/v1/tags/'+encodeURIComponent(tag)+'/relations',expect.objectContaining({redirect:'manual',credentials:'omit',cache:'no-store'}));
 });
 it('ignores added fields without exposing private extras',async()=>{
  const body={...payload(),future:1,createdBy:'private-account'};Object.assign(body.relations[0]!,{reviewReason:'private-reason'});
  const result=await createTagRelationsClient({enabled:true,fetch:transport(body),fallback})(tag);
  expect(result.status).toBe('available');expect(JSON.stringify(result)).not.toMatch(/future|private-account|private-reason/);
 });
 it.each(['pending','type','identity','href'])('fails closed for invalid %s',async kind=>{
  const body=payload();if(kind==='pending')body.relations[0]!.status='pending';if(kind==='type')body.relations[0]!.type='sameAs';if(kind==='identity')body.tagId=hash('其他');if(kind==='href')body.relations[0]!.target.href='https://evil.example/';
  expect(await createTagRelationsClient({enabled:true,fetch:transport(body),fallback})(tag)).toMatchObject({reason:'invalid-contract',data:null});
 });
 it.each([404,401,500,302])('falls back on HTTP %s without retry',async status=>{
  const fetch=mock(async()=>new Response('private body',{status}));const result=await createTagRelationsClient({enabled:true,fetch,fallback})(tag);
  expect(result).toMatchObject({status:'fallback',reason:'upstream-unavailable'});expect(fetch).toHaveBeenCalledTimes(1);expect(JSON.stringify(result)).not.toContain('private body');
 });
 it('honors rate-limit cooldown across tags',async()=>{
  let at=Date.parse('2026-10-13T00:00:00Z');const fetch=mock(async()=>new Response(null,{status:429,headers:{'retry-after':'120'}})),client=createTagRelationsClient({enabled:true,fetch,fallback,clock:()=>new Date(at)});
  expect(await client(tag)).toMatchObject({reason:'rate-limited',retryAfterSeconds:120});at+=1000;expect(await client('其他')).toMatchObject({retryAfterSeconds:119});expect(fetch).toHaveBeenCalledTimes(1);at+=119000;await client(tag);expect(fetch).toHaveBeenCalledTimes(2);
 });
 it.each([['Tue, 13 Oct 2026 00:02:00 GMT',120],['bad',60],['999999',999999]])('bounds retry-after %s',async(header,seconds)=>{
  const fetch=mock(async()=>new Response(null,{status:429,headers:{'retry-after':header}}));expect(await createTagRelationsClient({enabled:true,fetch,fallback,clock:()=>new Date('2026-10-13T00:00:00Z')})(tag)).toMatchObject({retryAfterSeconds:seconds});
 });
 it('enforces row and stream byte caps',async()=>{
  expect(await createTagRelationsClient({enabled:true,fetch:transport(),fallback,maxRows:1})(tag)).toMatchObject({reason:'response-cap'});
  const fetch=mock(async()=>new Response(new ReadableStream({start(c){c.enqueue(new Uint8Array(300));c.close();}}),{headers:{'content-type':'application/json'}}));expect(await createTagRelationsClient({enabled:true,fetch,fallback,maxBodyBytes:256})(tag)).toMatchObject({reason:'response-cap'});
 });
 it('bounds ignored-abort fetch and stalled body',async()=>{
  const fetch=mock(()=>new Promise(()=>{}));expect(await createTagRelationsClient({enabled:true,fetch,fallback,timeoutMs:10})(tag)).toMatchObject({reason:'timeout'});
  const cancel=vi.fn(),body=mock(async()=>new Response(new ReadableStream({pull(){},cancel}),{headers:{'content-type':'application/json'}}));expect(await createTagRelationsClient({enabled:true,fetch:body,fallback,timeoutMs:10})(tag)).toMatchObject({reason:'timeout'});expect(cancel).toHaveBeenCalled();
 });
 it('never returns token or transport error details',async()=>{
  const secret='mock-service-token',fetch=mock(async()=>{throw new Error(secret);});const result=await createTagRelationsClient({enabled:true,fetch,fallback,serviceToken:secret})(tag);expect(JSON.stringify(result)).not.toContain(secret);expect(fetch).toHaveBeenCalledWith(expect.any(String),expect.objectContaining({headers:{accept:'application/json','X-Service-Token':secret}}));
 });
 it.each([' leading','trailing ','\ncontrol','x'.repeat(61)])('rejects invalid tag without transport',async value=>{
  const fetch=transport();await expect(createTagRelationsClient({enabled:true,fetch,fallback})(value)).rejects.toThrow('Invalid relations tag');expect(fetch).not.toHaveBeenCalled();
 });
});

describe('retained F1 public projection compatibility (48bc174 source audit)',()=>{
 // Source-derived offline fixtures, not an upstream HTTP response or deployment proof.
 // Current publicRelations caps the combined projection at 200 rows and depth 8.
 it('preserves a 200-row partial projection, all relation types and inherited origin IDs',async()=>{
  const relations=Array.from({length:200},(_,index):TagRelation=>{
   const label='關係'+index,type=(['is-a','related','alias'] as const)[index%3]!;
   return {id:'relation:'+(index+1),type,target:{id:hash(label),label,href:'/tag/'+encodeURIComponent(label)+'/'},source:'submission',sourceDetail:'submission',createdAt:'2026-10-12T01:00:00.000Z',status:'approved',inherited:false,depth:1};
  });
  relations[199]={id:'group-membership:'+hash('中介分類')+':1001',type:'is-a',target:{id:'group:1001',label:'最上位群組',href:'/group/1001/'},source:'rule',sourceDetail:'legacy',createdAt:null,status:'approved',inherited:true,depth:8};
  const body={tag,tagId:hash(tag),truncated:true,relations},fetch=transport(body);
  const result=await createTagRelationsClient({enabled:true,fetch,fallback})(tag);
  expect(result).toMatchObject({status:'available',data:body,reason:null});
  if(result.status!=='available')throw new Error('Expected the source-shaped projection');
  expect(result.data.relations).toHaveLength(200);expect(new Set(result.data.relations.map(row=>row.type))).toEqual(new Set(['is-a','related','alias']));
  expect(result.data.relations[199]).toMatchObject({id:'group-membership:'+hash('中介分類')+':1001',inherited:true,depth:8,createdAt:null});
  expect(fetch).toHaveBeenCalledTimes(1);
 });
 it('encodes each raw UTF-8 label once and keeps literal group-like tags separate from group IDs',async()=>{
  const labels=['a/b%41','😀'.repeat(60),'é','e\u0301','group:811'];
  for(const label of labels){
   const body={tag:label,tagId:hash(label),truncated:false,relations:[{id:'relation:1',type:'related',target:{id:hash(label),label,href:'/tag/'+encodeURIComponent(label)+'/'},source:'submission',sourceDetail:'submission',createdAt:'2026-10-12T01:00:00.000Z',status:'approved',inherited:false,depth:1}]};
   const fetch=transport(body),result=await createTagRelationsClient({enabled:true,fetch,fallback})(label);
   expect(fetch).toHaveBeenCalledWith('https://tag.observe.tw/api/v1/tags/'+encodeURIComponent(label)+'/relations',expect.objectContaining({redirect:'manual',credentials:'omit'}));
   expect(fetch).toHaveBeenCalledTimes(1);expect(result).toMatchObject({status:'available',data:body});
  }
  expect(hash('é')).not.toBe(hash('e\u0301'));
 });
 it('reports a valid 200-row multibyte projection above the byte budget as unavailable, never an empty success',async()=>{
  const relations=Array.from({length:200},(_,index)=>{
   const label='😀'.repeat(59)+String.fromCodePoint(0x4e00+index);
   return {id:'relation:'+(index+1),type:'related',target:{id:hash(label),label,href:'/tag/'+encodeURIComponent(label)+'/'},source:'submission',sourceDetail:'submission',createdAt:'2026-10-12T01:00:00.000Z',status:'approved',inherited:false,depth:1};
  });
  const body={tag,tagId:hash(tag),truncated:true,relations},bytes=Buffer.byteLength(JSON.stringify(body),'utf8');
  expect(bytes).toBeGreaterThan(131072);expect(bytes).toBeLessThan(262144);expect([...relations[0]!.target.label]).toHaveLength(60);
  const fetch=transport(body),result=await createTagRelationsClient({enabled:true,fetch,fallback})(tag);
  expect(result).toMatchObject({status:'fallback',reason:'response-cap',data:null,fallback:{tag,existingSource:true}});
  expect(result.status).not.toBe('available');expect(fetch).toHaveBeenCalledTimes(1);
 });
});

describe('bounded fanout and upstream cache policy',()=>{
 it('singleflights matching tags and limits active upstream work to two without queueing',async()=>{
  let finish!:()=>void;const gate=new Promise<void>(resolve=>{finish=resolve;});
  const fetch=mock(async()=>{await gate;return new Response('offline unavailable',{status:503});}),client=createTagRelationsClient({enabled:true,fetch,fallback});
  const first=client(tag),same=client(tag),second=client('第二標籤');
  expect(await client('第三標籤')).toMatchObject({reason:'upstream-busy'});expect(fetch).toHaveBeenCalledTimes(2);
  finish();expect(await first).toEqual(await same);await second;
  await client('第四標籤');expect(fetch).toHaveBeenCalledTimes(3);
 });
 it('caches only anonymous public success until the actual upstream max-age',async()=>{
  let at=0;const fetch=mock(async()=>new Response(JSON.stringify(payload()),{headers:{'content-type':'application/json','cache-control':'public, max-age=10'}})),client=createTagRelationsClient({enabled:true,fetch,fallback,clock:()=>new Date(at)});
  const first=await client(tag);if(first.status==='available')first.data.relations.length=0;
  at=9999;expect(await client(tag)).toMatchObject({data:{relations:payload().relations}});expect(fetch).toHaveBeenCalledTimes(1);
  at=10000;await client(tag);expect(fetch).toHaveBeenCalledTimes(2);
 });
 it.each(['private, no-store','public, max-age=60, no-store','public, max-age=60, no-cache'])('does not cache %s responses',async control=>{
  const fetch=mock(async()=>new Response(JSON.stringify(payload()),{headers:{'content-type':'application/json','cache-control':control}})),client=createTagRelationsClient({enabled:true,fetch,fallback});await client(tag);await client(tag);expect(fetch).toHaveBeenCalledTimes(2);
 });
 it('does not cache configured token requests even if upstream sends public cache-control',async()=>{
  const fetch=mock(async()=>new Response(JSON.stringify(payload()),{headers:{'content-type':'application/json','cache-control':'public, max-age=60'}})),client=createTagRelationsClient({enabled:true,fetch,fallback,serviceToken:'mock-token'});await client(tag);await client(tag);expect(fetch).toHaveBeenCalledTimes(2);
 });
});

describe('abort-resistant dependency budget',()=>{
 it('keeps transport slots occupied after deadlines until underlying work settles',async()=>{
  const fetch=mock(()=>new Promise(()=>{})),client=createTagRelationsClient({enabled:true,fetch,fallback,timeoutMs:10});
  expect(await client(tag)).toMatchObject({reason:'timeout'});expect(await client('第二標籤')).toMatchObject({reason:'timeout'});
  expect(await client('第三標籤')).toMatchObject({reason:'upstream-busy'});expect(fetch).toHaveBeenCalledTimes(2);
 });
});

describe('finite successful memo',()=>{
 it('evicts older entries after 32 distinct successful terms',async()=>{
  const fetch=vi.fn(async(input:RequestInfo|URL)=>{
   const term=decodeURIComponent(new URL(String(input)).pathname.split('/').at(-2)!);
   return new Response(JSON.stringify({...payload(),tag:term,tagId:hash(term)}),{headers:{'content-type':'application/json','cache-control':'public, max-age=60'}});
  }) as unknown as typeof globalThis.fetch;
  const client=createTagRelationsClient({enabled:true,fetch,fallback});for(let i=0;i<33;i++)await client('標籤'+i);
  expect(fetch).toHaveBeenCalledTimes(33);await client('標籤32');expect(fetch).toHaveBeenCalledTimes(33);await client('標籤0');expect(fetch).toHaveBeenCalledTimes(34);
 });
 it('caps upstream max-age at 60 seconds and leaves actual empty available',async()=>{
  let at=0;const fetch=mock(async()=>new Response(JSON.stringify({...payload(),relations:[],truncated:false}),{headers:{'content-type':'application/json','cache-control':'public, max-age=999999'}})),client=createTagRelationsClient({enabled:true,fetch,fallback,clock:()=>new Date(at)});
  expect(await client(tag)).toMatchObject({status:'available',data:{relations:[],truncated:false}});at=59999;await client(tag);expect(fetch).toHaveBeenCalledTimes(1);at=60000;await client(tag);expect(fetch).toHaveBeenCalledTimes(2);
 });
});


describe('Retry-After is never shortened',()=>{
 it('holds a 7200 second limit beyond the former one-hour clamp',async()=>{
  let at=Date.parse('2026-10-13T00:00:00Z');const fetch=mock(async()=>new Response(null,{status:429,headers:{'retry-after':'7200'}})),client=createTagRelationsClient({enabled:true,fetch,fallback,clock:()=>new Date(at)});
  expect(await client(tag)).toMatchObject({retryAfterSeconds:7200});at+=3600000;expect(await client(tag)).toMatchObject({reason:'rate-limited',retryAfterSeconds:3600});expect(fetch).toHaveBeenCalledTimes(1);
  at+=3599999;await client(tag);expect(fetch).toHaveBeenCalledTimes(1);at+=1;await client(tag);expect(fetch).toHaveBeenCalledTimes(2);
 });
 it('returns a finite safe hold for overflowing numeric Retry-After and stays blocked',async()=>{
  let at=Date.parse('2026-10-13T00:00:00Z');const fetch=mock(async()=>new Response(null,{status:429,headers:{'retry-after':'9'.repeat(400)}})),client=createTagRelationsClient({enabled:true,fetch,fallback,clock:()=>new Date(at)});
  const result=await client(tag);expect(Number.isSafeInteger(result.retryAfterSeconds)).toBe(true);expect(result.retryAfterSeconds).toBeGreaterThan(7200);at+=86400000;expect(await client('另一詞')).toMatchObject({reason:'rate-limited'});expect(fetch).toHaveBeenCalledTimes(1);
 });
});

describe('strict HTTP-date and cooldown priority',()=>{
 it.each(['2026-10-13T00:02:00Z','October 13, 2026 00:02:00 GMT','Tue, 13-Oct-2026 00:02:00 GMT','Tue Oct 13 00:02:00 2026','Tue, 31 Feb 2026 00:02:00 GMT','Mon, 13 Oct 2026 00:02:00 GMT','Tue, 13 Oct 2026 25:02:00 GMT','10/13/2026','nonsense'])('uses safe default for non-IMF or invalid date %s',async header=>{
  const fetch=mock(async()=>new Response(null,{status:429,headers:{'retry-after':header}}));
  expect(await createTagRelationsClient({enabled:true,fetch,fallback,clock:()=>new Date('2026-10-13T00:00:00Z')})(tag)).toMatchObject({reason:'rate-limited',retryAfterSeconds:60});
 });
 it('prefers a global rate-limit hold over saturated upstream slots',async()=>{
  let count=0,release!:()=>void,started!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;}),fallbackStarted=new Promise<void>(resolve=>{started=resolve;});
  const fetch=mock(async()=>{if(++count===1)return new Response(null,{status:429,headers:{'retry-after':'7200'}});return new Promise<Response>(()=>{});});
  const client=createTagRelationsClient({enabled:true,fetch,fallback:async term=>{if(term===tag){started();await gate;}return fallback(term);},clock:()=>new Date('2026-10-13T00:00:00Z'),timeoutMs:10});
  const first=client(tag),second=client('stuck-one');await fallbackStarted;
  // The rate-limited request remains in flight while its current-source fallback resolves.
  expect(await client('new-term')).toMatchObject({reason:'rate-limited',retryAfterSeconds:7200});expect(fetch).toHaveBeenCalledTimes(2);
  release();await first;await second;
 });
});

it('concurrent 429 responses cannot shorten an already established global hold',async()=>{
 let at=Date.parse('2026-10-13T00:00:00Z');
 const finishes:Array<(response:Response)=>void>=[];
 const fetch=mock(()=>new Promise<Response>(resolve=>{finishes.push(resolve);}));
 const client=createTagRelationsClient({enabled:true,fetch,fallback,clock:()=>new Date(at)});
 const first=client(tag),second=client('另一詞');
 finishes[0]!(new Response(null,{status:429,headers:{'retry-after':'7200'}}));
 await first;
 finishes[1]!(new Response(null,{status:429,headers:{'retry-after':'60'}}));
 await second;at+=60000;
 expect(await client('第三詞')).toMatchObject({reason:'rate-limited',retryAfterSeconds:7140});
 expect(fetch).toHaveBeenCalledTimes(2);
});

it('cooldown expiry between clock reads never bypasses the concurrency gate',async()=>{
 let at=Date.parse('2026-10-13T00:00:00Z'),step=0;const start=at;
 const fetch=mock(async()=>new Response(null,{status:429,headers:{'retry-after':'1'}}));
 const client=createTagRelationsClient({enabled:true,fetch,fallback,clock:()=>{const now=at;at+=step;return new Date(now);}});
 await client(tag);at=start+999;step=2;
 expect(await client('另一詞')).toMatchObject({reason:'rate-limited',retryAfterSeconds:1});
 expect(fetch).toHaveBeenCalledTimes(1);
});


describe('independent Y2 raw identity and byte-boundary audit (offline)',()=>{
 const raw='ＡＩ／％😀',folded=raw.normalize('NFKC');
 const identityPayload=(label:string)=>({tag:label,tagId:hash(label),truncated:false,relations:[{id:'relation:1',type:'alias',target:{id:hash(label),label,href:'/tag/'+encodeURIComponent(label)+'/'},source:'submission',sourceDetail:'submission',createdAt:'2026-10-12T01:00:00.000Z',status:'approved',inherited:false,depth:1}]});
 it('keeps NFKC-equivalent raw labels distinct in transport, IDs, in-flight work and cached responses',async()=>{
  expect(raw).not.toBe(folded);expect(hash(raw)).not.toBe(hash(folded));
  const fetch=vi.fn(async(input:RequestInfo|URL)=>{
   const decoded=decodeURIComponent(new URL(String(input)).pathname.split('/').at(-2)!);
   expect([raw,folded]).toContain(decoded);
   return new Response(JSON.stringify(identityPayload(decoded)),{headers:{'content-type':'application/json','cache-control':'public, max-age=60'}});
  }) as unknown as typeof globalThis.fetch;
  const client=createTagRelationsClient({enabled:true,fetch,fallback});
  const results=await Promise.all([client(raw),client(folded)]);
  expect(fetch).toHaveBeenCalledTimes(2);
  [raw,folded].forEach((label,index)=>{
   expect(fetch).toHaveBeenCalledWith('https://tag.observe.tw/api/v1/tags/'+encodeURIComponent(label)+'/relations',expect.objectContaining({redirect:'manual',credentials:'omit'}));
   expect(results[index]).toMatchObject({status:'available',data:identityPayload(label)});
  });
  // A cache hit must keep each raw spelling's ID and href, not the folded peer's.
  expect(await client(raw)).toMatchObject({status:'available',data:identityPayload(raw)});
  expect(await client(folded)).toMatchObject({status:'available',data:identityPayload(folded)});
  expect(fetch).toHaveBeenCalledTimes(2);
 });
 it.each(['query-id','target-id','target-href'])('rejects normalized/double-encoded %s instead of merging raw source identity',async kind=>{
  const body=identityPayload(raw);
  if(kind==='query-id')body.tagId=hash(folded);
  if(kind==='target-id')body.relations[0]!.target.id=hash(folded);
  if(kind==='target-href')body.relations[0]!.target.href='/tag/'+encodeURIComponent(encodeURIComponent(raw))+'/';
  const fetch=transport(body),result=await createTagRelationsClient({enabled:true,fetch,fallback})(raw);
  expect(result).toMatchObject({status:'fallback',reason:'invalid-contract',data:null,fallback:{tag:raw,existingSource:true}});
  expect(fetch).toHaveBeenCalledTimes(1);
 });
 it.each([0,1])('enforces cumulative UTF-8 stream bytes at default limit plus%s despite understated content-length',async extra=>{
  const body=identityPayload(raw),json=JSON.stringify(body),limit=131072;
  const bytes=Buffer.from(json+' '.repeat(limit+extra-Buffer.byteLength(json)),'utf8');
  expect(bytes.byteLength).toBe(limit+extra);
  // Split inside a multibyte character, then cross the cap only after several chunks.
  const first=bytes.indexOf(Buffer.from(raw))+1,cuts=[first,32768,65536,98304,bytes.length];
  const fetch=mock(async()=>new Response(new ReadableStream<Uint8Array>({start(controller){let offset=0;for(const end of cuts){controller.enqueue(bytes.subarray(offset,end));offset=end;}controller.close();}}),{headers:{'content-type':'application/json','content-length':'1'}}));
  const result=await createTagRelationsClient({enabled:true,fetch,fallback})(raw);
  expect(result).toMatchObject(extra?{status:'fallback',reason:'response-cap',data:null}:{status:'available',data:body,reason:null});
  expect(fetch).toHaveBeenCalledTimes(1);
 });
 it('maps an oversized valid projection to unavailable while a later actual empty projection stays available',async()=>{
  const relations=Array.from({length:200},(_,index)=>{
   const label='😀'.repeat(59)+String.fromCodePoint(0x4e00+index);
   return {id:'relation:'+(index+1),type:'related',target:{id:hash(label),label,href:'/tag/'+encodeURIComponent(label)+'/'},source:'submission',sourceDetail:'submission',createdAt:'2026-10-12T01:00:00.000Z',status:'approved',inherited:false,depth:1};
  });
  const large={tag,tagId:hash(tag),truncated:true,relations},empty={tag,tagId:hash(tag),truncated:false,relations:[]};
  expect(Buffer.byteLength(JSON.stringify(large))).toBeGreaterThan(131072);
  let requests=0;const fetcher=mock(async()=>Response.json(requests++===0?large:empty)),credentials=vi.fn(async()=>({serviceToken:'offline-test-service'}));
  const report=createKeywordRelationsReport({env:{TS_TAG_RELATIONS_ENABLED:'true'},fetcher,credentials});
  expect(await report(tag)).toMatchObject({keyword:tag,status:'unavailable',reason:'response-cap',tagId:null,relations:[]});
  expect(await report(tag)).toMatchObject({keyword:tag,status:'available',reason:null,tagId:hash(tag),truncated:false,relations:[]});
  expect(fetcher).toHaveBeenCalledTimes(2);expect(credentials).toHaveBeenCalledTimes(1);
 });
});
