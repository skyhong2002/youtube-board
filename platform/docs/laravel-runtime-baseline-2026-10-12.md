# Laravel runtime baseline — 2026-10-12

Read-only inspection at **2026-10-12 05:29 UTC / 13:29 Taipei** bootstrapped
Laravel through PHP stdin in each existing container and selected only the
non-secret configuration keys below. No schedule command, provider call, env
change or service update was executed. This records effective configuration,
including cached configuration; service-level environment alone is insufficient.

| Setting | Web | Separate scheduler |
| --- | --- | --- |
| App timezone | UTC | UTC |
| Ingestion timezone | Asia/Taipei | Asia/Taipei |
| Scheduler / local polling / production polling gates | All false | All true |
| Scheduled write allowlist | `off` | 25 exact workflow keys below |
| Ingestion lock store | null | database |
| Daily YouTube quota budget | 9,000 | 9,000 |
| Telegram digest enabled | false | true |
| Telegram dedup store | database | database |
| Telegram hourly / daily maximum posts | 3 / 1 | 3 / 1 |
| General cache store | database | file |
| Cache prefix | `youtube-board-cache-` | `youtube-board-cache-` |
| Database cache table / configured lock-table override | `cache` / null | `cache` / null |

The 25 scheduler allowlist entries are:

```text
youtube.channels.stats
youtube.live.poll
youtube.tvbs.live.poll
youtube.live.cleanup
youtube.channels.videos.live_group
youtube.channels.videos.live
youtube.channels.videos.general
youtube.tvbs.videos
youtube.tag_videos.backfill
youtube.videos.stats
reports.counts.build
reports.keywords.build
reports.people.build
reports.tag_cloud.build
reports.tag_date.build
reports.keywords.cache
reports.groups.build
reports.schedule.build
reports.live.build
reports.live.clean
ai.daily
ai.hourly
ai.mayor_person
reports.mayor.static
ai.daily.catchup
```

Allowlisting is not evidence that a particular workflow ran successfully, or
that provider credentials work. Actual command definitions, due times, active
processes, locks and publication records must be checked during each handoff.
Comments are not in this allowlist; inventory manual and other triggers before
assuming there is no comment writer.

The Telegram enable variable is `TELEGRAM_DIGEST_ENABLED`, read through
`services.telegram.enabled`. General `CACHE_STORE=file` on the scheduler does
**not** mean Telegram deduplication uses files: its effective store is database.
The observed cache prefix can inform the later TS bridge configuration, but must
be rechecked immediately before handoff. Keep UTC schedule-slot keys separate
from Taipei report periods. A null lock-table override is not evidence that the
physical `cache_locks` table is missing; the restored source contains it.

Web and scheduler currently run different image IDs despite sharing a mutable
image tag. Preserve their separately retained rollback tags listed in
[cutover readiness](cutover-readiness-2026-10-12.md). Updating the scheduler to
the web image during frontend deployment would change its behavior prematurely.

Private selected-key evidence and reproducible inspection code are in
`.local/production-cutover/scheduler-effective-config.json` and
`effective-config.py`. Do not expand this inspection to whole configuration or
environment dumps: those contain credentials.
