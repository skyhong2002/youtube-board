# F4 fifth production batch — 2026-10-15

Routes captured at light 1280/390: `/ai/periods`, `/live/continuous`, `/live/days`, and `/live/hours`. Runtime identity: APP `35501a3f269f2818115ea7277c66db765a4e267d`, image `sha256:c2e30339080be1b8679d49277260e48a57ad43b6a700fd8f782054cfae856920`, BUILD_ID `b8g61kyNdOR6Pmo1TWxav`.

The fresh three-sample probe passed before capture: [fresh-probe.json](/tmp/babysit/mint-queue/youtube-f4-batch5-20261015T081500Z/fresh-probe.json), SHA-256 `4371726bc5038559f5ac47bec5e199377695078f68b0fa12c5fd4e18ec3f475f`. SM medians were tag 0.264s, blog 3.970s, YouTube 0.197s; all attempts returned HTTP 200 with curl exit 0. Both participating hosts had zero build and browser processes. The capture index is [production-capture-index.json](/tmp/babysit/mint-queue/youtube-f4-batch5-20261015T081500Z/production-capture-index.json), SHA-256 `222aa4992322287deec68c29755e41521899d7d328f2ddb4796c7a4d585f747a`, and the capture manifest SHA-256 is `5869a107b659e22a62aefb96d2251cbdac15c19ba95c6f766293b98d8edfba6f`.

## Review

The existing non-author reviewer `/root/f2_visual_sol` opened one light desktop full-page PNG for each route and returned `PASS_SCOPED`:

- `/ai/periods`: receipt SHA `5e5e7d7e331e2371ccafac1a856f56415baeca67bc2ffc574d021c141d220810`
- `/live/continuous`: receipt SHA `11964cc2ed0c1275054bbfbacea4a51c91c4462232348d17a24e00ec7a841366`
- `/live/days`: receipt SHA `f1a6c755af169ce8f37e604f0ad4b01fe51173e8dcf216135a44eba5bfb7db1e`
- `/live/hours`: receipt SHA `810851a5f1bc65c28580b456cee7ae0e0b56276c00d9fcd80bf8237b3297047e`

Receipts are in `/tmp/babysit/mint-queue/youtube-f4-batch5-20261015T081500Z/`. Mobile and dark views, the other four captured full-page images, slices, raw network, and interaction/error/loading/empty/auth states were not independently reviewed. No route or full F4 completion is claimed.
