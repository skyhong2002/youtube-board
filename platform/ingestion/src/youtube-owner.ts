import { workflowShutdownSignal } from '../../shared/shutdown.js';
import { YoutubeError, type QuotaLedger } from './quota.js';

/**
 * Credentials of the channel that owns the 加入直播 playlist: an OAuth client and a refresh token granted once by the channel
 * owner (scope youtube.force-ssl, tools/youtube-owner-authorize.mjs). They live in a root-only secret file, never in the env.
 */
export interface YoutubeOwnerCredentials { clientId: string; clientSecret: string; refreshToken: string }
export const YOUTUBE_OWNER_SCOPE = 'https://www.googleapis.com/auth/youtube.force-ssl';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const API = 'https://www.googleapis.com/youtube/v3/playlistItems';
/** playlistItems.list costs 1 unit, playlistItems.delete 50. */
export const OWNER_LIST_UNITS = 1, OWNER_DELETE_UNITS = 50;

export function parseOwnerCredentials(text: string): YoutubeOwnerCredentials {
  let value: unknown;
  try { value = JSON.parse(text); } catch { throw new Error('YouTube owner credentials are not JSON'); }
  const v = (value ?? {}) as Record<string, unknown>, field = (name: string) => typeof v[name] === 'string' ? (v[name] as string).trim() : '';
  const credentials = { clientId: field('client_id'), clientSecret: field('client_secret'), refreshToken: field('refresh_token') };
  if (!/^[\w.-]+\.apps\.googleusercontent\.com$/.test(credentials.clientId) || !credentials.clientSecret || !credentials.refreshToken) throw new Error('YouTube owner credentials are incomplete');
  return credentials;
}

export interface OwnerPlaylistItem { itemId: string; videoId: string }

/**
 * The only writes made as the channel owner: listing one playlist's items (for their item ids, which the feed lacks) and
 * deleting single items. Every call is precharged on the shared quota ledger. No retries: a failed call is reported, and the
 * caller holds off for an hour.
 */
export class YoutubePlaylistOwner {
  private token: { value: string; expires: number } | null = null;
  private calls = 0; private units = 0;
  constructor(private readonly options: { credentials: YoutubeOwnerCredentials; ledger: QuotaLedger; fetcher?: typeof fetch; now?: () => Date; timeoutMs?: number }) {}
  get attemptsMade() { return this.calls; }
  get unitsCharged() { return this.units; }
  private get timeoutMs() { return this.options.timeoutMs ?? 15000; }
  private async fetch(url: string, init: RequestInit): Promise<{ status: number; data: Record<string, unknown> | null }> {
    workflowShutdownSignal().throwIfAborted();
    let response: Response;
    try { response = await (this.options.fetcher ?? fetch)(url, { ...init, redirect: 'error', signal: AbortSignal.any([AbortSignal.timeout(this.timeoutMs), workflowShutdownSignal()]) }); }
    catch { workflowShutdownSignal().throwIfAborted(); throw new YoutubeError('transient'); }
    let text = '';
    try { text = await response.text(); } catch { throw new YoutubeError('transient'); }
    if (text.length > 2_000_000) throw new YoutubeError('invalid-response');
    let data: unknown = null; try { data = text ? JSON.parse(text) : null; } catch { data = null; }
    return { status: response.status, data: data && typeof data === 'object' && !Array.isArray(data) ? data as Record<string, unknown> : null };
  }
  private async accessToken(): Promise<string> {
    const now = (this.options.now ?? (() => new Date()))().getTime();
    if (this.token && this.token.expires > now + 60000) return this.token.value;
    const { credentials } = this.options;
    const { status, data } = await this.fetch(TOKEN_URL, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' }, body: new URLSearchParams({ grant_type: 'refresh_token', client_id: credentials.clientId, client_secret: credentials.clientSecret, refresh_token: credentials.refreshToken }).toString() });
    const value = typeof data?.access_token === 'string' ? data.access_token : '', ttl = Number(data?.expires_in ?? 0);
    if (status === 200 && value && ttl > 0) { this.token = { value, expires: now + ttl * 1000 }; return value; }
    // invalid_grant: the grant was revoked or expired (a client left in Testing mode expires it after 7 days).
    if ([400, 401, 403].includes(status)) throw new YoutubeError('authentication', status, typeof data?.error === 'string' ? data.error : undefined);
    throw new YoutubeError(status >= 500 ? 'transient' : 'invalid-response', status);
  }
  private async call(method: 'GET' | 'DELETE', query: Record<string, string>, units: number) {
    const token = await this.accessToken();
    const date = await this.options.ledger.precharge(this.timeoutMs, units);
    this.calls++; this.units += units;
    const result = await this.fetch(API + '?' + new URLSearchParams(query), { method, headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } });
    if (result.status >= 200 && result.status < 300) return result;
    const error = (result.data?.error ?? {}) as Record<string, unknown>, first = (Array.isArray(error.errors) ? error.errors[0] ?? {} : {}) as Record<string, unknown>;
    const reason = typeof first.reason === 'string' ? first.reason : '';
    if (result.status === 403 && ['quotaExceeded', 'dailyLimitExceeded'].includes(reason)) { try { await this.options.ledger.markDailyExhausted(date); } catch { /* keep the quota error */ } throw new YoutubeError('quota-daily', 403, reason); }
    if (result.status === 429 || /rateLimit/i.test(reason)) throw new YoutubeError('rate-limit', result.status, reason);
    if (result.status === 401) throw new YoutubeError('authentication', 401, reason);
    throw new YoutubeError(result.status >= 500 ? 'transient' : 'request-failed', result.status, reason);
  }
  /** Every item of the playlist with its item id, up to `maxPages` pages of 50. */
  async playlistItems(playlistId: string, maxPages = 4): Promise<{ items: OwnerPlaylistItem[]; complete: boolean }> {
    if (!/^PL[A-Za-z0-9_-]{10,64}$/.test(playlistId)) throw new YoutubeError('request-failed');
    const items: OwnerPlaylistItem[] = []; let pageToken = '';
    for (let page = 0; page < maxPages; page++) {
      const { data } = await this.call('GET', { part: 'id,contentDetails', playlistId, maxResults: '50', ...(pageToken ? { pageToken } : {}) }, OWNER_LIST_UNITS);
      if (!data || !Array.isArray(data.items) || data.items.length > 50) throw new YoutubeError('invalid-response');
      for (const raw of data.items as unknown[]) {
        const item = (raw ?? {}) as Record<string, unknown>, details = (item.contentDetails ?? {}) as Record<string, unknown>;
        const itemId = typeof item.id === 'string' ? item.id : '', videoId = typeof details.videoId === 'string' ? details.videoId : '';
        if (/^[A-Za-z0-9_=-]{1,128}$/.test(itemId) && /^[A-Za-z0-9_-]{11}$/.test(videoId)) items.push({ itemId, videoId });
      }
      pageToken = typeof data.nextPageToken === 'string' ? data.nextPageToken : '';
      if (!pageToken) return { items, complete: true };
    }
    return { items, complete: false };
  }
  /** Deletes one playlist item. An item already gone (404) counts as deleted. */
  async deleteItem(itemId: string): Promise<'deleted' | 'gone'> {
    if (!/^[A-Za-z0-9_=-]{1,128}$/.test(itemId)) throw new YoutubeError('request-failed');
    try { await this.call('DELETE', { id: itemId }, OWNER_DELETE_UNITS); return 'deleted'; }
    catch (error) { if (error instanceof YoutubeError && error.status === 404) return 'gone'; throw error; }
  }
}
