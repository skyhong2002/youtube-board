import { describe, expect, it } from 'vitest';
import { MysqlQuotaLedger, YoutubeError, type QuotaLedger } from '../src/quota.js';
import { parseOwnerCredentials, YoutubePlaylistOwner } from '../src/youtube-owner.js';

const credentials = { clientId: '123-abc.apps.googleusercontent.com', clientSecret: 'secret', refreshToken: 'refresh' };
function setup(routes: (url: URL, init: RequestInit) => { status: number; body?: unknown }) {
  const charged: number[] = [], exhausted: string[] = [], seen: { method: string; url: URL; auth: string | null }[] = [];
  const ledger: QuotaLedger = { precharge: async (_t, units = 1) => { charged.push(units); return '2026-11-01'; }, markDailyExhausted: async date => { exhausted.push(date); } };
  const fetcher = (async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = new URL(String(input)); seen.push({ method: init.method ?? 'GET', url, auth: new Headers(init.headers).get('authorization') });
    expect(init.redirect).toBe('error');
    const { status, body } = routes(url, init);
    return new Response(body === undefined ? null : JSON.stringify(body), { status });
  }) as unknown as typeof fetch;
  const owner = new YoutubePlaylistOwner({ credentials, ledger, fetcher, now: () => new Date('2026-11-01T04:00:00Z') });
  return { owner, charged, exhausted, seen };
}
const token = { status: 200, body: { access_token: 'tok', expires_in: 3600 } };
const reason = async (p: Promise<unknown>) => { try { await p; return 'resolved'; } catch (e) { return e instanceof YoutubeError ? e.code : String(e); } };

describe('youtube playlist owner', () => {
  it('parses only complete credentials', () => {
    expect(parseOwnerCredentials(JSON.stringify({ client_id: credentials.clientId, client_secret: 's', refresh_token: 'r' }))).toEqual({ clientId: credentials.clientId, clientSecret: 's', refreshToken: 'r' });
    expect(() => parseOwnerCredentials('{}')).toThrow(); expect(() => parseOwnerCredentials('x')).toThrow();
    expect(() => parseOwnerCredentials(JSON.stringify({ client_id: 'x', client_secret: 's', refresh_token: 'r' }))).toThrow();
  });
  it('lists every page with a bearer token fetched once, one unit a page', async () => {
    const t = setup(url => url.host === 'oauth2.googleapis.com' ? token : url.searchParams.get('pageToken')
      ? { status: 200, body: { items: [{ id: 'i2', contentDetails: { videoId: 'Other123456' } }] } }
      : { status: 200, body: { nextPageToken: 'p2', items: [{ id: 'i1', contentDetails: { videoId: 'dKGM2rzKRjs' } }, { id: 'bad', contentDetails: {} }] } });
    expect(await t.owner.playlistItems('PLWDKpvlDapjQ')).toEqual({ items: [{ itemId: 'i1', videoId: 'dKGM2rzKRjs' }, { itemId: 'i2', videoId: 'Other123456' }], complete: true });
    expect(t.charged).toEqual([1, 1]); expect(t.seen.filter(s => s.url.host === 'oauth2.googleapis.com')).toHaveLength(1);
    expect(t.seen[1]!.auth).toBe('Bearer tok'); expect(t.seen[1]!.url.searchParams.get('part')).toBe('id,contentDetails'); expect(t.seen[1]!.url.searchParams.has('key')).toBe(false);
  });
  it('stops at maxPages and reports the listing incomplete', async () => {
    const t = setup(url => url.host === 'oauth2.googleapis.com' ? token : { status: 200, body: { nextPageToken: 'more', items: [] } });
    expect(await t.owner.playlistItems('PLWDKpvlDapjQ', 2)).toEqual({ items: [], complete: false }); expect(t.charged).toEqual([1, 1]);
  });
  it('deletes for 50 units; an item already gone counts as gone', async () => {
    let status = 204;
    const t = setup(url => url.host === 'oauth2.googleapis.com' ? token : { status, body: status === 404 ? { error: { errors: [{ reason: 'playlistItemNotFound' }] } } : undefined });
    expect(await t.owner.deleteItem('i1')).toBe('deleted');
    expect(t.seen[1]).toMatchObject({ method: 'DELETE' }); expect(t.seen[1]!.url.searchParams.get('id')).toBe('i1'); expect(t.charged).toEqual([50]);
    status = 404; expect(await t.owner.deleteItem('i1')).toBe('gone');
    expect(t.owner.unitsCharged).toBe(100);
  });
  it('maps a revoked grant, quota and other failures without charging for a failed token', async () => {
    const revoked = setup(() => ({ status: 400, body: { error: 'invalid_grant' } }));
    expect(await reason(revoked.owner.deleteItem('i1'))).toBe('authentication'); expect(revoked.charged).toEqual([]);
    const quota = setup(url => url.host === 'oauth2.googleapis.com' ? token : { status: 403, body: { error: { errors: [{ reason: 'quotaExceeded' }] } } });
    expect(await reason(quota.owner.deleteItem('i1'))).toBe('quota-daily'); expect(quota.exhausted).toEqual(['2026-11-01']);
    const forbidden = setup(url => url.host === 'oauth2.googleapis.com' ? token : { status: 403, body: { error: { errors: [{ reason: 'playlistItemsNotAccessible' }] } } });
    expect(await reason(forbidden.owner.playlistItems('PLWDKpvlDapjQ'))).toBe('request-failed');
    const down = setup(() => { throw new TypeError('fetch failed'); });
    expect(await reason(down.owner.deleteItem('i1'))).toBe('transient');
    expect(await reason(setup(() => token).owner.deleteItem('bad id'))).toBe('request-failed');
  });
  it('the ledger charges a delete as 50 units against the same daily budget', async () => {
    const executed: unknown[][] = [];
    const db = { execute: async (sql: string, params: unknown[]) => { executed.push([sql, params]); return [{ affectedRows: 1 }]; }, query: async () => [[]] };
    const ledger = new MysqlQuotaLedger(db as never, 9000, () => new Date('2026-11-01T04:00:00Z'));
    await ledger.precharge(15000, 50); await ledger.precharge(15000);
    const updates = executed.filter(([sql]) => String(sql).startsWith('UPDATE')).map(([, params]) => params);
    expect(updates).toEqual([[50, 'youtube_data_api_v3', '2026-10-31', 50, 9000], [1, 'youtube_data_api_v3', '2026-10-31', 1, 9000]]);
    await expect(ledger.precharge(15000, 0)).rejects.toThrow(); await expect(ledger.precharge(15000, 101)).rejects.toThrow();
  });
});
