# Deployment

## Dokploy Production Services

The production deployment should use separate Dokploy services:

- `youtube-board-web`: Laravel application from this repository.
- `youtube-board-db`: MariaDB/MySQL with a persistent volume mounted at `/var/lib/mysql`.
- `youtube-board-pma`: phpMyAdmin for protected administrator access only.

`phpMyAdmin` is an operations tool, not an application dependency. Keep it behind Dokploy basic auth, Cloudflare Access, Tailscale, or another access control layer.

## Laravel Environment

Use `deploy/dokploy-env.example` as the production app template. Do not use SQLite for production ingestion because the data needs to survive image rebuilds and container replacement.

Expected database values:

```env
DB_CONNECTION=mysql
DB_HOST=<Dokploy MariaDB Internal Host>
DB_PORT=3306
DB_DATABASE=youtube_board
DB_USERNAME=youtube_board
DB_PASSWORD=<dokploy-secret>
```

Use the MariaDB service's **General -> Internal Credentials -> Internal Host** value for `DB_HOST`. Dokploy may append a generated suffix to the app name; do not assume the internal host is the human service name.

## Production Release Migrations

The production image owns schema upgrades. `docker/production-start.sh` waits for a bounded database readiness window, runs `php artisan migrate --force --no-interaction`, verifies `php artisan migrate:status` plus `php artisan deployment:schema-check`, and only then builds Laravel caches and binds the web port. The same schema verifier backs Laravel `/up`, including the required 63-table set, critical quota/mayor/run-history columns, quota unique index, run-history indexes and foreign key, and MariaDB InnoDB engines. A connection, migration, or verification failure exits nonzero, so a new container cannot report a healthy web process with stale schema. `DB_STARTUP_WAIT_ATTEMPTS` and `DB_STARTUP_WAIT_SECONDS` may tune only the readiness window; they do not make migration failures graceful.

All create migrations retain an existing table instead of replacing it. The startup schema verifier must still match every adopted baseline/framework/mayor column plus critical primary/unique indexes before the container becomes healthy; a same-named but incompatible table is not considered ready. The legacy baseline migration never drops adopted tables on rollback.

The normal Compose setup command below is a development-image migration check. It uses `docker/php/Dockerfile` and the current Compose database volume; it is not a Production-image or disposable-database preflight:

```bash
docker compose run --rm setup
docker compose run --rm setup php artisan migrate:status
docker compose run --rm setup php artisan migrate --force --no-interaction
```

For the actual Production image, create an isolated MariaDB container and network, then start the root image exactly as Dokploy will. These values are disposable local-only credentials:

```bash
docker build -t youtube-board-production-preflight .
docker network create youtube-board-production-preflight
docker run -d --name youtube-board-production-preflight-db \
  --network youtube-board-production-preflight \
  -e MARIADB_DATABASE=youtube_board \
  -e MARIADB_USER=youtube_board \
  -e MARIADB_PASSWORD=youtube_board_preflight \
  -e MARIADB_ROOT_PASSWORD=youtube_board_root_preflight \
  mariadb:11.4
until docker exec youtube-board-production-preflight-db \
  healthcheck.sh --connect --innodb_initialized; do sleep 2; done
docker run -d --name youtube-board-production-preflight-web \
  --network youtube-board-production-preflight \
  -p 127.0.0.1:18081:8000 \
  -e APP_ENV=production \
  -e APP_DEBUG=false \
  -e APP_KEY=base64:eW91dHViZS1ib2FyZC1sb2NhbC1jb21wb3NlLWtleSE= \
  -e APP_URL=http://127.0.0.1:18081 \
  -e DB_CONNECTION=mysql \
  -e DB_HOST=youtube-board-production-preflight-db \
  -e DB_PORT=3306 \
  -e DB_DATABASE=youtube_board \
  -e DB_USERNAME=youtube_board \
  -e DB_PASSWORD=youtube_board_preflight \
  youtube-board-production-preflight
curl --fail --retry 30 --retry-delay 2 http://127.0.0.1:18081/up
docker restart youtube-board-production-preflight-web
docker logs youtube-board-production-preflight-web
```

The restart log must report `Nothing to migrate`, and `/up` must return 200 again. Verify the disposable MariaDB reports the quota ledger plus both run-history tables as `ENGINE=InnoDB`, with the run/job foreign key intact. Clean up the isolated resources afterward:

```bash
docker rm -f youtube-board-production-preflight-web
docker rm -f youtube-board-production-preflight-db
docker network rm youtube-board-production-preflight
docker image rm youtube-board-production-preflight
```

An adoption preflight must use a separately disposable database populated from the reviewed schema shape being adopted; do not point these commands at Production. Never copy migration rows or run one-off schema SQL in Production.

Normal rollback is a code rollback followed by redeploy. Do not use `migrate:rollback` for this release: the run-history migration has an intentionally non-destructive `down()` and rolling it back would only desynchronize migration bookkeeping from the retained tables, while rolling back farther would drop `ingestion_youtube_quota_daily` and erase fail-safe quota reservations for the current Pacific Time day. Before any future destructive migration, first configure and verify a restorable database backup in Dokploy. The current additive tables can remain in place when application code is rolled back.

Production polling is controlled by Dokploy runtime values, not by the committed template. `INGESTION_SCHEDULER_ENABLED` stops scheduler registration, `INGESTION_LOCAL_POLLING_ENABLED` blocks scheduled writes, and `INGESTION_PRODUCTION_POLLING_ENABLED` blocks scheduled writes only in production. Production must use an exact reviewed `INGESTION_SCHEDULED_WRITE_ALLOWLIST`; do not change that list without dry-run evidence, backup/rollback planning, and explicit operator approval. The rate-limited web `/ops/ingestion/run` route is dry-run-only in Production, returns 403 for execute requests, and does not persist public web previews to durable run history.

Runner guardrails use `INGESTION_JOB_LOCK_SECONDS=14400` and `INGESTION_YOUTUBE_DAILY_QUOTA_BUDGET=9000`. Execute-mode jobs take an expiring per-job cache lock. Scheduled YouTube jobs atomically reserve their capped worst-case request estimate in the InnoDB `ingestion_youtube_quota_daily` ledger before execution, then settle the reservation to sanitized request telemetry. Every direct YouTube API `--execute` command uses the same current Pacific Time ledger plus a direct-command lock and fails closed when credentials, a positive budget, or the ledger are unavailable. The scheduler passes its successful reservation through a process-scoped command context so that the nested Artisan command does not reserve, settle, or lock twice. Each reserved HTTP attempt stops before its timeout could cross the Pacific quota reset. A handled success or failure settles to recorded request attempts; a process crash or failed settlement keeps the worst-case reservation fail-safe. Deployments and optional run-history recording cannot erase it. Keep the budget below `YOUTUBE_DATA_API_DAILY_QUOTA_UNITS` to reserve capacity for operator smokes and monitoring lag.

New `ingestion:run --record` history is stored in the persistent MariaDB service through `ingestion_runs` and `ingestion_run_jobs`, so application container replacement no longer erases scheduler evidence, report lineage, or sanitized telemetry. Database age cleanup runs at most hourly and deletes expired rows in 1,000-row batches until the backlog is clear; the hard record cap is enforced after every successful write. Defaults are 14 days and 25,000 runs. The application still reads legacy `storage/app/private/ingestion-runs/*.json` files as a compatibility fallback, and newly managed fallback files use the same age/count bounds if DB history is unavailable. The migration and built-in defaults are sufficient for deployment: no Dokploy env edit or web-service volume is required. Optional `INGESTION_RUN_HISTORY_RETENTION_DAYS` and `INGESTION_RUN_HISTORY_MAX_RECORDS` values tune the age limit and hard record cap.

Comment queue draining uses `INGESTION_COMMENT_CLAIM_MINUTES=30`. `youtube:comments:fetch` atomically writes `urt_comment_queue.stime` before an external call, excludes active claims, recovers stale claims, and releases a failed item's claim without moving it to `urt_comment_queue_done`. A failed item does not prevent later selected rows from completing.

Fail-closed production template before an exact allowlist is approved:

```env
SESSION_SECURE_COOKIE=true
INGESTION_SCHEDULER_ENABLED=true
INGESTION_LOCAL_POLLING_ENABLED=true
INGESTION_PRODUCTION_POLLING_ENABLED=true
INGESTION_SCHEDULED_WRITE_ALLOWLIST=off
INGESTION_JOB_LOCK_SECONDS=14400
INGESTION_YOUTUBE_DAILY_QUOTA_BUDGET=9000
YOUTUBE_API_TRANSIENT_RETRIES=1
YOUTUBE_API_RETRY_DELAY_MS=250
INGESTION_COMMENT_CLAIM_MINUTES=30
INGESTION_RUN_HISTORY_RETENTION_DAYS=14
INGESTION_RUN_HISTORY_MAX_RECORDS=25000
YOUTUBE_API_KEY=<youtube-data-api-key>
# Optional comma-separated fallback keys, configured only in Dokploy secrets/env:
YOUTUBE_API_KEYS=<youtube-data-api-key-2>,<youtube-data-api-key-3>
OPENAI_ENDPOINT_STYLE=auto
# AI fallback provider. Keep the fallback key in Dokploy secrets/env only.
OPENAI_FALLBACK_BASE_URL=https://api.openai.com/v1
OPENAI_FALLBACK_MODEL=gpt-4o-mini
OPENAI_FALLBACK_ENDPOINT_STYLE=chat
OPENAI_FALLBACK_TIMEOUT=300
```

For `/live/current` parity, these are candidate job keys for a separately reviewed exact allowlist. Listing them here is not authorization to add them:

- `youtube.live.poll`: refreshes active `urt_video_live` rows and upserts `urt_video_live_log`.
- `youtube.tvbs.live.poll`: refreshes active `urt_video_live_tvbs` rows and upserts `urt_video_live_log_tvbs`.
- `youtube.channels.videos.live`: discovers live/upcoming rows from channels tagged `[52]`.
- `youtube.channels.videos.live_group`: discovers live/upcoming rows from group channels tagged `[89]`.
- `youtube.tvbs.videos`: discovers TVBS tagged `[29]` uploads and live/upcoming rows into `urt_video_live_tvbs`.
- `reports.live.build`: fills `urt_show_video_live` display cache from local live/video rows.

For AI page freshness, candidate keys are:

- `ai.hourly`: at minute 10, runs `ai:hourly:pipeline`; it first refreshes the latest 50 uploads for all 39 configured AI channels and proves that the previous complete hour is covered, then refreshes `urt_ai_hour`. Any incomplete channel source blocks the AI stage.
- `ai.daily`: at 00:00, runs `ai:daily:pipeline --date=yesterday`; it first completes a paginated tag 102 uploads crawl for the closed calendar day, then refreshes configured channel-level `urt_channel_ai` rows and six daily `urt_ai_date` condition rows. An incomplete crawl blocks the AI stage.

The AI client tries the primary `OPENAI_*` provider first. If it fails and `OPENAI_FALLBACK_*` is configured, it retries once against the fallback provider. This matches the observed legacy daily AI path, which used OpenAI `chat/completions` with `gpt-4o-mini`, while keeping secrets out of git.

For derived report freshness, candidate keys are:

- `reports.keywords.build`: syncs `tags` from 新文易數 `tag.analysis.tw/api/tag_json.php`; the Laravel dashboard reads database-backed cache data instead of relying on legacy filesystem keyword JSON files.
- `reports.groups.build`: syncs `tag_group` from 新文易數 `tag.analysis.tw/api/group.php`.
- `reports.people.build`: refreshes selected political-people `urt_show_tag_date` cache rows from local `urt_video`, `urt_count`, and `tags`.
- `reports.counts.build` and `reports.schedule.build`: refresh local derived count deltas and schedule stime rows from existing local log/cache data.

After a stable first polling window, these broader candidates still require a new explicit approval before allowlist expansion:

- `youtube.channels.videos.general`: discovers regular channel uploads into `urt_video`, `urt_video_schedule`, and live rows.
- `youtube.videos.duration`: drains the duration queue with `videos.list(contentDetails)`.
- `youtube.comments.queue`: queues recent high-engagement videos for comment fetch.
- `youtube.comments.fetch`: drains up to five queued videos with one `commentThreads.list` page plus at most 20 shared `comments.list` reply pages per video.
- `reports.mayor.static`: refreshes mayor/city `urt_show_tag_date` cache rows for the dynamic Laravel mayor pages.

The scheduler service must run `php artisan schedule:run --verbose --no-interaction` every minute from `/var/www/html`, or the equivalent Dokploy scheduled task must be enabled against the current web image. Verify a fresh `ingestion:run --execute --record` history entry after deployment without changing the exact allowlist. Environment gates alone do not start the scheduler. Each approved scheduled write job uses its capped `scheduled_execute_command`; keys outside the exact allowlist remain blocked. Creating or enabling the Production scheduled task can execute already allowlisted writes and therefore requires explicit operator approval.

## MariaDB Environment

Use `deploy/dokploy-mariadb-env.example` for the database service. Generate fresh passwords in Dokploy and store them only as service environment variables.

The database service must have a persistent volume:

```text
/var/lib/mysql
```

## phpMyAdmin Environment

Use `deploy/dokploy-phpmyadmin-env.example` for phpMyAdmin. `PMA_HOST` must use the same Dokploy MariaDB internal host as Laravel. The `PMA_PASSWORD` value should match the application database user's password, not the root password.

The phpMyAdmin service should be exposed only on a protected hostname such as:

```text
pma-youtube-board.skyhong.tw
```

Do not expose phpMyAdmin publicly without an access gate.
