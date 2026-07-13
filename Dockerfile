FROM php:8.4-cli-alpine3.22

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

USER www-data

EXPOSE 8000

CMD ["sh", "docker/production-start.sh"]
