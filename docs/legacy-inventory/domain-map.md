# Domain Map

## Core Modules

| Modern module | Legacy concepts | Notes |
| --- | --- | --- |
| Channels | `urt_channel`, channel pages, channel tags | YouTube channel metadata and grouping. |
| Videos | `urt_video`, `urt_video_schedule` | Uploaded videos, scheduled videos, durations, view counts. |
| Live Streams | `urt_video_live`, `urt_video_live_log`, `urt_show_*live*` | Current live state, minute-ish logs, current and peak viewers. |
| Tags | `urt_tag`, `tags`, `tag_group`, `urt_show_tag_*` | Category filters and derived tag reports. |
| Comments | `urt_comment`, queue/done/revision/author tables | Comment ingestion and author analysis. |
| AI Events | `urt_ai_date`, `urt_ai_event`, `urt_ai_hour`, `urt_channel_ai` | Daily and hourly summaries, event grouping, media-perspective metrics. |
| Reports | Static HTML, API cache tables, public PHP pages | Real-time YouTube dashboard outputs backed by derived tables or generated files. |

## Initial Vertical Slice

Live Streams was the first completed vertical slice because it exercises the important migration path through local ingestion and public dashboard behavior:

- Legacy public page: `/live.php`
- Modern page: `/live/current`
- Legacy polling source: `maint/get_live.php`
- Legacy display cache: `maint/show_live.php`, `api/video_live.php`, `urt_show_video_live`
- Required behavior: preserve query filters, ranking columns, current viewers, daily peak, trend data, and all-time peak.

## Schema Policy

The committed sanitized legacy baseline and Laravel-owned migrations are the reproducible schema source for fresh development databases. Schema changes must be based on reviewed legacy queries or approved exports, remain adoption-safe for existing tables, and pass `deployment:schema-check`; do not add columns or indexes from guesses alone.

## Query-Derived Table Hotspots

The most referenced legacy tables from PHP query inventory are:

| Table | Approximate role |
| --- | --- |
| `urt_count` | Channel aggregate counts, tags, weekly deltas, predictions. |
| `urt_video` | Uploaded video records and latest statistics. |
| `urt_channel` | YouTube channel metadata and crawl state. |
| `urt_video_live` | Current/known live stream records. |
| `urt_video_live_log` | Per-day live stream viewer log JSON and peak values. |
| `urt_tag` | Numeric tag/category labels. |
| `urt_channel_ai` | Channel AI summaries, aspect/stance reports, daily summaries. |
| `urt_ai_date` | Daily AI report data. |
| `urt_show_tag_cloud_tag` | Precomputed tag-cloud/tag relation output. |
| `urt_video_schedule` | Scheduled/recent videos waiting for statistics refresh. |
| `urt_video_log` | Time-series video statistics. |
| `urt_show_tag_date` | Precomputed daily tag reports. |
| `urt_show_video_live` | Display cache for live report rows. |
| `urt_log` | Time-series channel statistics. |
| `urt_comment` | Video comment payloads and derived comment metadata. |
| `tag_group` | Manual/derived grouping of keyword tags. |
| `fanpage` | Cross-system metadata used by some tag/live pages. |

These names are covered by the committed baseline and deployment schema verifier. Approved exports may refine non-required legacy details, but the required table, column, and index contract must remain reproducible from migrations.

## External APIs

| Provider | Legacy usage | Modern adapter |
| --- | --- | --- |
| YouTube Data API v3 `channels.list` | Channel metadata/statistics in `app/admin.php`, `redir/renew.php`, `maint/get_statics.php`. | Shared `YoutubeDataApiClient` through capped `youtube:channels:stats --execute`; dry-run is the default and quota, credential, lock, and failure guardrails are shared with the scheduler. |
| YouTube Data API v3 `playlistItems.list` | Upload discovery in `maint/get_video.php`, `maint/get_video_tvbs.php`, `maint/make_live.php`. | `youtube:channels:videos`, `youtube:tag-videos:backfill`, and `youtube:tvbs:videos`; paginated backfill can rebuild tag-date caches after discovery. |
| YouTube Data API v3 `videos.list` | Video statistics, live status, duration, manual add flows. | `youtube:videos:stats`, `youtube:live:poll`, `youtube:tvbs:live:poll`, and `youtube:videos:duration`. |
| YouTube Data API v3 `commentThreads.list`, `comments.list` | Comment ingestion in `maint/get_comment.php`. | `youtube:comments:fetch` with queue leases, bounded pagination, reply completion checks, and per-video failure isolation. |
| OpenAI-compatible chat completions | Daily/hourly/channel/event prompts in `maint/*openai.php` and `prompt/*`. | Shared `OpenCodeChatClient` used by reviewed `ai:*` preview/execute commands, with response-shape validation and sanitized failures. |
