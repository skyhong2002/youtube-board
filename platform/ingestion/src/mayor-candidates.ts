import type { Connection, RowDataPacket } from 'mysql2/promise';
import { cities, candidateAliases, CANDIDATE_LIST_VERSION } from '../../shared/city-definitions.js';
import type { TagDictionary } from './tag-backfill.js';

/** Laravel reports:mayor:static passed every city's candidates plus press aliases as `onlyKeywords`. */
export function mayorCandidateTerms(): string[] {
  const terms = Object.values(cities).flatMap(city => Object.keys(city.candidates).flatMap(name => [name, ...(candidateAliases[name] ?? [])]));
  // Laravel eligibleKeyword: more than one character and not numeric.
  return [...new Set(terms)].filter(term => Array.from(term).length > 1 && !/^\d+(\.\d+)?$/.test(term));
}

/** Laravel TagDateCacheBuilder::metrics for a keyword subset: substr_count over title, title and description,
 * then each longer matched term's count is taken from every shorter term it contains. The count is emitted as
 * weight-1 matches so the shared accumulator sums exactly that count. */
export function laravelSubsetMatch(terms: string[], title: string, description: string) {
  const text = `${title} ${title} ${description}`, counts = new Map<string, number>();
  for (const term of terms) { const count = text.split(term).length - 1; if (count > 0) counts.set(term, count); }
  const matched = [...counts.keys()].sort((a, b) => Array.from(b).length - Array.from(a).length);
  for (let i = 0; i < matched.length; i++) for (let j = i + 1; j < matched.length; j++) if (matched[i]!.includes(matched[j]!)) counts.set(matched[j]!, counts.get(matched[j]!)! - counts.get(matched[i]!)!);
  return [...counts].flatMap(([term, count]) => Array.from({ length: Math.max(0, count) }, () => ({ term, field: 'description' as const })));
}

/** Candidate dictionary with Laravel's `tags` divisors: max(0.5, max_count + 0.5) for listed tags, 1.0 otherwise. */
export async function mayorCandidateDictionary(db: Connection): Promise<TagDictionary> {
  const terms = mayorCandidateTerms(), divisors = new Map<string, number>();
  const [rows] = await db.query<RowDataPacket[]>(`SELECT tag,max_count FROM tags WHERE (no_tag IS NULL OR no_tag<1) AND tag IN (${terms.map(() => '?').join(',')})`, terms);
  for (const row of rows) divisors.set(String(row.tag), Math.max(0.5, Math.max(0, Math.trunc(Number(row.max_count ?? 0))) + 0.5));
  return {
    version: `mayor-candidates-${CANDIDATE_LIST_VERSION}`, coverage: 'mayor-candidates', rule: 'laravel-substring-subset-v1',
    match: (title, description) => laravelSubsetMatch(terms, title, description),
    divisor: term => divisors.get(term) ?? 1,
  };
}
