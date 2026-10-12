'use client';
import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { ANALYTICS_PAGE_TITLE, OPT_OUT_EVENT, OPT_OUT_STORAGE_KEY, analyticsBlockReason, analyticsLinkEvent, analyticsPage, analyticsReferrer, readOptOut, resolveMeasurementId, type AnalyticsPage } from '@/lib/analytics-consent';

// GA4 for public pages only, started after hydration. This module is part of the
// hash/SRI-trusted bundle, so under 'strict-dynamic' the gtag script element it creates
// is trusted too: no inline script, nonce or 'unsafe-inline' is involved.
// Pages: the single config sends the initial page_view; enhanced measurement's history
// events cover client navigation and back/forward. No explicit page_view is ever sent.
// Every hit carries a fixed page_title and a sanitized page_location/page_referrer from
// `set`; whether history page_views honour them is unproven, so GA stays off by default.

// NEXT_PUBLIC_GA_ID is inlined at build: unset, empty or malformed disables GA.
const measurementId = resolveMeasurementId(process.env.NEXT_PUBLIC_GA_ID);
let started = false, stopped = false;
let current: AnalyticsPage | null = null;
const globals = () => window as unknown as Record<string, unknown> & { dataLayer?: unknown[] };

// gtag.js reads the Arguments object itself, so this must stay a function declaration.
function gtag(..._args: unknown[]) {
  (globals().dataLayer ??= []).push(arguments);
}
const storage = () => { try { return window.localStorage; } catch { return null; } };
function blocked() {
  const nav = navigator as Navigator & { globalPrivacyControl?: boolean; msDoNotTrack?: string };
  return analyticsBlockReason({
    measurementId,
    nodeEnv: process.env.NODE_ENV,
    hostname: window.location.hostname,
    webdriver: nav.webdriver,
    userAgent: nav.userAgent,
    doNotTrack: [nav.doNotTrack, globals().doNotTrack as string | undefined, nav.msDoNotTrack],
    globalPrivacyControl: nav.globalPrivacyControl,
    optedOut: readOptOut(storage()),
  }) !== null;
}
/** gtag's documented kill switch; set before hits for pages that must not be measured. */
function suppress(off: boolean) { if (measurementId) globals()[`ga-disable-${measurementId}`] = off || stopped; }
/** Runs before the browser URL becomes `next`: unmeasured pages (any query or fragment,
 * private, search, unknown) are switched off, measured ones get only sanitized fields. */
function prepare(next: URL) {
  const page = next.origin === window.location.origin ? analyticsPage(next) : null;
  suppress(page === null);
  if (!page || page.location === current?.location) return;
  gtag('set', { page_title: ANALYTICS_PAGE_TITLE, page_location: page.location, page_referrer: current?.location ?? '' });
  current = page;
}

// Wraps whatever pushState/replaceState is installed now (native or Next's), so the kill
// switch is set before the history entry changes and before gtag.js, which wraps later,
// reports the history event.
function guardHistory() {
  for (const method of ['pushState', 'replaceState'] as const) {
    const original = window.history[method];
    window.history[method] = function (this: History, data: unknown, unused: string, url?: string | URL | null) {
      if (url != null && !stopped) {
        try { prepare(new URL(url, window.location.href)); } catch { /* invalid URL: the call below throws */ }
      }
      return original.call(this, data, unused, url);
    };
  }
}
function onClick(event: MouseEvent) {
  const anchor = (event.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
  if (!anchor) return;
  const source = analyticsPage(window.location)?.type;
  if (!source) return;
  const tracked = analyticsLinkEvent(anchor.href, window.location.href, source);
  if (tracked) gtag('event', tracked.name, tracked.params);
}
// Registered before gtag.js loads, so it runs ahead of gtag's own popstate handler; the
// browser URL has already changed when popstate fires.
const onPopState = () => prepare(new URL(window.location.href));
const onInstalled = () => gtag('event', 'app_installed');
const onStorage = (event: StorageEvent) => { if (event.key === OPT_OUT_STORAGE_KEY && event.newValue === '1') stop(); };
/** Opt-out mid-visit: disable every further hit and drop our listeners. gtag.js itself
 * cannot be unloaded; the kill switch keeps it silent for the rest of the visit. */
function stop() {
  if (stopped) return;
  stopped = true;
  suppress(true);
  document.removeEventListener('click', onClick, true);
  window.removeEventListener('popstate', onPopState, true);
  window.removeEventListener('appinstalled', onInstalled);
  window.removeEventListener('storage', onStorage);
  window.removeEventListener(OPT_OUT_EVENT, stop);
}
function start(id: string, page: AnalyticsPage) {
  started = true;
  current = page;
  suppress(false);
  guardHistory();
  document.addEventListener('click', onClick, true);
  window.addEventListener('popstate', onPopState, true);
  window.addEventListener('appinstalled', onInstalled);
  window.addEventListener('storage', onStorage);
  window.addEventListener(OPT_OUT_EVENT, stop);
  gtag('js', new Date());
  gtag('set', { page_title: ANALYTICS_PAGE_TITLE, page_location: page.location, page_referrer: analyticsReferrer(document.referrer) });
  gtag('config', id);
  const script = document.createElement('script');
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(id)}`;
  document.head.appendChild(script);
}

export default function SiteAnalytics() {
  // Only a change signal: the measured location is read from window, which is the
  // browser URL even when the proxy rendered an internal ISR target.
  const pathname = usePathname();
  useEffect(() => {
    if (!measurementId || stopped) return;
    // Safety net for URL changes that bypassed the history guard.
    if (started) { prepare(new URL(window.location.href)); return; }
    // An unmeasured landing page loads nothing; a later client navigation to a public
    // page starts measurement there, with that page as the initial page_view.
    const page = analyticsPage(window.location);
    if (!page) return;
    if (blocked()) { stopped = true; return; }
    start(measurementId, page);
  }, [pathname]);
  return null;
}
