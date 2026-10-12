import { decodeReportSegments, resolveRoute } from "./routes";
import { uuid } from "../../../shared/editorial/contracts";
import { INTERNAL_RENDER_TARGETS, isInternalRenderPath, TRANSPORT_QUERY_PARAMS, type InternalRenderTarget, type PublicRenderRoute } from "../../../shared/public-render-contract";
import type { Search } from "./api";
/** ISR pages that must not prerender during `next build` (the API may be offline there),
 * so they live behind a dynamic segment with an empty generateStaticParams. */
export const ISR_HOME_PATH = INTERNAL_RENDER_TARGETS.home;
export const ISR_EVENTS_PATH = INTERNAL_RENDER_TARGETS.events;
/** Query variants of canonical reports render here, fully dynamic. */
export const FILTERED_REPORT_PREFIX = INTERNAL_RENDER_TARGETS.filtered;
/** `target` selects a next.config beforeFiles rewrite through INTERNAL_RENDER_HEADER. */
export type RenderDecision =
    | { kind: "blocked" }
    | { kind: "render"; target: InternalRenderTarget | null; eligible: PublicRenderRoute | null };
const transport = new Set<string>(TRANSPORT_QUERY_PARAMS);
/** Drop router transport params before a query reaches filters, links or the API. */
export function withoutTransportParams(search: Search): Search {
    return Object.fromEntries(Object.entries(search).filter(([key]) => !transport.has(key)));
}
/** Route a proxied page request. Only query-free GET/HEAD requests to allowlisted public
 * routes are cache-eligible; every real query keeps its original dynamic semantics.
 * `_rsc` alone selects the same route tree as the canonical URL but is never eligible. */
export function publicRenderDecision(url: URL, method = "GET"): RenderDecision {
    const { pathname } = url;
    if (isInternalRenderPath(pathname)) return { kind: "blocked" };
    const keys = [...url.searchParams.keys()];
    const filtered = keys.some((key) => !transport.has(key));
    const shareable = keys.length === 0 && (method === "GET" || method === "HEAD");
    const render = (target: InternalRenderTarget | null, route: PublicRenderRoute | null) =>
        ({ kind: "render", target, eligible: shareable ? route : null }) as const;
    // Home has no query semantics; the ISR render ignores any query string.
    if (pathname === "/") return render("home", "home");
    // `/events?…` with a real query stays on the original dynamic page.
    if (pathname === "/events") return filtered ? render(null, null) : render("events", "events");
    // Event detail reads only its id; a query never changes it, so the same ISR page serves
    // it, but only the bare canonical URL is eligible.
    const event = pathname.match(/^\/events\/([^/]+)$/);
    if (event) return render(null, uuid(event[1]) ? "event" : null);
    const segments = decodeReportSegments(pathname.slice(1).split("/"));
    if (segments && resolveRoute(segments))
        return filtered ? render("filtered", null) : render(null, "report");
    return render(null, null);
}
