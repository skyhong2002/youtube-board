/** Pure GA4 eligibility and event shaping for SiteAnalytics. Nothing here touches the DOM,
 * so every rule that decides whether gtag may load, and what an event may carry, is
 * testable without a browser. */
import { decodeReportSegments, resolveRoute } from './routes';
import { SITE_NAME, SITE_ORIGIN } from './site';

/** The site's public GA4 property. Not used unless NEXT_PUBLIC_GA_ID names it at build. */
export const PUBLIC_GA_ID = 'G-X2G1PLNP7K';
export const ANALYTICS_HOSTNAME = 'youtube.observe.tw';
export const OPT_OUT_PATH = '/observe/opt-out';
export const OPT_OUT_STORAGE_KEY = 'observe-analytics-opt-out';
/** Fired on window by the opt-out page so an already-running tracker stops mid-visit. */
export const OPT_OUT_EVENT = 'observe-analytics-opt-out';
/** Every hit carries this fixed page_title, never document.title (video and channel titles). */
export const ANALYTICS_PAGE_TITLE = SITE_NAME;

/** Off unless explicitly configured; enable only after captured /g/collect requests from a
 * real gtag.js have been validated. An empty or malformed value also disables GA. */
export function resolveMeasurementId(value: string | undefined): string | null {
  const id = value?.trim() ?? '';
  return /^G-[A-Z0-9]{4,20}$/.test(id) ? id : null;
}

/** Pending: a GA `login` event needs a one-time success receipt issued by the server's auth
 * callback and consumed once. A URL fragment or query is spoofable, and /auth/me only shows
 * a session exists, not that a login just happened, so neither counts. Until the callback
 * issues such a receipt nothing sends `login`. */
export interface LoginSuccessReceipt { method: 'google' }

export type BlockReason = 'unconfigured' | 'environment' | 'hostname' | 'automation' | 'do-not-track' | 'global-privacy-control' | 'opted-out';
export type AnalyticsEnvironment = {
  measurementId: string | null;
  nodeEnv: string | undefined;
  hostname: string;
  webdriver: boolean | undefined;
  userAgent: string;
  /** navigator.doNotTrack, window.doNotTrack and the legacy msDoNotTrack, as reported. */
  doNotTrack: Array<string | null | undefined>;
  globalPrivacyControl: boolean | undefined;
  optedOut: boolean;
};
// `bot/` and a whole-word `bot` catch Googlebot/bingbot without matching device names like Cubot.
const AUTOMATION = /Headless|PhantomJS|Puppeteer|Playwright|Selenium|WebDriver|Cypress|Lighthouse|PageSpeed|Google-InspectionTool|bot\/|\bbot\b|crawl|spider|slurp|facebookexternalhit/i;
export const isAutomationAgent = (userAgent: string) => !userAgent || AUTOMATION.test(userAgent);
/** Every reason blocks the whole gtag load, not just individual events. */
export function analyticsBlockReason(env: AnalyticsEnvironment): BlockReason | null {
  if (!env.measurementId) return 'unconfigured';
  if (env.nodeEnv !== 'production') return 'environment';
  if (env.hostname !== ANALYTICS_HOSTNAME) return 'hostname';
  if (env.webdriver === true || isAutomationAgent(env.userAgent)) return 'automation';
  if (env.doNotTrack.some(value => value === '1' || value === 'yes')) return 'do-not-track';
  if (env.globalPrivacyControl === true) return 'global-privacy-control';
  if (env.optedOut) return 'opted-out';
  return null;
}

type OptOutStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
/** Unreadable storage counts as opted out: without it a stored choice cannot be honoured. */
export function readOptOut(storage: OptOutStorage | null | undefined): boolean {
  try { return !storage || storage.getItem(OPT_OUT_STORAGE_KEY) === '1'; } catch { return true; }
}
export function writeOptOut(storage: OptOutStorage | null | undefined, optedOut: boolean): boolean {
  try {
    if (!storage) return false;
    if (optedOut) storage.setItem(OPT_OUT_STORAGE_KEY, '1'); else storage.removeItem(OPT_OUT_STORAGE_KEY);
    return true;
  } catch { return false; }
}

export const PAGE_TYPES = ['home', 'videos', 'video', 'channels', 'channel', 'keywords', 'tags', 'tag', 'events', 'event', 'ai', 'live', 'groups', 'mayor', 'compare', 'about', 'api'] as const;
export type PageType = (typeof PAGE_TYPES)[number];
/** A measurable page: a fixed type and its location, which is exactly the browser URL. */
export type AnalyticsPage = { type: PageType; location: string };
// Account, admin, auth, private token, personal board and opt-out pages are never measured.
const PRIVATE_PATH = /^\/(?:my|manage|ops|login|auth|boards|runtime|redir|observe|search)(?:\/|$)|^\/feeds\/u(?:\/|$)|^\/api\//;
const STATIC_PAGES: Record<string, PageType> = { '/': 'home', '/events': 'events', '/compare/titles': 'compare', '/about': 'about', '/about/brand': 'about', '/api': 'api' };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
// Structural words, numeric IDs and dates. resolveRoute admits only fixed words outside the
// free-text and video-ID positions below, so nothing a reader or source wrote passes here.
const SAFE_SEGMENT = /^(?:[a-z][a-z-]*|\d{1,16}|\d{4}-\d{2}-\d{2})$/;
/** Whether a report route carries reader-chosen or name text (keyword terms, group, city
 * and person names, AI day conditions). Such pages are not measured at all: gtag's
 * history page_views report the raw browser URL and ignore a `set` page_location, so
 * redacting the segment would not keep it out of GA. */
function hasFreeText(segments: string[]): boolean {
  const [family, id] = segments;
  if ((family === 'keywords' || family === 'vocabulary' || family === 'groups') && segments.length > 1) return true;
  if (family === 'mayor' && id === 'cities') return true;
  if (family === 'live' && id === 'groups') return true;
  return family === 'ai' && id === 'days' && /^\d{4}-\d{2}-\d{2}$/.test(segments[2] ?? '') && segments.length > 3;
}
const videoIdIndex = ([family, id]: string[]) => family === 'videos' ? 1 : family === 'live' && id === 'videos' ? 2 : -1;
function reportPageType(segments: string[]): PageType {
  const [family, id] = segments;
  if (family === 'videos') return id ? 'video' : 'videos';
  if (family === 'channels') return id ? 'channel' : 'channels';
  if (family === 'vocabulary') return 'keywords';
  if (family === 'tags') return id && /^\d+$/.test(id) ? 'tag' : 'tags';
  return family as PageType;
}
/** The measured form of a browser URL, or null when it must not be measured at all: any
 * query or fragment, private/auth/search pages, unknown paths, comment-author pages, prompt
 * previews and every route with a free-text segment. The location is origin + path and is
 * exactly the raw browser URL, so it is what gtag reports whether or not it honours `set`. */
export function analyticsPage(url: Pick<URL, 'pathname' | 'search' | 'hash'>): AnalyticsPage | null {
  const { pathname } = url;
  if (url.search || url.hash || PRIVATE_PATH.test(pathname)) return null;
  const known = STATIC_PAGES[pathname];
  if (known) return { type: known, location: SITE_ORIGIN + pathname };
  const event = pathname.match(/^\/events\/([^/]+)$/);
  if (event) return UUID.test(event[1]!) ? { type: 'event', location: SITE_ORIGIN + pathname } : null;
  const segments = decodeReportSegments(pathname.slice(1).split('/'));
  const route = segments && resolveRoute(segments);
  if (!segments || !route || route.kind === 'prompt-preview' || segments[0] === 'comments' || hasFreeText(segments)) return null;
  const videoAt = videoIdIndex(segments);
  if (!segments.every((segment, index) => index === videoAt ? VIDEO_ID.test(segment) : SAFE_SEGMENT.test(segment))) return null;
  // Percent-encoded ASCII would make the raw URL differ from the measured one.
  if ('/' + segments.join('/') !== pathname) return null;
  const type = reportPageType(segments);
  return PAGE_TYPES.includes(type) ? { type, location: SITE_ORIGIN + pathname } : null;
}
export const analyticsPageType = (pathname: string, search = '') => analyticsPage({ pathname, search, hash: '' })?.type ?? null;
/** page_referrer for the first hit: a same-site page's measured location, otherwise only
 * the referring origin, so no external path, query or fragment is forwarded. */
export function analyticsReferrer(referrer: string): string {
  let url: URL;
  try { url = new URL(referrer); } catch { return ''; }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return '';
  if (url.origin === SITE_ORIGIN) return analyticsPage(url)?.location ?? SITE_ORIGIN + '/';
  return url.origin + '/';
}
/** Whether a document may start GA given its referrer. A same-site referrer that is not
 * itself a measured page (private, query, fragment, free text) blocks the document: the
 * sanitized `set` page_referrer is not proven to replace gtag's own document.referrer. */
export function analyticsReferrerAllowsStart(referrer: string): boolean {
  let url: URL;
  try { url = new URL(referrer); } catch { return true; }
  return url.origin !== SITE_ORIGIN || analyticsPage(url) !== null;
}

export type AnalyticsEvent =
  | { name: 'open_original'; params: { link_domain: string; source_page_type: PageType } }
  | { name: 'select_content'; params: { content_type: 'keyword' | 'channel' | 'video' | 'event' | 'tag'; content_id?: string; source_page_type: PageType } }
  | { name: 'rss_click'; params: { source_page_type: PageType } };
const YOUTUBE_HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be']);
/** Map a followed link to at most one custom event. Only the link domain, a fixed content
 * type and a numeric channel ID or YouTube video ID ever leave the page: no titles, terms,
 * queries or full URLs. Keyword, tag and event selections carry no content_id. */
export function analyticsLinkEvent(href: string, base: string, sourcePageType: PageType): AnalyticsEvent | null {
  let url: URL;
  try { url = new URL(href, base); } catch { return null; }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  if (url.origin !== new URL(base).origin) return YOUTUBE_HOSTS.has(url.hostname) && url.protocol === 'https:'
    ? { name: 'open_original', params: { link_domain: url.hostname, source_page_type: sourcePageType } } : null;
  const path = url.pathname;
  if (path === '/feeds/videos.xml') return { name: 'rss_click', params: { source_page_type: sourcePageType } };
  const select = (content_type: 'keyword' | 'channel' | 'video' | 'event' | 'tag', content_id?: string): AnalyticsEvent =>
    ({ name: 'select_content', params: { content_type, ...(content_id ? { content_id } : {}), source_page_type: sourcePageType } });
  const channel = path.match(/^\/channels\/([1-9]\d{0,15})(?:\/|$)/);
  if (channel) return select('channel', channel[1]);
  const video = path.match(/^\/videos\/([A-Za-z0-9_-]{11})(?:\/analytics)?$/);
  if (video) return select('video', video[1]);
  const event = path.match(/^\/events\/([^/]+)$/);
  if (event && UUID.test(event[1]!)) return select('event');
  if (/^\/ai\/(?:events\/\d+|days\/\d+\/events)(?:\/|$)/.test(path)) return select('event');
  if (/^\/keywords\/[^/]+\/[a-z]/.test(path)) return select('keyword');
  if (/^\/tags\/\d+\/[a-z]/.test(path)) return select('tag');
  return null;
}
