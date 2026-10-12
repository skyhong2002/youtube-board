#!/bin/sh

set -eu

# A web/container restart is not approval for source-schema writes. Local compose
# setup has its own explicit migrate step; this production entrypoint defaults off.
case "${LARAVEL_STARTUP_MIGRATIONS_ENABLED:-false}" in
    true|false) ;;
    *) echo "LARAVEL_STARTUP_MIGRATIONS_ENABLED must be true or false." >&2; exit 1 ;;
esac

# Never let a developer-generated cached config select the database used by migrations.
rm -f bootstrap/cache/config.php

if [ "${DB_CONNECTION:-}" = "sqlite" ] && [ -n "${DB_DATABASE:-}" ]; then
    mkdir -p "$(dirname "$DB_DATABASE")"
    touch "$DB_DATABASE"
fi

wait_attempts="${DB_STARTUP_WAIT_ATTEMPTS:-30}"
wait_seconds="${DB_STARTUP_WAIT_SECONDS:-2}"
attempt=1

case "$wait_attempts" in
    ''|*[!0-9]*|0) echo "DB_STARTUP_WAIT_ATTEMPTS must be a positive integer." >&2; exit 1 ;;
esac

case "$wait_seconds" in
    ''|*[!0-9]*|0) echo "DB_STARTUP_WAIT_SECONDS must be a positive integer." >&2; exit 1 ;;
esac

until php artisan db:show --no-interaction >/dev/null 2>&1; do
    if [ "$attempt" -ge "$wait_attempts" ]; then
        echo "Database did not become ready after ${wait_attempts} attempts; refusing to start the web server." >&2
        exit 1
    fi

    echo "Waiting for database readiness (${attempt}/${wait_attempts})."
    attempt=$((attempt + 1))
    sleep "$wait_seconds"
done

if [ "${LARAVEL_STARTUP_MIGRATIONS_ENABLED:-false}" = "true" ]; then
    php artisan migrate --force --no-interaction
else
    echo "Startup migrations disabled; checking the existing schema only."
fi
php artisan migrate:status --no-interaction
php artisan deployment:schema-check --no-interaction
php artisan config:cache --no-interaction
php artisan view:cache --no-interaction

exec frankenphp php-server --root public --listen "0.0.0.0:${PORT:-8000}"
