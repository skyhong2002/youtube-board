# Cutover readiness — 2026-10-12

The latest user authorization permits frontend deployment followed by individual writer handoffs, subject to preserving the production database. **Production routing and workflow ownership have not switched.** Dokploy still redirects the shared browser's project URL to its login page; the user has offered to sign in. No production TS database schema or runtime principal has been created.

## Completed evidence

| Area | Result |
| --- | --- |
| Consistent mixed-engine backup | 66 tables, full isolated11.4.13 restore, all11 manifests match; original/off-host/NAS-restored archive hashes match. [Evidence](production-backup-2026-10-12.md). |
| Current legacy response parity | 36 APIs/72 responses, all200; no new content/numeric/order/status differences.43 exact accepted metadata/content-type differences retained;30 nonempty cases. [Evidence](current-data-parity.md). |
| Final coherent integration | **1,150 passed,0 skipped**: tools90/API649/web93/jobs140/ingestion62/AI61/notifications55. All workspace/runtime typechecks pass. |
| Frozen source | 693 program/config/asset hashes identical before/after tests and in the uploaded ARM build context. Private frozen-manifest SHA-256 `5f79f490da636d373dc33437d66060c72fb03384258e8a59a1bb73351f777afa`. |
| Packaged clone web | 28 pages/probes returned200, maximum2,419ms in sequential checks; includes homepage/ranking/channel/video/live/AI/keywords/search/RSS/sitemap/robots. Additional video analytics/comments/live-period/live-tag checks all200. |
| Legacy redirects | All78 inventoried redirect declarations returned the expected redirect target through the packaged gateway/Next service. |
| Worker startup isolation | All46 worker profiles passed actual MariaDB11.4.13 grant and physical-table mapping checks on the restored clone. Temporary facade/users were removed; source66/state36 table structures and exact counts were unchanged. This verifies startup isolation, not job execution or ownership transfer. |
| Concurrency | After two earlier observed tag-list query timeouts, independent concurrency3 profiling completed162/162 successfully; mixed p95 up to1,383ms, max2,188ms, connection acquisition max57ms. The original timeouts have no established cause and are retained; no timeout relaxation or claimed fix. Live capacity acceptance remains required. |
| OAuth preview | Final packaged start returned302 to Google with the exact Tailscale callback, S256/state/nonce and Secure/HttpOnly flow cookie; no token/code values retained in the summary. Prior2026-10-12 human preview login is recorded separately. Production Console callback registration is user-confirmed. |
| UI and brand | Seven paired comparisons with the mother site, updated channel result rows, selected family/legacy-mark logo, mobile/dark behavior. [Screenshots and differences](ui-comparison-2026-10-12.md). |
| Crawlers | XML sitemap/robots both200;20 canonical stable public routes all200; no invented update times or private-account sitemap entries. [Contract](crawler-metadata.md). |
| Review | Codex33/Opus13 recorded completed nodes (~2.5:1). Latest Opus model verified as claude-opus-5-5/stop; worker findings resolved or explicitly rejected with independent Codex verification. Private records contain dispositions; rejected/truncated attempts are excluded. |

## Candidate artifacts

- Local AMD64 image: `youtube-board-ts:cutover-final-local`, ID `sha256:6db9c5576461b6eff6441626948e675991b8e8b9b362c429be9efb381047158d`. Its228 runtime source/config hashes match the final tested tree; preview environment and read-only media mount fingerprints are unchanged.
- Host ARM64 image: `youtube-board-ts:cutover-20261012-release`, ID `sha256:a200fb01f3a3228f80e413447550e7871056d0bb2db79f4ca9972fb802d51b83`. Built from the verified context SHA-256 `b2e30dc38e1ee21db58b847fef6bd6704eae7f25251ae751d9c4e158b92606bf`.
- The ARM build passed all typechecks and Next build under a dedicated builder capped at1 CPU/3GiB. The builder is stopped after completion; no service was redeployed or routed to this image.
- Both existing Laravel web and scheduler image IDs were captured separately and given retained local tags. They differ despite both using a mutable `:latest` service reference. Do not accidentally roll the scheduler forward during frontend deployment.

Private evidence is under ignored `.local/production-cutover/`, `.local/current-parity/`, `.local/reviews/` and `.local/release-final-*`. No dump, private response capture, runtime credential or review packet belongs in Git or a Docker context. Candidate files were scanned against known environment/preview secret values without printing values; no matches were found.

## Remaining execution gates

Follow [the staged cutover plan](cutover-review-plan.md) and [frontend acceptance checklist](frontend-production-acceptance.md):

1. Establish the authenticated Dokploy operator session, configure the independent TS service and secret environment, and provision the reviewed SELECT-only report/own-state accounts in the separate production schema. Preserve Laravel ops/webhook ingress.
2. Validate the actual temporary ingress, schema grants, Cloudflare→Traefik→Fastify client-IP behavior, CSP/HSTS, private cache exclusions and source-data responses under live capacity. The clone tests do not replace this gate.
3. Prepare and exercise the one-action public route rollback with the separate secret-free account-maintenance responder. Review the concrete routing/service diff before applying it.
4. Switch the public route, repeat acceptance, check sibling sites and the still-running Laravel scheduler. Exercise production OAuth302 with the production callback, then obtain human production reader/admin/logout acceptance.
5. Transfer each background workflow only after its Laravel owner is stopped/drained; use exact restricted credentials, dry-run, bounded execution, parity and one actual scheduled observation. Telegram is last. Preserve external-delivery and quota uncertainty during rollback.
6. Complete recurring consistent backup coverage for both source and TS-owned state before final retirement of old writers. The [recurring backup runbook](recurring-consistent-backup.md) records the remaining multi-schema controller, failure rehearsal and off-host restore acceptance. It is not installed; the current backup tool only supports one schema. The sealed cutover snapshot is not a substitute for recurring consistent backups.

For context, post-backup read-only checks observed `urt_count.mtime` reaching2026-10-12 13:18:06 (after the backup), but maximum `urt_video.mtime` remains2026-07-18 17:35:55. This proves continuing derived-data updates, not fresh YouTube statistics. Provider credentials, quota and source freshness must be verified during the statistics handoff; do not present derived-cache timestamps as source freshness.

[Effective Laravel configuration](laravel-runtime-baseline-2026-10-12.md) was inspected at13:29 Taipei through Laravel itself. The separate scheduler has25 exact allowed workflows and Telegram enabled; web has ingestion/Telegram disabled. Both Telegram dedup stores are database with prefix `youtube-board-cache-`, even though the scheduler's general cache store is file. Recheck these settings and active writers before each transfer.
