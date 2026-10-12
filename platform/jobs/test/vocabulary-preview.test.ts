import {expect,it} from 'vitest';
import {createHash} from 'node:crypto';
import {previewVocabulary,type PreviewSource} from '../src/vocabulary-preview.js';
import type {ExportTerm,ExportManifest} from '../src/snapshot-client.js';
const hash=(x:string)=>createHash('sha256').update(x).digest('hex');
const id='11111111-1111-4111-8111-111111111111',target='22222222-2222-4222-8222-222222222222';
const at='2026-10-12T17:29:51.650Z',clock=()=>new Date(at);
const term=(label:string):ExportTerm=>({id:hash(label),label,articleCount:3,firstPublishedAt:at,lastPublishedAt:at,origin:'article-tags-mixed',journalistAssigned:null,noise:false});
function fixture() {
 const entries=[term('TPBL'),term('\u200BTPBL')];
 const manifest={schemaVersion:1,id,previousId:null,generatedAt:at,source:'https://tag.observe.tw',attribution:'新文易數',coverage:'all-current-indexed-article-tags',provenance:'mixed',identity:'sha256-exact-utf8-label',total:4733073,pageSize:500,pages:[],sha256:hash('full'),changeCount:0,changePages:[],active:{total:entries.length,pages:[hash(JSON.stringify(entries)+'\n')],sha256:hash(entries.map(e=>JSON.stringify(e)+'\n').join('')),days:30,minRecentArticleCount:3,minLength:2,excludeNoise:true}} as ExportManifest;
 const source:PreviewSource={current:async()=>manifest,activePage:async()=>({snapshot:manifest,subset:manifest.active!,entries,cursor:'0',nextCursor:null,sha256:manifest.active!.pages[0]!}),changes:async(_after,_target,cursor)=>({snapshot:{schemaVersion:1,kind:'delta',id:target,previousId:id,baseSnapshotId:id,generatedAt:at,source:'https://tag.observe.tw',total:4733073,pageSize:500,changeCount:0,changePages:[],noisePolicyVersion:hash('noise')},entries:[],cursor:cursor??'0',nextCursor:null,sha256:hash('[]\n')})};
 return {entries,manifest,source};
}
it('previews only active terms, verifies whole subset and keeps exact identities before matching alias merge',async()=>{
 const {source}=fixture();const result=await previewVocabulary(source,{rounds:1,clock});
 expect(result).toMatchObject({readOnly:true,fullPoolImported:false,servingPointerChanged:false,sourcePoolTerms:4733073,activeSourceTerms:2,activeChecksumVerified:true});
 expect(result.initial.metrics.matchingTerms).toBe(1);expect(result.initial.aliasGroups).toBe(1);expect(result.changes[0]!.entries).toBe(0);
});
it('rejects an incorrect aggregate checksum and duplicate raw identity before any changes call',async()=>{
 const {source,manifest}=fixture();manifest.active!.sha256=hash('wrong');let called=false;const change=source.changes;source.changes=async(...args)=>{called=true;return change(...args);};
 await expect(previewVocabulary(source,{rounds:1,clock})).rejects.toThrow(/checksum/);expect(called).toBe(false);
 const second=fixture();second.entries[1]=second.entries[0]!;
 await expect(previewVocabulary(second.source,{rounds:1,clock})).rejects.toThrow(/Duplicate/);
});
it('pins target on subsequent pages and applies same-round upsert then delete in order',async()=>{
 const {source}=fixture(),base=source.changes,newTerm=term('新詞');let calls=0;
 source.changes=async(after,pinned,cursor)=>{
  const page=await base(after,pinned,cursor);calls++;
  if(calls===1){expect(pinned).toBeUndefined();return {...page,entries:[{action:'upsert',term:newTerm,active:false}],nextCursor:'1'};}
  expect(pinned).toBe(target);expect(cursor).toBe('1');return {...page,entries:[{action:'absent-from-index',id:newTerm.id,label:newTerm.label,active:false}]};
 };
 const result=await previewVocabulary(source,{rounds:1,clock});
 expect(result.changes[0]).toMatchObject({pages:2,entries:2,upserts:1,removed:1});expect(result.changes[0]!.metrics.matchingTerms).toBe(1);
});
it('admits a fresh new term independently of upstream active threshold without altering subset statistics',async()=>{
 const {source}=fixture(),base=source.changes;
 source.changes=async(...args)=>({...await base(...args),entries:[{action:'upsert',term:{...term('新詞'),articleCount:1},active:false}]});
 const result=await previewVocabulary(source,{rounds:1,clock});expect(result.activeSourceTerms).toBe(2);expect(result.changes[0]!.metrics.matchingTerms).toBe(2);
});
it('a later-page failure or moving target rejects the round without a completed-round receipt',async()=>{
 for(const mode of ['fail','target','cursor']) {
  const {source}=fixture(),base=source.changes;let calls=0;const progress:string[]=[];
  source.changes=async(...args)=>{
   const page=await base(...args);calls++;
   if(calls===1)return {...page,entries:[{action:'upsert',term:term('新詞'),active:true}],nextCursor:'1'};
   if(mode==='fail')throw Error('resnapshot-required');
   if(mode==='target')return {...page,snapshot:{...page.snapshot,id}};
   return {...page,nextCursor:'0'};
  };
  await expect(previewVocabulary(source,{rounds:1,clock,onProgress:e=>progress.push(e.phase)})).rejects.toThrow();
  expect(progress).not.toContain('changes');
 }
});

it('rejects aggregate active payload growth independently of term count',async()=>{
 const {source}=fixture();let changed=false;const base=source.changes;source.changes=async(...args)=>{changed=true;return base(...args);};
 await expect(previewVocabulary(source,{rounds:1,clock,maxActiveBytes:100})).rejects.toThrow(/byte budget/);expect(changed).toBe(false);
});
