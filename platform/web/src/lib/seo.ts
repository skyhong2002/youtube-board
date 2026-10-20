import type { Metadata } from 'next';
import type { VideoRow } from '../../../api/src/contracts';
import type { ReportRoute } from './routes';
import { SITE_DESCRIPTION, SITE_NAME, SITE_ORIGIN, siteMetadata } from './site';

// Shared route metadata and JSON-LD. Pure: data-backed names arrive as arguments (see
// seo-data.ts), so canonical/title/robots rules stay testable without the API.

const OG_IMAGE = { url: '/brand/og-light.png', width: 1200, height: 630, alt: SITE_NAME };
/** Absolute canonical URL; the origin carries no trailing slash, paths start with `/`. */
export const absoluteUrl = (path: string) => SITE_ORIGIN + (path === '/' ? '' : path);
const clip = (value: string, max: number) => { const text = value.replace(/\s+/g, ' ').trim(); return text.length > max ? text.slice(0, max - 1) + '…' : text; };

/** Indexable page: canonical URL plus page-specific Open Graph / Twitter cards. Nested
 * metadata objects replace the root ones, so the shared image and RSS link are repeated. */
export function pageMetadata({ title, description, path, absoluteTitle = false }: { title: string; description: string; path: string; absoluteTitle?: boolean }): Metadata {
  const url = absoluteUrl(path), full = absoluteTitle ? title : `${title} - ${SITE_NAME}`;
  return {
    title: absoluteTitle ? { absolute: title } : title,
    description,
    alternates: { canonical: url, types: siteMetadata.alternates?.types },
    openGraph: { type: 'website', siteName: SITE_NAME, locale: 'zh_TW', title: full, description, url, images: [OG_IMAGE] },
    twitter: { card: 'summary_large_image', title: full, description, images: [OG_IMAGE.url] },
  };
}
/** Account, admin, auth, token and opt-out pages. */
export const privateMetadata = (title: string): Metadata => ({ title, robots: { index: false, follow: false } });
/** Query variants (filters, search results, pagination) and other unindexed public pages:
 * not indexed, links still followed, canonical to the query-free `path`. */
export const filteredMetadata = (title: string, path: string, description?: string): Metadata =>
  ({ title, ...(description ? { description } : {}), robots: { index: false, follow: true }, alternates: { canonical: absoluteUrl(path) } });

export const HOME_TITLE = `${SITE_NAME}｜YouTube 頻道、影片與直播觀測`;
export const homeMetadata = () => pageMetadata({ title: HOME_TITLE, description: SITE_DESCRIPTION, path: '/', absoluteTitle: true });
const EVENTS_TITLE = '事件時間軸';
export const eventsMetadata = () => pageMetadata({ title: EVENTS_TITLE, description: '由編輯審核的公共事件時間軸：跨 YouTube 影片與新聞來源比較標題、發布時間與引用依據。', path: '/events' });
export const filteredEventsMetadata = () => filteredMetadata(EVENTS_TITLE, '/events');
export const apiDocsMetadata = () => pageMetadata({ title: 'API 文件', description: '有影儀表板公開唯讀 API：使用規則、程式範例、錯誤、分頁、回應欄位與舊版 PHP 對照。', path: '/api' });
/** Live availability: not worth indexing, but still its own canonical page. */
export const apiStatusMetadata = () => filteredMetadata('API 狀態', '/api/status', '有影儀表板公開 API 的可用性與各端點用途。');

/** Data-backed names for detail reports. Only titles the page itself already reads. */
export type ReportSubject =
  | { kind: 'channel'; title: string }
  | { kind: 'video'; video: VideoRow; durationSeconds: number | null }
  | null;
export type Crumb = { name: string; path: string };

const FAMILY_ROOTS: Record<string, Crumb> = {
  videos: { name: '影片觀測', path: '/videos' },
  channels: { name: '頻道觀測', path: '/channels' },
  keywords: { name: '熱門標籤排行', path: '/keywords' },
  vocabulary: { name: '詞彙觀測', path: '/vocabulary' },
  tags: { name: '頻道分類', path: '/tags' },
  live: { name: '即時直播觀測', path: '/live/current' },
  ai: { name: '每日公共議題', path: '/ai/days' },
  groups: { name: '頻道群組', path: '/groups' },
  mayor: { name: '地方人物觀測', path: '/mayor' },
};
// Section labels mirror the report tabs in report-navigation.ts.
const CHANNEL_SECTIONS: Record<string, string> = { videos: '影片', comments: '留言', cloud: '關鍵詞', trends: '趨勢', people: '人物', ai: 'AI 議題', 'ai/days': '每日分析', prompt: '提示詞預覽' };
const TAG_SECTIONS: Record<string, string> = { channels: '頻道', videos: '影片', comments: '留言', cloud: '關鍵詞', days: '逐日', trends: '趨勢', compare: '詞彙比較', 'live/videos': '直播影片' };
const KEYWORD_SECTIONS: Record<string, string> = { videos: '影片', cloud: '關鍵詞', days: '逐日', 'groups/trends': '群組趨勢', 'live/trends': '直播趨勢' };
const LIVE_SECTIONS: Record<string, string> = { current: '即時直播', days: '每日直播', periods: '期間', hours: '逐時', channels: '頻道', tags: '分類', continuous: '連續直播', 'trends/daily': '每日趨勢', 'walls/news': '新聞直播電視牆', 'walls/china': '中國直播電視牆', 'walls/alternate': '其他直播電視牆' };
const AI_SECTIONS: Record<string, string> = { days: '每日公共議題', hours: '每小時議題', periods: '跨日議題', aspects: '觀點比較', 'days/prompt': '提示詞預覽', people: '人物觀點', wall: '來源影片牆', history: '跨日來源脈絡' };
const GROUP_SECTIONS: Record<string, string> = { ranking: '排行', trends: '趨勢', live: '直播' };
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export const reportPath = (segments: string[]) => '/' + segments.map(encodeURIComponent).join('/');
/** One indexable URL per report. /keywords (ranking) and /vocabulary (original pool) are distinct pages. */
export const reportCanonicalPath = (segments: string[]) => reportPath(segments);
/** Account-free but not worth indexing: prompt previews and per-person comment pages. */
export const reportIndexable = (route: ReportRoute, segments: string[]) => route.kind !== 'prompt-preview' && segments[0] !== 'comments';

/** Descriptive, path-unique title from already-decoded segments and an optional subject. */
export function reportTitle(route: ReportRoute, segments: string[], subject: ReportSubject = null): string {
  const [family, id = '', ...rest] = segments, tail = rest.join('/');
  if (family === 'channels' && /^\d+$/.test(id)) {
    const name = subject?.kind === 'channel' ? clip(subject.title, 60) : `頻道 #${id}`;
    if (!tail) return `${name}｜頻道觀測`;
    const date = DATE.test(rest.at(-1) ?? '') ? rest.at(-1) : undefined;
    const label = CHANNEL_SECTIONS[date ? rest.slice(0, -1).join('/') : tail] ?? route.title;
    return `${name}｜${label}${date ? ` ${date}` : ''}`;
  }
  if (family === 'videos' && id) {
    const name = subject?.kind === 'video' && subject.video.title ? clip(subject.video.title, 60) : `影片 ${id}`;
    return `${name}｜${tail === 'analytics' ? '影片觀測分析' : '影片觀測'}`;
  }
  if (family === 'keywords' && id) return `「${clip(id, 40)}」${KEYWORD_SECTIONS[tail] ?? '關鍵字報表'}`;
  if (family === 'tags' && id) {
    if (/^\d+$/.test(id)) return `分類 #${id}｜${TAG_SECTIONS[tail] ?? route.title}`;
    const section = TAG_SECTIONS[[id, ...rest].join('/')];
    if (section) return `頻道分類｜${section}`;
  }
  if (family === 'live' && id) {
    if (id === 'days' && DATE.test(tail)) return `每日直播 ${tail}｜直播觀測`;
    if (id === 'groups') return `${clip(rest[0] ?? '', 40)} 群組｜直播逐時`;
    if (id === 'videos') return `影片 ${rest[0] ?? ''}｜直播趨勢`;
    return `${LIVE_SECTIONS[[id, ...rest].join('/')] ?? route.title}｜直播觀測`;
  }
  if (family === 'ai' && id) {
    if (id === 'days' && DATE.test(rest[0] ?? '')) {
      const condition = rest[1] && rest[1] !== 'prompt' ? `｜${clip(rest[1], 40)}` : '';
      return `每日公共議題 ${rest[0]}${condition}${rest.at(-1) === 'prompt' ? '｜提示詞預覽' : ''}`;
    }
    if (id === 'days' && /^\d+$/.test(rest[0] ?? '')) return `每日彙整 #${rest[0]}｜${rest[2] === 'history' ? '跨日來源脈絡' : '議題來源與分析'}`;
    if (id === 'events' && /^\d+$/.test(rest[0] ?? '')) return `AI 議題 #${rest[0]}｜${AI_SECTIONS[rest[1] ?? ''] ?? '議題來源與分析'}`;
    return `${AI_SECTIONS[[id, ...rest].join('/')] ?? route.title}｜AI 議題`;
  }
  if (family === 'groups' && id) return `${clip(id, 40)}｜${GROUP_SECTIONS[tail] ?? '頻道群組'}`;
  if (family === 'mayor' && id === 'cities' && rest[0]) {
    const [city, , person, , date] = rest;
    return person ? `${clip(person, 30)}（${clip(city!, 20)}）${date ? ` ${date}` : ''}｜地方人物觀測` : `${clip(city!, 20)}｜地方人物觀測`;
  }
  return route.title;
}
export function reportDescription(route: ReportRoute, title: string, subject: ReportSubject = null): string {
  if (subject?.kind === 'channel') return clip(`${subject.title} 的 YouTube 頻道觀測：收錄影片、公開統計與歷次觀測。`, 160);
  if (subject?.kind === 'video' && subject.video.title) return clip(`${subject.video.channelTitle ? subject.video.channelTitle + '「' : '「'}${subject.video.title}」的觀看數、互動數與歷次公開觀測。`, 160);
  return clip(`${title}。${route.description || SITE_DESCRIPTION}`, 160);
}
/** A video the site never observed (no view count) renders only placeholders; keep it out of search indexes. */
export const unobservedVideo = (subject: ReportSubject) => subject?.kind === 'video' && subject.video.views === null;
export function reportMetadata(route: ReportRoute, segments: string[], subject: ReportSubject = null): Metadata {
  const title = reportTitle(route, segments, subject), path = reportCanonicalPath(segments);
  return reportIndexable(route, segments) && !unobservedVideo(subject)
    ? pageMetadata({ title, description: reportDescription(route, title, subject), path })
    : filteredMetadata(title, path);
}
/** Query variant of a report: never indexed, canonical to the query-free report. */
export const filteredReportMetadata = (route: ReportRoute, segments: string[]) => filteredMetadata(reportTitle(route, segments), reportCanonicalPath(segments));
/** Home → family root → parent detail (channel / video / keyword) → this page. */
export function reportBreadcrumbs(route: ReportRoute, segments: string[], subject: ReportSubject = null): Crumb[] {
  const [family = '', id = '', section] = segments, path = reportCanonicalPath(segments);
  const crumbs: Crumb[] = [{ name: SITE_NAME, path: '/' }];
  const root = FAMILY_ROOTS[family];
  if (root) crumbs.push(root);
  if (family === 'channels' && /^\d+$/.test(id) && section) crumbs.push({ name: reportTitle(route, [family, id], subject), path: reportPath([family, id]) });
  if (family === 'videos' && id && section) crumbs.push({ name: reportTitle(route, [family, id], subject), path: reportPath([family, id]) });
  if (family === 'keywords' && id && section !== 'videos') crumbs.push({ name: `「${clip(id, 40)}」影片`, path: reportPath([family, id, 'videos']) });
  crumbs.push({ name: reportTitle(route, segments, subject), path });
  return crumbs.filter((crumb, index) => crumbs.findIndex(other => other.path === crumb.path) === index);
}

export type EventSummary = { canonicalId: string; title: string; sourceCount: number };
export function eventMetadata(event: EventSummary): Metadata {
  const title = `${clip(event.title, 60)}｜事件來源與時間軸`;
  return pageMetadata({ title, description: clip(`「${event.title}」的跨來源標題比較、來源時間軸與編輯異動紀錄，目前關聯 ${event.sourceCount} 個來源。`, 160), path: `/events/${event.canonicalId}` });
}
export const eventBreadcrumbs = (event: EventSummary): Crumb[] => [
  { name: SITE_NAME, path: '/' }, { name: '事件時間軸', path: '/events' }, { name: clip(event.title, 60), path: `/events/${event.canonicalId}` },
];

// JSON-LD. Values are plain data; serializeJsonLd makes them safe inside a script element.
const ORGANIZATION_ID = `${SITE_ORIGIN}/#organization`;
/** WebSite + Organization for the homepage. The SearchAction targets the real header
 * search, which submits `q` to /videos. */
export function homeJsonLd() {
  return {
    '@context': 'https://schema.org',
    '@graph': [
      { '@type': 'WebSite', '@id': `${SITE_ORIGIN}/#website`, url: absoluteUrl('/'), name: SITE_NAME, description: SITE_DESCRIPTION, inLanguage: 'zh-Hant-TW', publisher: { '@id': ORGANIZATION_ID },
        potentialAction: { '@type': 'SearchAction', target: { '@type': 'EntryPoint', urlTemplate: `${SITE_ORIGIN}/videos?q={search_term_string}` }, 'query-input': 'required name=search_term_string' } },
      { '@type': 'Organization', '@id': ORGANIZATION_ID, name: SITE_NAME, url: absoluteUrl('/'), logo: absoluteUrl('/brand/apple-180-light.png') },
    ],
  };
}
export function breadcrumbJsonLd(crumbs: Crumb[]) {
  return {
    '@context': 'https://schema.org', '@type': 'BreadcrumbList',
    itemListElement: crumbs.map((crumb, index) => ({ '@type': 'ListItem', position: index + 1, name: crumb.name, item: absoluteUrl(crumb.path) })),
  };
}
const THUMBNAIL_HOSTS = new Set(['i.ytimg.com', 'i1.ytimg.com', 'i2.ytimg.com', 'i3.ytimg.com', 'i4.ytimg.com', 'i9.ytimg.com', 'img.youtube.com']);
const WATCH_HOSTS = new Set(['youtube.com', 'www.youtube.com', 'youtu.be']);
const httpsUrl = (value: string | null | undefined, hosts: Set<string>) => {
  if (!value) return null;
  try { const url = new URL(value); return url.protocol === 'https:' && hosts.has(url.hostname) ? url.href : null; } catch { return null; }
};
/** ISO 8601 duration, only from a recorded positive length. */
export const isoDuration = (seconds: number | null) => seconds !== null && Number.isSafeInteger(seconds) && seconds > 0
  ? `PT${Math.floor(seconds / 3600) ? `${Math.floor(seconds / 3600)}H` : ''}${Math.floor(seconds / 60) % 60 ? `${Math.floor(seconds / 60) % 60}M` : ''}${seconds % 60 ? `${seconds % 60}S` : ''}` : null;
/** VideoObject only when the source provides every required field: title, description,
 * a YouTube-hosted thumbnail and a real publish time. Nothing is synthesised. */
export function videoJsonLd(video: VideoRow, durationSeconds: number | null) {
  const name = video.title?.trim(), description = video.description?.trim(), thumbnailUrl = httpsUrl(video.thumbnail, THUMBNAIL_HOSTS);
  const published = video.publishedAt ? new Date(video.publishedAt) : null;
  if (!name || !description || !thumbnailUrl || !published || !Number.isFinite(published.getTime())) return null;
  const duration = isoDuration(durationSeconds), url = httpsUrl(video.youtubeUrl, WATCH_HOSTS);
  return {
    '@context': 'https://schema.org', '@type': 'VideoObject', name, description: clip(description, 500), thumbnailUrl: [thumbnailUrl],
    uploadDate: published.toISOString(), ...(duration ? { duration } : {}), ...(url ? { url } : {}),
  };
}
/** JSON for a `<script type="application/ld+json">` body: `<`, `>`, `&` and the JS line
 * separators are escaped so no source value can close the element or open markup. */
export const serializeJsonLd = (value: unknown) => JSON.stringify(value)
  .replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026')
  .replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
