import type { ReportMeta, VocabularySourceQuality } from '../contracts.js';
import { object } from './normalize.js';
/** Missing means legacy/unknown quality accounting, never a fabricated zero count. */
export function vocabularySourceQuality(value: unknown): VocabularySourceQuality | undefined {
    if (value === null || value === undefined) return undefined;
    const raw = object(value);
    const count = (key: string, cap: number) => {
        const n = raw[key];
        if (typeof n !== 'number' || !Number.isSafeInteger(n) || n < 0 || n > cap) throw new Error('Invalid stored vocabulary source quality');
        return n;
    };
    const quality = { normalizedTags: count('normalizedTags', 25_000_000), rejectedTags: count('rejectedTags', 25_000_000), articlesWithRejectedTags: count('articlesWithRejectedTags', 50_000) };
    if (quality.normalizedTags + quality.rejectedTags > 25_000_000 || quality.articlesWithRejectedTags > quality.rejectedTags || quality.rejectedTags > quality.articlesWithRejectedTags * 500 || (quality.rejectedTags > 0) !== (quality.articlesWithRejectedTags > 0)) throw new Error('Invalid stored vocabulary source quality');
    return quality;
}
export function addVocabularyQualityNotice(meta: ReportMeta, value: unknown): void {
    const quality = vocabularySourceQuality(value);
    if (!quality) return;
    meta.coverage = { ...meta.coverage, ...quality };
    if (quality.normalizedTags) meta.warnings.push(`已正規化 ${quality.normalizedTags} 筆上游標籤的零寬空白或前後空白。`);
    if (quality.rejectedTags) meta.warnings.push(`上游有 ${quality.rejectedTags} 筆標籤含不支援的控制字元，已排除於比對（涉及 ${quality.articlesWithRejectedTags} 篇文章）；原文與原因保留供查核。`);
}
