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

Production polling is still off in the template. To enable it after a backup and rollback point are verified, set the scheduler flags and an exact job allowlist in the app service environment:

```env
INGESTION_SCHEDULER_ENABLED=true
INGESTION_LOCAL_POLLING_ENABLED=true
INGESTION_PRODUCTION_POLLING_ENABLED=true
INGESTION_SCHEDULED_WRITE_ALLOWLIST=youtube.live.poll,youtube.channels.videos.live,youtube.channels.videos.live_group,reports.live.build,reports.live.clean,youtube.live.cleanup,reports.counts.build,reports.schedule.build,reports.keywords.build,reports.groups.build,reports.people.build,ai.hourly,ai.daily
YOUTUBE_API_KEY=<youtube-data-api-key>
# Optional comma-separated fallback keys, configured only in Dokploy secrets/env:
YOUTUBE_API_KEYS=<youtube-data-api-key-2>,<youtube-data-api-key-3>
OPENAI_ENDPOINT_STYLE=auto
```

For `/live/current` parity with the legacy site, the minimum live allowlist is:

- `youtube.live.poll`: refreshes active `urt_video_live` rows and upserts `urt_video_live_log`.
- `youtube.channels.videos.live`: discovers live/upcoming rows from channels tagged `[52]`.
- `youtube.channels.videos.live_group`: discovers live/upcoming rows from group channels tagged `[89]`.
- `reports.live.build`: fills `urt_show_video_live` display cache from local live/video rows.

For AI page freshness, add:

- `ai.hourly`: refreshes `urt_ai_hour` from the previous complete hour of `urt_video`.
- `ai.daily`: refreshes configured channel-level `urt_channel_ai` rows in capped batches first, then writes six daily `urt_ai_date` condition rows from those channel summaries.

For derived report freshness, add:

- `reports.keywords.build`: syncs `tags` from `tag.analysis.tw/api/tag_json.php` while leaving legacy filesystem keyword JSON writes disabled.
- `reports.groups.build`: syncs `tag_group` from `tag.analysis.tw/api/group.php`.
- `reports.people.build`: refreshes selected political-people `urt_show_tag_date` cache rows from local `urt_video`, `urt_count`, and `tags`.
- `reports.counts.build` and `reports.schedule.build`: refresh local derived count deltas and schedule stime rows from existing local log/cache data.

The scheduler service must run `php artisan schedule:run` every minute, or the equivalent Dokploy cron service must be enabled. Keep the allowlist narrow at first; each allowlisted job uses its capped `scheduled_execute_command`.

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
