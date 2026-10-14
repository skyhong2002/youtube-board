# Production UI review — 2026-10-15 Taipei

These are anonymous **production** captures, separate from candidate acceptance. Production remained APP `335c8dbd023ed1466620b29a4dea6cda9e3cef80`, BUILD_ID `NZua9VnOCd6zsK0BXUoF7`, arm64 image `sha256:cabe15587df1d7dd80c561abe0629ba71a80a0188f402202858b7b60722b69f6`. The two actual named services matched this identity and were healthy before and after capture. No deployment was performed for this review.

## Capture evidence

Our `platform/tools/production-ui-capture.mjs` uses native DNT:1 and Sec-GPC:1 from context creation, with the network guard installed before navigation. Its HTTPS proxy starts before Chromium and permits only the public site and the approved video-thumbnail host; all other destinations are denied before upstream connection. Google analytics attempts/responses were zero. The approved `i.ytimg.com` thumbnail destination is explicitly allowed; this is not a claim that no Google-owned infrastructure was contacted. Raw network preserves request method, public URL, DNT/GPC, resource type, response status and terminal state, without bodies, cookies or secret headers.

Each accepted view includes its full-page PNG, native readable slices, raw and normalized network records, DOM coherence, verified Next BUILD_ID, and the prelaunch proxy receipt. Widths are 1280 and 390; themes light and dark. Home and keywords were captured in both rolling24h (visible label 過去24小時; internal selector `today`) and week states. 柯文哲 videos and mayor use their default visible state. First secondary batch covers `/groups` and `/live/current`.

| Batch | Views | Manifest | SHA256 |
| --- | ---: | --- | --- |
| main-light | 12 | `/home/deck/.cache/youtube-ui-review/production-335c8db-main-light-20261014T192030Z/captures.json` | `5dabf379a805223f45ce6351aa40f7e6e420c70c28671586fc41efc3f07a62a7` |
| main-home-dark | 4 | `/home/deck/.cache/youtube-ui-review/production-335c8db-main-dark-20261014T192240Z/completed-home-only-manifest.json` | `08864b9be181d867bbdc38894a668fffd861abc336e157fe742c5a00daf74c14` |
| main-remaining-dark | 8 | `/home/deck/.cache/youtube-ui-review/production-335c8db-main-dark-remaining-20261014T192820Z/captures.json` | `2aa0dbb5ee2d21c037f5eba23ca9ad4d477a1a1ccb74ef8137a0cc168554ced1` |
| secondary | 8 | `/home/deck/.cache/youtube-ui-review/production-335c8db-secondary-20261014T193015Z/captures.json` | `813a2bc304e619593567a8b980a30408ecaeea2337c7c66d9188fa69a46fbaab` |

Author technical index: `/tmp/babysit/mint-queue/youtube-production-capture-index-335c8db-20261015.json`, SHA256 `805ac5634a5d359acbf63a1d2715017b1f5bbb1c7be14a8def006c16ad300636`. It has 32 accepted views and 242 PNG hashes. It is an immutable capture-time record whose pending review text is superseded only by returned independent review receipts below. Source review fc43909 and error-preservation delta 3e146aa are source-only; they do not constitute visual acceptance.

Post-capture services: `/tmp/babysit/mint-queue/youtube-production-capture-services-after-20261015.json`, SHA256 `1d4d7b2dcc4a6f41e20baa98747d4c81695d03af4f13ab70f50aff11e9fc4fda`. Both actual TS services are healthy with the exact APP/image/BUILD_ID. Local /home available about 57 GiB after capture; capture browsers exited.

## Independent visual review

Existing nonauthor `/root/f2_visual_sol` returned scoped PASS for the 12 main light views. Receipt `/home/deck/.cache/youtube-ui-review/f2_visual_sol-2026-10-14/production-app335c8db-main-light-20261014T193038Z/review.json`, SHA256 `6525b6d34a96121bb50d9abb8bf885b8b135a0ad5d0502e58de10655bf3b6c3f`. Actually opened 52 PNGs (12 full pages, 40 native slices); all 95 hashed, remaining 43 hash-only. No blocker in the stated light views. The subsequent main24 review returned `PASS_SCOPED_PRODUCTION_MAIN_24_ACTUAL_VISUAL`, blockers empty: `/home/deck/.cache/youtube-ui-review/f2_visual_sol-2026-10-14/production-app335c8db-main24-20261014T193550Z/review.json`, SHA256 `200d9d76c1e024fafc0dd7843db8bd9d312cfeb9697a212930261e06c44e1b99`. Actually opened 104 PNGs (24 full pages, 80 native slices); all 190 hashed, other 86 hash-only. Secondary eight views returned `FAIL_SCOPED_PRODUCTION_SECONDARY_VISUAL`; see below. No candidate pass was inherited.

## Limits and preserved failures

Production data is live: different navigations can have different ten-minute cutoffs and totals. Within each view, before/after coherence passed; this batch does not prove one frozen cross-page data snapshot. Keyword raw-pool exclusions, privacy/no-store regression and candidate acceptance have their own earlier receipts and are not inferred solely from these pictures.

The first dark batch completed both home periods, then failed before the keywords-short-dark desktop view completed. Missing privacyAfter caused network rejection; the tool's finally assertion masked the initial failure, so the original cause remains unknown. Failed evidence is preserved and not counted as pass. Error-preservation source delta 3e146aa passed independent review; the remaining eight dark main views were retaken successfully without adding a network exception. A fresh gate showing blog median 6.552891s was rejected; no browser started from that receipt. Retry passed before retake.

Profile video-thumbnail optimizer 404/fallback and aborted requests remain in the network evidence; accepted lifecycle is not a claim that every subrequest succeeded. Static capture does not certify links, mobile swipes, authenticated states, loading/error/empty variants or all mayor cities. Historical findings remain historical until specifically rechecked. Whole-site completion remains pending; F4 waits for tag T-ref.

## Secondary actual-image result

Existing nonauthor reviewer returned FAIL for the eight secondary views: `/home/deck/.cache/youtube-ui-review/f2_visual_sol-2026-10-14/production-app335c8db-secondary-20261014T194210Z/review.json`, SHA256 `6fa0e0efc6238e2736c37e7ecc23419c15fc91a46dac8d3f83525882a0cc7b9a`. Opened 26 PNGs (8 full pages, 18 native slices), all 52 hashed; other 26 hash-only. Capture/privacy technical checks passed, but this is not a visual PASS. Combined independent actual review totals: 32 views, 130 PNGs actually opened, 242 hashes checked, 112 hash-only.

- **Blocking: `/live/current` at390.** Light/dark title column is about60px, only4–5 CJK characters per line; first long row is about430px high. Channel text is clipped. A responsive layout fix needs its own candidate and production retest.
- **Open: `/live/current` at1280.** Rightmost update-time text is cut off in the default view; interaction/scroll reachability remains untested.
- **Open: `/groups`.** Two same-label, same-basis rows show2/7 with no range or counting-unit distinction. Source explains that `two` and `two_all` have two and seven configured subgroups; this is a presentation ambiguity, not proof of incorrect counts. Source read was author analysis, separate from reviewer actual-picture evidence.
- **Open: `/groups`.**2023 update date alongside current-office labels needs freshness clarification; product copy exposes `tag_group`. Verbose repeated mobile labels remain readable and nonblocking.

The main24 scoped PASS remains separate. Other page/state reviews and F4 are pending. Immediate next work is the responsive live list and group scope/unit copy, then another small public-page batch. No new image, build or deployment was created by this capture/review task.
