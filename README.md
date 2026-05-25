# YouTube Board Modern

Modern Laravel rebuild of the legacy YouTube Board system.

## Ground Truth

The legacy system is read-only reference material at:

`/Users/sky/Documents/youtube-board-legacy`

Do not run formatters, package managers, migrations, code generation, or write commands in that directory. All new development happens in this repository:

`/Users/sky/Projects/youtube-board`

Ground truth priority:

1. The read-only legacy snapshot.
2. Public behavior on `https://youtube.board.tw`.
3. A future read-only production DB dump, only after explicit approval.

## Local Development

Start the Docker services:

```bash
docker compose up -d --build
```

Install dependencies if `vendor/` or `node_modules/` are missing:

```bash
docker compose run --rm app composer install
docker compose run --rm app npm install
```

Run migrations:

```bash
docker compose run --rm app php artisan migrate
```

Open the app:

`http://localhost:8080`

Open phpMyAdmin for the local development database:

`http://localhost:8081`

Default local credentials:

- Server: `mysql`
- Username: `youtube_board`
- Password: `youtube_board`
- Database: `youtube_board`

## Current Slice

The first migration slice is the read-only live ranking report.

- New route: `/live/current`
- Legacy redirect: `/live.php?...` -> `/live/current?...`
- Legacy reference: `/Users/sky/Documents/youtube-board-legacy/urtube/live.php`

The current implementation is a scaffold that preserves URL and query behavior before importing legacy fixtures and data adapters.

## Feature Parity

The full legacy feature backlog is tracked in:

`docs/legacy-inventory/feature-parity.md`

Use that document to choose the next vertical slice and to avoid silently dropping legacy behavior.
