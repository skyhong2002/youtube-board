import "server-only";
import type { ApiResponse } from "../../../api/src/contracts";
export type * from "../../../api/src/contracts";
export type Search = Record<string, string | string[] | undefined>;
export type Result<T> =
    | { ok: true; response: ApiResponse<T> }
    | { ok: false; status: number; code: string };
export function queryString(search: Search, allow?: string[]) {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(search)) {
        if (allow && !allow.includes(key)) continue;
        if (Array.isArray(value))
            value.forEach((item) => query.append(key, item));
        else if (value !== undefined) query.set(key, value);
    }
    const encoded = query.toString();
    return encoded ? `?${encoded}` : "";
}
export async function api<T>(
    path: string,
    search: Search = {},
): Promise<Result<T>> {
    const base = (
        process.env.YOUTUBE_API_BASE_URL || "http://127.0.0.1:4100/api/v1"
    ).replace(/\/$/, "");
    try {
        const response = await fetch(
            `${base}/${path.replace(/^\//, "")}${queryString(search)}`,
            {
                cache: "no-store",
                signal: AbortSignal.timeout(12000),
                headers: { Accept: "application/json" },
            },
        );
        if (!response.ok) {
            const body = await response.json().catch(() => ({}));
            return {
                ok: false,
                status: response.status,
                code:
                    typeof body?.error?.code === "string"
                        ? body.error.code
                        : "API_UNAVAILABLE",
            };
        }
        const body = await response.json().catch(() => null);
        if (
            typeof body !== "object" ||
            body === null ||
            !("data" in body) ||
            body.meta?.schemaVersion !== 1
        )
            return { ok: false, status: 502, code: "INVALID_RESPONSE" };
        return { ok: true, response: body as ApiResponse<T> };
    } catch {
        return { ok: false, status: 503, code: "API_UNAVAILABLE" };
    }
}
