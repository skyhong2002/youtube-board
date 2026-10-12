# Mobile images and LCP — 2026-10-13 Taipei

Application release `cd65a1b` is deployed at https://youtube.observe.tw/. Actual frontend work was implemented by Claude Opus5.5 (two completed CLI results); Codex implemented the bounded asset pipeline, independently reviewed it, tested and deployed it.

## Measurements

The provided PSI mobile baseline was 82 points, LCP 5.0 s, potential image savings 770 KiB. At the user's request we did **not** rerun a baseline. FCP/CLS/TBT baseline values were not provided. After deployment, Lighthouse 13.0.1 mobile/simulated throttling ran sequentially against production using a fresh headless Chromium document for each run. Low priority, three-core CPU affinity; no parallel build. PSI's public API had returned 429, so the after measurements use local Lighthouse. These environments differ; do not describe the comparison as a controlled same-machine experiment. There is no lab INP measurement and TBT is not INP.

| Metric | Provided baseline | Run 1 | Run 2 | Run 3 | After median |
| --- | ---: | ---: | ---: | ---: | ---: |
| Performance | 82 | 97 | 97 | 98 | 97 |
| LCP, seconds | 5.0 | 2.250 | 2.406 | 2.164 | 2.250 |
| FCP, seconds | Not provided | 1.217 | 1.148 | 1.116 | 1.148 |
| CLS | Not provided | 0.000802 | 0.000802 | 0.000802 | 0.000802 |
| TBT, milliseconds | Not provided | 132.5 | 76 | 89 | 89 |
| Potential image savings | 770KiB | 25KiB | 25KiB | 25KiB | 25KiB |

Run timestamps UTC: 2026-10-12 17:23:27,17:23:49,17:24:15. Raw JSON, logs, screenshots and receipts remain in ignored `platform/.local/`.

## LCP and images

Actual LCP is the focus-topic hero thumbnail. It is SSR-discoverable and already preloaded/eager/high priority; these protections are retained. All three Lighthouse LCP-discovery audits passed. The changes reduce competing avatar transfer bytes and give hero/story/live thumbnails sizes derived from actual layout and cover cropping. Nonhero images remain lazy; avatar dimensions and thumbnail aspect ratios remain reserved. Unsized-image audits passed all three runs.

The original 16px avatars loaded 192px PNG files. 47 existing cache entries were converted offline into immutable 48/96/192px WebP variants using one paced worker with no network or database access. Source manifest and every original PNG hash were unchanged. Original PNG bytes total 2,834,623; all 47 variants at 48px total 41,178; 96px 100,434; 192px 209,744.48px transfer size is 98.5% smaller for this sample. The public request path only reads bounded precomputed files; it does not encode images.

The browser chooses WebP via picture/srcset, retries original PNG on derivative failure, then preserves the text placeholder if both fail. An injected WebP 404 on production was verified to recover via PNG; 390px light/dark screenshots have no whole-page horizontal overflow or application execution errors. Video mqdefault sources are 320×180: cover-crop sizing can still select the 640 URL on high-DPR phones, but Next never upscales the original, so the delivered source remains 320px. We retain sharp cover crops rather than reducing them below the required pixels.

## Safety and operations

Validation: 28 focused jobs tests, 3 media API tests, 185 frontend tests; typechecks/build pass. Independent review adopted cancellation propagation through encoding and manifest publication, and documented crash-recovery precautions for immutable hard links. Canary validated media files, public API, hash CSP and all 17 nonempty sitemap children; maximum canary memory 433,324,032 bytes. Production image `sha256:5160b4c7261afdf3ecdf31e02825d84dc8806dc5b643b320b95e28fe1fa763f9` retains original PNGs, has no DB migrations, and changes no scheduler ownership or runtime env.

Postdeployment homepage probes: three Cloudflare HIT responses 28/31/34ms TTFB, Age 31–33. The cached upstream x-nextjs-cache:MISS describes the earlier cache fill, not a new render for each Cloudflare hit. The earlier reported 3.3s request has no corresponding trace, so its cause cannot be conclusively assigned to cold ISR. tag.observe.tw and blog.observe.tw both 200; Laravel scheduler remained running 35 hours.

Rollback via Dokploy: restore the API release image `sha256:4df04a07b8207c64f206431257f0841db168ba2af334c9a43051d46f7bf97dee` for both TS services and deploy, preserving env. Added derivative assets can remain; original PNG paths still work. Only newly generated packaging/build temporary files may be cleaned; existing worktrees, dependencies and backups remain protected by the user's instruction.
