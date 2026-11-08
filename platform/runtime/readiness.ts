/** Coalesce concurrent probes and briefly cache both success and failure. */
export function readinessProbe(check: () => Promise<boolean>, now = () => Date.now(), ttlMs = 3000) {
  let cached = false, expires = 0, pending: Promise<boolean> | undefined;
  return async (): Promise<boolean> => {
    if (now() < expires) return cached;
    if (!pending) pending = check().catch(() => false).then(value => { cached = value; expires = now() + ttlMs; return value; }).finally(() => { pending = undefined; });
    return pending;
  };
}

export type RuntimeChecks = { api: string; ui: string; security: string };
/**
 * Container liveness for the web role. Replacing the only web task cannot repair a
 * saturated reader pool or a slow database; it turns degraded data into a public 502.
 * Once the API has been ready since this boot, its database check no longer decides
 * liveness. Before the first ready API check (cold start, bad release, wrong
 * credentials) liveness still requires it, so a broken release keeps failing its
 * start-up check. UI and security headers are local and always required.
 */
export function runtimeLiveness(checks: RuntimeChecks, apiSeenReady: boolean) {
  const api = checks.api === 'ready' ? 'ready' : apiSeenReady ? 'degraded' : 'unavailable';
  return { live: checks.ui === 'ready' && checks.security === 'ready' && api !== 'unavailable', checks: { ...checks, api } };
}
