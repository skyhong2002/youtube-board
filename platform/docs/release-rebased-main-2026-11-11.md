# Rebased main deployment — 2026-11-11

User requested fetching remote changes, inspecting them, rebasing and deploying.

## Integration

Fetched `origin/main` at `49a07bfc1694f10c3e701f33a99877de514caa74`.
Its 13 commits cover scheduler liveness under submission uncertainty/Redis failure, AI daily-refresh
failure stage/run lineage, bounded web liveness checks, and mayor provisional dates shown as dashed lines only.
These features had already been deployed through service-specific overlays.

Rebased the 13 local commits (`5ba0676c` through `99feb1b3`) onto that remote main in the isolated worktree
`/home/sky/Projects/youtube-board-integration-20261111`. No conflicts; `git range-diff` marks every replayed
commit identical. Both the local home method note and remote mayor method note survive.

Added `8c9122791507ec16dbdd29e8d0b7217671d470d6` to type a topic coverage test fixture against `TopicRow`;
this resolves a real full-typecheck failure and matches the existing uncommitted correction in the original worktree.
Pushed the result to `origin/main` with a normal fast-forward push (`49a07bfc` → `8c912279`), without force.
The original local main was moved to that result, preserving byte-identical content for all 53 previously modified
files (the fixture correction is now committed; the remaining branding changes remain uncommitted).
Original history is retained at `backup/pre-nav-rebase-20261111`.

## Validation

- Independent read-only review of remote commits found no conceptual conflicts.
- Full `npm test`: tools 128 pass / 2 skipped; API 939 / 365; web 428 / 2; jobs 356 / 48;
  ingestion 142 / 57; AI 40 / 48; notifications 36 / 42. Zero failures. Database/Redis integration
  suites remain skipped in this command; no full isolated integration claim.
- Full `npm run typecheck` passed after the fixture annotation.
- Candidate image rebuild passed full web tests, web typecheck, Next production build and GA/web-vitals bundle checks.
- Candidate: 17 page/readiness checks plus `/runtime/live` and `/mayor/cities/taipei`, all 200. Rendered menu
  assertions cover taxonomy/search filtering, quarter settings, date budgets and channel single-date precedence.
- All 624 tracked TypeScript/MJS/JSON files under the API, jobs, ingestion, AI, notifications, shared, runtime,
  inventory and tools directories match the rebased checkout in the candidate image.
- Before deployment, hashes of the specific remote/local fixes already live in scheduler, worker-ai-daily,
  worker-youtube-source and web matched the rebased checkout. Those worker services need no restart.

## Image and rollout

Image `youtube-board-ts:release-integrated-8c91227-amd64`:
`sha256:64c599e5d7872a62cae50b2fe88c132240228973b95d270716d07177526f8765`.
Base: preceding report menu web image `sha256:b91cb6efdb5510978ae8c502d9d0abe2e1f20951f038549a88d3d7bafd8f4704`.

Context `/home/sky/yt-release-integrated-20261111`: clean git archive of `8c912279`, with the **already deployed**
Wordmark/site metadata and public brand/favicon assets preserved from the previous published build context.
No new branding edits were included. Runtime source modules are copied from the clean rebased tree;
Next is rebuilt from that same tree plus published branding. Dependencies remain lockfile-compatible.

Guarded `/home/sky/yt-release-integrated-20261111/release-integrated.py --execute` accepted the web-only swap at
2026-11-10 17:25:42 UTC (2026-11-11 01:25:42 Taiwan). It asserted every other service field, top-level compose
field and env unchanged and retained a mode-0600 compose/env/command backup.
No migration, grant, schedule, secret or production data maintenance was performed.

Swarm update completed at 2026-11-10 17:26:10 UTC (01:26:10 Taiwan). Sole web task is healthy on the new image.
Post-release public validation: the same 17 page/readiness checks passed, plus `/runtime/live` and
`/mayor/cities/taipei` both returned 200. Rendered repaired menu URLs passed all assertions.
Temporary candidate container and its private environment file were removed after validation.

## Rollback

`python3 /home/sky/yt-release-integrated-20261111/release-integrated.py --execute --rollback`
restores the preceding web image after a drift check. Private pre-release backup:
`/home/sky/yt-release-integrated-20261111/release-integrated-before-20261110T172542Z.private.json`.
