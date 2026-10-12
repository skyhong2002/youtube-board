import {createHash} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {matchVocabulary} from './match.js';
import {buildMatchingSnapshot} from './vocabulary-normalization.js';
import type {ChangePage,ExportTerm,HttpSnapshotSource} from './snapshot-client.js';

export type PreviewSource=Pick<HttpSnapshotSource,'current'|'activePage'|'changes'>;
const memory=()=>{global.gc?.();const {heapUsed,rss}=process.memoryUsage();return {heapBytes:heapUsed,rssBytes:rss};};
const elapsed=(start:number)=>Math.round(performance.now()-start);
function measure(terms:Iterable<ExportTerm>,identity:{id:string;generatedAt:string}) {
 const built=buildMatchingSnapshot(terms,identity);
 const before=memory(),start=performance.now();
 matchVocabulary({title:''},built.snapshot);
 const compileMs=elapsed(start),after=memory();
 return {metrics:built.metrics,compileMs,trieHeapBytes:Math.max(0,after.heapBytes-before.heapBytes),beforeMemory:before,afterMemory:after,
  // Public source identities only; do not emit entire pools or arbitrary labels.
  aliasGroups:built.aliases.filter(group=>group.rawAliases.length>1).length};
}
/** Read-only capacity/contract preview. No DB/store/publisher or filesystem writes.
 * Whole source pool is never downloaded here. Delta pages are staged separately
 * and applied only after the complete pinned round validates. */
export async function previewVocabulary(source:PreviewSource,options:{rounds?:number;maxActiveBytes?:number;signal?:AbortSignal;onProgress?:(event:{phase:string;pages:number;terms:number})=>void;clock?:()=>Date}={}) {
 const rounds=options.rounds??3;if(!Number.isSafeInteger(rounds)||rounds<1||rounds>5)throw Error('Invalid preview round count');
 const maxActiveBytes=options.maxActiveBytes??64*1024*1024;if(!Number.isSafeInteger(maxActiveBytes)||maxActiveBytes<1||maxActiveBytes>64*1024*1024)throw Error('Invalid active byte budget');
 const started=performance.now(),clock=options.clock??(()=>new Date());
 const check=()=>options.signal?.throwIfAborted();
 check();const manifest=await source.current(),active=manifest.active;
 if(!active||active.total>100000||active.pages.length>200)throw Error('Active preview exceeds matching capacity');
 const digest=createHash('sha256');let activeSourceBytes=0;let terms=new Map<string,ExportTerm>();const fetchStart=performance.now();
 for(let index=0;index<active.pages.length;index++) {
  check();const page=await source.activePage(manifest,index);
  for(const entry of page.entries) {
   if(terms.has(entry.id))throw Error('Duplicate active source identity');
   if(entry.noise===true||[...entry.label].length<2)throw Error('Upstream active subset violates its policy');
   const encoded=JSON.stringify(entry)+'\n';activeSourceBytes+=Buffer.byteLength(encoded);
   if(activeSourceBytes>maxActiveBytes)throw Error('Active preview byte budget exceeded');
   digest.update(encoded,'utf8');terms.set(entry.id,entry);
  }
  options.onProgress?.({phase:'active',pages:index+1,terms:terms.size});
 }
 if(terms.size!==active.total||digest.digest('hex')!==active.sha256)throw Error('Active aggregate checksum or count mismatch');
 const activeFetchMs=elapsed(fetchStart),initial=measure(terms.values(),manifest);
 let after=manifest.id;const changes=[];
 for(let round=0;round<rounds;round++) {
  check();const start=performance.now(),staged:ChangePage['entries']=[];let target:string|undefined,cursor='0',pageCount=0,bytes=0,generatedAt=manifest.generatedAt;
  do {
   check();if(++pageCount>200)throw Error('Changes preview page cap');
   const page=await source.changes(after,target,cursor);
   if(page.cursor!==cursor||target!==undefined&&page.snapshot.id!==target)throw Error('Changes target or cursor changed');
   target=page.snapshot.id;generatedAt=page.snapshot.generatedAt;
   bytes+=Buffer.byteLength(JSON.stringify(page.entries));
   if(bytes>32*1024*1024||staged.length+page.entries.length>100000)throw Error('Changes preview staging cap');
   staged.push(...page.entries);
   if(page.nextCursor===null)break;
   if(page.nextCursor!==String(Number(cursor)+1))throw Error('Changes cursor did not advance');
   cursor=page.nextCursor;
  }while(true);
  // Preserve upstream subset count/checksum independently of this overlay.
  // New recent tags can enter immediately, even with active=false (upstream's
  // 30-day/3-article profile), without changing or deleting the shared pool.
  const candidate=new Map(terms);let upserts=0,removed=0;
  const freshAfter=+clock()-180*86400000;
  for(const change of staged) {
   if(change.action==='absent-from-index'){candidate.delete(change.id);removed++;continue;}
   const term=change.term;upserts++;
   if(term.noise!==true&&[...term.label].length>=2&&(change.active===true||Date.parse(term.lastPublishedAt)>=freshAfter))candidate.set(term.id,term);
   else candidate.delete(term.id);
  }
  if(candidate.size>100000)throw Error('Changes matching capacity exceeded');
  const measured=measure(candidate.values(),{id:target!,generatedAt});
  changes.push({round:round+1,after,target,pages:pageCount,entries:staged.length,upserts,removed,stagedBytes:bytes,durationMs:elapsed(start),...measured});
  terms=candidate;after=target!;
  options.onProgress?.({phase:'changes',pages:pageCount,terms:terms.size});
 }
 return {readOnly:true,fullPoolImported:false,servingPointerChanged:false,at:clock().toISOString(),snapshot:manifest.id,generatedAt:manifest.generatedAt,
  sourcePoolTerms:manifest.total,sourcePoolPages:manifest.pages.length,activeSourceTerms:active.total,activePages:active.pages.length,activeChecksumVerified:true,
  activePolicy:{days:active.days,minRecentArticleCount:active.minRecentArticleCount,minArticleCount:active.minArticleCount,excludeNoise:active.excludeNoise,minLength:active.minLength},
  activeFetchMs,activeSourceBytes,maxActiveBytes,initial,changes,lastPreviewGeneration:after,totalMs:elapsed(started),forcedGc:typeof global.gc==='function',peakProcessRssBytes:process.resourceUsage().maxRSS*1024,
  maxMatchingTerms:100000,maxNormalizedCodeUnits:2000000,deltaPolicy:'noise-free length>=2 and (upstream active or lastPublishedAt within180days)',
  caveat:'Matcher compiled against derived normalized labels only; no production text-offset or DB import acceptance is claimed.'};
}
