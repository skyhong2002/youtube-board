import type {ExportTerm} from './snapshot-client.js';
import {SOURCE,termKey,type VocabularySnapshot} from './vocabulary.js';
const zeroWidth=/[\u200B\u200C\u200D\u2060\uFEFF]/gu;
export type NormalizationRejection='raw-length'|'normalized-length'|'unsupported-control'|'lone-surrogate';
export class MatchingNormalizationError extends Error {
  constructor(readonly reason:NormalizationRejection){super(`Matching label rejected: ${reason}`);this.name='MatchingNormalizationError';}
}
export class MatchingPreviewBudgetError extends Error {
  constructor(readonly budget:'matching-terms'|'normalized-code-units'){super(`Matching preview exceeds ${budget} budget`);this.name='MatchingPreviewBudgetError';}
}
/** Preview label only: no video-text normalization or offset mapping claim. */
export function normalizeMatchingLabel(raw:string):string {
  if(raw.length>240)throw new MatchingNormalizationError('raw-length');
  if(/[\uD800-\uDFFF]/u.test(raw))throw new MatchingNormalizationError('lone-surrogate');
  let label=raw.replace(zeroWidth,'');
  if(/[\p{Cc}\p{Cf}]/u.test(label))throw new MatchingNormalizationError('unsupported-control');
  // Folding exposes compositions, e.g. J + caron -> j + caron -> ǰ.
  for(let pass=0;pass<8;pass++) {
    const next=label.normalize('NFKC').replace(zeroWidth,'').trim().replace(/[A-Z]/g,letter=>letter.toLowerCase());
    if(next.length>240)throw new MatchingNormalizationError('normalized-length');
    if(/[\p{Cc}\p{Cf}]/u.test(next))throw new MatchingNormalizationError('unsupported-control');
    if(next===label)return next;
    label=next;
  }
  throw new Error('Matching label normalization did not stabilize');
}
export interface MatchingAliasGroup {key:string;label:string;canonicalId:string;rawAliases:Array<{id:string;label:string}>}
export interface MatchingPreviewMetrics {
  sourceTerms:number;acceptedSourceTerms:number;matchingTerms:number;aliasesMerged:number;
  normalizationChanged:number;zeroWidthChanged:number;normalizedCodeUnits:number;
  rejected:Record<NormalizationRejection|'noise'|'short-label',number>;
}
interface MatchingBudgets {maxMatchingTerms?:number;maxNormalizedCodeUnits?:number}
/** Read-only preview of an already validated upstream active subset. Retain
 * primitive aliases, not full source clones. Counts use max (overlap unknown).
 * Oversize aborts the entire preview, never silently truncates the source pool. */
export function buildMatchingSnapshot(entries:Iterable<ExportTerm & {noise?:boolean}>,identity:{id:string;generatedAt:string},budgets:MatchingBudgets={}):{snapshot:VocabularySnapshot;metrics:MatchingPreviewMetrics;aliases:MatchingAliasGroup[]} {
  const maxTerms=budgets.maxMatchingTerms??100_000,maxUnits=budgets.maxNormalizedCodeUnits??2_000_000;
  if(!Number.isSafeInteger(maxTerms)||maxTerms<1||!Number.isSafeInteger(maxUnits)||maxUnits<1)throw new Error('Invalid matching preview budget');
  const metrics:MatchingPreviewMetrics={sourceTerms:0,acceptedSourceTerms:0,matchingTerms:0,aliasesMerged:0,normalizationChanged:0,zeroWidthChanged:0,normalizedCodeUnits:0,rejected:{noise:0,'short-label':0,'raw-length':0,'normalized-length':0,'unsupported-control':0,'lone-surrogate':0}};
  const groups=new Map<string,{count:number;aliases:Array<{id:string;label:string}>}>(),seenIds=new Set<string>();
  for(const entry of entries) {
    metrics.sourceTerms++;
    if(seenIds.has(entry.id))throw new Error('Duplicate upstream identity in matching preview');
    seenIds.add(entry.id);
    if(entry.noise===true){metrics.rejected.noise++;continue;}
    let label:string;
    try{label=normalizeMatchingLabel(entry.label);}catch(error){if(error instanceof MatchingNormalizationError){metrics.rejected[error.reason]++;continue;}throw error;}
    if(label!==entry.label)metrics.normalizationChanged++;
    if(entry.label.replace(zeroWidth,'')!==entry.label)metrics.zeroWidthChanged++;
    if([...label].length<2){metrics.rejected['short-label']++;continue;}
    let group=groups.get(label);
    if(!group) {
      if(groups.size+1>maxTerms)throw new MatchingPreviewBudgetError('matching-terms');
      // Reserve the real trie's root node too, so existing matcher accepts it.
      if(metrics.normalizedCodeUnits+label.length+1>maxUnits)throw new MatchingPreviewBudgetError('normalized-code-units');
      group={count:entry.articleCount,aliases:[]};groups.set(label,group);metrics.normalizedCodeUnits+=label.length;
    }
    group.count=Math.max(group.count,entry.articleCount);group.aliases.push({id:entry.id,label:entry.label});metrics.acceptedSourceTerms++;
  }
  const compare=(a:string,b:string)=>a<b?-1:a>b?1:0;
  const aliases:MatchingAliasGroup[]=[...groups].map(([label,group])=>{
    group.aliases.sort((a,b)=>compare(a.id,b.id));
    return {key:termKey(label),label,canonicalId:group.aliases[0]!.id,rawAliases:group.aliases};
  }).sort((a,b)=>compare(a.key,b.key));
  metrics.matchingTerms=aliases.length;metrics.aliasesMerged=metrics.acceptedSourceTerms-metrics.matchingTerms;
  const snapshot:VocabularySnapshot={id:identity.id,source:SOURCE,window:null,publishedAt:identity.generatedAt,coverage:'all-current-indexed-article-tags',upstreamSnapshotConsistent:false,upstreamSnapshotId:identity.id,upstreamGeneratedAt:identity.generatedAt,
    terms:aliases.map(group=>({key:group.key,term:group.label,articleCount:groups.get(group.label)!.count,media:[],provenance:'upstream-article-tag-origin-unspecified',upstreamId:group.canonicalId}))};
  return {snapshot,metrics,aliases};
}
