/** Pure shaping of the `web_vital` GA4 event. SiteAnalytics decides whether it may be sent;
 * this only decides what it may carry: the metric itself and the fixed page type of the
 * document load, never a URL, query, title or DOM text. */
import type { PageType } from './analytics-consent';

export const WEB_VITAL_NAMES = ['LCP', 'INP', 'CLS'] as const;
export type WebVitalName = (typeof WEB_VITAL_NAMES)[number];
export type WebVitalRating = 'good' | 'needs-improvement' | 'poor';
/** The fields read from a web-vitals Metric (attribution-free). */
export type WebVitalMetric = { name: string; value: number; rating: string; id: string; navigationType?: string };
export type WebVitalEvent = {
  name: 'web_vital';
  params: {
    metric_name: WebVitalName;
    /** LCP/INP in whole milliseconds; CLS unitless, three decimals. */
    metric_value: number;
    metric_rating: WebVitalRating;
    page_type: PageType;
    metric_id: string;
    navigation_type: string;
  };
};
const RATINGS: readonly string[] = ['good', 'needs-improvement', 'poor'];
const isName = (name: string): name is WebVitalName => (WEB_VITAL_NAMES as readonly string[]).includes(name);
// web-vitals ids are `v6-<timestamp>-<random>`; anything else is not forwarded.
const METRIC_ID = /^v\d+-[0-9]+-[0-9]+$/;
const NAVIGATION_TYPE = /^[a-z][a-z_-]{0,31}$/;

/** The event for one settled metric, or null for other metrics or malformed values.
 * `pageType` is the measured type of the landing page of this document load. */
export function webVitalEvent(metric: WebVitalMetric, pageType: PageType): WebVitalEvent | null {
  const { name, value, rating, id } = metric;
  if (!isName(name) || !Number.isFinite(value) || value < 0 || !RATINGS.includes(rating) || !METRIC_ID.test(id)) return null;
  const navigationType = metric.navigationType && NAVIGATION_TYPE.test(metric.navigationType) ? metric.navigationType : 'unknown';
  return {
    name: 'web_vital',
    params: {
      metric_name: name,
      metric_value: name === 'CLS' ? Math.round(value * 1000) / 1000 : Math.round(value),
      metric_rating: rating as WebVitalRating,
      page_type: pageType,
      metric_id: id,
      navigation_type: navigationType,
    },
  };
}
