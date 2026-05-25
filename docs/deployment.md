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
INGESTION_SCHEDULED_WRITE_ALLOWLIST=youtube.channels.stats,ai.hourly
OPENAI_ENDPOINT_STYLE=auto
```

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
