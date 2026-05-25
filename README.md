# YouTube Board Modern

Laravel rebuild of YouTube Board, based on the public behavior of `youtube.board.tw`.

The app can run locally with Docker and includes read-only Laravel implementations for the main public report surfaces, compatibility redirects, JSON API shells, guarded writeback URLs, and local preview commands for scheduled jobs.

## Project Scope

This repository modernizes the public YouTube Board experience in Laravel while keeping rebuilt report pages read-only by default.

Guardrails:

- Do not SSH production.
- Do not write production DBs.
- Do not run production migrations.
- Do not put secrets in code.
- Rebuilt public report work should be read-only unless explicitly approved.
- Polling, cache generation, and AI generation stay disabled by default.

## Local Development

Start the app:

```bash
docker compose up -d --build
```

Open:

- App: `http://localhost:8080`
- phpMyAdmin: `http://localhost:8081`

Default local database credentials:

- Server: `mysql`
- Username: `youtube_board`
- Password: `youtube_board`
- Database: `youtube_board`

Install dependencies only if the local checkout is missing `vendor/` or `node_modules/`:

```bash
docker compose run --rm app composer install
docker compose run --rm app npm install
```

Run migrations for a fresh local database:

```bash
docker compose run --rm app php artisan migrate
```

For day-to-day commands, prefer the running app container:

```bash
docker compose exec app php artisan route:list
docker compose exec app php artisan test
```

## What Works

Implemented read-only surfaces include:

- Home and keyword/tag pages: `/`, `/keywords`, `/tags/{tagId}/channels`, `/tags/{tagId}/videos`, `/tags/{tagId}/comments`, `/tags/{tagId}/cloud`, `/tags/{tagId}/days`, `/tags/{tagId}/trends`, `/tags/compare`.
- Keyword pages: `/keywords/{keyword}/videos`, `/keywords/{keyword}/cloud`, `/keywords/{keyword}/days`, `/keywords/{keyword}/groups/trends`, `/keywords/{keyword}/live/trends`.
- Channel pages: `/channels/{u_id}`, `/channels/{u_id}/videos`, `/channels/{u_id}/comments`, `/channels/{u_id}/cloud`, `/channels/{u_id}/trends`, `/channels/{u_id}/people`, `/channels/{u_id}/ai`, `/channels/{u_id}/ai/days`, `/channels/{u_id}/prompt`.
- Live pages: `/live/current`, `/live/days/{date}`, `/live/periods`, `/live/channels`, `/live/hours`, `/live/tags`, `/live/trends/daily`, `/live/groups/{group}/hours`, `/live/walls/{variant}`.
- AI pages: `/ai/days`, `/ai/hours`, `/ai/periods`, `/ai/events/{id}`, `/ai/events/{id}/people`, `/ai/events/{id}/wall`, `/ai/aspects`.
- Group/mayor/video/comment reports: `/groups`, `/groups/{groupName}`, `/groups/{groupName}/ranking`, `/groups/{groupName}/trends`, `/groups/{groupName}/live`, `/mayor`, `/mayor/cities/{city}`, `/videos/{videoId}`, `/videos/{videoId}/analytics`, `/comments/authors/{authorKey}`.
- Legacy compatibility redirects for top-level PHP URLs such as `/live.php`, `/rank.php`, `/tag_group.php`, `/group_two.php`, `/channel.php`, `/ch/{u_id}/...`, `/ai_day.php`, and related legacy paths.
- Read-only compatibility API routes under `/api/*.php`.
- Guarded legacy mutating routes under `/redir/{script}.php` and `/prompt/{script}.php`.

Feature parity notes are tracked in:

`docs/legacy-inventory/feature-parity.md`

Route mapping details are in:

`docs/legacy-inventory/routes.md`

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

The suite covers read-only behavior, compatibility redirects, legacy API payload shapes, cache-miss behavior, and writeback/prompt guards.

## Legacy Job Previews

Scheduled and maintenance flows are represented as Laravel preview commands and `/ops/ingestion` pages.

Open:

`http://localhost:8080/ops/ingestion`

Most commands default to dry-run/read-only previews. Some local-only execute modes exist for explicit smoke tests, but they require opt-in flags, local credentials, and guardrail checks. Scheduler polling is disabled by default.

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

## Development Notes

- Keep rebuilt public report slices read-only unless explicit approval changes the scope.
- Prefer local MariaDB and public-site behavior checks when validating reports.
- Add or update focused feature tests for each route/controller/service/view slice.
- Update `docs/legacy-inventory/feature-parity.md` and `docs/legacy-inventory/routes.md` when behavior changes.
- Do not commit secrets from `.env`; `.env.example` is the safe template.
