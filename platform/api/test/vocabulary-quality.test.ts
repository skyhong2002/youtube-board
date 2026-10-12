import { expect, it } from 'vitest';
import { MySqlDialect } from 'drizzle-orm/mysql-core';
import { buildApp } from '../src/app.js';
import type { Reader, Row } from '../src/db/client.js';
import { vocabularySourceQuality } from '../src/reports/vocabulary-quality.js';
const quality = { normalizedTags: 2, rejectedTags: 3, articlesWithRejectedTags: 2 };
function reader(sourceQuality: unknown): Reader {
    const dialect = new MySqlDialect();
    const snapshot = { coverage: 'observed-article-window', window: { since: '2026-10-10T00:00:00Z', until: '2026-10-11T00:00:00Z' }, terms: [], publishedAt: '2026-10-11T00:00:00Z', ...(sourceQuality === undefined ? {} : { sourceQuality }) };
    return { rows: async <T extends Row>(query: Parameters<Reader['rows']>[0]) => {
        const sql = dialect.sqlToQuery(query).sql;
        if (sql.includes('AS source_meta')) {
            expect(sql).toContain('$.sourceQuality');
            return [{ id: 'published-quality', source_meta: JSON.stringify(snapshot) }] as unknown as T[];
        }
        if (sql.includes('SELECT r.id,r.snapshot FROM ts_vocabulary_current')) return [{ id: 'published-quality', snapshot: JSON.stringify(snapshot) }] as unknown as T[];
        if (sql.includes('SELECT c.run_id FROM ts_vocabulary_current')) return [{run_id:'published-quality'}] as unknown as T[];
        if (sql.includes('today_source_videos')) return [{ source_videos: 0, unprocessed: 0, fresh: 0, stale: 0, latest_match: null, today_source_videos: 0, today_unprocessed: 0, today_fresh: 0, today_stale: 0, today_latest_match: null }] as unknown as T[];
        return [];
    }, close: async () => {} };
}
it.each(['/api/v1/vocabulary', '/api/v1/keywords', '/api/v1/home'])('discloses quarantined tag counts through existing metadata warnings: %s', async path => {
    const app = buildApp({ reader: reader(quality), clock: () => new Date('2026-10-11T01:00:00Z') });
    try {
        const response = await app.inject(path);
        expect(response.statusCode).toBe(200);
        const body = response.json();
        expect(body.meta.coverage).toMatchObject(quality);
        expect(body.meta.warnings.some((s: string) => s.includes('3 筆標籤') && s.includes('2 篇文章') && s.includes('已排除於比對'))).toBe(true);
        expect(body.meta.warnings.some((s: string) => s.includes('正規化 2 筆'))).toBe(true);
        if (path.endsWith('/home')) {
            expect(body.data.exploration.keywords.sourceQuality).toEqual(quality);
            expect(body.data.exploration.keywordToday.sourceQuality).toEqual(quality);
            expect(body.data.exploration.keywords.vocabularyCoverage).toBe('observed-article-window');
        } else {
            expect(body.data.sourceQuality).toEqual(quality);
            expect(body.data.coverage).toBe('observed-article-window');
            expect(body.data).not.toHaveProperty('sourceTags');
        }
    } finally { await app.close(); }
});
it.each(['/api/v1/vocabulary', '/api/v1/home'])('keeps legacy quality unknown, without claiming zero rejections: %s', async path => {
    const app = buildApp({ reader: reader(undefined) });
    try {
        const response = await app.inject(path);
        expect(response.statusCode).toBe(200);
        const body = response.json();
        expect(body.meta.coverage).not.toHaveProperty('rejectedTags');
        expect(body.meta.warnings.some((s: string) => s.includes('已排除於比對'))).toBe(false);
    } finally { await app.close(); }
});
it('refuses invalid quality rather than hiding corrupt counts as zero', () => {
    for (const value of [{ ...quality, rejectedTags: -1 }, { ...quality, normalizedTags: '2' }, { ...quality, articlesWithRejectedTags: 4 }, { ...quality, rejectedTags: 0 }, {}, { ...quality, normalizedTags: 25_000_000 }, { normalizedTags: 0, rejectedTags: 501, articlesWithRejectedTags: 1 }]) expect(() => vocabularySourceQuality(value)).toThrow('Invalid stored vocabulary source quality');
    expect(vocabularySourceQuality({ normalizedTags: 0, rejectedTags: 500, articlesWithRejectedTags: 1 })).toEqual({ normalizedTags: 0, rejectedTags: 500, articlesWithRejectedTags: 1 });
    expect(vocabularySourceQuality(undefined)).toBeUndefined();
    expect(vocabularySourceQuality({ normalizedTags: 0, rejectedTags: 0, articlesWithRejectedTags: 0 })).toEqual({ normalizedTags: 0, rejectedTags: 0, articlesWithRejectedTags: 0 });
});
