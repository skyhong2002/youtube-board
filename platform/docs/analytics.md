# Website analytics

GA4 measurement ID `G-X2G1PLNP7K` belongs to property 558497452 / stream 16112956911. It is a public identifier, not a credential. Set `NEXT_PUBLIC_GA_ID` to this value at frontend build and runtime. An unset frontend build setting loads no Google script; the gateway only opens GA transport CSP destinations when the runtime setting, production environment and exact public origin agree. Preview hosts, automation, DNT, GPC and opt-out do not load GA. The gateway flag alone is not a script download kill switch: disabling analytics requires a build without the ID.

The loader runs after hydration from the hash/SRI-trusted application bundle, creating the external gtag script under strict-dynamic. No nonce or unsafe-inline is added to script policy. Google signals and advertisement personalization signals are disabled. The Google console must retain the operator-confirmed enhanced measurement settings: **page loads and browser-history changes only**. Other automatic click/form/download/video events must remain off because they can transmit raw links or text.

There is no manual page_view. One gtag config supplies the initial view; Google's enhanced measurement owns history/back navigation. Every measured hit uses the fixed title `有影儀表板`. Initial external referrers are reduced to origin. Custom events are `open_original` (domain and fixed page type), `select_content` (fixed type; only numeric channel or YouTube video IDs), `rss_click`, `app_installed` and `web_vital` (see Real-user performance). Keyword clicks do not send the keyword itself. Neither application user IDs nor email, account/session/CSRF tokens, titles, search text or full external URLs are sent.

## Privacy boundary for automatic history measurement

Real gtag transport testing demonstrated that automatic history views override global page_location and page_referrer. Consequently, free-text routes (keyword/group/city detail), private/unknown paths and any query/fragment are not measured. The first such navigation permanently disables analytics for that document; returning to a public page does not resume it and leak the prior raw URL as referrer. A fresh eligible document may start. An unmeasured initial route or unmeasured same-origin document referrer prevents startup. This intentionally undercounts some visits to preserve privacy.

The opt-out page `/observe/opt-out` is noindex. Choosing opt-out immediately stops the current document even if storage fails; failed persistence is disclosed and can be retried. A full reload is needed to restart tracking after opting back in. The `login` event remains pending a verified one-time server callback receipt; ordinary session presence, URL fragments and user IDs must never manufacture that event.

## Real-user performance

Once GA has started in a document, the `web-vitals` package (v6, loaded as a separate chunk; attribution build not used) reports a `web_vital` event per settled metric:

- `metric_name`: LCP, INP or CLS.
- `metric_value`: LCP/INP in whole milliseconds; CLS is unitless, rounded to three decimals.
- `metric_rating`: good, needs-improvement or poor (the library's thresholds).
- `page_type`: the fixed `analyticsPage` type of the landing page of this document load (home, videos, video, channel, …). Never a URL, query text, title or DOM text, and it does not change on SPA navigation.
- `metric_id`, `navigation_type`: identify the sample and how the document was reached (navigate, reload, back-forward, back-forward-cache, prerender, restore). Do not register the high-cardinality `metric_id` as a custom dimension.

The observers are registered once per document, only after GA started, with web-vitals' default reporting (the settled value, usually at the first interaction or when the page is hidden, not every change). SPA navigation is not a new load and soft-navigation reporting is off; pages without interaction produce no INP. Sending goes through the same `sendEvent` gate as every other custom event in `SiteAnalytics`: nothing before start, nothing once the document has stopped (first unmeasured URL, opt-out), and a block reason found at send time stops GA instead of sending. A metric that settles after the reader moved to an unmeasured page is therefore dropped. Opt-out, DNT, GPC, automation, preview hosts and non-production never load GA, so they never load web-vitals either.

Chosen over Next's `useReportWebVitals` (`next/web-vitals`): the copy Next 16.3 bundles is web-vitals v3 (still exports FID, older INP), registers FCP/TTFB/FID too and re-registers whenever the callback identity changes. The `web-vitals` package gives current LCP/INP/CLS with `rating` and lets registration be gated on GA having started.

GA4 custom definitions for the owner to create (Admin → Custom definitions; needs Editor): event-scoped dimensions `metric_name`, `metric_rating` and `page_type`, and the custom metric `metric_value` (standard unit). Always filter reports by `metric_name` before aggregating `metric_value`: milliseconds and CLS must not be mixed. GA does not backfill, so events sent before a definition exists have that field blank. Explore by device category, page type, metric name and rating for sample counts and the good share. GA's aggregate average is not a 75th percentile; for real p75 use a BigQuery raw-event export, or CrUX / Search Console Core Web Vitals where the sample is large enough.

## Validation and operational status

Frontend implementation is by Claude Opus 5.5; Codex reviewed and integrated it. Pure browser-policy tests, a fake enhanced-history implementation and actual gtag transport interception verify the boundary. The interception harness blocks collection and stores only safe event fields; these are **not production events delivered to GA**. Real loader tests confirmed one initial/history/back page_view each, fixed title, sanitized external referrer, safe external-link/RSS/SVG keyword events, and no events after direct hash navigation followed by public navigation. Google backend delivery must be verified after the enabled deployment; do not claim Realtime receipt from intercepted evidence.

The enabled build `1a93214` was deployed on 2026-10-12 at approximately 15:37 UTC, pinned to `sha256:08292fb0cd1a898b2a65f7db8826a6c0c0d52d402a4a08a4e13d7f7fb188437b`. Only the public measurement-ID environment entry was added. Database/schema, routing and writer ownership did not change. The previous sitemap image remains the GA-disabled rollback.

A normal collaborative browser (webdriver false; DNT/GPC/opt-out off) loaded the actual built Next bundle. Observed outgoing UTC times:

| Event | UTC time |
| --- | --- |
| Initial about page_view | 15:38:12.340 |
| SPA about → channels page_view | 15:39:32.336 |
| Browser back → about page_view | 15:40:06.337 |
| Fresh video landing page_view | 15:41:56.734 |
| open_original | 15:42:02.335 |
| select_content (video) | 15:43:06.334 |

Initial/history/back each generated one page_view; config count was one and the application queued no manual page_view. The fixed public site title was used. Custom events carried only the expected domain/type/public video ID, with no title, full external URL, email or user ID. A pass-through observer preserved transport; fetch resolved with opaque no-cors responses. This records actual send attempts, **not Google Realtime receipt**, which is for the Google administrator to confirm. One outbound click followed YouTube; a later repeat prevented only page navigation to retain observation while preserving the analytics request.

No CSP errors were observed. SPA entry into opt-out set the GA kill switch without a new hit; a fresh `/my` document loaded zero GA scripts/resources and was noindex. HTTP `/my` and opt-out remained private/no-store. Sitemap remained public XML and all 17 nonempty children remained in the canary. Public homepage hash CSP and ISR shared-cache headers remained enabled.

Opus5.5 review was complete and model-verified. Adopted: real built-bundle transport checks, outbound parameter audit, runtime/build ID checks and accurate separation from Realtime proof. Its concern that enhanced-measurement settings were unverified was resolved by the user's two explicit confirmations that only page-load/history are enabled. External initial-referrer origin sanitization already had actual gtag interception evidence; conservative same-origin exclusions remain. Optional cookie-retention change and older Safari/Firefox behavior remain separate follow-up work. The login event is still pending the secure one-time receipt described above.

## 2026-11-01: GA silently off since Docker-built releases

GA4 showed "No data received" for stream 16112956911. The live bundle referenced `process.env.NEXT_PUBLIC_GA_ID` un-inlined: `platform/Dockerfile` ran `next build` without the ID (only `tools/guarded-next-build.py` set it), so every Docker-built web image shipped with GA disabled even though the runtime env and gateway CSP were correct. The Dockerfile now sets `ARG/ENV NEXT_PUBLIC_GA_ID=G-X2G1PLNP7K` before the web build (`--build-arg NEXT_PUBLIC_GA_ID=` builds a GA-disabled image), and `web/src/lib/analytics-consent.test.ts` guards it. After a web release, confirm the served chunk contains `G-X2G1PLNP7K` and a normal browser sends `g/collect`.

## Public site traffic (本站流量, `/observe`)

Port of tag.observe.tw's `/observe/` page (its `docs/analytics.md` sections 「公開本站流量與讀者關注」 and 「授權讀取 GSC／GA 成效」). Not released yet; the production steps below are still open.

### Data flow

- `site.analytics.sync` (hourly at :20 Taipei) reads the GA4 Data API (property 558497452) and Search Console with a service account and replaces a trailing window of `ts_site_metrics` rows (Taipei day × source × metric × item). The first run backfills 90 days; later runs re-read GA for the last 7 days and Search Console for the last 10 and overwrite that whole window in one InnoDB transaction, so late data and corrections settle and vanished items disappear. It also writes `source='meta', metric='synced_at'` (the page's 更新於) and journals each run in `ts_job_runs`.
- `site.analytics.live` (every 2 minutes) reads GA Realtime: active users and views of the last 30 minutes plus views per minute (`source='rt'`), replacing all realtime rows each run; no `ts_job_runs` row. Totals only, never `unifiedScreenName`/pages.
- `GET /api/v1/site-observation?days=7|28|90` (`api/src/reports/site-observation.ts`; default 28, anything else 400) aggregates the table for the page: `updatedAt`, `live` (null when missing or older than 15 minutes), `traffic` (zero-filled daily views/sessions/users since the first GA day, default channel groups, devices, custom-event counts), `pages` (top 20), `content` (top 10 content pages), `search` (daily clicks/impressions/position, impression-weighted position, top 10 pages by clicks), `vitals`. Standard v1 envelope and 60-second public cache; the API also reuses one aggregation per period for a minute. A missing table or grant yields the empty shape, not an error.
- `/observe` (`web/src/app/observe/page.tsx`, `components/SiteObservationView.tsx`) renders it with a method block (`components/method/observe.tsx`); linked from the footer, `/about#observe` and the opt-out page; listed in both sitemaps. The page itself stays outside GA measurement (`/observe` is a private path in `analytics-consent.ts`), and the gateway does not share its HTML.
- What is read: GA `date`, `pagePath`, `sessionDefaultChannelGroup`, `deviceCategory`, `eventName` (`open_original`, `select_content`, `rss_click`) and, once the event-scoped custom dimensions `metric_name`/`metric_rating` exist in the property, `web_vital` counts per LCP/INP/CLS rating; every GA report is filtered to `hostName = youtube.observe.tw`. Search Console: dimensions `date` and `date,page` only with `dataState=all` — **search queries are never requested**. GA page titles are never requested (GA only receives the fixed 有影儀表板); the API names pages from their path and, for videos, channels, categories and AI topics, from `urt_video`/`urt_channel`/`urt_tag`/`urt_ai_event`.
- Paths are normalized by `shared/site-analytics.ts` `sitePath`: other hosts (a `sc-domain:` property also covers tag.observe.tw etc.), private pages, `/observe/opt-out`, `/api/*` and every free-text route (keyword, vocabulary term, group, mayor city/person, live group, AI condition, comment author) are dropped, matching what the web never measures. With a domain property the Search Console requests also carry a `page includingRegex ^https?://youtube\.observe\.tw/` filter, so the daily totals cover only this site.
- Content pages (讀者關注): `/videos/:id`, `/live/videos/:id/trend`, `/channels/:id/…`, `/tags/:id/…`, `/ai/events/:id`, `/ai/days/:id/events`, `/events/:uuid`.

### Configuration

Worker env (cache worker only; the web never touches Google credentials). If any of the three is unset both jobs return `{status:'skipped', reason:'google-access-not-configured'}` without connecting; a set but malformed value fails the run.

| Variable | Production value |
| --- | --- |
| `GOOGLE_APPLICATION_CREDENTIALS` | `/run/secrets/yb_ts_google_analytics_sa_v1` (path to the service-account JSON) |
| `GA4_PROPERTY_ID` | `558497452` |
| `GSC_SITE_URL` | `https://youtube.observe.tw/` (the URL-prefix property; `sc-domain:observe.tw` also works) |

The client signs a JWT for `analytics.readonly` and `webmasters.readonly` only (`jobs/src/google-analytics.ts`), never logs the token, assertion or response bodies (errors carry only status and URL path).

### Batch and grants

Both workflows belong to the `cache` batch (`shared/worker-batches.ts`): they derive TS-owned aggregates without YouTube quota or Laravel tables, like the avatar refresh, and a dedicated batch would need a new facade, principal and worker service for two small jobs. The cache worker is serial, so a long report-cache run can delay `site.analytics.live`; delays over 15 minutes simply hide the 最近 30 分鐘 panel until the next run.

Profiles (`shared/worker-permissions.json`): `site.analytics.sync` = `ts_site_metrics` SELECT/INSERT/DELETE + `ts_job_runs` SELECT/INSERT/UPDATE (already in the batch); `site.analytics.live` = `ts_site_metrics` SELECT/INSERT/DELETE. The report principal gets SELECT on `ts_site_metrics` (`reportStateTables`). Table: `jobs/migrations/021_site_metrics.sql` (also in `migrations/002-frontend-state.sql`).

### Manual one-off run

Inside the cache worker container (its env already has the facade DB settings and gates; `TS_INGESTION_OWNERS` and, in production, `TS_INGESTION_WRITE_ALLOWLIST` must include the workflow):

```bash
node --import tsx jobs/src/cli.ts site:analytics:sync            # dry run: reports whether Google access is configured
node --import tsx jobs/src/cli.ts site:analytics:sync --execute  # one GA/GSC pull (first run backfills 90 days)
node --import tsx jobs/src/cli.ts site:analytics:live --execute  # one realtime refresh
```

The worker's DB settings come from the env secret its service command sources (`set -a; . /run/secrets/<worker-cache env secret>; set +a`); source the same file in a `docker exec … sh -c` before these commands. The output is a JSON summary of windows and row counts only. Locally the same commands run against the isolated `*_rewrite` database with `APP_ENV=local`, `TS_INGESTION_ENABLED=true`, `TS_INGESTION_OWNERS=site.analytics.sync,site.analytics.live` and the three Google variables.

Verification: `npx vitest run test/site-analytics-cli.test.ts test/schedules-site-analytics.test.ts` (jobs), `npx vitest run test/site-observation.test.ts` (api), `node --import tsx --test src/lib/site-observation-view.test.ts` (web), `node --test tools/site-metrics-upgrade.test.mjs`.

### Release status (2026-11-01)

- Done: web half (Web Vitals, `/observe`, API) released, see `release-observe-web-7891484-2026-11-01.md`.
- Google side, done by the user with Codex's help (the user reported these as checked; I have not checked them myself):
  - Service account reused from tag.observe.tw: `tag-observe-analytics-reader@skys-gemini-api.iam.gserviceaccount.com` (an identifier, not a credential). No new key was created.
  - Search Console: URL-prefix property `https://youtube.observe.tw/` added and auto-verified; the service account is a Restricted user on it.
  - GA4 558497452: event-scoped dimensions `metric_name`, `metric_rating`, `page_type` and the Standard-unit metric `metric_value` created; the Search Console link to stream 16112956911 was created.
  - Key file: the existing key, copied on sky-server to `/root/youtube-board-secrets/google-analytics-sa.json` (root:root 0600, byte-identical to tag's copy, never printed).
- GA4 Viewer for the service account added later on 2026-11-01. Viewer confirmed in the access list, no email notification.
- Data half released on 2026-11-01 (steps 2–7): `release-sitemetrics-7891484-2026-11-01.md`. Google API read access and GA receipt of hits were verified there.

### Production release steps (all done on 2026-11-01)

1. Google side (user): grant the tag.observe.tw service account **Viewer** on GA4 property 558497452 and a (restricted) user on the Search Console property `https://youtube.observe.tw/`. Optionally register event-scoped custom dimensions `metric_name`, `metric_rating` in GA (needs editor) so vitals appear; GA does not backfill.
2. Secret on sky-server: keep the key as a root-only file outside git (for example `/root/youtube-board-secrets/google-analytics-sa.json`, mode 0600), then `docker secret create yb_ts_google_analytics_sa_v1 <that file>`. Never paste or log the key.
3. Take the usual consistent backup, then `node tools/site-metrics-upgrade.mjs` (dry run) and `--execute --phase=prepare` with `FRONTEND_BOOTSTRAP_URL`, `FRONTEND_ACCOUNT_HOST`, `WORKER_ACCOUNT_HOST` set as for the earlier upgrades: creates the table, the `youtube_board_ts_worker_cache` facade view and the report SELECT; the running cache worker's grants stay unchanged.
4. Build the image from this commit. Swap the **web** service (route, page, sitemap) — it reads the table through the report grant from step 3.
5. Swap **worker-cache** to the new image and immediately run `--execute --phase=worker` (cache principal SELECT/INSERT/DELETE): the worker verifies its grants against the permission file on connect, so the grants and the image go together. In the same compose update add to worker-cache: the secret `{source: yb_ts_google_analytics_sa_v1, uid: '1000', gid: '1000', mode: 0400}` (external), env `GOOGLE_APPLICATION_CREDENTIALS=/run/secrets/yb_ts_google_analytics_sa_v1`, `GA4_PROPERTY_ID=558497452`, `GSC_SITE_URL=https://youtube.observe.tw/`, and `site.analytics.sync,site.analytics.live` in its `TS_INGESTION_OWNERS` and `TS_INGESTION_WRITE_ALLOWLIST`.
6. Swap the **scheduler** image first (an older image rejects unknown workflows), add the two workflows to its owners/allowlist, then add `runtime/schedules.site-analytics.json` to its schedule configuration.
7. Run `site:analytics:sync --execute` once by hand in worker-cache, check `ts_job_runs`, `GET /api/v1/site-observation` and `/observe`.

Rollback: remove the schedule entries, swap worker-cache/scheduler/web back (revoke the cache principal's `ts_site_metrics` grants before starting an old worker image, since it verifies grants against its own permission file), drop the secret mount. The table and the report grant are additive and can stay.
