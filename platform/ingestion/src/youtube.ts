import { workflowShutdownSignal } from '../../shared/shutdown.js';
import { assertQuotaWindow, YoutubeError, type QuotaLedger, type YoutubeFailure } from './quota.js';
export type Json = Record<string, unknown>;
export const record = (x: unknown): x is Json => !!x && typeof x === 'object' && !Array.isArray(x);
export function unsigned(value: unknown): number | null {
  if (!(typeof value === 'number' || (typeof value === 'string' && /^\d+$/.test(value)))) return null;
  const n = Number(value); return Number.isSafeInteger(n) && n >= 0 ? n : null;
}
export function rfc3339(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!match || !Number.isFinite(Date.parse(value))) return false;
  const [year, month, day, hour, minute, second] = match.slice(1, 7).map(Number);
  const calendar = new Date(`${match[1]}-${match[2]}-${match[3]}T00:00:00Z`);
  return calendar.getUTCFullYear() === year && calendar.getUTCMonth() + 1 === month && calendar.getUTCDate() === day && hour! < 24 && minute! < 60 && second! < 60;
}
const str = (value: unknown) => typeof value === 'string' ? value : '';
export interface VideoStatistics { viewCount: number; likeCount: number | null; dislikeCount: number; favoriteCount: number | null; commentCount: number | null }
export interface ChannelProfile { id:string; title:string; description:string; uploads:string; publishedAt:string; thumbnail:string|null; statistics:ChannelStatistics }
export interface ChannelStatistics { viewCount: number; videoCount: number; subscriberCount: number | null; hiddenSubscriberCount: boolean }
export interface PlaylistItem { id: string; videoId: string; publishedAt: string; channelId: string; title: string; description: string; thumbnails: string; channelTitle: string; playlistId: string; position: number; liveBroadcastContent: 'none' | 'live' | 'upcoming' }
export interface Page<T> { items: T[]; nextPageToken: string | null }
export interface RequestAudit { method: string; attempt: number; status: number | null; ok: boolean; failure?: YoutubeFailure; units: 1 }
export interface YoutubeOptions { keys: string[]; ledger: QuotaLedger; fetcher?: typeof fetch; now?: () => Date; sleep?: (ms: number) => Promise<void>; transientRetries?: number; retryDelayMs?: number; maxAttempts?: number; audit?: (event: RequestAudit) => void }
export class YoutubeDataApiClient {
  private readonly keys: string[];
  private attempts = 0;
  private quotaDate: string | null = null;
  private exhausted = false;
  constructor(private readonly options: YoutubeOptions) { this.keys = [...new Set(options.keys.map(k => k.trim()).filter(Boolean))]; if (!Number.isInteger(options.transientRetries ?? 1) || (options.transientRetries ?? 1) < 0 || (options.transientRetries ?? 1) > 3 || this.keys.length > 20 || !Number.isInteger(options.maxAttempts ?? 1000) || (options.maxAttempts ?? 1000) < 1 || (options.maxAttempts ?? 1000) > 10000) throw new YoutubeError('request-failed'); }
  get attemptsMade() { return this.attempts; }
  private ids(ids: string[]): string[] {
    const unique = [...new Set(ids.map(id => id.trim()).filter(Boolean))];
    if (unique.length > 50 || unique.some(id => !/^[A-Za-z0-9_-]{1,128}$/.test(id))) throw new YoutubeError('request-failed');
    return unique;
  }
  private emit(event: RequestAudit) { try { this.options.audit?.(event); } catch { /* Telemetry cannot change API semantics. */ } }
  private async get(path: string, query: Record<string, string>, timeoutMs = 15000): Promise<Json> {
    workflowShutdownSignal().throwIfAborted();
    if (this.exhausted) throw new YoutubeError('quota-exhausted');
    if (!this.keys.length) throw new YoutubeError('not-configured');
    const now = this.options.now ?? (() => new Date());
    const sleep = this.options.sleep ?? (ms => new Promise(resolve => setTimeout(resolve, ms)));
    let dailyKeys = 0, lastFailure: YoutubeFailure = 'request-failed', lastDate = '';
    for (const key of this.keys) {
      const retries = Math.max(0, Math.min(3, this.options.transientRetries ?? 1));
      for (let retry = 0; retry <= retries; retry++) {
        workflowShutdownSignal().throwIfAborted();
        if (this.attempts >= (this.options.maxAttempts ?? 1000)) throw new YoutubeError('quota-budget');
        if (this.quotaDate) assertQuotaWindow(now(), timeoutMs, this.quotaDate);
        lastDate = await this.options.ledger.precharge(timeoutMs);
        workflowShutdownSignal().throwIfAborted();
        this.quotaDate ??= lastDate;
        if (lastDate !== this.quotaDate) throw new YoutubeError('quota-window');
        assertQuotaWindow(now(), timeoutMs, this.quotaDate);
        const url = new URL(`https://www.googleapis.com/youtube/v3/${path}`);
        url.search = new URLSearchParams({ ...query, key }).toString();
        this.attempts++;
        let response: Response;
        try { response = await (this.options.fetcher ?? fetch)(url, { signal: AbortSignal.any([AbortSignal.timeout(timeoutMs),workflowShutdownSignal()]), redirect: 'error', headers: { Accept: 'application/json' } }); }
        catch {
          workflowShutdownSignal().throwIfAborted();
          this.emit({ method: `${path}.list`, attempt: this.attempts, status: null, ok: false, failure: 'transient', units: 1 });
          if (retry < retries) { await sleep(Math.min(5000, this.options.retryDelayMs ?? 250)); continue; }
          throw new YoutubeError('transient');
        }
        let data: unknown, bodyReadFailed = false, invalidBody = false, body = '';
        try {
          if (!response.body) throw new Error();
          const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
          try { while (true) { const chunk = await reader.read(); if (chunk.done) break; size += chunk.value.byteLength; if (size > 8000000) { invalidBody = true; throw new Error(); } chunks.push(chunk.value); } } finally { await reader.cancel().catch(() => undefined); }
          body = Buffer.concat(chunks).toString('utf8');
        } catch { bodyReadFailed = !invalidBody; }
        if (bodyReadFailed) {
          workflowShutdownSignal().throwIfAborted();
          this.emit({ method: `${path}.list`, attempt: this.attempts, status: response.status, ok: false, failure: 'transient', units: 1 });
          if (retry < retries) { await sleep(Math.min(5000, this.options.retryDelayMs ?? 250)); continue; }
          throw new YoutubeError('transient');
        }
        try { data = JSON.parse(body); } catch { data = null; }
        if (response.ok) {
          if (!record(data) || !Array.isArray(data.items) || data.items.length > 100) { this.emit({ method: `${path}.list`, attempt: this.attempts, status: response.status, ok: false, failure: 'invalid-response', units: 1 }); throw new YoutubeError('invalid-response'); }
          this.emit({ method: `${path}.list`, attempt: this.attempts, status: response.status, ok: true, units: 1 });
          return data;
        }
        const error = record(data) && record(data.error) ? data.error : {};
        const first = Array.isArray(error.errors) && record(error.errors[0]) ? error.errors[0] : {};
        const reason = str(first.reason);
        const message = str(error.message).toLowerCase();
        const daily = response.status === 403 && ['quotaExceeded', 'dailyLimitExceeded'].includes(reason);
        const rate = response.status === 429 || ([403, 429].includes(response.status) && /rate|quota|dailylimit/i.test(reason));
        const auth = response.status === 401 || ([400, 403].includes(response.status) && (/keyinvalid|keyexpired|keynotfound|keyrevoked|accessnotconfigured|iprefererblocked|autherror/i.test(reason.replace(/[^a-z0-9]/gi, '')) || /api key.*(?:valid|expired|found|revoked)|authentication credential|access not configured/.test(message)));
        const transient = [500, 502, 503, 504].includes(response.status);
        lastFailure = daily ? 'quota-daily' : rate ? 'rate-limit' : auth ? 'authentication' : transient ? 'transient' : 'request-failed';
        this.emit({ method: `${path}.list`, attempt: this.attempts, status: response.status, ok: false, failure: lastFailure, units: 1 });
        if (daily || rate || auth) { if (daily) dailyKeys++; break; }
        if (transient && retry < retries) { await sleep(Math.min(5000, this.options.retryDelayMs ?? 250)); continue; }
        throw new YoutubeError(lastFailure, response.status);
      }
    }
    if (dailyKeys === this.keys.length) {
      this.exhausted=true;
      // Preserve the provider exhaustion error even when the durable breaker write fails.
      try { await this.options.ledger.markDailyExhausted(lastDate); } catch { /* Original quota error and in-memory breaker survive a ledger failure. */ }
    }
    throw new YoutubeError(lastFailure);
  }
  private items(data: Json): unknown[] { return data.items as unknown[]; }
  private next(data: Json): string | null {
    if (data.nextPageToken === undefined || data.nextPageToken === null || data.nextPageToken === '') return null;
    if (typeof data.nextPageToken !== 'string' || data.nextPageToken.length > 2000) throw new YoutubeError('invalid-response');
    return data.nextPageToken;
  }
  async channelProfiles(values:string[]):Promise<Map<string,ChannelProfile>> {
    const ids=this.ids(values);if(ids.some(id=>!/^UC[A-Za-z0-9_-]{22}$/.test(id)))throw new YoutubeError('request-failed');
    const result=new Map<string,ChannelProfile>();if(!ids.length)return result;
    const data=await this.get('channels',{part:'snippet,contentDetails,statistics',id:ids.join(','),maxResults:'50'});
    for(const raw of this.items(data)){
      if(!record(raw)||!ids.includes(str(raw.id))||result.has(str(raw.id))||!record(raw.snippet)||!record(raw.contentDetails)||!record(raw.contentDetails.relatedPlaylists)||!record(raw.statistics))throw new YoutubeError('invalid-response');
      const n=raw.snippet,c=raw.contentDetails.relatedPlaylists,s=raw.statistics,id=str(raw.id),title=str(n.title),description=str(n.description),uploads=str(c.uploads);
      const viewCount=unsigned(s.viewCount),videoCount=unsigned(s.videoCount),subscriberCount=unsigned(s.subscriberCount),hidden=s.hiddenSubscriberCount??false;
      if(!title||[...title].length>256||Buffer.byteLength(description)>60000||uploads!=='UU'+id.slice(2)||!rfc3339(n.publishedAt)||viewCount===null||videoCount===null||typeof hidden!=='boolean'||(subscriberCount===null&&!hidden))throw new YoutubeError('invalid-response');
      const thumbnails=record(n.thumbnails)?n.thumbnails:{},defaultThumbnail=record(thumbnails.default)?thumbnails.default:{},candidate=str(defaultThumbnail.url);
      let thumbnail:string|null=null;if(candidate){try{const u=new URL(candidate);if(u.protocol==='https:'&&!u.username&&!u.password&&candidate.length<=256)thumbnail=candidate;}catch{/* Optional image omitted. */}}
      result.set(id,{id,title,description,uploads,publishedAt:n.publishedAt,thumbnail,statistics:{viewCount,videoCount,subscriberCount,hiddenSubscriberCount:hidden}});
    }
    return result;
  }
  async channelPresence(values: string[]): Promise<string[]> {
    const ids = this.ids(values); if (!ids.length) return [];
    const data = await this.get('channels', { part: 'id', id: ids.join(','), maxResults: '50' });
    const items = this.items(data);
    if (items.some(item => !record(item) || !ids.includes(str(item.id)))) throw new YoutubeError('invalid-response');
    return items.filter(record).map(item => str(item.id));
  }
  async channelStatistics(values: string[]): Promise<Map<string, ChannelStatistics>> {
    const ids = this.ids(values); const result = new Map<string, ChannelStatistics>(); if (!ids.length) return result;
    const data = await this.get('channels', { part: 'statistics', id: ids.join(','), maxResults: '50' });
    for (const item of this.items(data)) {
      if (!record(item) || !ids.includes(str(item.id)) || !record(item.statistics)) continue;
      const s = item.statistics, viewCount = unsigned(s.viewCount), videoCount = unsigned(s.videoCount), subscriberCount = unsigned(s.subscriberCount), hidden = s.hiddenSubscriberCount ?? false;
      if (viewCount === null || videoCount === null || typeof hidden !== 'boolean' || (subscriberCount === null && !hidden)) continue;
      result.set(str(item.id), { viewCount, videoCount, subscriberCount, hiddenSubscriberCount: hidden });
    } return result;
  }
  async videoStatistics(values: string[]): Promise<Map<string, VideoStatistics>> {
    const ids = this.ids(values); const result = new Map<string, VideoStatistics>(); if (!ids.length) return result;
    const data = await this.get('videos', { part: 'statistics', id: ids.join(','), maxResults: '50' });
    for (const item of this.items(data)) {
      if (!record(item) || !ids.includes(str(item.id)) || !record(item.statistics)) continue;
      const s = item.statistics, viewCount = unsigned(s.viewCount), dislikeCount = s.dislikeCount === undefined ? 0 : unsigned(s.dislikeCount);
      if (viewCount === null || dislikeCount === null || ['likeCount', 'favoriteCount', 'commentCount'].some(k => s[k] !== undefined && unsigned(s[k]) === null)) continue;
      result.set(str(item.id), { viewCount, dislikeCount, likeCount: unsigned(s.likeCount), favoriteCount: unsigned(s.favoriteCount), commentCount: unsigned(s.commentCount) });
    } return result;
  }
  async playlistItemsPage(playlistId: string, pageToken: string | null = null, maxResults = 50): Promise<Page<PlaylistItem>> {
    if (!playlistId.trim()) return { items: [], nextPageToken: null };
    const data = await this.get('playlistItems', { part: 'snippet', playlistId: playlistId.trim(), maxResults: String(Math.max(1, Math.min(50, maxResults))), ...(pageToken ? { pageToken } : {}) });
    const items = this.items(data).map(item => {
      if (!record(item) || !record(item.snippet)) throw new YoutubeError('invalid-response');
      const s = item.snippet, thumbnails = record(s.thumbnails) ? s.thumbnails : {}, resource = record(s.resourceId) ? s.resourceId : {};
      // Laravel trims identifiers, dates and titles (never the description) before validating and storing them.
      const trimmed = (value: unknown) => str(value).trim(), publishedAt = trimmed(s.publishedAt);
      const thumbnail = ['default', 'medium', 'high'].map(size => thumbnails[size]).filter(record).map(t => str(t.url)).find(url => url.trim() !== '') ?? '';
      const live = s.liveBroadcastContent === undefined ? 'none' : trimmed(s.liveBroadcastContent), position = unsigned(s.position);
      if (!trimmed(item.id) || !trimmed(resource.videoId) || !rfc3339(publishedAt) || !trimmed(s.channelId) || !trimmed(s.title) || !trimmed(s.channelTitle) || trimmed(s.playlistId) !== playlistId.trim() || typeof s.description !== 'string' || !thumbnail || position === null || !['none', 'live', 'upcoming'].includes(live)) throw new YoutubeError('invalid-response');
      return { id: trimmed(item.id), videoId: trimmed(resource.videoId), publishedAt, channelId: trimmed(s.channelId), title: trimmed(s.title), description: s.description, thumbnails: thumbnail, channelTitle: trimmed(s.channelTitle), playlistId: playlistId.trim(), position, liveBroadcastContent: live as PlaylistItem['liveBroadcastContent'] };
    }); return { items, nextPageToken: this.next(data) };
  }
  async playlistItems(playlistId: string, maxResults = 50) { return (await this.playlistItemsPage(playlistId, null, maxResults)).items; }
  async videoContentDetails(values: string[]): Promise<Map<string, { duration: string; durationSeconds: number; caption: string | null }>> {
    const ids = this.ids(values); const result = new Map<string, { duration: string; durationSeconds: number; caption: string | null }>(); if (!ids.length) return result;
    const data = await this.get('videos', { part: 'contentDetails', id: ids.join(','), maxResults: '50' });
    for (const item of this.items(data)) {
      if (!record(item) || !ids.includes(str(item.id)) || !record(item.contentDetails)) continue;
      const duration = str(item.contentDetails.duration);
      let durationSeconds: number;
      try { durationSeconds = durationToSeconds(duration); } catch { continue; }
      result.set(str(item.id), { duration, durationSeconds, caption: typeof item.contentDetails.caption === 'string' ? item.contentDetails.caption : null });
    } return result;
  }
  async videoLiveStreamingDetails(values: string[]): Promise<Map<string, Json | null>> {
    const ids = this.ids(values); const result = new Map<string, Json | null>(); if (!ids.length) return result;
    const data = await this.get('videos', { part: 'liveStreamingDetails', id: ids.join(','), maxResults: '50' });
    for (const item of this.items(data)) {
      if (!record(item) || !ids.includes(str(item.id))) throw new YoutubeError('invalid-response');
      if (!record(item.liveStreamingDetails)) { if ('liveStreamingDetails' in item) result.set(str(item.id), null); continue; }
      const d = item.liveStreamingDetails;
      if (!['actualStartTime', 'actualEndTime', 'scheduledStartTime', 'concurrentViewers', 'activeLiveChatId'].some(k => k in d)) continue;
      const malformed = ('concurrentViewers' in d && unsigned(d.concurrentViewers) === null) || ['actualStartTime', 'actualEndTime', 'scheduledStartTime'].some(k => k in d && !rfc3339(d[k])) || ('activeLiveChatId' in d && !str(d.activeLiveChatId).trim());
      result.set(str(item.id), malformed ? null : d);
    } return result;
  }
  async commentThreads(videoId: string, pageToken: string | null = null, maxResults = 100): Promise<Page<Json>> {
    if (!videoId.trim()) return { items: [], nextPageToken: null };
    const data = await this.get('commentThreads', { part: 'id,replies,snippet', videoId, maxResults: String(Math.max(1, Math.min(100, maxResults))), ...(pageToken ? { pageToken } : {}) }, 20000);
    if (this.items(data).some(item => !record(item))) throw new YoutubeError('invalid-response');
    return { items: this.items(data) as Json[], nextPageToken: this.next(data) };
  }
  async comments(parentId: string, pageToken: string | null = null, maxResults = 100): Promise<Page<Json>> {
    if (!parentId.trim()) return { items: [], nextPageToken: null };
    const data = await this.get('comments', { part: 'id,snippet', parentId, maxResults: String(Math.max(1, Math.min(100, maxResults))), ...(pageToken ? { pageToken } : {}) }, 20000);
    if (this.items(data).some(item => !record(item))) throw new YoutubeError('invalid-response');
    return { items: this.items(data) as Json[], nextPageToken: this.next(data) };
  }
}
export function durationToSeconds(duration: string): number {
  const match = /^P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(duration);
  if (!match || !match.slice(1).some(v => v !== undefined)) throw new YoutubeError('invalid-response');
  const seconds = [604800, 86400, 3600, 60, 1].reduce((sum, multiplier, index) => sum + Number(match[index + 1] ?? 0) * multiplier, 0);
  if (!Number.isSafeInteger(seconds)) throw new YoutubeError('invalid-response'); return seconds;
}
