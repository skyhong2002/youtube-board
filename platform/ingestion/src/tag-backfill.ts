import {tagMetricsFromEvidence} from '../../shared/cache-metrics.js';
import type { RowDataPacket } from 'mysql2/promise';
import type { PlaylistItem } from './youtube.js';
import { taipeiSql, selectOne, upsert } from './legacy-db.js';
import type { SourceJobContext } from './video-statistics.js';
export interface TagSelection { tagIds: number[]; orTagIds?: number[]; notTagIds?: number[] }
export interface TagDictionary {
  version: string; coverage: string; rule: string;
  match(title: string, description: string): { term: string; field: 'title' | 'description' }[];
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
async function channels(ctx: SourceJobContext, input: BackfillInput): Promise<RowDataPacket[]> {
  const clauses = ['c.flag_del IS NULL'], values: unknown[] = [];
  for (const id of input.tagIds) { clauses.push('n.tags LIKE ?'); values.push(`%[${id}]%`); }
  if (input.orTagIds?.length) { clauses.push('(' + input.orTagIds.map(() => 'n.tags LIKE ?').join(' OR ') + ')'); values.push(...input.orTagIds.map(id => `%[${id}]%`)); }
  for (const id of input.notTagIds ?? []) { clauses.push('n.tags NOT LIKE ?'); values.push(`%[${id}]%`); }
  const [rows] = await ctx.db.query<RowDataPacket[]>(`SELECT c.u_id, c.title, c.uploads FROM urt_channel c JOIN urt_count n ON n.u_id = c.u_id WHERE ${clauses.join(' AND ')} ORDER BY c.u_id LIMIT ?`, [...values, input.channelLimit + 1]); return rows;
}
async function crawlChannel(ctx: SourceJobContext, channel: RowDataPacket, input: BackfillInput) {
  const from = Date.parse(input.from + 'T00:00:00+08:00'), until = Date.parse(input.to + 'T23:59:59.999+08:00');
  let token: string | null = null, complete = false, pages = 0, previousTime = Infinity;
  const seen = new Set<string>(), items = new Map<string, PlaylistItem>();
  for (; pages < input.maxPages; ) {
    await ctx.assertOwnership();
    const page = await ctx.youtube.playlistItemsPage(String(channel.uploads), token, input.maxResults); pages++;
    for (const item of page.items) {
      const at = Date.parse(item.publishedAt);
      if (at > previousTime) throw new Error('Uploads chronology changed during scan'); previousTime = at;
      if (at < from) complete = true;
      else if (at <= until) items.set(item.videoId, item);
    }
    if (complete || page.nextPageToken === null) { complete = true; break; }
    if (seen.has(page.nextPageToken) || page.nextPageToken === token || !page.items.length) throw new Error('Uploads cursor failed to advance');
    seen.add(page.nextPageToken); token = page.nextPageToken;
  }
  if (!complete) throw new Error('Uploads page cap reached before cutoff');
  const at = taipeiSql(ctx.now);
  for (const item of items.values()) {
    await ctx.assertOwnership(); const existing = await selectOne(ctx.db, 'urt_video', { videoId: item.videoId });
    const publishedAt = taipeiSql(new Date(item.publishedAt));
    await upsert(ctx.db, 'urt_video', { videoId: item.videoId }, { ...(existing ? {} : { ctime: at }), id: item.id, publishedAt, channelId: item.channelId, title: item.title, description: item.description, thumbnails: item.thumbnails, channelTitle: item.channelTitle, playlistId: item.playlistId, position: item.position, u_id: channel.u_id });
    const schedule = await selectOne(ctx.db, 'urt_video_schedule', { videoId: item.videoId });
    await upsert(ctx.db, 'urt_video_schedule', { videoId: item.videoId }, { ...(schedule ? {} : { ctime: at }), publishedAt });
    if (item.liveBroadcastContent === 'live' || item.liveBroadcastContent === 'upcoming' || item.thumbnails.includes('default_live.jpg')) {
      const live = await selectOne(ctx.db, 'urt_video_live', { videoId: item.videoId });
      await upsert(ctx.db, 'urt_video_live', { videoId: item.videoId }, { ...(live ? {} : { ctime: at }), publishedAt, u_id: channel.u_id });
    }
  }
  return { uId: Number(channel.u_id), pages, videos: items.size };
}
export function tagMetrics(videos:{title:string;description:string;viewCount:unknown}[],dictionary:TagDictionary){return tagMetricsFromEvidence(videos.map(v=>({videoId:'',uId:0,publishedAt:'',viewCount:v.viewCount,matches:dictionary.match(v.title,v.description)})));}

export async function rebuildTagDates(ctx: SourceJobContext, input: BackfillInput, channelIds: number[], dictionary: TagDictionary) {
  const prepared: { day: string; metrics: ReturnType<typeof tagMetrics> }[] = [];
  for (let time = Date.parse(input.from + 'T00:00:00Z'); time <= Date.parse(input.to + 'T00:00:00Z'); time += 86400000) {
    const day = new Date(time).toISOString().slice(0, 10);
    const [rows] = await ctx.db.query<RowDataPacket[]>(`SELECT title, description, viewCount FROM urt_video WHERE u_id IN (${channelIds.map(() => '?').join(',')}) AND publishedAt >= ? AND publishedAt <= ? ORDER BY publishedAt, pk LIMIT ?`, [...channelIds, day + ' 00:00:00', day + ' 23:59:59', input.videoLimit + 1]);
    if (rows.length > input.videoLimit) throw new Error('Tag cache video cap reached; existing caches retained');
    prepared.push({ day, metrics: tagMetrics(rows.map(r => ({ title: r.title ?? '', description: r.description ?? '', viewCount: r.viewCount })), dictionary) });
  }
  const selectionKey = JSON.stringify([input.tagIds, input.orTagIds ?? [], input.notTagIds ?? []]);
  for (const { day, metrics } of prepared) {
    await ctx.assertOwnership();
    const keys = { tagid: input.tagIds.join(','), tag_or: input.orTagIds?.length ? input.orTagIds.join(',') : null, tag_not: input.notTagIds?.length ? input.notTagIds.join(',') : null, the_date: day };
    const existing = await selectOne(ctx.db, 'urt_show_tag_date', keys);
    const at = taipeiSql(ctx.now);
    // Sidecar is marked pending before writing MyISAM so interrupted publication is visible.
    await ctx.db.execute('INSERT INTO ts_tag_cache_lineage (selection_key, the_date, vocabulary_version, coverage, rule_version, status, generated_at, unknown_view_videos) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE vocabulary_version = VALUES(vocabulary_version), coverage = VALUES(coverage), rule_version = VALUES(rule_version), status = VALUES(status), generated_at = VALUES(generated_at), unknown_view_videos = VALUES(unknown_view_videos)', [selectionKey, day, dictionary.version, dictionary.coverage, dictionary.rule, 'pending', at, metrics.unknown_view_videos]);
    const { unknown_view_videos: _unknown, ...cacheMetrics } = metrics;
    await upsert(ctx.db, 'urt_show_tag_date', keys, { ...(existing ? {} : { ctime: at }), mtime: at, stime: at, count_channels: channelIds.length, ...cacheMetrics, tags_result: JSON.stringify(metrics.tags_result), tags_video: JSON.stringify(metrics.tags_video), tags_views: JSON.stringify(metrics.tags_views) });
    await ctx.db.execute('UPDATE ts_tag_cache_lineage SET status = ? WHERE selection_key = ? AND the_date = ?', ['published', selectionKey, day]);
  }
  return prepared.map(row => ({ date: row.day, videos: row.metrics.count_videos, terms: row.metrics.tags_count }));
}
export async function tagBackfillJob(ctx: SourceJobContext, rawInput: BackfillInput, dictionary?: TagDictionary) {
  const input = validateBackfill(rawInput), selected = await channels(ctx, input);
  if (input.rebuildCache && !dictionary) throw new Error('A published upstream vocabulary is required to rebuild tag caches');
  if (!ctx.execute) return { mode: 'dry-run', selected: Math.min(input.channelLimit, selected.length), truncated: selected.length > input.channelLimit, maxRequests: Math.min(input.channelLimit, selected.length) * input.maxPages, apiAttempts: 0, applied: [], skipped: [], caches: [] };
  if (!selected.length || selected.length > input.channelLimit) throw new Error('Channel selection is empty or exceeds cap; no API calls made');
  const applied: { uId: number; pages: number; videos: number }[] = [], skipped: { uId: number; reason: string }[] = [];
  for (const channel of selected) {
    if (!String(channel.uploads ?? '').trim()) { skipped.push({ uId: channel.u_id, reason: 'missing-uploads-playlist' }); continue; }
    try { applied.push(await crawlChannel(ctx, channel, input)); } catch (error) {
      if (error instanceof Error && error.name === 'YoutubeError' && /quota|authentication/.test(error.message)) throw error;
      skipped.push({ uId: channel.u_id, reason: 'incomplete-channel-crawl' });
    }
  }
  const caches = !skipped.length && input.rebuildCache ? await rebuildTagDates(ctx, input, selected.map(c => Number(c.u_id)), dictionary!) : [];
  return { mode: 'execute', selected: selected.length, truncated: false, apiAttempts: ctx.youtube.attemptsMade, applied, skipped, caches, crawlComplete: skipped.length === 0 };
}
