import { MAX_TRIE_NODES, assertVocabularyBudget } from './vocabulary-budget.js';
import type { VocabularySnapshot, VocabularyTerm } from './vocabulary.js';
import type {TextExclusion,TextExclusionReason} from './description-templates.js';
import {matchVocabulary as matchLegacyVocabulary} from './match-legacy.js';
import {MATCH_RULE,matchingRuleForSnapshot} from '../../shared/youtube-match-policy.js';
import {asciiCaseFold} from '../../shared/ascii-case.js';
export {asciiCaseFold} from '../../shared/ascii-case.js';
export interface SourceTermIdentity {termKey:string;term:string}
export interface MatchEvidence { termKey: string; term: string; vocabularyVersion: string; source: string; field: 'title' | 'description'; start: number; end: number; text: string; method: 'exact-text-v1'|typeof MATCH_RULE;sourceTerms?:SourceTermIdentity[] }
export type MatchExclusionReason=TextExclusionReason|'single-character-substring';
export interface ExcludedMatchEvidence extends MatchEvidence {reasons:MatchExclusionReason[]}
const latinWord = /[\p{Script=Latin}\p{M}\p{Number}_]/u;
const tokenCharacter=/[\p{L}\p{M}\p{N}_]/u;
/** ASCII folding never expands a character or changes original UTF-16 offsets. */
interface TrieNode { children: Map<string, TrieNode>; term?: VocabularyTerm;aliases?:SourceTermIdentity[] }
const cache = new WeakMap<VocabularySnapshot, { terms: VocabularyTerm[]; root: TrieNode }>();
function compile(snapshot: VocabularySnapshot): TrieNode {
  const stored = cache.get(snapshot);
  if (stored?.terms === snapshot.terms) return stored.root;
  assertVocabularyBudget(snapshot.terms);
  const root: TrieNode = { children: new Map() }; let nodes = 1;
  for (const term of snapshot.terms) {
    if (!term.term) continue;
    if ([...term.term].length > 240) throw new Error('Vocabulary matching term exceeds cap');
    let node = root;
    // Code units preserve source UTF-16 offsets, including supplementary chars.
    const folded=asciiCaseFold(term.term);
    for (let index = 0; index < folded.length; index++) {
      const character = folded[index]!;
      let child = node.children.get(character);
      if (!child) {
        if (++nodes > MAX_TRIE_NODES) throw new Error('Vocabulary matcher exceeds node cap');
        child = { children: new Map() }; node.children.set(character, child);
      }
      node = child;
    }
    (node.aliases??=[]).push({termKey:term.key,term:term.term});
    if(!node.term||term.key<node.term.key)node.term = term;
  }
  const pending=[root];while(pending.length){const node=pending.pop()!;node.aliases?.sort((a,b)=>a.termKey<b.termKey?-1:a.termKey>b.termKey?1:0);pending.push(...node.children.values());}
  cache.set(snapshot, { terms: snapshot.terms, root });
  return root;
}
/** Compile once per immutable snapshot; matching cost follows input length and
 * shared prefixes rather than scanning the whole text for every vocabulary term.
 * Offsets remain original UTF-16 coordinates; only ASCII case is folded.
 * Case aliases retain exact upstream identities but emit one canonical occurrence.
 */
export function matchVocabulary(input: { title: string; description?: string }, snapshot: VocabularySnapshot): MatchEvidence[] {
  return matchingRuleForSnapshot(snapshot)==='exact-text-v1'?matchLegacyVocabulary(input,snapshot):matchVocabularyWithExclusions(input,snapshot,[]).evidence;
}
export function matchVocabularyWithExclusions(input: { title: string; description?: string }, snapshot: VocabularySnapshot, exclusions:TextExclusion[]):{evidence:MatchEvidence[];excluded:ExcludedMatchEvidence[]} {
  const root = compile(snapshot);
  const evidence: MatchEvidence[] = [];
  const excluded:ExcludedMatchEvidence[]=[];
  for (const field of ['title', 'description'] as const) {
    const text = input[field] ?? '';
    if (text.length > 100000) throw new Error('Vocabulary matching input exceeds cap');
    const folded=asciiCaseFold(text);
    const reasonNames:TextExclusionReason[]=['channel-repeated-line','url','hashtag-stack','social-cta'],mask=new Uint8Array(text.length);let spanUnits=0;
    for(const span of exclusions.filter(item=>item.field===field)){
      if(!Number.isSafeInteger(span.start)||!Number.isSafeInteger(span.end)||span.start<0||span.end<span.start||span.end>text.length||(spanUnits+=span.end-span.start)>text.length*4||!reasonNames.includes(span.reason))throw new Error('Invalid matching exclusion span');
      const bit=1<<reasonNames.indexOf(span.reason);for(let index=span.start;index<span.end;index++)mask[index]|=bit;
    }
    const candidates: MatchEvidence[] = [];
    for (let start = 0; start < text.length; start++) {
      let node = root;
      for (let offset = start; offset < text.length; offset++) {
        const child = node.children.get(folded[offset]!);
        if (!child) break;
        node = child;
        if (!node.term) continue;
        const { key, term } = node.term;
        const end = offset + 1;
        const before = text.slice(Math.max(0, start - 2), start).match(/.$/u)?.[0] ?? '';
        const afterPoint = text.codePointAt(end);
        const after = afterPoint === undefined ? '' : String.fromCodePoint(afterPoint);
        const points = [...term];
        if (points.length>1&&((latinWord.test(points[0]!) && latinWord.test(before)) || (latinWord.test(points.at(-1)!) && latinWord.test(after)))) continue;
        if (candidates.length+excluded.length >= 10000) throw new Error('Vocabulary matching evidence exceeds cap');
        const candidate:MatchEvidence={ termKey: key, term, vocabularyVersion: snapshot.id, source: snapshot.source, field, start, end, text: text.slice(start, end), method: MATCH_RULE,...(node.aliases!.length>1?{sourceTerms:node.aliases}: {}) };
        let bits=0;for(let index=start;index<end;index++)bits|=mask[index]!;
        const reasons:MatchExclusionReason[]=reasonNames.filter((_,index)=>bits&(1<<index));
        if(points.length===1&&(tokenCharacter.test(before)||tokenCharacter.test(after)))reasons.push('single-character-substring');
        if(reasons.length)excluded.push({...candidate,reasons});else candidates.push(candidate);
      }
    }
    const occupied = new Uint8Array(text.length);
    const accepted: MatchEvidence[] = [];
    for (const candidate of candidates.sort((a, b) => (b.end - b.start) - (a.end - a.start) || a.start - b.start || (a.termKey < b.termKey ? -1 : a.termKey > b.termKey ? 1 : 0))) {
      if (occupied.subarray(candidate.start, candidate.end).some(Boolean)) continue;
      occupied.fill(1, candidate.start, candidate.end);
      accepted.push(candidate);
    }
    evidence.push(...accepted.sort((a, b) => a.start - b.start));
  }
  return {evidence,excluded};
}
