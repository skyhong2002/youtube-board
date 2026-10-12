import {describe,it,expect,vi} from 'vitest';
import {SOURCE} from '../src/vocabulary.js';
import {hash,HttpSnapshotSource,SnapshotResnapshotRequired,validateManifest,validateActivePage,validateChangePage,validateGeneration,validateTerm,type ExportTerm,type ExportManifest,type ExportDeltaGeneration,type ExportChange} from '../src/snapshot-client.js';
const id='11111111-1111-4111-8111-111111111111',previous='22222222-2222-4222-8222-222222222222',at='2026-10-13T00:00:00.000Z';
const digest=(value:unknown)=>hash(JSON.stringify(value)+'\n');
const term=(label='關\u200b鍵😀\u2028字'):ExportTerm=>({id:hash(label),label,articleCount:5,firstPublishedAt:at,lastPublishedAt:at,origin:'article-tags-mixed',journalistAssigned:null,noise:false,noEqual:false,recentArticleCount:4,recentArticleCounts:{'30':3,'90':4,'180':4},recentCountsAsOf:at});
function fixture(entries=[term()]){
 const pageHash=digest(entries),changes:ExportChange[]=entries.map(term=>({action:'upsert',term,active:true}));
 const manifest:ExportManifest={schemaVersion:1,id,previousId:null,generatedAt:at,source:SOURCE,attribution:'tag',coverage:'all-current-indexed-article-tags',provenance:'mixed',identity:'sha256-exact-utf8-label',total:entries.length,pageSize:500,pages:entries.length?[pageHash]:[],sha256:hash(entries.map(e=>JSON.stringify(e)+'\n').join('')),changeCount:changes.length,changePages:changes.length?[digest(changes)]:[],active:{total:entries.length,pages:entries.length?[pageHash]:[],sha256:hash(entries.map(e=>JSON.stringify(e)+'\n').join('')),days:30,minRecentArticleCount:3,policy:'recent-article-count',minLength:2,excludeNoise:true}};
 const page={snapshot:{id,generatedAt:at,total:manifest.total,pageSize:500,sha256:manifest.sha256},subset:{total:manifest.active!.total,sha256:manifest.active!.sha256},entries,cursor:'0',nextCursor:null,sha256:pageHash};
 return {manifest,page,changes};
}
const generation=():ExportDeltaGeneration=>({schemaVersion:1,kind:'delta',id,previousId:previous,baseSnapshotId:previous,generatedAt:at,source:SOURCE,total:4_733_073,pageSize:500,changeCount:1,changePages:[hash('latest-only')],noisePolicyVersion:hash('policy')});
const changesPage=(entries:ExportChange[]=fixture().changes)=>({snapshot:generation(),entries,cursor:'0',nextCursor:null,sha256:digest(entries)});

describe('released vocabulary active and cumulative changes contract',()=>{
 it('accepts full 10M capacity, additive annotations and bounded active catalogs',()=>{
  const {manifest}=fixture();
  expect(validateManifest({...manifest,total:10_000_000,pages:Array(20_000).fill(hash('page')),futureAnnotation:{safe:true}}).total).toBe(10_000_000);
  expect(()=>validateManifest({...manifest,total:10_000_001,pages:Array(20_001).fill(hash('page'))})).toThrow('manifest');
  expect(()=>validateManifest({...manifest,active:{...manifest.active,total:2}})).toThrow('subset');
  expect(()=>validateManifest({...manifest,active:{...manifest.active,pages:[]}})).toThrow('subset');
 });
 it('preserves raw Unicode identities with a fixed UTF-8 JSON newline golden vector',()=>{
  expect(hash(JSON.stringify(['😀','a\u2028b','關\u200b鍵'])+'\n')).toBe('ccf15fd5e48356a0954de2d40b061623d956ea3170401ed982a5c8b5823f3022');
  const {manifest,page}=fixture();expect(validateActivePage(page,manifest,0).entries[0]).toEqual(term());
  expect(term('ＡＩ').id).not.toBe(term('AI').id);expect(term('關\u200b鍵').id).not.toBe(term('關鍵').id);
 });
 it('pins every compact snapshot field, subset identity, cursor, count and checksum',()=>{
  const {manifest,page}=fixture();
  for(const field of ['id','generatedAt','total','pageSize','sha256'])expect(()=>validateActivePage({...page,snapshot:{...page.snapshot,[field]:'changed'}},manifest,0)).toThrow('changed');
  for(const subset of [{total:9,sha256:page.subset.sha256},{...page.subset,sha256:hash('other')}])expect(()=>validateActivePage({...page,subset},manifest,0)).toThrow('changed');
  for(const patch of [{cursor:'1'},{nextCursor:'1'},{entries:[]},{sha256:hash('wrong')}])expect(()=>validateActivePage({...page,...patch},manifest,0)).toThrow('mismatch');
  for(const index of [-1,1,NaN])expect(()=>validateActivePage(page,manifest,index)).toThrow();
  const empty=fixture([]);expect(validateActivePage(empty.page,empty.manifest,0).entries).toEqual([]);
 });
 it('validates nonfinal active pages and the exact smaller terminal page',()=>{
  const first=Array.from({length:500},(_,n)=>term(`詞條${n}`)),last=[term('末頁詞')];
  const {manifest}=fixture();manifest.total=501;manifest.active={...manifest.active!,total:501,pages:[digest(first),digest(last)]};
  const page=(entries:ExportTerm[],cursor:string,nextCursor:string|null)=>({snapshot:{id,generatedAt:at,total:501,pageSize:500,sha256:manifest.sha256},subset:{total:501,sha256:manifest.active!.sha256},entries,cursor,nextCursor,sha256:digest(entries)});
  expect(validateActivePage(page(first,'0','1'),manifest,0).entries).toHaveLength(500);
  expect(validateActivePage(page(last,'1',null),manifest,1).entries).toHaveLength(1);
  expect(()=>validateActivePage(page(last,'1','2'),manifest,1)).toThrow('cursor');
 });
 it('rejects invalid optional metadata and recent-count ordering without losing additive fields',()=>{
  expect(validateTerm({...term(),future:['accepted']})).toHaveProperty('future');
  for(const patch of [{noise:'false'},{noEqual:0},{noiseReasons:[1]},{recentCountsAsOf:'yesterday'},{recentArticleCount:3},{recentArticleCounts:{'30':5,'90':4,'180':4}},{recentArticleCounts:undefined}])expect(()=>validateTerm({...term(),...patch})).toThrow('term');
 });
 it('accepts cumulative page hashes unrelated to the target generation catalog and raw deletion identities',()=>{
  const page=changesPage();expect(page.sha256).not.toBe(page.snapshot.changePages[0]);expect(validateChangePage(page,id).entries).toEqual(page.entries);
  const deleted={action:'absent-from-index',id:hash('原始\u200b詞'),label:'原始\u200b詞',active:false} as const;
  expect(validateChangePage(changesPage([deleted]),id).entries).toEqual([deleted]);
  expect(()=>validateChangePage(changesPage([{...deleted,id:hash('原始詞')}]),id)).toThrow('identity');
  const full=fixture();expect(validateChangePage({...changesPage(full.changes),snapshot:full.manifest},id).snapshot).toEqual(full.manifest);
 });
 it('rejects moved targets, skipped cursors, corrupt entries and invalid generations',()=>{
  const page=changesPage();expect(()=>validateChangePage(page,previous)).toThrow('target');
  for(const patch of [{cursor:'1'},{nextCursor:'2'},{sha256:hash('bad')},{entries:Array(501).fill(page.entries[0])}])expect(()=>validateChangePage({...page,...patch},id)).toThrow('mismatch');
  expect(validateChangePage({...page,cursor:'9',nextCursor:'10'},id,'9').nextCursor).toBe('10');
  expect(()=>validateChangePage({...page,entries:[],sha256:digest([]),nextCursor:'1'},id)).toThrow('mismatch');
  expect(()=>validateChangePage(changesPage([{action:'upsert',term:term(),active:'true'} as unknown as ExportChange]),id)).toThrow('change');
  for(const patch of [{kind:'other'},{id:'bad'},{previousId:'bad'},{baseSnapshotId:'bad'},{source:'https://other.test'},{generatedAt:'2026-02-30T00:00:00.000Z'},{changeCount:501},{noisePolicyVersion:'bad'}])expect(()=>validateGeneration({...generation(),...patch})).toThrow();
 });
 it('requests compact active pages and requires a pinned target on continuation',async()=>{
  const {manifest,page}=fixture(),request=vi.fn<typeof fetch>(async url=>new Response(JSON.stringify(String(url).includes('/active?')?page:changesPage())));
  const source=new HttpSnapshotSource(request,{serviceToken:'fixture'});
  await source.activePage(manifest,0);expect(request.mock.calls[0]![0]).toBe(`${SOURCE}/api/v1/vocabulary/snapshots/${id}/active?cursor=0&compact=1&limit=500`);
  await source.changes(previous);expect(String(request.mock.calls[1]![0])).toContain(`after=${previous}&cursor=0`);
  await source.changes(previous,id);expect(String(request.mock.calls[2]![0])).toContain(`target=${id}&cursor=0`);
  await expect(source.changes(previous,undefined,'1')).rejects.toThrow('pinned target');
  await expect(source.changes('invalid')).rejects.toThrow('request');expect(request).toHaveBeenCalledTimes(3);
 });
 it('signals 409 resnapshot without retry or response-body exposure',async()=>{
  const request=vi.fn<typeof fetch>(async()=>new Response('sensitive response discarded',{status:409}));
  await expect(new HttpSnapshotSource(request,{serviceToken:'fixture'}).changes(previous,id)).rejects.toBeInstanceOf(SnapshotResnapshotRequired);expect(request).toHaveBeenCalledTimes(1);
 });
 it('caps response bytes and propagates cancellation before a request',async()=>{
  const huge=vi.fn<typeof fetch>(async()=>new Response('x'.repeat(2_000_001)));
  await expect(new HttpSnapshotSource(huge,{serviceToken:'fixture'}).current()).rejects.toThrow('byte cap');
  const request=vi.fn<typeof fetch>();await expect(new HttpSnapshotSource(request,{},AbortSignal.abort()).current()).rejects.toThrow();expect(request).not.toHaveBeenCalled();
 });
});
