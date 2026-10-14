import { describe, it, expect } from 'vitest';
import { vocabulary, videoTagEvidence } from '../src/reports/vocabulary.js';
import { buildApp } from '../src/app.js';
import type { Reader, Row } from '../src/db/client.js';
import { sourceTextFingerprint } from '../../shared/video-fingerprint.js';
function queueReader(queue: Row[][]): Reader { return { rows: async <T extends Row>() => (queue.shift() ?? []) as T[], close: async () => { } }; }
describe('published vocabulary and source evidence', () => {
    it('uses database pagination for complete immutable snapshots', async () => { const r = await vocabulary(queueReader([[{ id: 'full-v1', snapshot: JSON.stringify({ termsStoredSeparately: true, coverage: 'all-current-indexed-article-tags', upstreamSnapshotConsistent: true, publishedAt: '2026-10-11T00:00:00Z' }) }], [{ payload: JSON.stringify({ key: 'local-key', term: '城市', articleCount: 9, media: [], upstreamId: '12' }) }], [{ total: 50000 }]]), { limit: '1' }); expect(r.total).toBe(50000); expect(r.rows).toHaveLength(1); expect(r.coverage).toBe('all-current-indexed-article-tags'); expect(r.upstreamSnapshotConsistent).toBe(true); expect(r.window).toBeNull(); });
    it('keywords alias keeps the same freshness and provenance as vocabulary', async () => { const row = { id: 'window-v1', snapshot: JSON.stringify({ terms: [], publishedAt: '2026-10-11T00:00:00Z', coverage: 'observed-article-window' }) }, app = buildApp({ reader: queueReader([[row], [row]]), dataset: 'fixture', clock: () => new Date('2026-10-11T00:00:00Z') }); const a = (await app.inject('/api/v1/vocabulary')).json(), b = (await app.inject('/api/v1/keywords')).json(); expect(a.meta).toEqual(b.meta); expect(a.meta.dataset).toBe('fixture'); expect(a.meta.updatedAt).toBeTruthy(); expect(a.meta.warnings[0]).toContain('來源未逐詞'); await app.close(); });
    it('source fingerprint is shared with matcher and title changes mark historical evidence stale', async () => {
        for (const stale of [false, true]) {
            const title = stale ? 'new title' : 'original', reader = queueReader([[{ pk: 1, videoId: 'Aa', title, description: 'description' }], [{ run_id: 'v1' }], [{ source_pk: 1, rule_version:'exact-text-v1', matched_epoch: Date.parse('2026-10-11T00:00:00Z'), source_text_sha256: sourceTextFingerprint('original', 'description') }], []]);
            const r = await videoTagEvidence(reader, 'Aa');
            expect(r.status).toBe(stale ? 'stale' : 'matched');
            expect(r.matchedAt).toBe('2026-10-11T00:00:00.000Z');
        }
    });
    it('does not show evidence when there is no published current run', async () => { const r = await videoTagEvidence(queueReader([[{ pk: 1, videoId: 'Aa', title: 'title', description: '' }], []]), 'Aa'); expect(r.status).toBe('not-synchronized'); expect(r.rows).toEqual([]); });
    it('a null evidence timestamp is not the Unix epoch', async () => { const r = await videoTagEvidence(queueReader([[{ pk: 1, videoId: 'Aa', title: 'title', description: '' }], [{ run_id: 'v1' }], [{ source_pk: 1, rule_version:'exact-text-v1', matched_epoch: null, source_text_sha256: sourceTextFingerprint('title', '') }], []]), 'Aa'); expect(r.matchedAt).toBeNull(); });
    it('keyword list explicitly identifies missing synchronization', async () => {
        const app = buildApp({ reader: queueReader([[]]) });
        try {
            const r = await app.inject('/api/v1/keywords/news/videos');
            expect(r.statusCode).toBe(200);
            expect(r.json().meta.coverage).toEqual({ status: 'not-synchronized', vocabularyVersion: null });
        }
        finally {
            await app.close();
        }
    });
    it('dangling event daily identity and empty stored title return404', async () => {
        for (const direct of [{ pk: 1, aipk: 0, event_name: 'title' }, { pk: 1, aipk: null, event_name: 'title' }, { pk: 1, aipk: 1, event_name: '' }]) {
            const app = buildApp({ reader: queueReader([[direct]]) });
            try {
                expect((await app.inject('/api/v1/ai/events/1')).statusCode).toBe(404);
            }
            finally {
                await app.close();
            }
        }
    });
});


describe('audited display exclusions remain visible in the original vocabulary pool',()=>{
 const terms=[{key:'generic',term:'支持',articleCount:3,media:['fixture']},{key:'city',term:'北京',articleCount:2,media:['fixture']},{key:'topic',term:'烏克蘭戰爭',articleCount:1,media:['fixture']},...['TVBS','聯合','三立'].map(term=>({key:term,term,articleCount:2,media:['fixture']}))];
 for(const separate of [false,true])it(`preserves original labels and exclusion reasons in ${separate?'separate':'embedded'} storage`,async()=>{
  const before=JSON.stringify(terms);const snapshot=separate?{termsStoredSeparately:true,coverage:'all-current-indexed-article-tags'}:{terms};
  const queue:Row[][]=[[{id:'audited-fixture',snapshot:JSON.stringify(snapshot)}]];
  if(separate)queue.push(terms.map(t=>({payload:JSON.stringify(t)})),[{total:terms.length}]);
  const r=await vocabulary(queueReader(queue),{});
  expect(r.rows.map(t=>[t.key,t.term,t.displayExclusion]).sort((a,b)=>String(a[0]).localeCompare(String(b[0])))).toEqual([['generic','支持','youtube-generic-two-character'],['city','北京','youtube-country-city-party'],['topic','烏克蘭戰爭',null],...['TVBS','聯合','三立'].map(term=>[term,term,'youtube-source-or-platform'])].sort((a,b)=>String(a[0]).localeCompare(String(b[0]))));
  expect(r.total).toBe(terms.length);expect(JSON.stringify(terms)).toBe(before);
 });
});
