# Agent Notes

These notes are for coding agents and maintainers working inside this repository. The public-facing project overview belongs in `README.md`.

## Project Scope

This repository modernizes the public YouTube Board experience in Laravel as a real-time YouTube data dashboard. Data capture, cache rebuilding, scheduled polling, AI generation, and report rendering are in scope when they run through reviewed Laravel commands, public HTTP responses, approved legacy snapshots, approved DB exports, or explicitly approved production inspection/export tasks.

Current product direction:

- Treat the Laravel app as the system of record for ongoing data capture and derived dashboard caches.
- Do not rely on scraping or importing legacy public-site cache as the normal fix for parity gaps. Legacy pages are useful for behavior comparison, but durable fixes should make Laravel ingestion fetch source data and rebuild local caches itself.
- High-volume tag reports, such as `/tags/102/days` for 每日新聞頻道, require paginated YouTube uploads crawling plus `urt_show_tag_date` rebuilds. The relevant workflow is `youtube:tag-videos:backfill`, followed by or including tag-date cache rebuild.
- Public report parity should come from reviewed commands, scheduler jobs, and local/prod database tables managed by Laravel, not one-off manual database edits.

Guardrails:

- Protect the legacy public site (`youtube.board.tw`) as a reference system: do not SSH into, edit code on, mutate data in, or operate admin tools against the legacy website unless the user explicitly approves a narrow inspection/export task.
- Treat the Laravel production app (`youtube.observe.tw`) as the active system of record for ongoing YouTube data capture, cache rebuilding, polling, AI generation, and report serving.
- Production writes to the Laravel database are allowed only through reviewed Laravel commands, scheduler jobs, ingestion dashboards, migrations, deploy workflows, or explicit operator-approved maintenance tasks. Prefer idempotent commands with dry-run/preview modes, caps, logs, backups or rollback plans, and clear operator intent.
- Do not make one-off manual production DB edits as a substitute for ingestion/cache workflow fixes. If data needs to change regularly, implement or repair the Laravel command/job that owns that data.
- Do not put secrets in code, commits, logs, issues, or chat. Runtime secrets belong in Dokploy/env configuration.
- Local data import, local cache building, and local ingestion smoke tests may write to local development databases. Local development may connect to Laravel production data only when the user explicitly wants live production inspection/debugging; use the least-privileged access that still fits the task, and avoid running destructive commands accidentally.
- Polling, cache generation, and AI generation are first-class production workflows for this project. Production execution should remain controlled by env gates, allowlists, backups, rollback plans, and explicit operator approval when expanding or changing write-capable jobs.

## User Operating Preferences

- The user expects agents to implement the actual ingestion/cache workflow when a dashboard number is wrong, not just explain that local data is missing.
- When the user asks to enable a production job and the change is an env allowlist/gate change, use the Dokploy UI through Chrome if explicitly requested; do not print secret values or webhook URLs.
- On SkyLabMac, use `@chrome` for authenticated Dokploy UI work when the task requires it; the user has confirmed that Chrome is signed in there. Do not copy, export, or inspect Chrome cookies, passwords, or session storage. An authenticated browser session does not by itself authorize a production write; keep the existing operator-approval guardrails.
- Prefer Chrome for inspecting the legacy public site (`youtube.board.tw`) because direct curl/headless fetches are often blocked by Cloudflare. Use Chrome page text/DOM screenshots for legacy behavior comparisons when available.
- If code changes are needed for production, commit and push to `main`; Dokploy autodeploy watches the GitHub repository.
- If a production runtime env change is saved in Dokploy, use Dokploy Reload/Deploy controls as appropriate so the running container picks up the new env. Use Reload when code is already deployed and only runtime env changed.
- Keep responses direct about what was changed, what was pushed, and what still depends on Dokploy/runtime state.

## Local Workflow

Start the app:

```bash
docker compose up -d --build
```

Use the running app container for day-to-day commands:

```bash
docker compose exec app php artisan route:list
docker compose exec app php artisan test
```

Install dependencies only if the local checkout is missing `vendor/` or `node_modules/`:

```bash
docker compose run --rm app composer install
docker compose run --rm app npm install
```

Run migrations for a fresh local database:

```bash
docker compose run --rm app php artisan migrate
```

## Implemented Surfaces

Implemented real-time dashboard surfaces include:

- Home and keyword/tag pages: `/`, `/keywords`, `/tags/{tagId}/channels`, `/tags/{tagId}/videos`, `/tags/{tagId}/comments`, `/tags/{tagId}/cloud`, `/tags/{tagId}/days`, `/tags/{tagId}/trends`, `/tags/compare`.
- Keyword pages: `/keywords/{keyword}/videos`, `/keywords/{keyword}/cloud`, `/keywords/{keyword}/days`, `/keywords/{keyword}/groups/trends`, `/keywords/{keyword}/live/trends`.
- Channel pages: `/channels/{u_id}`, `/channels/{u_id}/videos`, `/channels/{u_id}/comments`, `/channels/{u_id}/cloud`, `/channels/{u_id}/trends`, `/channels/{u_id}/people`, `/channels/{u_id}/ai`, `/channels/{u_id}/ai/days`, `/channels/{u_id}/prompt`.
- Live pages: `/live/current`, `/live/days/{date}`, `/live/periods`, `/live/channels`, `/live/hours`, `/live/tags`, `/live/trends/daily`, `/live/groups/{group}/hours`, `/live/walls/{variant}`.
- AI pages: `/ai/days`, `/ai/hours`, `/ai/periods`, `/ai/events/{id}`, `/ai/events/{id}/people`, `/ai/events/{id}/wall`, `/ai/aspects`.
- Group/mayor/video/comment reports: `/groups`, `/groups/{groupName}`, `/groups/{groupName}/ranking`, `/groups/{groupName}/trends`, `/groups/{groupName}/live`, `/mayor`, `/mayor/cities/{city}`, `/videos/{videoId}`, `/videos/{videoId}/analytics`, `/comments/authors/{authorKey}`.
- Legacy compatibility redirects for top-level PHP URLs such as `/live.php`, `/rank.php`, `/tag_group.php`, `/group_two.php`, `/channel.php`, `/ch/{u_id}/...`, `/ai_day.php`, and related legacy paths.
- Live compatibility API routes under `/api/*.php`.
- Guarded legacy mutating routes under `/redir/{script}.php` and `/prompt/{script}.php`.

Feature parity notes are tracked in:

- `docs/legacy-architecture-report.md`
- `docs/legacy-inventory/feature-parity.md`
- `docs/legacy-inventory/routes.md`

## Testing

Run the full suite:

```bash
docker compose exec app php artisan test
```

Useful focused suites:

```bash
docker compose exec app php artisan test tests/Feature/LegacyRedirectTest.php
docker compose exec app php artisan test tests/Feature/LegacySurfaceInventoryTest.php
docker compose exec app php artisan test tests/Feature/Reports
docker compose exec app php artisan test tests/Feature/Ops
```

The suite covers real-time dashboard behavior, compatibility redirects, legacy API payload shapes, cache-miss behavior, ingestion execution paths, and writeback/prompt guards.

## Legacy Ingestion Jobs

Scheduled and maintenance flows are represented as Laravel ingestion commands and `/ops/ingestion` pages.

Open:

```text
http://127.0.0.1:8080/ops/ingestion
```

Most commands support dry-run inspection and opt-in `--execute` modes. Local execute modes are available for smoke tests and cache/data refreshes, but they require explicit flags, local credentials, and guardrail checks. Production scheduler polling is controlled by environment gates and allowlists.

Useful commands:

```bash
docker compose exec app php artisan ingestion:list
docker compose exec app php artisan ingestion:run --dry-run
docker compose exec app php artisan youtube:tag-videos:backfill --tagid=102 --days=2
docker compose exec app php artisan ai:daily
docker compose exec app php artisan ai:hourly
docker compose exec app php artisan youtube:channels:stats
docker compose exec app php artisan youtube:live:poll
docker compose exec app php artisan youtube:comments:queue
```

## Production Deployment

Current production is managed in Dokploy:

```text
http://skyhong-blog.tailf76d1d.ts.net:3000/dashboard/project/93GHkfiDfvqUbbw7ya-8J/environment/b7C5wXwWGQJDwReDQHGkG
```

Dokploy platform and service layout was first observed on 2026-05-31. The current application, scheduler, and AI provider state below was operator-confirmed on 2026-07-16:

- Dokploy version: `v0.29.10`.
- Project: `YouTube Board`.
- Environment: `production`.
- Server: `Dokploy Server`.
- Services:
  - `YouTube Board Web`: Laravel application for `youtube.observe.tw`; container/service name `youtube-board-web-mwafzd`.
  - `youtube-board-scheduler`: separate Swarm service that runs the schedule loop (`while true; do php artisan schedule:run; sleep 60; done`) using the web service's image tag (`youtube-board-web-mwafzd:latest`) with a command override. It does NOT follow web deploys: it keeps its old container (and therefore old code) until restarted. After every code release, run `docker service update --force youtube-board-scheduler` on the Dokploy host (or deploy it in Dokploy) so scheduled jobs pick up the new image. Its service-level healthcheck was disabled on 2026-08-26 (`--no-healthcheck`) because the image healthcheck targets the web server. (A 2026-08-22 note here claimed the separate scheduler no longer existed — that was a misreading of the Dokploy UI; host inspection shows the service.)
  - `YouTube Board DB`: persistent MariaDB database; container/service name `youtube-board-db-qcja1i`.
  - `YouTube Board phpMyAdmin`: protected phpMyAdmin for the MariaDB service; container/service name `youtube-board-pma-dxtxrr`.

Production service notes:

- Web service source is Git over SSH: `git@github.com:skyhong2002/youtube-board.git`.
- Web service branch is `main`.
- Web service uses the `youtube-board deploy key` SSH key in Dokploy.
- Web service build type is `Dockerfile`, with Docker file `Dockerfile` and context `.`.
- Web service autodeploy is enabled.
- Web service has clean-cache disabled.
- Web service domain is `https://youtube.observe.tw/`, path `/`, container port `8000`, HTTPS via `letsencrypt`. As observed on 2026-08-25, Cloudflare also fronts the public domain (responses carry `server: cloudflare`), so origin response headers are partially rewritten.
- The container serves the app with FrankenPHP (`frankenphp php-server`); before 2026-08-26 it used `php artisan serve`, whose near-serial request handling caused multi-second tail latency and uptime-probe timeouts. The first FrankenPHP deploys (2026-08-25, `8e1db86`) silently rolled back: the frankenphp base image's HEALTHCHECK probes the Caddy admin API on :2019, which `php-server` mode disables, so Swarm killed the healthy container after ~90s and kept the old task (deploys are start-first with `FailureAction: rollback`). Fixed by overriding the image HEALTHCHECK to probe Laravel's `/up` (`4ef5968`, refined for the scheduler container in `4dbebd9`).
- When verifying a release, check container state on the Dokploy host (`docker ps`, process list, code in the container) — public response headers are rewritten and cached by Cloudflare and can misleadingly show fresh `Last-Modified` values.
- Web Traefik routes redirect HTTP to HTTPS and forward HTTPS to `http://youtube-board-web-mwafzd:8000`.
- Web service has no Dokploy basic auth, no extra exposed ports, no redirects, and no volumes configured.
- Web service resource limits are currently 1 GB memory limit, 256 MB memory reservation, 2 CPU limit, and 1 CPU reservation.
- On 2026-08-22 the web service (which now also hosts the scheduler task) was redeployed to commit `19df26fd9db16159a051869e3b6ecbfc5785759f`, operator-session-confirmed `done` in Dokploy; later documentation-only commits may produce a newer image SHA without changing runtime code.

Database service notes:

- MariaDB internal host is `youtube-board-db-qcja1i`.
- Internal port is `3306`.
- Database name is `youtube_board`.
- Database user is `youtube_board`.
- External database port is not configured; keep production DB private unless explicitly approved.
- Persistent volume `youtube-board-db-qcja1i-data` is mounted at `/var/lib/mysql`.
- Dokploy backups are not configured because no S3 destination/provider is configured.
- Database service resource limits are currently 1 GB memory limit, 256 MB memory reservation, 2 CPU limit, and 1 CPU reservation.
- Do not use Dokploy "Rebuild Database" unless a fresh backup and rollback plan have been verified.

phpMyAdmin service notes:

- phpMyAdmin uses Docker image `phpmyadmin:5-apache`.
- phpMyAdmin domain is `https://pma-youtube-board.skyhong.tw/`, path `/`, container port `80`, HTTPS via `letsencrypt`.
- phpMyAdmin connects to `PMA_HOST=youtube-board-db-qcja1i`, `PMA_PORT=3306`, `PMA_USER=youtube_board`, `UPLOAD_LIMIT=256M`.
- phpMyAdmin has Dokploy basic auth enabled. Do not commit or repeat its username/password values.
- phpMyAdmin Traefik HTTPS route uses `auth-youtube-board-pma-dxtxrr` middleware and forwards to `http://youtube-board-pma-dxtxrr:80`.
- phpMyAdmin has no extra exposed ports, redirects, or volumes configured.
- phpMyAdmin resource limits are currently 1 GB memory limit, 256 MB memory reservation, 2 CPU limit, and 1 CPU reservation.

Production app environment:

- Runtime env is configured in Dokploy, not in git.
- As of 2026-10-01, web and scheduler use the private Codex CLI gateway: `OPENAI_BASE_URL=http://172.19.0.1:8321/v1`, `OPENAI_MODEL=gpt-6.1-sol`, and an empty `OPENAI_FALLBACK_API_KEY`. Telegram must separately set `TELEGRAM_OPENAI_BASE_URL` to the same gateway and `TELEGRAM_OPENAI_MODEL=gpt-6.1-sol`. Both key fields contain the private gateway secret, not an OpenAI Platform key. See `docs/codex-gateway.md`; preserve these values on deployment/recreation.
- Other current shared non-secret values include `APP_ENV=production`, `APP_DEBUG=false`, `APP_URL=https://youtube.observe.tw`, `APP_LOCALE=zh_TW`, `APP_FALLBACK_LOCALE=en`, `LOG_CHANNEL=stderr`, `LOG_LEVEL=info`, `CACHE_STORE=file`, `QUEUE_CONNECTION=sync`, `SESSION_DRIVER=file`, `SESSION_SECURE_COOKIE=true`, `FILESYSTEM_DISK=local`, `DB_CONNECTION=mysql`, `DB_HOST=youtube-board-db-qcja1i`, `DB_PORT=3306`, `DB_DATABASE=youtube_board`, `DB_USERNAME=youtube_board`, `LEGACY_PUBLIC_SITE_URL=https://youtube.board.tw`, `INGESTION_TIMEZONE=Asia/Taipei`, and `PORT=8000`.
- Current secret-bearing values are configured in Dokploy and must stay redacted in git: `APP_KEY`, `DB_PASSWORD`, `YOUTUBE_API_KEY`, `OPENAI_API_KEY`, `OPENAI_FALLBACK_API_KEY`, `DOKPLOY_DEPLOY_WEBHOOK_URL`, and `DOKPLOY_DEPLOY_RELAY_SECRET`.
- During the 2026-07-15 provider switch, omitted `DB_CONNECTION`, `DB_PORT`, and `DB_PASSWORD` values briefly caused a web 502. They were restored from the healthy scheduler configuration, the persistent Dokploy env was repaired, and a protected out-of-repository Production env backup was created. Never copy that backup or its values into git or logs.
- After the 2026-07-16 rollout, `DB_CONNECTION`, `DB_PORT`, and `DB_PASSWORD` were reverified as present in the persistent Web env and exactly equal in the running Web and scheduler containers without printing their values.
- The Web and scheduler currently have different non-empty `YOUTUBE_API_KEY` values. The scheduler credential returns sanitized expired-key failures, so YouTube-backed source polling and downstream AI remain fail-closed. Rotating or synchronizing either credential still requires explicit operator approval; never inspect or print either value.
- Historical (2026-07-15): direct OpenAI succeeded while OpenCode Go hit monthly quota. This was superseded by the 2026-10-01 Codex cutover after the Platform account was deactivated. Verify actual inference in both web and scheduler, plus the separate Telegram AI client; CLI login status alone is insufficient.
- `DOKPLOY_DEPLOY_WEBHOOK_URL` points at the Dokploy deploy endpoint for `YouTube Board Web`; never commit the full webhook token URL.
- `DOKPLOY_DEPLOY_RELAY_SECRET` is configured for the app-side deploy relay; never print or commit it.
- Dokploy "Create Environment File" is enabled for the web service.
- Dokploy currently has placeholder `NPM_TOKEN=xyz` entries in build-time arguments and build-time secrets. Treat these as non-runtime placeholders unless intentionally replaced.

Production scheduler status:

- `INGESTION_SCHEDULER_ENABLED=true`, `INGESTION_LOCAL_POLLING_ENABLED=true`, and `INGESTION_PRODUCTION_POLLING_ENABLED=true` remain enabled, and the dedicated `youtube-board-scheduler` Swarm service evaluates Laravel due jobs every minute (see the service notes above for its deploy caveat).
- Because the scheduler did not follow web deploys, scheduled jobs (including AI generation) ran the 2026-08-01 image until the scheduler was force-updated on 2026-08-26 — data-quality changes shipped in between only took effect from that date.
- `INGESTION_SCHEDULED_WRITE_ALLOWLIST` is configured in Dokploy and includes `ai.daily` and `ai.hourly` as of 2026-07-16. Do not print the full env block because it also contains secrets.
- Production ingestion/polling is controlled by scheduler and polling env gates plus the allowlist. New write/API jobs must still be explicitly allowlisted before scheduled execute mode can run.
- To adjust production polling, follow `docs/deployment.md` and `docs/legacy-inventory/scheduler-activation.md`; require an exact `INGESTION_SCHEDULED_WRITE_ALLOWLIST`, a rollback plan, and explicit operator approval before adding new write/API jobs.

Deployment operations:

- Prefer Dokploy Deploy/Reload/Rebuild controls for production changes.
- The web service Deployments tab exposes a Dokploy deploy webhook URL; do not paste the full URL into commits, issues, logs, or chat unless explicitly rotating/reconfiguring secrets.
- Latest confirmed application-code release on 2026-08-26 is commit `4dbebd9` (`Skip the /up healthcheck for non-server containers`), verified on the Dokploy host via healthy task state with `frankenphp php-server` as PID 1. Use the Dokploy deployment record for the exact current image commit when documentation-only commits follow it.
- Autodeploy chain: a GitHub `push` webhook posts to `https://youtube.observe.tw/ops/deploy/dokploy` (route `ops/deploy/dokploy`, HMAC-verified against `DOKPLOY_DEPLOY_RELAY_SECRET`), and the app relays `main`-branch pushes to `DOKPLOY_DEPLOY_WEBHOOK_URL`.
- Autodeploy silently broke between 2026-08-01 15:25 and 2026-08-02: the GitHub webhook pointed at the dead domain `youtube-board.skyhong.tw`, and the running web container was missing `DOKPLOY_DEPLOY_RELAY_SECRET` (the relay route 404s when that env is absent). Fixed on 2026-08-22 by repointing the webhook to `youtube.observe.tw`, rotating the relay secret on both sides, and adding the env var; an end-to-end webhook redelivery returned 200 and deployed. If pushes stop deploying, check the GitHub webhook deliveries and the relay endpoint status code first (404 = env missing, 403 = signature mismatch).
- On 2026-05-31, Dokploy env was updated through Chrome to add `youtube.tag_videos.backfill` to `INGESTION_SCHEDULED_WRITE_ALLOWLIST`, then the web application was reloaded successfully.
- If changing resource limits, volumes, Traefik config, basic auth, or cluster settings in Dokploy, redeploy afterward for the change to apply.
- Keep `deploy/dokploy-env.example`, `deploy/dokploy-mariadb-env.example`, and `deploy/dokploy-phpmyadmin-env.example` aligned with the production shape, but never copy production secret values into those files.

## Development Notes

- Keep rebuilt public report slices aligned with the real-time YouTube data dashboard direction.
- Prefer local MariaDB, approved data exports, and public-site behavior checks when validating reports.
- When fresh Laravel production data is needed locally, prefer narrow controlled exports documented in `docs/legacy-inventory/db-dumps.md`, or explicitly approved read/live inspection. Do not use phpMyAdmin or direct SQL for one-off production data fixes; repair the Laravel ingestion/cache workflow instead.
- Add or update focused feature tests for each route/controller/service/view slice.
- Update `docs/legacy-inventory/feature-parity.md` and `docs/legacy-inventory/routes.md` when behavior changes.
- Do not commit secrets from `.env`; `.env.example` is the safe template.
