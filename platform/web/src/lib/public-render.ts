import { decodeReportSegments, resolveRoute } from "./routes";
import { uuid } from "../../../shared/editorial/contracts";
import { isInternalRenderPath, TRANSPORT_QUERY_PARAMS, type PublicRenderRoute } from "../../../shared/public-render-contract";
import type { Search } from "./api";
/** ISR pages that must not prerender during `next build` (the API may be offline there),
 * so they live behind a dynamic segment with an empty generateStaticParams. */
export const ISR_HOME_PATH = "/render-isr/home/current";
export const ISR_EVENTS_PATH = "/render-isr/events/current";
/** Query variants of canonical reports render here, fully dynamic. */
export const FILTERED_REPORT_PREFIX = "/render-filtered/report";
export type RenderDecision =
    | { kind: "blocked" }
    | { kind: "render"; rewrite: string | null; eligible: PublicRenderRoute | null };
const transport = new Set<string>(TRANSPORT_QUERY_PARAMS);
/** Drop router transport params before a query reaches filters, links or the API. */
export function withoutTransportParams(search: Search): Search {
    return Object.fromEntries(Object.entries(search).filter(([key]) => !transport.has(key)));
}
/** Route a proxied page request. Only query-free GET/HEAD requests to allowlisted public
 * routes are cache-eligible; every real query keeps its original dynamic semantics.
 * `_rsc` alone selects the same route tree as the canonical URL (and is forwarded on
 * rewrites so Next can validate it) but is never eligible for the shared cache. */
export function publicRenderDecision(url: URL, method = "GET"): RenderDecision {
    const { pathname, search } = url;
    if (isInternalRenderPath(pathname)) return { kind: "blocked" };
    const keys = [...url.searchParams.keys()];
    const filtered = keys.some((key) => !transport.has(key));
    const shareable = keys.length === 0 && (method === "GET" || method === "HEAD");
    const render = (rewrite: string | null, route: PublicRenderRoute | null) =>
        ({ kind: "render", rewrite, eligible: shareable ? route : null }) as const;
    // Home has no query semantics; the ISR render ignores any query string.
    if (pathname === "/") return render(ISR_HOME_PATH + search, "home");
    // `/events?…` with a real query stays on the original dynamic page.
    if (pathname === "/events") return filtered ? render(null, null) : render(ISR_EVENTS_PATH + search, "events");
    // Event detail reads only its id; a query never changes it, so the same ISR page serves
    // it, but only the bare canonical URL is eligible.
    const event = pathname.match(/^\/events\/([^/]+)$/);
    if (event) return render(null, uuid(event[1]) ? "event" : null);
    const segments = decodeReportSegments(pathname.slice(1).split("/"));
    if (segments && resolveRoute(segments))
        return filtered ? render(FILTERED_REPORT_PREFIX + pathname + search, null) : render(null, "report");
    return render(null, null);
}
