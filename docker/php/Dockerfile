FROM php:8.4-cli-alpine3.22

RUN apk add --no-cache \
        bash \
        git \
        icu-dev \
        libzip-dev \
        linux-headers \
        nodejs \
        npm \
        unzip \
        zip \
        $PHPIZE_DEPS \
    && docker-php-ext-install bcmath intl pcntl pdo_mysql zip \
    && pecl install redis \
    && docker-php-ext-enable redis \
    && apk del $PHPIZE_DEPS

COPY --from=composer:latest /usr/bin/composer /usr/bin/composer

WORKDIR /var/www/html
