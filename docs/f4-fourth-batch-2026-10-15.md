# F4 fourth production batch — 2026-10-15

This batch records the DNT=1 production capture of four P0 routes:

- `/ai/aspects`
- `/ai/days`
- `/ai/days/2026-10-12`
- `/ai/hours`

The deployed source was APP `35501a3f269f2818115ea7277c66db765a4e267d`, image `sha256:c2e30339080be1b8679d49277260e48a57ad43b6a700fd8f782054cfae856920`, BUILD_ID `b8g61kyNdOR6Pmo1TWxav`. The fresh probe passed before capture: [fresh-probe.json](/tmp/babysit/mint-queue/youtube-f4-batch4-20261015T065612Z/fresh-probe.json), SHA-256 `68597a64c51ba5e5e4f0dd5e34d2d06f337a74256fe6e61463af9b4400a98bdc`. The complete capture index is [production-capture-index.json](/tmp/babysit/mint-queue/youtube-f4-batch4-20261015T065612Z/production-capture-index.json), SHA-256 `245ac77d1cfbfbe0a441315882313f0ee4ca6ed27fe05ec821da121c79d91e29`.

All 16 requested light/dark × 1280/390 views returned HTTP 200 in the capture manifests. The capture retained DNT/GPC and raw network records; Google attempts/responses were zero according to the capture evidence. The route-selection record preserves two invalid/stale examples: `/ai/events/5533` returned 404, and `/ai/days/5550/events` returned 400 because the route requires an `event` query parameter. The capture tool was not loosened to accept queryless URLs.

## Independent visual review

The existing non-author reviewer `/root/f2_visual_sol` actually opened these four light desktop full-page PNGs and returned `PASS_SCOPED` for each, with no visual blockers:

- `/ai/aspects`: [receipt](</tmp/babysit/mint-queue/youtube-f4-batch4-20261015T065612Z/reviewer-ai-aspects-single.json>), SHA-256 `58eb5dff1bf5510c1bd4bca2caf0a5a11c1bcae671176df4cac0cf4b998e6d02`
- `/ai/days`: [receipt](</tmp/babysit/mint-queue/youtube-f4-batch4-20261015T065612Z/reviewer-ai-days-single.json>), SHA-256 `677d108f9bbfb970ad1f9c9c79c252d7e284e51076514bae7616f8a84ac5d03e`
- `/ai/days/2026-10-12`: [receipt](</tmp/babysit/mint-queue/youtube-f4-batch4-20261015T065612Z/reviewer-ai-day-2026-10-12-single.json>), SHA-256 `df0b3cf7e3b63b2e2eb421ac6a6281fe435e4d12d398a1856fa96952c314dc4c`
- `/ai/hours`: [receipt](</tmp/babysit/mint-queue/youtube-f4-batch4-20261015T065612Z/reviewer-ai-hours-single.json>), SHA-256 `c04bcc814cbdc85716edc5a5e7c59dd361295b0c8d671ee4ba3cfd362deac6f1`

The reviewer did not open the other 12 full-page images, slices, or raw network records. This is therefore a scoped visual review only; it does not complete any route or F4. Dark/mobile variants, interactions, loading/error/empty/denied states, per-statistic freshness, and the known thumbnail source/optimizer 404 remain pending.
