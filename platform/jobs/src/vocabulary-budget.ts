export const MAX_TRIE_NODES = 2_000_000;
export function assertVocabularyBudget(terms: Iterable<{ term: string }>): void {
  let units = 1, count = 0;
  for (const { term } of terms) {
    if (/[\uD800-\uDFFF]/u.test(term) || !term || [...term].length > 240) throw new Error('Invalid matching term');
    units += term.length;
    if (++count > 250000 || units > MAX_TRIE_NODES) throw new Error('Vocabulary exceeds publication matching budget');
  }
}
