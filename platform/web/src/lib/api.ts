import "server-only";
import { cache } from "react";
import { unstable_cache } from "next/cache";
import { notFound } from "next/navigation";
import type { ApiResponse } from "../../../api/src/contracts";
import { PUBLIC_DATA_REVALIDATE, PublicDataError, deterministicPartial, publicApiUrl, publicDataClass, readPublicResponse, requireSuccess, type PublicDataClass } from "./public-data";
export type * from "../../../api/src/contracts";
export type Search = Record<string, string | string[] | undefined>;
export type Result<T> =
    | { ok: true; response: ApiResponse<T> }
    | { ok: false; status: number; code: string };
export {queryString} from './query-string';
/** Per-render switch, scoped to one React server request. Dynamic renders keep the
 * original no-store reads and graceful error states. */
const renderMode = cache(() => ({ revalidate: false }));
/** Called by ISR page entries before rendering anything that reads data. */
export function enablePublicRevalidation() {
    renderMode().revalidate = true;
}
/** For renderer shape checks on an accepted envelope: ISR renders throw, dynamic
 * renders go on to show their existing 502 notice. */
export function rejectMalformedPayload() {
    if (renderMode().revalidate) throw new PublicDataError(502, "INVALID_RESPONSE");
}
const apiBase = () => process.env.YOUTUBE_API_BASE_URL || "http://127.0.0.1:4100/api/v1";
// Public reads never carry cookies, authorization or forwarded request headers.
async function read<T>(url: string): Promise<Result<T>> {
    try {
        const response = await fetch(url, {
            cache: "no-store",
            credentials: "omit",
            redirect: "error",
            signal: AbortSignal.timeout(12000),
            headers: { Accept: "application/json" },
        });
        return await readPublicResponse<T>(response);
    } catch {
        return { ok: false, status: 503, code: "API_UNAVAILABLE" };
    }
}
// Only successful payloads are stored: a thrown read is never cached, and a stale entry
// keeps being served while its background refresh fails.
const revalidated = Object.fromEntries(
    (Object.keys(PUBLIC_DATA_REVALIDATE) as PublicDataClass[]).map((kind) => [
        kind,
        unstable_cache(async (url: string) => requireSuccess(await read<unknown>(url)), ["public-api", kind], {
            revalidate: PUBLIC_DATA_REVALIDATE[kind],
            tags: ["public-api", `public-api:${kind}`],
        }),
    ]),
) as Record<PublicDataClass, (url: string) => Promise<ApiResponse<unknown>>>;
/** `optional` marks a secondary read whose failure the caller renders as a partial
 * section. In ISR it returns only deterministic failures (see deterministicPartial) and
 * never turns a 404 into a page-level notFound(). */
export async function api<T>(
    path: string,
    search: Search = {},
    { optional = false }: { optional?: boolean } = {},
): Promise<Result<T>> {
    const isr = renderMode().revalidate;
    let url: string;
    try {
        url = publicApiUrl(apiBase(), path, search);
    } catch {
        if (isr && !optional) notFound();
        return { ok: false, status: 404, code: "NOT_FOUND" };
    }
    if (!isr) return read<T>(url);
    try {
        return { ok: true, response: (await revalidated[publicDataClass(path, search)](url)) as ApiResponse<T> };
    } catch (error) {
        if (!(error instanceof PublicDataError)) throw error;
        if (optional && deterministicPartial(error.status, error.code))
            return { ok: false, status: error.status, code: error.code };
        if (error.status === 404) notFound();
        throw error;
    }
}
