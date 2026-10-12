/** Browser view of GET /api/status (JSON). Only API availability and the public endpoint
 * list are read; anything else in the body is dropped, never echoed into the page. */
export interface ApiAvailability {
    status: 'ok' | 'degraded';
    checkedAt: string;
    services: Array<{ id: 'reports'; status: 'ok' | 'unavailable' }>;
    endpoints: Array<{ method: 'GET'; path: string }>;
}
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
/** Accepts 200 and 503 bodies alike: a degraded check still describes availability. */
export function parseApiAvailability(value: unknown): ApiAvailability | null {
    if (!record(value) || value.scope !== 'api_availability' || (value.status !== 'ok' && value.status !== 'degraded')) return null;
    if (typeof value.checkedAt !== 'string' || Number.isNaN(Date.parse(value.checkedAt))) return null;
    if (!Array.isArray(value.services) || !Array.isArray(value.endpoints)) return null;
    const services = value.services.filter((s): s is ApiAvailability['services'][number] =>
        record(s) && s.id === 'reports' && (s.status === 'ok' || s.status === 'unavailable')).map(({ id, status }) => ({ id, status }));
    // Paths only: same-origin, printable ASCII, no query or fragment, so no live URL is shown.
    const endpoints = value.endpoints.filter((e): e is ApiAvailability['endpoints'][number] =>
        record(e) && e.method === 'GET' && typeof e.path === 'string' && /^\/api\/[\x21\x22\x24-\x3e\x40-\x7e]{0,200}$/.test(e.path)).map(({ method, path }) => ({ method, path }));
    return { status: value.status, checkedAt: value.checkedAt, services, endpoints };
}
/** Same-origin JSON read; the gateway negotiates JSON for this Accept header. A response
 * that is not the JSON contract (e.g. this HTML page itself) is treated as unavailable,
 * so the page never re-requests itself. */
export async function fetchApiAvailability(fetcher: typeof fetch = fetch, signal?: AbortSignal): Promise<ApiAvailability | null> {
    try {
        const response = await fetcher('/api/status', { headers: { Accept: 'application/json' }, cache: 'no-store', credentials: 'omit', redirect: 'error', signal: signal ?? AbortSignal.timeout(8000) });
        if (response.status !== 200 && response.status !== 503) return null;
        if (!(response.headers.get('content-type') ?? '').toLowerCase().includes('application/json')) return null;
        return parseApiAvailability(await response.json());
    } catch {
        return null;
    }
}
export const SERVICE_LABELS: Record<ApiAvailability['services'][number]['id'], string> = { reports: '公開報表 API' };
