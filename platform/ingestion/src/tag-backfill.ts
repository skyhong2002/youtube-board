import {tagMetricsFromEvidence} from '../../shared/cache-metrics.js';
import type { RowDataPacket } from 'mysql2/promise';
import type { PlaylistItem } from './youtube.js';
import { taipeiSql, upsert } from './legacy-db.js';
import { isLiveCandidate, isRunStoppingYoutubeError } from './channel-jobs.js';
import type { SourceJobContext } from './video-statistics.js';
export interface TagSelection { tagIds: number[]; orTagIds?: number[]; notTagIds?: number[] }
export interface TagDictionary {
  version: string; coverage: string; rule: string;
  match(title: string, description: string): { term: string; field: 'title' | 'description' }[];
  /** Score divisor per term; absent means 1 (the vocabulary builders). */
  divisor?(term: string): number;
}
export interface BackfillInput extends TagSelection { from: string; to: string; channelLimit: number; maxPages: number; maxResults: number; videoLimit: number; rebuildCache: boolean }
function normalized(values: number[] = []): number[] { if (values.length > 20 || values.some(v => !Number.isSafeInteger(v) || v < 1)) throw new Error('Tag IDs require 1–20 positive integers'); const normalized = [...new Set(values)].sort((a, b) => a - b); if (normalized.join(',').length > 64) throw new Error('Tag selection exceeds legacy cache key capacity'); return normalized; }
export function validateBackfill(input: BackfillInput): BackfillInput {
  const validDay = (day: string) => /^\d{4}-\d{2}-\d{2}$/.test(day) && new Date(day + 'T00:00:00Z').toISOString().slice(0, 10) === day;
  if (!validDay(input.from) || !validDay(input.to)) throw new Error('Backfill dates must be real YYYY-MM-DD dates');
  const days = (Date.parse(input.to) - Date.parse(input.from)) / 86400000 + 1;
  if (days < 1 || days > 31) throw new Error('Backfill range must be 1–31 days');
  for (const [value, max] of [[input.channelLimit, 500], [input.maxPages, 200], [input.maxResults, 50], [input.videoLimit, 20000]]) if (!Number.isInteger(value) || value! < 1 || value! > max!) throw new Error('Invalid backfill cap');
  const result = { ...input, tagIds: normalized(input.tagIds), orTagIds: normalized(input.orTagIds), notTagIds: normalized(input.notTagIds) };
  if (!result.tagIds.length && !result.orTagIds.length) throw new Error('Backfill requires explicit channel taxonomy selection');
  return result;
}
/** Laravel TagVideoBackfillIngestion::channels: inner join urt_count, ORDER BY u_id, first `limit` rows plus a truncation flag. */
async function channels(ctx: SourceJobContext, input: BackfillInput): Promise<{ rows: RowDataPacket[]; truncated: boolean }> {
  const clauses = ['c.flag_del IS NULL'], values: unknown[] = [];
  if (input.orTagIds?.length) { clauses.push('(' + input.orTagIds.map(() => 'n.tags LIKE ?').join(' OR ') + ')'); values.push(...input.orTagIds.map(id => `%[${id}]%`)); }
  for (const id of input.tagIds) { clauses.push('n.tags LIKE ?'); values.push(`%[${id}]%`); }
  for (const id of input.notTagIds ?? []) { clauses.push('n.tags NOT LIKE ?'); values.push(`%[${id}]%`); }
  const [rows] = await ctx.db.query<RowDataPacket[]>(`SELECT c.u_id, c.title, c.uploads FROM urt_channel c JOIN urt_count n ON n.u_id = c.u_id WHERE ${clauses.join(' AND ')} ORDER BY c.u_id LIMIT ?`, [...values, input.channelLimit + 1]);
  return { rows: rows.slice(0, input.channelLimit), truncated: rows.length > input.channelLimit };
}
/** Laravel fetchChannel: walk uploads newest-first and stop at the first item before `from` (premieres included as listed). */
async function crawlChannel(ctx: SourceJobContext, channel: RowDataPacket, input: BackfillInput) {
  const from = Date.parse(input.from + 'T00:00:00+08:00'), until = Date.parse(input.to + 'T23:59:59+08:00');
  let token: string | null = null, stoppedBeforeFrom = false, pages = 0;
  const seen = new Set<string>(), items: PlaylistItem[] = [];
  do {
    await ctx.assertOwnership();
    const page = await ctx.youtube.playlistItemsPage(String(channel.uploads).trim(), token, input.maxResults); pages++;
    for (const item of page.items) {
      const at = Math.floor(Date.parse(item.publishedAt) / 1000) * 1000;
      if (at < from) { stoppedBeforeFrom = true; break; }
      if (at > until) continue;
      items.push(item);
    }
    if (stoppedBeforeFrom) break;
    if (page.nextPageToken !== null && (seen.has(page.nextPageToken) || page.nextPageToken === token)) throw new Error('Uploads cursor failed to advance');
    token = page.nextPageToken; if (token !== null) seen.add(token);
  } while (token !== null && pages < input.maxPages);
  if (token !== null && !stoppedBeforeFrom) throw new Error('Uploads page cap reached before cutoff');
  const at = taipeiSql(ctx.now);
  for (const item of items) {
    await ctx.assertOwnership();
    const publishedAt = taipeiSql(new Date(item.publishedAt));
    // Laravel upsertByKeys overwrites ctime on existing rows as well.
    await upsert(ctx.db, 'urt_video', { videoId: item.videoId }, { ctime: at, id: item.id, publishedAt, channelId: item.channelId, title: item.title, thumbnails: item.thumbnails, channelTitle: item.channelTitle, playlistId: item.playlistId, position: item.position, u_id: channel.u_id, description: item.description });
    await upsert(ctx.db, 'urt_video_schedule', { videoId: item.videoId }, { ctime: at, publishedAt });
    if (isLiveCandidate(item)) {
      await upsert(ctx.db, 'urt_video_live', { videoId: item.videoId }, { ctime: at, publishedAt, u_id: channel.u_id });
    }
  }
  return { uId: Number(channel.u_id), pages, videos: new Set(items.map(item => item.videoId)).size };
}
export function tagMetrics(videos:{title:string;description:string;viewCount:unknown}[],dictionary:TagDictionary){return tagMetricsFromEvidence(videos.map(v=>({videoId:'',uId:0,publishedAt:'',viewCount:v.viewCount,matches:dictionary.match(v.title,v.description)})));}

/** Laravel rebuilds each date with the same TagDateCacheBuilder as reports.tag_date.build (1000 channels, 10000 videos per date). */
export async function rebuildTagDates(ctx: SourceJobContext, input: BackfillInput, dictionary: TagDictionary) {
  const { tagDateCacheJob } = await import('./report-caches.js');
  const days = (Date.parse(input.to) - Date.parse(input.from)) / 86400000 + 1;
  return tagDateCacheJob(ctx, { tagIds: input.tagIds, orTagIds: input.orTagIds ?? [], notTagIds: input.notTagIds ?? [], from: input.from, to: input.to, days, channelLimit: 1000, videoLimit: input.videoLimit }, dictionary);
}
export async function tagBackfillJob(ctx: SourceJobContext, rawInput: BackfillInput, dictionary?: TagDictionary) {
  const input = validateBackfill(rawInput), { rows: selected, truncated } = await channels(ctx, input);
  if (input.rebuildCache && !dictionary) throw new Error('A published upstream vocabulary is required to rebuild tag caches');
  if (!ctx.execute) return { mode: 'dry-run', selected: selected.length, truncated, maxRequests: selected.length * input.maxPages, apiAttempts: 0, applied: [], skipped: [], caches: [] };
  const applied: { uId: number; pages: number; videos: number }[] = [], skipped: { uId: number; reason: string }[] = [];
  for (const channel of selected) {
    if (!String(channel.uploads ?? '').trim()) { skipped.push({ uId: channel.u_id, reason: 'missing-uploads-playlist' }); continue; }
    try { applied.push(await crawlChannel(ctx, channel, input)); } catch (error) {
      // Laravel rethrows all-keys/quota-window failures (partial channels stay written); anything else fails this channel only.
      if (isRunStoppingYoutubeError(error)) throw error;
      await ctx.assertOwnership();
      skipped.push({ uId: channel.u_id, reason: 'incomplete-channel-crawl' });
    }
  }
  // An incomplete or capped channel selection never claims a complete date cache.
  const crawlComplete = selected.length > 0 && !truncated && skipped.length === 0;
  const rebuilt = crawlComplete && input.rebuildCache ? await rebuildTagDates(ctx, input, dictionary!) : null;
  const caches = rebuilt ? rebuilt.applied.map(date => ({ date })) : [];
  return { mode: 'execute', selected: selected.length, truncated, apiAttempts: ctx.youtube.attemptsMade, applied, skipped: [...skipped, ...(rebuilt?.skipped ?? []).map(row => ({ uId: 0, reason: `tag-date-${row.date}-${row.reason}` }))], caches, crawlComplete };
}
