import type { ApiResponse } from "../../../api/src/contracts";
import type { Result, Search } from "./api";
import { queryString } from "./query-string";
import { TRANSPORT_QUERY_PARAMS } from "../../../shared/public-render-contract";
/** Next data-cache periods for public API reads made by ISR pages (seconds). Home and
 * other current snapshots use `current`; date-pinned and history reports use `history`. */
export const PUBLIC_DATA_REVALIDATE = { live: 30, current: 60, history: 300 } as const;
export type PublicDataClass = keyof typeof PUBLIC_DATA_REVALIDATE;
const day = /^\d{4}-\d{2}-\d{2}$/;
export function publicDataClass(path: string, search: Search = {}): PublicDataClass {
    if (/^(?:live\/current|live\/walls\/[^/]+|ai\/events\/\d+\/wall)$/.test(path)) return "live";
    const date = search.date;
    if (/(?:^|\/)history$/.test(path) || path.split("/").some((segment) => day.test(segment)) || (typeof date === "string" && day.test(date)))
        return "history";
    return "current";
}
export class PublicDataError extends Error {
    constructor(readonly status: number, readonly code: string) {
        super(`Public API read failed: ${status} ${code}`);
        this.name = "PublicDataError";
    }
}
/** Families registered under the read-only /api/v1 surface. Credentialed /auth and
 * /api/ops routes live outside the base and are never reachable from here. */
const PUBLIC_FAMILIES = new Set(["home", "channels", "videos", "live", "tags", "ai", "vocabulary", "keywords", "groups", "mayor", "comments", "filter-options", "editorial"]);
const encodedSegment = /^[A-Za-z0-9\-_.!~*'()%]+$/;
/** Build a public read URL, rejecting anything that could leave the public API base. */
export function publicApiUrl(base: string, path: string, search: Search = {}): string {
    const segments = path.replace(/^\//, "").split("/");
    const safe = segments.every((segment) => {
        if (!encodedSegment.test(segment)) return false;
        try { const decoded = decodeURIComponent(segment); return decoded !== "." && decoded !== ".."; }
        catch { return false; }
    });
    if (!safe || !PUBLIC_FAMILIES.has(segments[0])) throw new PublicDataError(404, "NOT_PUBLIC");
    // Router transport params (`_rsc`) never reach the API or its cache keys.
    const query = Object.fromEntries(Object.entries(search).filter(([key]) => !(TRANSPORT_QUERY_PARAMS as readonly string[]).includes(key)));
    return `${base.replace(/\/$/, "")}/${segments.join("/")}${queryString(query)}`;
}
/** Optional sections (secondary reads beside a page's primary data) keep their partial
 * notice in ISR only for outcomes that repeat on retry: missing/invalid resource and an
 * envelope that fails validation. Network errors, timeouts, 408/429 and 5xx are transient
 * and throw, so a blip never becomes a cached partial page. */
export function deterministicPartial(status: number, code: string): boolean {
    return [400, 404, 410, 422].includes(status) || code === "INVALID_RESPONSE" || code === "NOT_PUBLIC";
}
const errorCode = /^[A-Z][A-Z0-9_]{0,63}$/;
/** Error code from either the public v1 envelope `{error: string, code?: string}` or the
 * older structured `{error: {code}}`. Anything else (prose, raw detail) is not trusted. */
function publicErrorCode(body: unknown): string {
    const value = body as { error?: unknown; code?: unknown } | null;
    const code = typeof value?.error === "string" ? value.code
        : typeof value?.error === "object" && value.error !== null ? (value.error as { code?: unknown }).code
        : undefined;
    return typeof code === "string" && errorCode.test(code) ? code : "API_UNAVAILABLE";
}
export async function readPublicResponse<T>(response: Response): Promise<Result<T>> {
    if (!response.ok) {
        const body = await response.json().catch(() => null);
        return { ok: false, status: response.status, code: publicErrorCode(body) };
    }
    const body = await response.json().catch(() => null);
    if (typeof body !== "object" || body === null || !("data" in body) || body.meta?.schemaVersion !== 1)
        return { ok: false, status: 502, code: "INVALID_RESPONSE" };
    return { ok: true, response: body as ApiResponse<T> };
}
/** ISR renders must never store an error state: every unsuccessful read throws, so Next
 * keeps serving the previous good page (or answers 500 when there is none). */
export function requireSuccess<T>(result: Result<T>): ApiResponse<T> {
    if (!result.ok) throw new PublicDataError(result.status, result.code);
    return result.response;
}
const HOME_SECTIONS = ["categories", "keywords", "keywordToday"] as const;
/** The public `home` read answers 200 with an exploration section marked `unavailable`
 * when its source read failed. Dynamic renders show that partial state; the shared ISR
 * cache must not keep it, so the cached read throws and Next keeps the previous good
 * entry. Missing sections (older API) and `not-synchronized` or empty results pass.
 * Exception: a keyword window that is unavailable only because the tag.observe.tw ranking
 * pool could not be read. The API already keeps a successful keyword ranking for its
 * stale window, so by then no valid ranking is left. Throwing would turn a third-party
 * outage into a 503 for the whole page once the in-memory ISR entry is gone. The page
 * instead states that the window is temporarily unavailable. That state goes through the
 * same layers as a good page (60 s data cache, 60 s ISR revalidation, edge s-maxage 60 +
 * stale-while-revalidate 60), so it can outlive an upstream recovery by a few minutes. */
export function requireCompleteHome<T>(response: ApiResponse<T>): ApiResponse<T> {
    const exploration = (response.data as { exploration?: unknown } | null)?.exploration;
    if (typeof exploration !== "object" || exploration === null) return response;
    for (const key of HOME_SECTIONS) {
        const section = (exploration as Record<string, unknown>)[key];
        if (typeof section !== "object" || section === null || (section as { status?: unknown }).status !== "unavailable") continue;
        const pool = (section as { rankingPool?: { status?: unknown } }).rankingPool;
        if (key !== "categories" && typeof pool === "object" && pool !== null && pool.status === "unavailable") continue;
        throw new PublicDataError(503, "HOME_SECTION_UNAVAILABLE");
    }
    return response;
}
