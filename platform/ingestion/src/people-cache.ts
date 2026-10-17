import type { RowDataPacket } from 'mysql2/promise';
import { cap } from './channel-jobs.js';
import { legacyInstant, selectOne, taipeiSql, update, upsert } from './legacy-db.js';
import { checkedSum, dateKeys, legacyTagChannels, scanVideos, selectionKey, withReportLineage, type CacheContext } from './report-caches.js';
/**
 * Laravel `reports:people:build --limit=5 --offset=auto --days=37 --tagid=13 --keyword-limit=5000`
 * (PeopleReportsPreview + TagDateCacheBuilder with onlyKeywords=[person]):
 * - rotates `limit` people of tag_group `group` ordered by latest_time DESC, tag; offset=auto is
 *   (floor(unix/3600) * limit) % candidates, wrapping to the start of the list;
 * - for each of the last `days` Taipei calendar dates counts the person name with substr_count over
 *   "title title description" of the urt_count-marker channels' videos;
 * - MERGES the person's tags_result/tags_video/tags_views into the existing urt_show_tag_date row (other
 *   names and the row totals are kept; a zero count leaves the previous value), or inserts a new row.
 */
export interface PeopleInput { group: string; tagId: number; days: number; limit: number; offset: number | 'auto'; keywordLimit: number; channelLimit: number; videoLimit: number }
export const PEOPLE_LINEAGE = { version: 'laravel-tag-group', coverage: 'tag_group-people', rule: 'laravel-substr-title2-merge-v1' };
const numericString = /^\s*[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?\s*$/;
/** PHP is_numeric for decoded JSON scalars. */
export const phpNumeric = (value: unknown) => typeof value === 'number' ? Number.isFinite(value) : typeof value === 'string' && numericString.test(value);
/** PHP stores canonical decimal-integer keys as ints; Laravel's is_string($key) filter then drops them. */
const phpIntegerKey = (key: string) => /^(0|-?[1-9]\d*)$/.test(key) && Number.isSafeInteger(Number(key));
export function eligibleKeyword(tag: string) {
  if (tag === '' || [...tag].length <= 1 || phpNumeric(tag)) return false;
  return !/^[A-Za-z]+$/.test(tag) || tag.length >= 3;
}
export function substrCount(haystack: string, needle: string) {
  let count = 0;
  for (let at = haystack.indexOf(needle); at !== -1; at = haystack.indexOf(needle, at + needle.length)) count++;
  return count;
}
/** TagDateCacheBuilder::decodeMetricJson. */
export function laravelMetricEntries(json: unknown): [string, unknown][] {
  let decoded: unknown;
  try { decoded = JSON.parse(String(json ?? '')); } catch { return []; }
  if (!decoded || typeof decoded !== 'object' || Array.isArray(decoded)) return [];
  const data = (decoded as Record<string, unknown>).data;
  if (Object.hasOwn(decoded, 'data') && data && typeof data === 'object') { if (Array.isArray(data)) return []; decoded = data; }
  return Object.entries(decoded as Record<string, unknown>).filter(([key, value]) => !phpIntegerKey(key) && phpNumeric(value));
}
const encode = (entries: [string, unknown][]) => entries.length ? JSON.stringify(Object.fromEntries(entries)) : '[]';
/** TagDateCacheBuilder::mergedMetricJson: set the new values, then a stable arsort(SORT_NUMERIC). */
export function mergedMetricJson(existing: unknown, updates: Record<string, unknown>) {
  const merged = new Map(laravelMetricEntries(existing));
  for (const [tag, value] of Object.entries(updates)) if (!phpIntegerKey(tag) && phpNumeric(value)) merged.set(tag, value);
  return encode([...merged].sort((a, b) => Number(b[1]) - Number(a[1])));
}
export interface LaravelKeyword { tag: string; divisor: number }
/** TagDateCacheBuilder::metrics (substr_count on "title title description", longer keywords subtract contained shorter ones). */
export function laravelKeywordMetrics(keywords: LaravelKeyword[], videos: RowDataPacket[]) {
  const lengths = new Map<string, number>(), divisors = new Map<string, number>();
  for (const k of keywords) { lengths.set(k.tag, [...k.tag].length); divisors.set(k.tag, k.divisor); }
  const raw = new Map<string, number>(), perVideo = new Map<string, number>(), perViews = new Map<string, number>();
  let countTags = 0, totalViews = 0;
  for (const video of videos) {
    const text = `${video.title ?? ''} ${video.title ?? ''} ${video.description ?? ''}`, views = Math.max(0, Math.trunc(Number(video.viewCount ?? 0)) || 0);
    totalViews = checkedSum(totalViews, views);
    const counts = new Map<string, number>(), matched: [string, number][] = [];
    for (const k of keywords) { const n = substrCount(text, k.tag); if (n > 0) { if (!counts.has(k.tag)) matched.push([k.tag, lengths.get(k.tag)!]); counts.set(k.tag, n); } }
    if (!counts.size) continue;
    const ordered = matched.sort((a, b) => b[1] - a[1]).map(([tag]) => tag);
    for (let i = 0; i < ordered.length; i++) for (let j = i + 1; j < ordered.length; j++) if (ordered[i]!.includes(ordered[j]!)) counts.set(ordered[j]!, counts.get(ordered[j]!)! - counts.get(ordered[i]!)!);
    for (const [tag, count] of counts) {
      if (count <= 0) continue;
      countTags += count; raw.set(tag, (raw.get(tag) ?? 0) + count); perVideo.set(tag, (perVideo.get(tag) ?? 0) + 1); perViews.set(tag, checkedSum(perViews.get(tag) ?? 0, views));
    }
  }
  const result: [string, string][] = [];
  for (const [tag, count] of raw) { const score = count * (Math.log([...tag].length + 0.5) - 0.5) / (divisors.get(tag) ?? 0.5); if (score > 0) result.push([tag, score.toFixed(3)]); }
  const desc = <T>(entries: [string, T][]) => entries.sort((a, b) => Number(b[1]) - Number(a[1]));
  return { tags_result: Object.fromEntries(desc(result)), tags_video: Object.fromEntries(desc([...perVideo])), tags_views: Object.fromEntries(desc([...perViews])), count_tags: countTags, count_videos: videos.length, total_views: totalViews };
}
/** TagDateCacheBuilder::keywords with onlyKeywords=[person]: matching `tags` rows give divisor max_count+0.5, otherwise 1.0. */
async function personKeywords(ctx: CacheContext, person: string, keywordLimit: number): Promise<LaravelKeyword[]> {
  const [rows] = await ctx.db.query<RowDataPacket[]>('SELECT tag,max_count,hours_count,max_hours FROM tags WHERE (no_tag IS NULL OR no_tag<1) AND tag IN (?) ORDER BY hours_count DESC LIMIT ?', [person, keywordLimit + 1]);
  const now = ctx.now.getTime();
  const keywords = rows.slice(0, keywordLimit).map(row => {
    const maxCount = Math.max(0, Math.trunc(Number(row.max_count ?? 0)) || 0), hours = Math.max(0, Math.trunc(Number(row.hours_count ?? 0)) || 0);
    const maxHours = legacyInstant(row.max_hours) ?? ctx.now, periodDays = Math.max(1 / 24, Math.abs(now - maxHours.getTime()) / 1000 / 86400);
    const weight = hours > 1 && maxCount > 1 ? Math.log(hours) / periodDays * Math.log(maxCount) * 100 : 0;
    return { tag: String(row.tag), weight: Math.max(0, weight), divisor: Math.max(0.5, maxCount + 0.5) };
  }).filter(k => eligibleKeyword(k.tag)).sort((a, b) => b.weight - a.weight).slice(0, keywordLimit).map(({ tag, divisor }) => ({ tag, divisor }));
  if (!keywords.some(k => k.tag === person) && eligibleKeyword(person)) keywords.push({ tag: person, divisor: 1 });
  return keywords;
}
export function peopleOffset(offset: number | 'auto', total: number, limit: number, now: Date) {
  if (total < 1) return 0;
  return offset === 'auto' ? (Math.floor(now.getTime() / 1000 / 3600) * limit) % total : offset % total;
}
export async function peopleCacheJob(ctx: CacheContext, input: PeopleInput) {
  cap(input.tagId, 2147483647); cap(input.days, 365); cap(input.limit, 200); cap(input.keywordLimit, 20000); cap(input.channelLimit, 5000); cap(input.videoLimit, 100000);
  if (input.offset !== 'auto') cap(input.offset, 2147483647, 0);
  if (!input.group.trim() || [...input.group].length > 64) throw new Error('Invalid people group');
  const group = input.group.trim(), active = "group_name=? AND (del_flag IS NULL OR del_flag<'1')";
  const [counted] = await ctx.db.query<RowDataPacket[]>(`SELECT COUNT(*) AS n FROM tag_group WHERE ${active}`, [group]);
  const candidates = Number(counted[0]?.n ?? 0), offset = peopleOffset(input.offset, candidates, input.limit, ctx.now), want = Math.min(input.limit, candidates);
  const page = async (limit: number, skip: number) => (await ctx.db.query<RowDataPacket[]>(`SELECT tag,latest_time FROM tag_group WHERE ${active} ORDER BY latest_time DESC,tag LIMIT ? OFFSET ?`, [group, limit, skip]))[0];
  let selected = candidates ? await page(input.limit, offset) : [];
  const wrapped = selected.length < want && offset > 0;
  if (wrapped) selected = [...selected, ...await page(want - selected.length, 0)];
  // Laravel trims the name and would fall back to a full-vocabulary rebuild for a blank one; never do that here.
  const people = selected.map(r => String(r.tag ?? '').trim()), skipped: { tag?: string; date?: string; reason: string }[] = people.filter(p => !p).map(() => ({ reason: 'blank-tag' }));
  const names = people.filter(Boolean), keywords = new Map<string, LaravelKeyword[]>();
  for (const name of names) if (!keywords.has(name)) keywords.set(name, await personKeywords(ctx, name, input.keywordLimit));
  const dates = Array.from({ length: input.days }, (_, i) => taipeiSql(new Date(ctx.now.getTime() - (input.days - 1 - i) * 86400000)).slice(0, 10));
  const selection = { tagIds: [input.tagId], orTagIds: [], notTagIds: [] }, { channels, truncated } = await legacyTagChannels(ctx, selection, input.channelLimit);
  const applied: string[] = [], summary = { offset, nextOffset: candidates ? (offset + selected.length) % candidates : 0, candidates, wrapped, people };
  for (const date of dates) {
    if (!names.length) break;
    if (truncated) { skipped.push({ date, reason: 'channel_scan_limit_exceeded' }); continue; }
    const videos: RowDataPacket[] = [];
    if ((await scanVideos(ctx, channels, date + ' 00:00:00', date + ' 23:59:59', input.videoLimit, row => videos.push(row))).truncated) { skipped.push({ date, reason: 'video_scan_limit_exceeded' }); continue; }
    const perPerson = names.map(name => ({ name, metrics: laravelKeywordMetrics(keywords.get(name)!, videos) }));
    if (!ctx.execute) continue;
    const keys = { ...dateKeys(selection), the_date: date }, key = selectionKey(selection), unknown = videos.filter(v => v.viewCount === null || v.viewCount === undefined).length, at = taipeiSql(ctx.now);
    await ctx.assertOwnership();
    await ctx.db.execute('INSERT INTO ts_tag_cache_lineage(selection_key,the_date,vocabulary_version,coverage,rule_version,status,generated_at,unknown_view_videos) VALUES(?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE vocabulary_version=VALUES(vocabulary_version),coverage=VALUES(coverage),rule_version=VALUES(rule_version),status=VALUES(status),generated_at=VALUES(generated_at),unknown_view_videos=VALUES(unknown_view_videos)', [key, date, PEOPLE_LINEAGE.version, PEOPLE_LINEAGE.coverage, PEOPLE_LINEAGE.rule, 'pending', at, unknown]);
    await ctx.db.execute('UPDATE ts_tag_cache_lineage SET window_from=?,window_to=?,window_closed=? WHERE selection_key=? AND the_date=?', [date, date, date < at.slice(0, 10), key, date]);
    await withReportLineage(ctx, 'urt_show_tag_date', keys, PEOPLE_LINEAGE, unknown, undefined, async () => {
      for (const { metrics: m } of perPerson) {
        await ctx.assertOwnership();
        const existing = await selectOne(ctx.db, 'urt_show_tag_date', keys);
        if (existing) {
          const tagsResult = mergedMetricJson(existing.tags_result, m.tags_result);
          await update(ctx.db, 'urt_show_tag_date', { pk: existing.pk }, { mtime: at, stime: at, tags_count: laravelMetricEntries(tagsResult).length, tags_result: tagsResult, tags_video: mergedMetricJson(existing.tags_video, m.tags_video), tags_views: mergedMetricJson(existing.tags_views, m.tags_views) });
        } else {
          await upsert(ctx.db, 'urt_show_tag_date', keys, { ctime: at, mtime: at, stime: at, count_channels: channels.length, count_videos: m.count_videos, count_tags: m.count_tags, tags_count: Object.keys(m.tags_result).length, total_views: m.total_views, tags_result: encode(Object.entries(m.tags_result)), tags_video: encode(Object.entries(m.tags_video)), tags_views: encode(Object.entries(m.tags_views)) });
        }
      }
    });
    await ctx.db.execute('UPDATE ts_tag_cache_lineage SET status=? WHERE selection_key=? AND the_date=?', ['published', key, date]);
    applied.push(date);
  }
  return { mode: ctx.execute ? 'execute' : 'dry-run', selected: names.length, applied, skipped, channels: channels.length, ...summary };
}
