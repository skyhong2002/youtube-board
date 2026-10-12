/** Contract between the Next frontend and the public gateway for cacheable HTML.
 * Pure data: imported by the web root layout, the Next proxy and the gateway. */

/** Exact inline theme bootstrap emitted in <head>. The gateway approves these bytes by
 * hash; any edit here must ship together with the gateway's allowlist. */
export const THEME_SCRIPT = `(function(){try{var m=matchMedia('(prefers-color-scheme: dark)');function a(){var s=localStorage.getItem('theme');document.documentElement.dataset.theme=s==='dark'||s==='light'?s:m.matches?'dark':'light'}a();m.addEventListener('change',a)}catch(e){}})()`;

/** Set by the Next proxy only for allowlisted, query-free GET/HEAD public routes.
 * Any incoming copy is deleted; the gateway must still check status, Set-Cookie,
 * RSC/prefetch requests and private markers before storing a response. */
export const PUBLIC_RENDER_HEADER = 'x-youtube-board-public-render';
export const PUBLIC_RENDER_ROUTES = ['home', 'events', 'event', 'report', 'api'] as const;
export type PublicRenderRoute = (typeof PUBLIC_RENDER_ROUTES)[number];
/** Next ISR period per eligible route; the gateway owns the final shared TTL. */
export const PUBLIC_RENDER_REVALIDATE_SECONDS: Record<PublicRenderRoute, number> = { home: 60, events: 60, event: 60, report: 60, api: 3600 };
/** Next client-router cache-buster. It never selects content: it must not change the
 * route tree or reach the API, and a request carrying it is never shared-cached. */
export const TRANSPORT_QUERY_PARAMS = ['_rsc'] as const;

/** Request header the Next proxy sets (after deleting any client copy) to pick an internal
 * render target; next.config `beforeFiles` rewrites match on it. The proxy cannot rewrite
 * itself: Next 16.3.8 NextURL turns a 127.x host into `localhost`, so with a 127.0.0.1
 * listener an absolute proxy rewrite no longer matches the router origin and is replayed
 * as an external HTTP request that re-enters the proxy. The gateway strips this header. */
export const INTERNAL_RENDER_HEADER = 'x-youtube-board-render';
export const INTERNAL_RENDER_TARGETS = {
  home: '/render-isr/home/current',
  events: '/render-isr/events/current',
  filtered: '/render-filtered/report',
} as const;
export type InternalRenderTarget = keyof typeof INTERNAL_RENDER_TARGETS;
/** First path segment of every resolveRoute report (web/src/lib/routes.ts). */
export const REPORT_FAMILIES = ['channels', 'videos', 'tags', 'keywords', 'vocabulary', 'live', 'ai', 'groups', 'mayor', 'comments'] as const;
/** next.config `beforeFiles` rewrites. Relative destinations stay inside one router pass
 * (no proxy re-entry); sources only cover paths the proxy matcher always handles, so a
 * client-sent header is deleted before these run. Path params are copied raw, keeping
 * percent-encoded report terms byte-identical; the original query is carried over. */
export function internalRenderRewrites() {
  const when = (target: InternalRenderTarget) => [{ type: 'header' as const, key: INTERNAL_RENDER_HEADER, value: target }];
  return [
    { source: '/', has: when('home'), destination: INTERNAL_RENDER_TARGETS.home },
    { source: '/events', has: when('events'), destination: INTERNAL_RENDER_TARGETS.events },
    { source: `/:family(${REPORT_FAMILIES.join('|')})/:rest*`, has: when('filtered'), destination: `${INTERNAL_RENDER_TARGETS.filtered}/:family/:rest*` },
  ];
}
/** Internal rewrite targets. Never reachable directly: the proxy answers 404 and the
 * gateway must block them as well. */
export const INTERNAL_RENDER_PREFIXES = ['/render-isr', '/render-filtered'] as const;
export function isInternalRenderPath(pathname: string): boolean {
  let first = pathname.split('/')[1] ?? '';
  try { first = decodeURIComponent(first); } catch { /* keep the raw segment */ }
  first = '/' + first.toLowerCase();
  return INTERNAL_RENDER_PREFIXES.some((prefix) => first === prefix);
}
