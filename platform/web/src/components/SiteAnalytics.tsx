'use client';
import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { ANALYTICS_PAGE_TITLE, OPT_OUT_EVENT, OPT_OUT_STORAGE_KEY, analyticsBlockReason, analyticsLinkEvent, analyticsPage, analyticsReferrer, analyticsReferrerAllowsStart, readOptOut, resolveMeasurementId, type AnalyticsPage } from '@/lib/analytics-consent';

// GA4 for public pages only, started after hydration. This module is part of the
// hash/SRI-trusted bundle, so under 'strict-dynamic' the gtag script element it creates
// is trusted too: no inline script, nonce or 'unsafe-inline' is involved.
// Pages: the single config sends the initial page_view; enhanced measurement's history
// events cover client navigation and back/forward. No explicit page_view is ever sent.
// History page_views report the raw browser URL (a `set` page_location is not honoured)
// and the previous raw URL as referrer, so measured pages are only those whose URL holds
// no free text, and the first move to any other URL stops GA for the rest of the document:
// resuming later would let the referrer of the next history hit carry the unmeasured URL.
// The fixed `set` page_title is honoured, so the document title (video, channel names) is
// not sent.

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
/** gtag's documented kill switch, read by gtag.js before every hit. */
function disable(off: boolean) { if (measurementId) globals()[`ga-disable-${measurementId}`] = off; }
/** Runs before the browser URL becomes `next` (or, for popstate/hashchange, before gtag's
 * own listener sees it): an unmeasured page (any query or fragment, private, search,
 * unknown or free-text) stops GA for good; a measured one only updates the fixed fields. */
function prepare(next: URL) {
  const page = next.origin === window.location.origin ? analyticsPage(next) : null;
  if (!page) { stop(); return; }
  if (page.location === current?.location) return;
  gtag('set', { page_title: ANALYTICS_PAGE_TITLE, page_location: page.location, page_referrer: current?.location ?? '' });
  current = page;
}

// Wraps whatever pushState/replaceState is installed now (native or Next's), so the kill
// switch is set before the history entry changes and before gtag.js, which wraps later,
// reports the history event. The wrappers stay installed after stop() but do nothing.
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
  // The raw attribute, not `.href`: an SVG <a> (the home keyword cloud) exposes `.href`
  // as an SVGAnimatedString, not a URL string.
  const href = (event.target as Element | null)?.closest?.('a[href]')?.getAttribute('href');
  if (href == null) return;
  const source = analyticsPage(window.location)?.type;
  if (!source) return;
  const tracked = analyticsLinkEvent(href, window.location.href, source);
  if (tracked) gtag('event', tracked.name, tracked.params);
}
// Registered before gtag.js loads, so it runs ahead of gtag's own popstate handler; the
// browser URL has already changed when popstate fires. Fragment navigation fires popstate
// before the queued hashchange; the hashchange listener covers browsers that skip it.
const onUrlChange = () => prepare(new URL(window.location.href));
const onInstalled = () => gtag('event', 'app_installed');
const onStorage = (event: StorageEvent) => { if (event.key === OPT_OUT_STORAGE_KEY && event.newValue === '1') stop(); };
/** Opt-out, or the first unmeasured URL: disable every further hit and drop our listeners.
 * gtag.js itself cannot be unloaded; the kill switch keeps it silent until a full reload. */
function stop() {
  if (stopped) return;
  stopped = true;
  disable(true);
  document.removeEventListener('click', onClick, true);
  window.removeEventListener('popstate', onUrlChange, true);
  window.removeEventListener('hashchange', onUrlChange, true);
  window.removeEventListener('appinstalled', onInstalled);
  window.removeEventListener('storage', onStorage);
  window.removeEventListener(OPT_OUT_EVENT, stop);
}
function start(id: string, page: AnalyticsPage) {
  started = true;
  current = page;
  disable(false);
  guardHistory();
  document.addEventListener('click', onClick, true);
  window.addEventListener('popstate', onUrlChange, true);
  window.addEventListener('hashchange', onUrlChange, true);
  window.addEventListener('appinstalled', onInstalled);
  window.addEventListener('storage', onStorage);
  window.addEventListener(OPT_OUT_EVENT, stop);
  gtag('js', new Date());
  gtag('set', { page_title: ANALYTICS_PAGE_TITLE, page_location: page.location, page_referrer: analyticsReferrer(document.referrer) });
  gtag('config', id, { allow_google_signals: false, allow_ad_personalization_signals: false });
  const script = document.createElement('script');
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(id)}`;
  document.head.appendChild(script);
}

/** The effect run after hydration and on every pathname change; exported for tests. */
export function syncAnalytics() {
  if (!measurementId || stopped) return;
  // Safety net for URL changes that bypassed the history guard.
  if (started) { prepare(new URL(window.location.href)); return; }
  // An unmeasured landing page, or one reached from an unmeasured same-site page, never
  // loads GA in this document: a later history page_view could carry that URL as its
  // referrer. Only a fresh document load of a measured page can start.
  const page = analyticsPage(window.location);
  if (!page || !analyticsReferrerAllowsStart(document.referrer) || blocked()) { stopped = true; return; }
  start(measurementId, page);
}

export default function SiteAnalytics() {
  // Only a change signal: the measured location is read from window, which is the
  // browser URL even when the proxy rendered an internal ISR target.
  const pathname = usePathname();
  useEffect(syncAnalytics, [pathname]);
  return null;
}
