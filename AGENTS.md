# Agent Notes

These notes are for coding agents and maintainers working inside this repository. The public-facing project overview belongs in `README.md`.

## Project Scope

### Current production state (2026-10-19)

`youtube.observe.tw` runs only the TypeScript platform in `platform/`. Dokploy compose
`youtube-board-ts-6oukfq` holds the web frontend, the account-maintenance responder, a
private Redis, the BullMQ scheduler and one worker per workflow batch (cache,
youtube-live, youtube-source, ai-daily, ai-hourly, ai-mayor, telegram). Each worker
reaches the source database through its own facade schema and DB principal. The
keyword recent matcher and the hourly avatar cache run as systemd timers on the host.

History:

- 2026-10-12: public frontend switched to TypeScript
  (`platform/docs/frontend-cutover-execution-2026-10-12.md`).
- 2026-10-18: every scheduled workflow handed off from the Laravel scheduler to the TS
  workers (`platform/docs/laravel-scheduler-handoff-2026-10-18.md`,
  `platform/docs/scheduler-handoff-record-2026-10-18.md`).
- 2026-10-19: the Laravel web and scheduler services, their Traefik routers and the
  Dokploy application were deleted, and the Laravel code was removed from this
  repository. Laravel-created tables (`cache`, `cache_locks`, `telegram_digest_*`,
  `ingestion_youtube_quota_daily`, …) stay: the TS workers use them. A backup of the
  deleted Dokploy application, router files and service specs is in
  `/root/laravel-retired-20261019` on the host (included in the nightly NAS backup); the
  last deployed Laravel commit was `08fddece4ea500dbd3f7e28911602338ed3428b4`.

Direction:

- TypeScript only. Do not add PHP. New workflows live in `platform/`, aligned with
  tag.observe.tw (Next.js/React, Fastify, Drizzle/MariaDB, Redis/BullMQ).
- AI calls go only through the CLIProxyAPI gateways (blog → SM → sky-mini); never use
  opencode.ai.
- Use tag.observe.tw as the shared content vocabulary source, preserving provenance,
  version and matching evidence; keep YouTube channel taxonomy and news/YouTube metrics
  separate. Windowed article-tag observations are not a complete canonical vocabulary.
- The user chose YouTube red (`#FF0000`) as the brand color on 2026-10-12. Match
  tag.observe.tw's stack and interaction patterns while using red branding; use
  accessible red variants where needed for text contrast.
- The user authorizes parallel agent implementation (up to five collaborators, subject
  to tool limits) and direct CLI Proxy consultation with `claude-opus-5-5` for execution
  advice and feature reviews. Never send secrets in review packets. Only count reviews
  with actual returned text, address findings and execute tests.
- Fix wrong dashboard numbers by repairing the ingestion/cache workflow that owns the
  data, not by importing legacy public-site cache or editing production rows by hand.

Guardrails:

- Protect the legacy public site (`youtube.board.tw`) as a reference system: do not SSH
  into, edit code on, mutate data in, or operate admin tools against it unless the user
  explicitly approves a narrow inspection/export task.
- Production writes happen only through the reviewed TS workflows, migrations, release
  tooling or explicitly approved maintenance tasks. Prefer idempotent commands with
  preview modes, caps, logs, backups or rollback plans.
- Never let two writers run the same workflow at the same time.
- Do not put secrets in code, commits, logs, issues or chat. Runtime secrets belong in
  Dokploy, Swarm secrets or root-only files on the host.
- Local development uses the isolated databases from `platform/compose.yml`. Connect to
  production data only when the user explicitly wants live inspection, with the
  least-privileged access that fits.

## User Operating Preferences

- Releases are manual: pushing to `main` does not deploy. Build the TS image and swap it
  in the Dokploy compose (see `platform/docs/` release records and
  `platform/.local/dokploy/release-all.py`) only with the user's approval.
- Other sessions edit this worktree concurrently: stage exact files, never a directory.
- Confirm with the user before hard-to-reverse actions such as deleting services,
  routers, data or code.
- Prefer Chrome for inspecting the legacy public site (`youtube.board.tw`) because direct
  curl/headless fetches are often blocked by Cloudflare. Do not copy, export or inspect
  Chrome cookies, passwords or session storage.
- Keep responses direct about what was changed, what was pushed and what still depends
  on production runtime state.

## Production Services

Dokploy (`v0.29.10`) on skyhong-blog, project `YouTube Board`, environment `production`:

- `有影儀表板 TS`: compose `youtube-board-ts-6oukfq` (see above). Traefik routes for
  `youtube.observe.tw` are in `/etc/dokploy/traefik/dynamic/youtube-board-ts-cutover.yml`
  (`yt-cutover-public`, `yt-cutover-accounts`, `yt-cutover-http` for http→https).
  Cloudflare fronts the public domain, so check container state on the host when
  verifying a release.
- `YouTube Board DB`: MariaDB `youtube-board-db-qcja1i`, port 3306, database
  `youtube_board` (plus `youtube_board_ts` and the worker facade schemas), volume
  `youtube-board-db-qcja1i-data`. No external port; keep it private. Do not use Dokploy
  "Rebuild Database" without a fresh verified backup and rollback plan.
- `YouTube Board phpMyAdmin`: `youtube-board-pma-dxtxrr` at
  `https://pma-youtube-board.skyhong.tw/`, behind Dokploy basic auth. Do not commit or
  repeat its credentials, and do not use it for manual data changes.

Backups: host `nas-backup.timer` runs daily around 20:25 UTC to GGSS-NAS. The YouTube
job `/etc/nas-backup/jobs/youtube-board.sh` dumps the source, TS and worker facade
schemas and copies the runtime env files; `sudo nas-backup snapshots youtube-board`
lists snapshots and `nas-backup restore <job> <dir>` restores to an isolated directory.
The dump uses `--single-transaction`, which does not make the MyISAM tables consistent:
before a destructive migration, take an additional consistent backup and verify a
restore in isolation. Never log the backed-up env files.

## Development Notes

- See `platform/README.md` for local development and tests.
- Add or update focused tests for each workflow, route or report change.
- `docs/` holds the legacy site inventory and Laravel-period documents; treat them as
  history, not as instructions.
