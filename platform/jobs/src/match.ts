import { MAX_TRIE_NODES, assertVocabularyBudget } from './vocabulary-budget.js';
import type { VocabularySnapshot, VocabularyTerm } from './vocabulary.js';
export interface MatchEvidence { termKey: string; term: string; vocabularyVersion: string; source: string; field: 'title' | 'description'; start: number; end: number; text: string; method: 'exact-text-v1' }
const latinWord = /[\p{Script=Latin}\p{M}\p{Number}_]/u;
interface TrieNode { children: Map<string, TrieNode>; term?: VocabularyTerm }
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
    for (let index = 0; index < term.term.length; index++) {
      const character = term.term[index]!;
      let child = node.children.get(character);
      if (!child) {
        if (++nodes > MAX_TRIE_NODES) throw new Error('Vocabulary matcher exceeds node cap');
        child = { children: new Map() }; node.children.set(character, child);
      }
      node = child;
    }
    node.term = term;
  }
  cache.set(snapshot, { terms: snapshot.terms, root });
  return root;
}
/** Compile once per immutable snapshot; matching cost follows input length and
 * shared prefixes rather than scanning the whole text for every vocabulary term.
 * Offsets remain original UTF-16 coordinates; no implicit normalization.
 */
export function matchVocabulary(input: { title: string; description?: string }, snapshot: VocabularySnapshot): MatchEvidence[] {
  const root = compile(snapshot);
  const evidence: MatchEvidence[] = [];
  for (const field of ['title', 'description'] as const) {
    const text = input[field] ?? '';
    if (text.length > 100000) throw new Error('Vocabulary matching input exceeds cap');
    const candidates: MatchEvidence[] = [];
    for (let start = 0; start < text.length; start++) {
      let node = root;
      for (let offset = start; offset < text.length; offset++) {
        const child = node.children.get(text[offset]!);
        if (!child) break;
        node = child;
        if (!node.term) continue;
        const { key, term } = node.term;
        const end = offset + 1;
        const before = text.slice(Math.max(0, start - 2), start).match(/.$/u)?.[0] ?? '';
        const afterPoint = text.codePointAt(end);
        const after = afterPoint === undefined ? '' : String.fromCodePoint(afterPoint);
        const points = [...term];
        if ((latinWord.test(points[0]!) && latinWord.test(before)) || (latinWord.test(points.at(-1)!) && latinWord.test(after))) continue;
        if (candidates.length >= 10000) throw new Error('Vocabulary matching evidence exceeds cap');
        candidates.push({ termKey: key, term, vocabularyVersion: snapshot.id, source: snapshot.source, field, start, end, text: text.slice(start, end), method: 'exact-text-v1' });
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
  return evidence;
}
