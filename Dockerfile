FROM dunglas/frankenphp:1-php8.4-alpine

RUN apk add --no-cache \
        bash \
        git \
        icu-dev \
        libzip-dev \
        linux-headers \
        nodejs \
        npm \
        sqlite-dev \
        unzip \
        zip \
        $PHPIZE_DEPS \
    && docker-php-ext-install bcmath intl pcntl pdo_mysql pdo_sqlite zip \
    && pecl install redis \
    && docker-php-ext-enable redis \
    && apk del $PHPIZE_DEPS

COPY --from=composer:2 /usr/bin/composer /usr/bin/composer

WORKDIR /var/www/html

COPY composer.json composer.lock ./
RUN composer install \
    --no-dev \
    --no-interaction \
    --no-progress \
    --no-scripts \
    --optimize-autoloader \
    --prefer-dist

COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts

COPY . .

RUN chmod -R a+rX /var/www/html \
    && npm run build \
    && composer dump-autoload --optimize \
    && php artisan package:discover --ansi \
    && mkdir -p \
        bootstrap/cache \
        storage/app \
        storage/framework/cache/data \
        storage/framework/sessions \
        storage/framework/views \
        storage/logs \
    && chown -R www-data:www-data bootstrap/cache storage

# Caddy (inside FrankenPHP) needs writable config/data dirs when running unprivileged.
ENV XDG_CONFIG_HOME=/tmp/caddy-config \
    XDG_DATA_HOME=/tmp/caddy-data

# The frankenphp base image's HEALTHCHECK probes the Caddy admin API on :2019,
# which is disabled in `frankenphp php-server` mode — Swarm would kill the
# healthy container after three failed probes. Probe the app itself instead.
HEALTHCHECK --interval=30s --timeout=10s --start-period=120s --retries=3 \
    CMD curl -fsS "http://localhost:${PORT:-8000}/up" || exit 1

USER www-data

EXPOSE 8000

CMD ["sh", "docker/production-start.sh"]
