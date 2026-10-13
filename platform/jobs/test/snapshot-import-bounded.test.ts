import {createHash,randomUUID} from 'node:crypto';
import type {Connection} from 'mysql2/promise';
import {describe,expect,it,vi} from 'vitest';
import {hash,type ExportManifest,type ExportTerm,type ExportActivePage,type SnapshotSource} from '../src/snapshot-client.js';
import {importSnapshot} from '../src/snapshot-import.js';
import {loadVocabularySnapshot,scanStoredVocabulary,type StoredVocabularySnapshot,MAX_STORED_SNAPSHOT_BYTES} from '../src/load-vocabulary.js';
import {SOURCE,termKey,type VocabularyTerm} from '../src/vocabulary.js';
const date='2026-10-13T00:00:00.000Z';
function fixture(count=1001,width=0,activeCount=2,rawLabels?:string[]) {
 const terms:ExportTerm[]=Array.from({length:count},(_,index):ExportTerm=>{
  const label=rawLabels?.[index]??`詞彙${String(index).padStart(6,'0')}`.padEnd(width,'字');
  return {id:hash(label),label,articleCount:3,firstPublishedAt:date,lastPublishedAt:date,origin:'article-tags-mixed',journalistAssigned:null};
 }).sort((a,b)=>Buffer.compare(Buffer.from(a.label),Buffer.from(b.label)));
 const pages=(entries:ExportTerm[])=>Array.from({length:Math.ceil(entries.length/500)},(_,index)=>entries.slice(index*500,index*500+500));
 const allPages=pages(terms),active=terms.slice(0,activeCount),activePages=pages(active);
 const aggregate=(entries:ExportTerm[])=>{const digest=createHash('sha256');for(const entry of entries)digest.update(JSON.stringify(entry)+'\n');return digest.digest('hex');};
 const manifest:ExportManifest={schemaVersion:1,id:randomUUID(),previousId:null,generatedAt:date,source:SOURCE,attribution:'tag.observe.tw',coverage:'all-current-indexed-article-tags',provenance:'article-tags-mixed',identity:'sha256-exact-utf8-label',total:count,pageSize:500,pages:allPages.map(page=>hash(JSON.stringify(page)+'\n')),sha256:aggregate(terms),changeCount:0,changePages:[],active:{total:active.length,pages:activePages.map(page=>hash(JSON.stringify(page)+'\n')),sha256:aggregate(active),days:30,minRecentArticleCount:3,minLength:2,excludeNoise:true}};
 const source:SnapshotSource & {activePage:(manifest:ExportManifest,index:number)=>Promise<ExportActivePage>}={
  current:vi.fn(async()=>manifest),
  page:vi.fn(async(_,index)=>({snapshot:manifest,entries:allPages[index]!,cursor:String(index),nextCursor:index+1<allPages.length?String(index+1):null,sha256:manifest.pages[index]!})),
  activePage:vi.fn(async(_,index)=>({snapshot:manifest,subset:manifest.active!,entries:activePages[index]!,cursor:String(index),nextCursor:index+1<activePages.length?String(index+1):null,sha256:manifest.active!.pages[index]!}))
 };
 return {manifest,source,terms,active};
}
function mockStore() {
 const terms=new Map<string,{term_key:string;payload:string}>();
 let run:{id:string;window_since:string;window_until:string;status:string;snapshot:string}|undefined,current:string|undefined;
 const queries:Array<{sql:string;values:unknown[]}>=[];
 const query=vi.fn(async(sql:string,values:unknown[])=>{
  queries.push({sql,values});
  if(sql.startsWith('SELECT COUNT'))return [[{total:terms.size}]];
  if(sql.startsWith('SELECT * FROM ts_vocabulary_runs'))return [[...(run?[run]:[])]];
  if(sql.includes('SELECT snapshot FROM ts_vocabulary_runs'))return [[...(run?.status==='published'?[{snapshot:run.snapshot}]:[])]];
  if(sql.includes('JOIN ts_vocabulary_runs'))return [[...(current&&run?[{snapshot:run.snapshot}]:[])]];
  if(sql.startsWith('SELECT term_key, payload')) {
   const ordered=[...terms.values()].sort((a,b)=>a.term_key<b.term_key?-1:1);
   if(sql.includes(' IN ('))return [ordered.filter(row=>values.slice(1).includes(row.term_key))];
   expect(sql).toContain('LIMIT 500');
   return [ordered.filter(row=>row.term_key>String(values[1])).slice(0,500)];
  }
  throw Error('Unexpected mock query');
 });
 const execute=vi.fn(async(sql:string,values:unknown[])=>{
  if(sql.startsWith('INSERT INTO ts_vocabulary_runs'))run??={id:String(values[0]),window_since:String(values[1]),window_until:String(values[2]),status:'scanning',snapshot:String(values[3])};
  else if(sql.startsWith('INSERT INTO ts_vocabulary_terms'))terms.set(String(values[1]),{term_key:String(values[1]),payload:String(values[4])});
  else if(sql.includes('SET status =')){run!.status=String(values[0]);run!.snapshot=String(values[1]);}
  else if(sql.startsWith('INSERT INTO ts_vocabulary_current'))current=String(values[1]);
  return [{affectedRows:1}];
 });
 const db={query,execute,beginTransaction:vi.fn(async()=>{}),commit:vi.fn(async()=>{}),rollback:vi.fn(async()=>{})} as unknown as Connection;
 return {db,terms,queries,setSnapshot(snapshot:StoredVocabularySnapshot){run!.snapshot=JSON.stringify(snapshot);},get snapshot(){return run?JSON.parse(run.snapshot) as StoredVocabularySnapshot:undefined;},get current(){return current;}};
}
const check=async()=>{};
describe('bounded full-pool publication and active-only loader (offline)',()=>{
 it('keeps originals and streams full checksum while loading only pinned active terms',async()=>{
  const f=fixture(),store=mockStore(),wait=vi.fn(async()=>{});await importSnapshot(store.db,f.source,3,check,wait);
  const lastScan=Math.max(...store.queries.map((q,index)=>q.sql.startsWith('SELECT term_key, payload')?index:-1));
  const firstLock=store.queries.findIndex(q=>q.sql.includes('FOR UPDATE'));
  expect(lastScan).toBeLessThan(firstLock);expect(wait).toHaveBeenCalledTimes(4);
  expect(store.terms.size).toBe(1001);
  const payloads=[...store.terms.values()].sort((a,b)=>a.term_key<b.term_key?-1:1).map(row=>JSON.stringify(JSON.parse(row.payload))+'\n');
  expect(store.snapshot!.localPayloadChecksum).toBe(hash(payloads.join('')));
  expect(store.snapshot!.matchingSubset!.source).toEqual(f.manifest.active);store.queries.length=0;
  const loaded=await loadVocabularySnapshot(store.db,store.snapshot!.id);
  expect(loaded.termCount).toBe(1001);expect(loaded.terms).toHaveLength(2);
  expect(loaded.terms.map(term=>term.upstream).sort((a,b)=>a!.label<b!.label?-1:1)).toEqual(f.active);
  expect(loaded.coverage).toBe('all-current-indexed-article-tags');
  expect(store.queries.filter(q=>q.sql.includes('ts_vocabulary_terms'))).toHaveLength(1);
  expect(store.queries.find(q=>q.sql.includes('ts_vocabulary_terms'))!.values).toHaveLength(3);
  expect(store.queries.some(q=>q.sql.includes('term_key >'))).toBe(false);
 });
 it('imports a pool exceeding trie memory while budgeting only active terms',async()=>{
  const f=fixture(34000,60,1),store=mockStore();
  await expect(importSnapshot(store.db,f.source,68,check)).resolves.toMatchObject({status:'published',total:34000});
  expect(store.terms.size).toBe(34000);expect((await loadVocabularySnapshot(store.db,store.snapshot!.id)).terms).toHaveLength(1);
 },20000);
 it('supports explicit caps above500 up to20k and rejects invalid caps without I/O',async()=>{
  const f=fixture(1),store=mockStore();f.source.page=vi.fn(async()=>{throw Error('page reached');});
  await expect(importSnapshot(store.db,f.source,20000,check)).rejects.toThrow('page reached');
  for(const cap of [0,20001,1.5])await expect(importSnapshot(store.db,f.source,cap,check)).rejects.toThrow('maxPages');
  expect(f.source.current).toHaveBeenCalledTimes(1);
 });
 it('chunks active reads at500 and fails on missing or tampered active evidence',async()=>{
  const f=fixture(1001,0,501),store=mockStore();await importSnapshot(store.db,f.source,3,check);store.queries.length=0;
  expect((await loadVocabularySnapshot(store.db,store.snapshot!.id)).terms).toHaveLength(501);
  expect(store.queries.filter(q=>q.sql.includes('ts_vocabulary_terms')).map(q=>q.values.length)).toEqual([501,2]);
  const key=store.snapshot!.matchingSubset!.keys[0]!,row=store.terms.get(key)!,payload=JSON.parse(row.payload);
  payload.media=['tampered'];row.payload=JSON.stringify(payload);
  await expect(loadVocabularySnapshot(store.db,store.snapshot!.id)).rejects.toThrow('checksum');store.terms.delete(key);
  await expect(loadVocabularySnapshot(store.db,store.snapshot!.id)).rejects.toThrow('incomplete');
 });
 it('fails closed on active checksum drift, duplicate membership, policy and full evidence mismatch',async()=>{
  for(const kind of ['checksum','duplicate','policy','different','missing'] as const) {
   const f=fixture(2),store=mockStore();
   if(kind==='checksum')f.manifest.active!.sha256='0'.repeat(64);
   else {
    const entries=kind==='duplicate'?[f.active[0]!,f.active[0]!]:kind==='policy'?[{...f.active[0]!,noise:true},f.active[1]!]:kind==='different'?[{...f.active[0]!,articleCount:4},f.active[1]!]:[{...f.active[0]!,id:hash('另外詞彙'),label:'另外詞彙'},f.active[1]!];
    const pageSha=hash(JSON.stringify(entries)+'\n');f.manifest.active!.pages=[pageSha];
    const digest=createHash('sha256');entries.forEach(entry=>digest.update(JSON.stringify(entry)+'\n'));f.manifest.active!.sha256=digest.digest('hex');
    f.source.activePage=async()=>({snapshot:f.manifest,subset:f.manifest.active!,entries,cursor:'0',nextCursor:null,sha256:pageSha});
   }
   await expect(importSnapshot(store.db,f.source,1,check)).rejects.toThrow(/Active|active/);
   expect(store.current).toBeUndefined();expect(store.snapshot?.matchingSubset).toBeUndefined();
  }
 });
 it('keeps an empty active subset empty instead of loading the whole pool',async()=>{
  const f=fixture(2,0,0),store=mockStore();await importSnapshot(store.db,f.source,1,check);store.queries.length=0;
  expect((await loadVocabularySnapshot(store.db,store.snapshot!.id)).terms).toEqual([]);
  expect(store.queries.some(q=>q.sql.includes('ts_vocabulary_terms'))).toBe(false);
 });
 it('retains the legacy small full export checksum path',async()=>{
  const f=fixture(501),store=mockStore();delete f.manifest.active;await importSnapshot(store.db,f.source,2,check);
  expect((await loadVocabularySnapshot(store.db,store.snapshot!.id)).terms).toHaveLength(501);
  const row=[...store.terms.values()][0]!,payload=JSON.parse(row.payload);payload.media=['changed'];row.payload=JSON.stringify(payload);
  await expect(loadVocabularySnapshot(store.db,store.snapshot!.id)).rejects.toThrow('checksum');
 });
 it('retains raw normalization aliases with their original source identities',async()=>{
  const f=fixture(4,0,4,['AI','ai','ＡＩ','A\u200BI']),store=mockStore();
  await importSnapshot(store.db,f.source,1,check);
  const loaded=await loadVocabularySnapshot(store.db,store.snapshot!.id);
  expect(loaded.terms).toHaveLength(4);expect(new Set(loaded.terms.map(term=>term.key)).size).toBe(4);
  expect(loaded.terms.map(term=>term.term).sort()).toEqual(f.terms.map(term=>term.label).sort());
  for(const term of loaded.terms){expect(term.key).toBe(termKey(term.term));expect(term.upstreamId).toBe(hash(term.term));}
 });
 it('rejects oversized upstream active count before active network calls or writes',async()=>{
  const f=fixture(1),store=mockStore();f.manifest.total=100001;f.manifest.pages=Array(201).fill(hash('page'));
  f.manifest.active!.total=100001;f.manifest.active!.pages=[...f.manifest.pages];
  await expect(importSnapshot(store.db,f.source,201,check)).rejects.toThrow('capacity');
  expect(f.source.activePage).not.toHaveBeenCalled();expect(store.terms.size).toBe(0);expect(store.current).toBeUndefined();
 });
 it('loses ownership during verification without publication or current lock',async()=>{
  const f=fixture(501),store=mockStore();let checks=0;
  await expect(importSnapshot(store.db,f.source,2,async()=>{
   // initial + active pre/post + full pre/post for two pages; first full scan
   // passes, then ownership fails before the second checksum batch.
   if(++checks===9)throw Error('lost ownership');
  })).rejects.toThrow('lost ownership');
  expect(store.snapshot!.matchingSubset).toBeUndefined();expect(store.current).toBeUndefined();
  expect(store.queries.some(q=>q.sql.includes('FOR UPDATE'))).toBe(false);
 });
 it('rejects active key metadata drift and enforces16MiB read cap',async()=>{
  const f=fixture(),store=mockStore();await importSnapshot(store.db,f.source,3,check);
  const original=store.snapshot!;
  for(const keys of [[...original.matchingSubset!.keys].reverse(),[original.matchingSubset!.keys[0]!,original.matchingSubset!.keys[0]!],[]]) {
   store.setSnapshot({...original,matchingSubset:{...original.matchingSubset!,keys}});
   await expect(loadVocabularySnapshot(store.db,original.id)).rejects.toThrow(/metadata|keys/);
  }
  const db={query:async()=>[[{snapshot:' '.repeat(MAX_STORED_SNAPSHOT_BYTES+1)}]]} as unknown as Connection;
  await expect(loadVocabularySnapshot(db)).rejects.toThrow('metadata exceeds byte cap');
 });
 it('checks scan ownership before query and rejects unordered stored keys',async()=>{
  const store=mockStore(),payload:VocabularyTerm={key:termKey('測試'),term:'測試',articleCount:1,media:[],provenance:'upstream-article-tag-origin-unspecified'};
  await expect(scanStoredVocabulary(store.db,'test',()=>{},async()=>{throw Error('lost ownership');})).rejects.toThrow('lost ownership');expect(store.queries).toHaveLength(0);
  const rows=fixture(2).terms.map(upstream=>({term_key:termKey(upstream.label),payload:JSON.stringify({...payload,key:termKey(upstream.label),term:upstream.label,articleCount:upstream.articleCount,upstreamId:upstream.id,upstream})})).sort((a,b)=>a.term_key>b.term_key?-1:1);
  const db={query:async()=>[rows]} as unknown as Connection;
  await expect(scanStoredVocabulary(db,'test',()=>{})).rejects.toThrow('ordered');
 });
});
