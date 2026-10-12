# Website analytics

GA4 measurement ID `G-X2G1PLNP7K` belongs to property 558497452 / stream 16112956911. It is a public identifier, not a credential. Set `NEXT_PUBLIC_GA_ID` to this value at frontend build and runtime. An unset frontend build setting loads no Google script; the gateway only opens GA transport CSP destinations when the runtime setting, production environment and exact public origin agree. Preview hosts, automation, DNT, GPC and opt-out do not load GA. The gateway flag alone is not a script download kill switch: disabling analytics requires a build without the ID.

The loader runs after hydration from the hash/SRI-trusted application bundle, creating the external gtag script under strict-dynamic. No nonce or unsafe-inline is added to script policy. Google signals and advertisement personalization signals are disabled. The Google console must retain the operator-confirmed enhanced measurement settings: **page loads and browser-history changes only**. Other automatic click/form/download/video events must remain off because they can transmit raw links or text.

There is no manual page_view. One gtag config supplies the initial view; Google's enhanced measurement owns history/back navigation. Every measured hit uses the fixed title `有影儀表板`. Initial external referrers are reduced to origin. Custom events are `open_original` (domain and fixed page type), `select_content` (fixed type; only numeric channel or YouTube video IDs), `rss_click` and `app_installed`. Keyword clicks do not send the keyword itself. Neither application user IDs nor email, account/session/CSRF tokens, titles, search text or full external URLs are sent.

## Privacy boundary for automatic history measurement

Real gtag transport testing demonstrated that automatic history views override global page_location and page_referrer. Consequently, free-text routes (keyword/group/city detail), private/unknown paths and any query/fragment are not measured. The first such navigation permanently disables analytics for that document; returning to a public page does not resume it and leak the prior raw URL as referrer. A fresh eligible document may start. An unmeasured initial route or unmeasured same-origin document referrer prevents startup. This intentionally undercounts some visits to preserve privacy.

The opt-out page `/observe/opt-out` is noindex. Choosing opt-out immediately stops the current document even if storage fails; failed persistence is disclosed and can be retried. A full reload is needed to restart tracking after opting back in. The `login` event remains pending a verified one-time server callback receipt; ordinary session presence, URL fragments and user IDs must never manufacture that event.

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
