# Agent Notes

These notes are for coding agents and maintainers working inside this repository. The public-facing project overview belongs in `README.md`.

## Project Scope

This repository modernizes the public YouTube Board experience in Laravel as a real-time YouTube data dashboard. Data capture, cache rebuilding, scheduled polling, AI generation, and report rendering are in scope when they run through reviewed Laravel commands, public HTTP responses, approved legacy snapshots, approved DB exports, or explicitly approved production inspection/export tasks.

Guardrails:

- Do not SSH production unless the user explicitly approves an inspection/export task.
- Do not write production DBs.
- Do not run production migrations.
- Do not put secrets in code.
- Do not edit production code or operate phpMyAdmin to change production data.
- Local data import, local cache building, and local ingestion smoke tests may write only to local development databases.
- Polling, cache generation, and AI generation are first-class workflows, but production execution must remain controlled by env gates, allowlists, backups, rollback plans, and explicit operator approval.

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

Observed Dokploy state as of 2026-05-26:

- Dokploy version: `v0.29.5`.
- Project: `YouTube Board`.
- Environment: `production`.
- Server: `Dokploy Server`.
- Services:
  - `YouTube Board Web`: Laravel application for `youtube-board.skyhong.tw`; container/service name `youtube-board-web-mwafzd`.
  - `YouTube Board DB`: persistent MariaDB database; container/service name `youtube-board-db-qcja1i`.
  - `YouTube Board phpMyAdmin`: protected phpMyAdmin for the MariaDB service; container/service name `youtube-board-pma-dxtxrr`.

Production service notes:

- Web service source is Git over SSH: `git@github.com:skyhong2002/youtube-board.git`.
- Web service branch is `main`.
- Web service uses the `youtube-board deploy key` SSH key in Dokploy.
- Web service build type is `Dockerfile`, with Docker file `Dockerfile` and context `.`.
- Web service autodeploy is enabled.
- Web service has clean-cache disabled.
- Web service domain is `https://youtube-board.skyhong.tw/`, path `/`, container port `8000`, HTTPS via `letsencrypt`.
- Web Traefik routes redirect HTTP to HTTPS and forward HTTPS to `http://youtube-board-web-mwafzd:8000`.
- Web service has no Dokploy basic auth, no extra exposed ports, no redirects, and no volumes configured.
- Web service resource limits are currently 1 GB memory limit, 256 MB memory reservation, 2 CPU limit, and 1 CPU reservation.

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
- Current non-secret values include `APP_ENV=production`, `APP_DEBUG=false`, `APP_URL=https://youtube-board.skyhong.tw`, `APP_LOCALE=zh_TW`, `APP_FALLBACK_LOCALE=en`, `LOG_CHANNEL=stderr`, `LOG_LEVEL=info`, `CACHE_STORE=file`, `QUEUE_CONNECTION=sync`, `SESSION_DRIVER=file`, `SESSION_SECURE_COOKIE=true`, `FILESYSTEM_DISK=local`, `DB_CONNECTION=mysql`, `DB_HOST=youtube-board-db-qcja1i`, `DB_PORT=3306`, `DB_DATABASE=youtube_board`, `DB_USERNAME=youtube_board`, `LEGACY_PUBLIC_SITE_URL=https://youtube.board.tw`, `INGESTION_SCHEDULER_ENABLED=false`, `INGESTION_TIMEZONE=Asia/Taipei`, `PORT=8000`, `OPENAI_BASE_URL=https://opencode.ai/zen/go/v1`, and `OPENAI_MODEL=qwen3.6-plus`.
- Current secret-bearing values are configured in Dokploy and must stay redacted in git: `APP_KEY`, `DB_PASSWORD`, `YOUTUBE_API_KEY`, `OPENAI_API_KEY`, `DOKPLOY_DEPLOY_WEBHOOK_URL`, and `DOKPLOY_DEPLOY_RELAY_SECRET`.
- `DOKPLOY_DEPLOY_WEBHOOK_URL` points at the Dokploy deploy endpoint for `YouTube Board Web`; never commit the full webhook token URL.
- `DOKPLOY_DEPLOY_RELAY_SECRET` is configured for the app-side deploy relay; never print or commit it.
- Dokploy "Create Environment File" is enabled for the web service.
- Dokploy currently has placeholder `NPM_TOKEN=xyz` entries in build-time arguments and build-time secrets. Treat these as non-runtime placeholders unless intentionally replaced.

Production scheduler status:

- `INGESTION_SCHEDULER_ENABLED=false` in the current Dokploy web environment.
- Production ingestion/polling is controlled by scheduler and polling env gates even though `YOUTUBE_API_KEY` and OpenAI-compatible env vars are configured.
- To activate or adjust production polling, follow `docs/deployment.md` and `docs/legacy-inventory/scheduler-activation.md`; require a DB backup, rollback point, exact `INGESTION_SCHEDULED_WRITE_ALLOWLIST`, and explicit operator approval before enabling write/API jobs.

Deployment operations:

- Prefer Dokploy Deploy/Reload/Rebuild controls for production changes.
- The web service Deployments tab exposes a Dokploy deploy webhook URL; do not paste the full URL into commits, issues, logs, or chat unless explicitly rotating/reconfiguring secrets.
- Latest observed web deployment on 2026-05-26 was successful for commit `278c8c2c834b3d4aa701da7e8535329af92c0fa9` (`Fix real-time dashboard report cache fallbacks`).
- If changing resource limits, volumes, Traefik config, basic auth, or cluster settings in Dokploy, redeploy afterward for the change to apply.
- Keep `deploy/dokploy-env.example`, `deploy/dokploy-mariadb-env.example`, and `deploy/dokploy-phpmyadmin-env.example` aligned with the production shape, but never copy production secret values into those files.

## Development Notes

- Keep rebuilt public report slices aligned with the real-time YouTube data dashboard direction.
- Prefer local MariaDB, approved data exports, and public-site behavior checks when validating reports.
- When fresh production data is needed, prefer narrow controlled exports that are documented in `docs/legacy-inventory/db-dumps.md`; do not use production SSH or phpMyAdmin for manual edits.
- Add or update focused feature tests for each route/controller/service/view slice.
- Update `docs/legacy-inventory/feature-parity.md` and `docs/legacy-inventory/routes.md` when behavior changes.
- Do not commit secrets from `.env`; `.env.example` is the safe template.
