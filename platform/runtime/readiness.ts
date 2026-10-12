/** Coalesce concurrent probes and briefly cache both success and failure. */
export function readinessProbe(check: () => Promise<boolean>, now = () => Date.now(), ttlMs = 3000) {
  let cached = false, expires = 0, pending: Promise<boolean> | undefined;
  return async (): Promise<boolean> => {
    if (now() < expires) return cached;
    if (!pending) pending = check().catch(() => false).then(value => { cached = value; expires = now() + ttlMs; return value; }).finally(() => { pending = undefined; });
    return pending;
  };
}
