/**
 * 本站流量 (/observe): shared rules for the GA4 / Search Console pull (jobs/src/site-analytics-cli.ts) and the
 * public read (api/src/reports/site-observation.ts), ported from tag.observe.tw (app/src/jobs/analytics-job.ts,
 * app/src/v1/site-observation.ts). Rows live in ts_site_metrics: one value per Taipei day × source × metric × item.
 *
 * GA receives a fixed page_title (有影儀表板) and only measured paths (web/src/lib/analytics-consent.ts), so no title is
 * ever read from Google: pages are named from their path here and, for videos/channels/categories/AI topics, from the
 * dashboard's own tables at read time.
 */
export const SITE_HOST = 'youtube.observe.tw';
export const OBSERVATION_DAYS = [7, 28, 90] as const;
export type ObservationDays = (typeof OBSERVATION_DAYS)[number];
export const DEFAULT_OBSERVATION_DAYS: ObservationDays = 28;
/** Realtime rows older than this mean site.analytics.live has stopped: show nothing rather than a stale "now". */
export const LIVE_STALE_MS = 15 * 60e3;
export const VITAL_NAMES = ['LCP', 'INP', 'CLS'] as const;
export const VITAL_RATINGS = ['good', 'needs-improvement', 'poor'] as const;
/** Custom events SiteAnalytics sends (analyticsLinkEvent); web_vital is counted separately by rating. */
export const TRACKED_EVENTS = ['open_original', 'select_content', 'rss_click'] as const;

export const taipeiDay = (d: Date) => new Date(d.getTime() + 8 * 3600e3).toISOString().slice(0, 10);
export const shiftDay = (day: string, days: number) => new Date(Date.parse(`${day}T00:00:00Z`) + days * 864e5).toISOString().slice(0, 10);

const SAFE_SEGMENT = /^(?:[a-z][a-z-]*|\d{1,16}|\d{4}-\d{2}-\d{2})$/;
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Never measured (analytics-consent PRIVATE_PATH); dropped here too should a row ever name one.
const PRIVATE_FAMILIES = new Set(['my', 'admin', 'manage', 'ops', 'login', 'auth', 'boards', 'runtime', 'redir', 'search', 'feeds', 'render-isr', 'render-filtered']);

/** Whether a path carries text a reader or a source wrote (keyword terms, group/city/person names, AI conditions). */
function freeText(segments: string[]): boolean {
  const [family, id] = segments;
  if (['keywords', 'vocabulary', 'groups', 'comments'].includes(family!) && segments.length > 1) return true;
  if (family === 'mayor' && id === 'cities') return true;
  if (family === 'live' && id === 'groups') return true;
  return family === 'ai' && id === 'days' && /^\d{4}-\d{2}-\d{2}$/.test(segments[2] ?? '') && segments.length > 3;
}

/**
 * Canonical public path of a page GA or Search Console reports (a path or a full URL), or null when it is not ours or
 * not publishable: other hosts (a Search Console domain property also covers sibling subdomains), private pages,
 * free-text routes and anything with characters a measured path cannot have. Queries and fragments are cut.
 */
export function sitePath(raw: string): string | null {
  let path = raw.trim();
  if (/^https?:\/\//i.test(path)) {
    let url: URL;
    try { url = new URL(path); } catch { return null; }
    if (url.hostname !== SITE_HOST) return null;
    path = url.pathname;
  }
  path = path.split(/[?#]/)[0]!;
  if (!path.startsWith('/') || path.startsWith('//') || path.length > 200) return null;
  let decoded: string;
  try { decoded = decodeURIComponent(path); } catch { return null; }
  if (decoded.length > 1 && decoded.endsWith('/')) decoded = decoded.slice(0, -1);
  if (decoded === '/') return '/';
  const segments = decoded.slice(1).split('/'), [family, id] = segments;
  if (segments.some(s => !s) || PRIVATE_FAMILIES.has(family!) || (family === 'api' && segments.length > 1) || (family === 'observe' && segments.length > 1) || freeText(segments)) return null;
  const videoAt = family === 'videos' ? 1 : family === 'live' && id === 'videos' ? 2 : -1;
  const ok = segments.every((s, i) => i === videoAt ? VIDEO_ID.test(s) : family === 'events' && i === 1 ? UUID.test(s) : SAFE_SEGMENT.test(s));
  return ok ? '/' + segments.join('/') : null;
}

export type PageKind = 'video' | 'channel' | 'category' | 'topic' | 'event' | 'page';
export const KIND_LABELS: Record<PageKind, string> = { video: '影片', channel: '頻道', category: '分類', topic: '議題', event: '事件', page: '頁面' };
// Content a reader came for, as opposed to index and navigation pages (tag's 讀者關注).
const CONTENT: Array<[PageKind, RegExp]> = [
  ['video', /^\/videos\/[A-Za-z0-9_-]{11}(?:\/analytics)?$/],
  ['video', /^\/live\/videos\/[A-Za-z0-9_-]{11}\/trend$/],
  ['channel', /^\/channels\/\d+(?:\/[a-z]+)*(?:\/\d{4}-\d{2}-\d{2})?$/],
  ['category', /^\/tags\/\d+\/[a-z]+(?:\/[a-z]+)?$/],
  ['topic', /^\/ai\/events\/\d+(?:\/[a-z]+)?$/],
  ['topic', /^\/ai\/days\/\d+\/events(?:\/history)?$/],
  ['event', /^\/events\/[0-9A-Fa-f-]{36}$/],
];
/** SQL REGEXP (MariaDB PCRE) matching every content path, for the top-content query. */
export const CONTENT_PATH_REGEXP = CONTENT.map(([, re]) => re.source).join('|');
export function pageKind(path: string): PageKind {
  return CONTENT.find(([, re]) => re.test(path))?.[0] ?? 'page';
}

const PAGE_TITLES: Record<string, string> = {
  '/': '首頁',
  '/videos': '最新影片',
  '/channels': '頻道來源',
  '/tags': '頻道分類',
  '/tags/videos': '分類影片',
  '/tags/compare': '分類比較',
  '/tags/cloud': '分類文字雲',
  '/tags/days': '分類每日報表',
  '/tags/trends': '分類趨勢',
  '/tags/live/videos': '分類直播影片',
  '/keywords': '標籤與關鍵字',
  '/vocabulary': '共同標籤詞彙',
  '/groups': '頻道群組',
  '/mayor': '縣市長選戰聲量',
  '/ai/days': '每日公共議題',
  '/ai/hours': '每小時議題',
  '/ai/periods': '期間議題',
  '/ai/aspects': '議題面向',
  '/live/current': '即時直播',
  '/live/channels': '直播頻道',
  '/live/hours': '直播時段',
  '/live/tags': '直播分類',
  '/live/periods': '直播期間',
  '/live/days': '每日直播',
  '/live/continuous': '連續直播',
  '/live/trends/daily': '每日直播趨勢',
  '/live/walls/news': '直播電視牆（新聞）',
  '/live/walls/china': '直播電視牆（中國）',
  '/live/walls/alternate': '直播電視牆（其他）',
  '/compare/titles': '影片標題用語比較',
  '/events': '事件時間軸',
  '/about': '資料來源與計算方式',
  '/about/brand': '有影儀表板識別',
  '/api': 'API 文件',
  '/observe': '本站流量',
};
const SECTIONS: Record<string, string> = {
  videos: '影片', channels: '頻道', trends: '趨勢', cloud: '文字雲', ai: 'AI 分析', people: '人物', comments: '留言', prompt: '提示詞',
  analytics: '觀測分析', days: '每日', trend: '直播趨勢', wall: '影片牆', history: '跨日脈絡', live: '直播',
};
/** Names a page reads by for display. `names` holds titles the API looked up: `video:<id>`, `channel:<id>`,
 * `category:<id>`, `topic:<id>`. Unknown pages show their path. */
export function pageTitle(path: string, names: ReadonlyMap<string, string> = new Map()): string {
  if (PAGE_TITLES[path]) return PAGE_TITLES[path];
  const segments = path.slice(1).split('/'), [family, id] = segments;
  const section = (from: number) => segments.slice(from).filter(s => !/^\d/.test(s)).map(s => SECTIONS[s] ?? s).join('・');
  const named = (base: string, from: number) => { const rest = section(from); return rest ? `${base}・${rest}` : base; };
  if (family === 'videos' && id) return named(names.get(`video:${id}`) ?? `影片 ${id}`, 2);
  if (family === 'live' && id === 'videos' && segments[2]) return named(names.get(`video:${segments[2]}`) ?? `影片 ${segments[2]}`, 3);
  if (family === 'channels' && id && /^\d+$/.test(id)) return named(names.get(`channel:${id}`) ?? `頻道 #${id}`, 2);
  if (family === 'tags' && id && /^\d+$/.test(id)) return named(names.get(`category:${id}`) ?? `分類 #${id}`, 2);
  if (family === 'ai' && id === 'events' && segments[2]) return named(names.get(`topic:${segments[2]}`) ?? `議題 #${segments[2]}`, 3);
  if (family === 'ai' && id === 'days' && /^\d+$/.test(segments[2] ?? '')) return named(`議題 #${segments[2]}`, 4);
  if (family === 'ai' && id === 'days' && /^\d{4}-\d{2}-\d{2}$/.test(segments[2] ?? '')) return `每日公共議題 ${segments[2]}`;
  if (family === 'events' && id) return '事件';
  return path;
}
