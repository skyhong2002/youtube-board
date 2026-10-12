import type { Row } from '../db/client.js';
import { object, list, text, integer, timestamp } from './normalize.js';
import { link } from './table.js';
import { BadQuery } from './query.js';
export const authorTaxonomyIds = [3, 4, 5, 6, 48, 49];
/** Current writers emit string lists. Key/count maps are a documented legacy-reader extension. */
export function authorIndex(value: unknown) {
  const array = list(value), map = object(value), entries = array.length ? array.map((v,i) => [String(i),v] as const) : Object.entries(map);
  let keyCountMap = false;
  const ids = entries.map(([key,v]) => {
    if (!array.length && typeof v === 'number' && /^[A-Za-z0-9_-]{11}$/.test(key)) { keyCountMap = true; return key; }
    return (typeof v === 'string' || (typeof v === 'number' && Number.isFinite(v)) ? String(v) : key).replace(/^[ \t\r\n\x00\x0b]+|[ \t\r\n\x00\x0b]+$/g,'');
  }).filter(v => /^[A-Za-z0-9_-]{1,32}$/.test(v));
  return { ids: [...new Set(ids)], keyCountMap, ignoredEntries: entries.length - ids.length };
}
export function analyzeAuthorComments(records: Row[], channelId: string) {
  const hourly = Array.from({ length: 24 }, (_, hour) => ({ hour: String(hour).padStart(2,'0'), comments: 0, replies: 0, total: 0 }));
  const channels = new Map<number, { uId: number; videos: number; comments: number; replies: number; total: number }>();
  const comments: { video: { value: string; href: string }; text: string; publishedAt: string | null; likes: number | null; reply: boolean }[] = [];
  let roots = 0, replies = 0, undated = 0;
  for (const record of records) {
    const uId = integer(record.u_id) ?? 0;
    if (uId > 0) { const c = channels.get(uId) ?? { uId, videos: 0, comments: 0, replies: 0, total: 0 }; c.videos++; channels.set(uId, c); }
    const raw = object(record.comments_json), items = Object.keys(raw).length ? Object.values(raw) : list(record.comments_json);
    for (const value of items) {
      const root = object(value), children = Array.isArray(root.replies) ? root.replies : Object.values(object(root.replies));
      for (const [comment, reply] of [[root, false], ...children.map(v => [object(v), true])] as const) {
        const c = object(comment);
        if (!channelId || text(object(c.authorChannelId).value ?? c.authorChannelId) !== channelId) continue;
        if (comments.length >= 100000) throw new BadQuery('Author history exceeds the 100,000 comment review bound.');
        const publishedAt = timestamp(c.publishedAt), at = publishedAt ? Date.parse(publishedAt) : NaN;
        if (Number.isFinite(at)) { const bucket = hourly[new Date(at + 8*3600000).getUTCHours()]!; bucket[reply ? 'replies' : 'comments']++; bucket.total++; } else undated++;
        if (reply) replies++; else roots++;
        const channel = channels.get(uId); if (channel) { channel[reply ? 'replies' : 'comments']++; channel.total++; }
        comments.push({ video: link(text(record.videoId), `/videos/${encodeURIComponent(text(record.videoId))}`), text: text(c.textOriginal ?? c.textDisplay).replace(/<[^>]*>/g, '').trim(), publishedAt, likes: integer(c.likeCount), reply: Boolean(reply) });
      }
    }
  }
  comments.sort((a,b) => (b.publishedAt ? Date.parse(b.publishedAt) : -Infinity) - (a.publishedAt ? Date.parse(a.publishedAt) : -Infinity));
  return { comments, hourly, channels: [...channels.values()].sort((a,b) => b.total-a.total || a.uId-b.uId), roots, replies, undated };
}
