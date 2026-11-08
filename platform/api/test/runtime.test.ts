import { it, expect, vi } from 'vitest';
import { readinessProbe } from '../../runtime/readiness.js';
it('coalesces concurrent readiness probes and caches failures for the bounded interval', async () => {
    let time = 1000;
    const check = vi.fn(async () => true);
    const probe = readinessProbe(check, () => time, 3000);
    expect((await Promise.all(Array.from({ length: 100 }, () => probe()))).every(Boolean)).toBe(true);
    expect(check).toHaveBeenCalledTimes(1);
    time += 2999;
    expect(await probe()).toBe(true);
    expect(check).toHaveBeenCalledTimes(1);
    time += 1;
    check.mockRejectedValueOnce(new Error('offline'));
    expect(await probe()).toBe(false);
    expect(await probe()).toBe(false);
    expect(check).toHaveBeenCalledTimes(2);
    time += 3000;
    expect(await probe()).toBe(true);
    expect(check).toHaveBeenCalledTimes(3);
});

// #6: the web container healthcheck used /runtime/ready, whose API check runs SELECT 1
// through the shared 6-connection reader pool. A saturated pool (admission queue 24/24,
// 3 s acquire deadline) failed the probe on a healthy process, and Swarm replaced the only
// web task, turning degraded data into a public 502.
it('keeps a booted web task live through data-source degradation but not before first readiness', async () => {
    const { runtimeLiveness } = await import('../../runtime/readiness.js');
    const ok = { api: 'ready', ui: 'ready', security: 'ready' };
    const dbDown = { ...ok, api: 'unavailable' };
    expect(runtimeLiveness(ok, true)).toEqual({ live: true, checks: ok });
    // Pool saturation or a slow database after boot: stay live, report degraded.
    expect(runtimeLiveness(dbDown, true)).toEqual({ live: true, checks: { ...ok, api: 'degraded' } });
    // Cold start or a broken release (wrong credentials, sitemap warmup): not live yet.
    expect(runtimeLiveness(dbDown, false)).toEqual({ live: false, checks: dbDown });
    expect(runtimeLiveness({ ...ok, api: 'unchecked' }, false).live).toBe(false);
    // Local UI and CSP failures are never excused.
    expect(runtimeLiveness({ ...ok, ui: 'unavailable' }, true).live).toBe(false);
    expect(runtimeLiveness({ ...ok, security: 'unavailable' }, true).live).toBe(false);
});
it('points the web container healthcheck at liveness, workers and scheduler at their own /ready', async () => {
    const { readFile } = await import('node:fs/promises');
    const source = await readFile(new URL('../../runtime/healthcheck.mjs', import.meta.url), 'utf8');
    expect(source).toContain("worker || scheduler ? 'ready' : 'runtime/live'");
});
