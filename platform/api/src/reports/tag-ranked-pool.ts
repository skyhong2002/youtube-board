import {createHash} from 'node:crypto';
const ORIGIN='https://tag.observe.tw';
const hash=(text:string)=>createHash('sha256').update(text).digest('hex');
const hex=(value:unknown):value is string=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const object=(value:unknown):Record<string,unknown>=>{if(!value||typeof value!=='object'||Array.isArray(value))throw new PoolUnavailable('contract');return value as Record<string,unknown>;};
const count=(value:unknown):number=>{if(typeof value!=='number'||!Number.isSafeInteger(value)||value<0)throw new PoolUnavailable('contract');return value;};
const iso=(value:unknown):string=>{if(typeof value!=='string'||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value)||!Number.isFinite(Date.parse(value))||new Date(value).toISOString()!==value)throw new PoolUnavailable('contract');return value;};
const label=(value:unknown,max=256):string=>{if(typeof value!=='string'||!value||Buffer.byteLength(value)>max||/[\x00-\x1f\x7f]/.test(value))throw new PoolUnavailable('contract');return value;};
export class PoolUnavailable extends Error {constructor(public reason:'contract'|'unavailable'|'rate-limited'|'deadline'|'response-cap'){super('Tag ranking pool '+reason);}}
export interface PoolEntry {tag:string;tagId:string;rank:number;score:number;articleCount:number;mediaCount:number;media:Record<string,number>}
export interface PoolProvenance {source:typeof ORIGIN;snapshotId:string;policyVersion:string;noiseFilterVersion:string;window:{since:string;until:string};computedAt:string;asOf:string;expiresAt:string;basisId:string;basisMedia:string[];eligibleTotal:number;checksum:string;gate:'early';qualification:'two-media-with-two-distinct-articles-each'}
export interface RankedPool {provenance:PoolProvenance;entries:PoolEntry[]}
export interface PoolWindows {today:{since:string;until:string};week:{since:string;until:string}}
export interface RankedPoolClient {load(window:{since:string;until:string}):Promise<RankedPool>}
/** Shared ten-minute cutoff; short window is always rolling24h, week is seven Taipei calendar dates. */
export function rankingPoolWindows(now:Date):PoolWindows {
 const cutoff=Math.floor(now.getTime()/600000)*600000,day=new Date(now.getTime()+8*3600000).toISOString().slice(0,10),start=Date.parse(day+'T00:00:00+08:00');
 return {today:{since:new Date(cutoff-86400000).toISOString(),until:new Date(cutoff).toISOString()},week:{since:new Date(start-6*86400000).toISOString(),until:new Date(cutoff).toISOString()}};
}
export function poolEntryLine(e:PoolEntry):string {return JSON.stringify({tag:e.tag,tagId:e.tagId,rank:e.rank,score:e.score,articleCount:e.articleCount,mediaCount:e.mediaCount,media:Object.fromEntries(Object.entries(e.media).sort(([a],[b])=>Buffer.compare(Buffer.from(a),Buffer.from(b))))})+'\n';}
function entry(raw:unknown,rank:number,basis:Set<string>):PoolEntry {
 const e=object(raw);if(Object.keys(e).sort().join(',')!=='articleCount,media,mediaCount,rank,score,tag,tagId')throw new PoolUnavailable('contract');
 const tag=label(e.tag),media=object(e.media),counts=Object.entries(media);if(e.tagId!==hash(tag)||e.rank!==rank||typeof e.score!=='number'||!Number.isFinite(e.score)||e.score<0||counts.length>128)throw new PoolUnavailable('contract');
 let articles=0,twice=0,score=0;for(const [name,n]of counts){label(name,128);if(!basis.has(name)||count(n)<1)throw new PoolUnavailable('contract');articles+=Number(n);if(Number(n)>=2)twice++;score+=2*(1-0.5**Number(n));}
 if(count(e.articleCount)!==articles||count(e.mediaCount)!==counts.length||twice<2||Math.abs(score-e.score)>1e-8)throw new PoolUnavailable('contract');
 return {tag,tagId:hash(tag),rank,score:e.score,articleCount:articles,mediaCount:counts.length,media:Object.fromEntries(counts.map(([k,v])=>[k,Number(v)]))};
}
export function createRankedPoolClient({fetch:transport=fetch,clock=()=>new Date(),timeoutMs=15000,maxTerms=20000}:{fetch?:typeof fetch;clock?:()=>Date;timeoutMs?:number;maxTerms?:number}={}):RankedPoolClient {
 const pending=new Map<string,Promise<RankedPool>>(),cache=new Map<string,RankedPool>();let cooldownUntil=0;
 const load=async(window:{since:string;until:string}):Promise<RankedPool>=>{
  iso(window.since);iso(window.until);if(Date.parse(window.since)>=Date.parse(window.until)||Date.parse(window.until)>clock().getTime()||Date.parse(window.until)-Date.parse(window.since)>7*86400000)throw new PoolUnavailable('contract');
  const key=JSON.stringify(window),cached=cache.get(key);if(cached&&Date.parse(cached.provenance.expiresAt)>clock().getTime())return structuredClone(cached);
  if(clock().getTime()<cooldownUntil)throw new PoolUnavailable('rate-limited');
  let totalBytes=0;const stream:{body:ReadableStream<Uint8Array>|null;reader:ReadableStreamDefaultReader<Uint8Array>|null}={body:null,reader:null};
  const controller=new AbortController();let timedOut=false;const deadline=new Promise<never>((_,reject)=>{controller.signal.addEventListener('abort',()=>reject(new PoolUnavailable('deadline')),{once:true});});
  const timer=setTimeout(()=>{timedOut=true;controller.abort();void stream.reader?.cancel().catch(()=>{});void stream.body?.cancel().catch(()=>{});},timeoutMs);
  const get=async(path:string)=>{
   const response=await transport(ORIGIN+path,{headers:{accept:'application/json',DNT:'1','Sec-GPC':'1'},credentials:'omit',redirect:'manual',cache:'no-store',signal:controller.signal});stream.body=response.body;
   if(controller.signal.aborted){void stream.body?.cancel().catch(()=>{});throw new PoolUnavailable('deadline');}
   if(response.status===429){const raw=response.headers.get('retry-after'),now=clock().getTime();
    const retryAt=raw&&/^\d+$/.test(raw)?now+Math.max(1,Number(raw))*1000:raw&&Number.isFinite(Date.parse(raw))?Math.max(now+1000,Date.parse(raw)):now+60000;
    cooldownUntil=Math.max(cooldownUntil,retryAt);void stream.body?.cancel().catch(()=>{});throw new PoolUnavailable('rate-limited');}
   if(response.status!==200){void stream.body?.cancel().catch(()=>{});throw new PoolUnavailable('unavailable');}
   if(!/^application\/json(?:;|$)/i.test(response.headers.get('content-type')??'')||!stream.body)throw new PoolUnavailable('contract');
   stream.reader=stream.body.getReader();let bytes=0;const chunks:Uint8Array[]=[];
   while(true){const r=await stream.reader.read();if(r.done)break;bytes+=r.value.byteLength;totalBytes+=r.value.byteLength;if(bytes>4*1024**2||totalBytes>16*1024**2)throw new PoolUnavailable('response-cap');chunks.push(r.value);}
   stream.reader.releaseLock();stream.reader=null;stream.body=null;
   return object(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks,bytes))));
  };
  try {
   const work=async():Promise<RankedPool>=>{
    const params=new URLSearchParams({category:'news',...window,gate:'early',order:'score'}),m=await get('/api/v1/ranking-pools?'+params);
    const {snapshotId,...content}=m;if(!hex(snapshotId)||hash(JSON.stringify(content))!==snapshotId||m.schemaVersion!=='ranking-pool-1'||m.available!==true||m.truncated!==false||m.incompleteReason!==null||m.category!=='news'||m.order!=='score'||m.gate!=='early')throw new PoolUnavailable('contract');
    const w=object(m.window),b=object(m.basis),q=object(m.qualification),c=object(m.checksum);const eligibleTotal=count(m.eligibleTotal);
    if(w.since!==window.since||w.until!==window.until||w.basis!=='published_at'||w.timezone!=='UTC'||q.gate!=='early'||q.distinctArticles!==true||q.minTwiceMedia!==2||q.minMedia!==2||q.minArticlesAtOneMedia!==0||m.upstreamVocabularyId!==null||eligibleTotal>maxTerms||m.defaultPageSize!==500||m.totalPages!==Math.ceil(eligibleTotal/500)||c.algorithm!=='sha256'||c.serialization!=='canonical-entry-jsonl-v1'||!hex(c.value))throw new PoolUnavailable('contract');
    if(!Array.isArray(b.media)||b.media.length<2||b.media.length>128||new Set(b.media).size!==b.media.length||iso(b.coverageFrom)>window.since||iso(m.expiresAt)<=clock().toISOString())throw new PoolUnavailable('contract');
    const basis=new Set(b.media.map(v=>label(v,128))),entries:PoolEntry[]=[],seen=new Set<string>(),cursors=new Set<string>(),checksum=createHash('sha256');let cursor:string|null=null;
    do {
     const page=await get('/api/v1/ranking-pools/'+snapshotId+'?limit=2000'+(cursor?'&cursor='+encodeURIComponent(cursor):''));
     for(const [k,v] of Object.entries(m))if(k!=='totalPages'&&JSON.stringify(page[k])!==JSON.stringify(v))throw new PoolUnavailable('contract');
     if(page.offset!==entries.length||page.limit!==2000||page.totalPages!==Math.ceil(eligibleTotal/2000)||!Array.isArray(page.entries)||page.entries.length!==Math.min(2000,eligibleTotal-entries.length))throw new PoolUnavailable('contract');
     for(const raw of page.entries){const e=entry(raw,entries.length+1,basis),previous=entries.at(-1);if(seen.has(e.tag)||previous&&(previous.score<e.score||previous.score===e.score&&Buffer.compare(Buffer.from(previous.tag),Buffer.from(e.tag))>=0))throw new PoolUnavailable('contract');seen.add(e.tag);entries.push(e);checksum.update(poolEntryLine(e));}
     const next=page.nextCursor;if(entries.length===eligibleTotal){if(next!==null)throw new PoolUnavailable('contract');}else if(typeof next!=='string'||!next||next.length>512||!/^[A-Za-z0-9_-]+$/.test(next)||cursors.has(next))throw new PoolUnavailable('contract');
     cursor=next as string|null;if(cursor)cursors.add(cursor);
    }while(cursor!==null);
    if(entries.length!==eligibleTotal||checksum.digest('hex')!==c.value)throw new PoolUnavailable('contract');
    const provenance:PoolProvenance={source:ORIGIN,snapshotId,policyVersion:label(m.policyVersion),noiseFilterVersion:label(m.noiseFilterVersion),window:{...window},computedAt:iso(m.computedAt),asOf:iso(m.asOf),expiresAt:iso(m.expiresAt),basisId:label(b.id),basisMedia:[...basis],eligibleTotal,checksum:c.value,gate:'early',qualification:'two-media-with-two-distinct-articles-each'};
    return {provenance,entries};
   };
   const result=await Promise.race([work(),deadline]);if(cache.size>=4)cache.delete(cache.keys().next().value!);cache.set(key,result);return structuredClone(result);
  }catch(error){if(error instanceof PoolUnavailable)throw error;throw new PoolUnavailable(timedOut?'deadline':'contract');}
  finally{clearTimeout(timer);void stream.reader?.cancel().catch(()=>{});try{stream.reader?.releaseLock();}catch{}void stream.body?.cancel().catch(()=>{});}
 };
 return {load(window){const key=JSON.stringify(window);let task=pending.get(key);if(!task){task=load(window).finally(()=>pending.delete(key));pending.set(key,task);}return task.then(result=>structuredClone(result));}};
}
