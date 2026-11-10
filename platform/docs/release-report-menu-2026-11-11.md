# Report menu compatibility release — 2026-11-11

Web-only release on sky-server, accepted 2026-11-10 16:39:19 UTC and completed 16:39:47 UTC
(2026-11-11 00:39 Taiwan time). User explicitly authorized overall inspection and deployment.

## Changes

Commits `adb7c02` and `9a998307198d7f4d13a3690a12979864f5a4dab0`:

- Daily live trends drop unsupported taxonomy/search filters when entered from sibling reports;
  same-page links retain period, group, metric and end-day controls.
- Live tag reports drop unsupported search text. Every live report keeps only its own controls;
  single-day selections survive the active menu link.
- Cross-report live ranges respect destination limits. An oversized interval becomes its endpoint day;
  daily-only `from=year` is dropped on incompatible destinations, endpoint-only live list links get
  a matching start, and open-start cross-page ranges are anchored to the selected start day.
- Live channel single-date precedence is reflected in sibling menu links.
- Tag trends also normalize their accepted reversed boundaries for sibling pages, drop unsupported
  `from=year`, and use the endpoint day when the daily report cannot accept the full interval.

API validation remains strict; direct URLs containing unsupported parameters still return an invalid-query
response. The repaired menus generate supported URLs.

## Build and verification

Image `youtube-board-ts:release-live-nav-final-amd64`:
`sha256:b91cb6efdb5510978ae8c502d9d0abe2e1f20951f038549a88d3d7bafd8f4704`.
Base: live `4003f84` image `sha256:9fb607b6d4b32b42ae8f71c195575fdcbad3e061cb599cb258c6e496b301df40`.

Build context `/home/sky/yt-release-live-nav-adb7c02` reuses the archived source context of the live mayorquiet
release and overlays only `report-navigation.ts` and its tests. This preserves already-deployed source/branding
without including concurrent changes in this worktree. Final runtime inherits the live API and workflows;
only the rebuilt Next output/public assets are copied. GA measurement ID and web-vitals bundle checks passed.

- Independent agent audit covered live, taxonomy, channel, keyword, group and AI menu contracts; findings addressed.
- 15 focused navigation tests passed; full web suite and typecheck passed in the image build.
- Final local web suite: 426 passed, 2 previously skipped, 0 failed.
- 41 focused live API tests passed (4 suites; no database integration claimed).
- All 48 daily period/group/metric combinations returned 200 with one correct active item per control row.
- Candidate and production: 17 checks each, all 200, with assertions against rendered menu URLs for taxonomy
  filters, search, quarter controls, year ranges, oversized intervals, channel date precedence and tag daily limits.
- Production Swarm update completed; sole web container healthy on the new image.

## Deployment and rollback

Guarded script: `/home/sky/yt-release-live-nav-adb7c02/release-live-nav.py`.
Dry-run asserted only `web.image` changes. Execute backed up compose/env/command in a mode-0600 private file,
checked all other service/top-level fields and env unchanged, and requested deployment through Dokploy.
Workers, scheduler, secrets, grants, database and schedules were not changed.

Rollback: `python3 /home/sky/yt-release-live-nav-adb7c02/release-live-nav.py --execute --rollback`.
This restores the previous web image after a drift check. Private pre-release backup:
`/home/sky/yt-release-live-nav-adb7c02/release-live-nav-before-20261110T163919Z.private.json`.

Code and this record are committed locally. No Git push: local main and origin/main were already divergent;
this release did not alter that unrelated history.
