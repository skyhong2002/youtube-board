#!/bin/sh

set -eu

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

php artisan deployment:migrate --lock-timeout=0 --no-interaction
php artisan migrate:status --no-interaction
php artisan deployment:schema-check --no-interaction
php artisan config:cache --no-interaction
php artisan view:cache --no-interaction

exec php artisan serve --host=0.0.0.0 --port="${PORT:-8000}"
