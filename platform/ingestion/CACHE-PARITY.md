# Original 45-job ledger

This is an implementation ledger, not production activation or proof of live-data parity. Every writer remains gated. `Other slice` rows refer to the corresponding package and its separately reviewed tests.

| Original key | Disposition | Replacement / owner |
| --- | --- | --- |
| `youtube.channels.stats` | Implemented, other slice | youtube-cli / ingestion source workflows |
| `youtube.live.poll` | Implemented, other slice | youtube-cli / ingestion source workflows |
| `youtube.tvbs.live.poll` | Implemented | youtube-cli TVBS variants; taxonomy 29 and separate live/log tables |
| `youtube.live.cleanup` | Implemented | cache-cli exact key, pure validation, dry-run, gated executor, run history |
| `youtube.channels.videos.live_group` | Implemented, other slice | youtube-cli / ingestion source workflows |
| `youtube.channels.videos.live` | Implemented, other slice | youtube-cli / ingestion source workflows |
| `youtube.channels.videos.general` | Implemented, other slice | youtube-cli / ingestion source workflows |
| `youtube.tvbs.videos` | Implemented | youtube-cli TVBS variants; taxonomy 29 and separate live/log tables |
| `youtube.tag_videos.backfill` | Implemented, other slice | youtube-cli / ingestion source workflows |
| `youtube.videos.stats` | Implemented, other slice | youtube-cli / ingestion source workflows |
| `reports.counts.build` | Implemented | cache-cli exact key, pure validation, dry-run, gated executor, run history |
| `reports.keywords.build` | Retired materializer | Maintained vocabulary import replaces generated news-weight dictionary files. |
| `reports.people.build` | Implemented | cache-cli exact key, pure validation, dry-run, gated executor, run history |
| `reports.tag_cloud.build` | Implemented | cache-cli exact key, pure validation, dry-run, gated executor, run history |
| `reports.channel_cloud.build` | Implemented | cache-cli exact key, pure validation, dry-run, gated executor, run history |
| `reports.tag_date.build` | Implemented | cache-cli exact key, pure validation, dry-run, gated executor, run history |
| `reports.tag_month.build` | Implemented | cache-cli exact key, pure validation, dry-run, gated executor, run history |
| `reports.ai_topic.build` | Owned by AI slice | ai-cli / ai-derived-cli; see AI parity/review notes |
| `youtube.channels.retire` | Implemented, other slice | youtube-cli / ingestion source workflows |
| `reports.group_view.build` | Retired materializer | Dynamic legacy group projector from published day caches; historical imported fallback labeled. |
| `reports.photos.build` | Implemented | cache-cli exact key, pure validation, dry-run, gated executor, run history |
| `reports.keywords.cache` | Implemented | cache-cli exact key, pure validation, dry-run, gated executor, run history |
| `reports.groups.build` | Implemented read-only local CLI | Bounded local `tag_group` status and active/deleted counts; `--execute` still reads only. Existing display membership preserved. Optional legacy remote sync is unsupported: maintained tag export has no group-membership contract. |
| `reports.schedule.build` | Implemented | cache-cli exact key, pure validation, dry-run, gated executor, run history |
| `reports.static.html` | Retired materializer | Next dynamic group/keyword pages + old static URL redirects. |
| `reports.mayor.static` | Retired materializer | Next dynamic mayor pages + old static URL redirects. |
| `reports.live.static` | Retired materializer | Next dynamic live pages/walls + old static URL redirects. |
| `youtube.videos.duration` | Implemented, other slice | youtube-cli / ingestion source workflows |
| `reports.live.build` | Implemented | cache-cli exact key, pure validation, dry-run, gated executor, run history |
| `reports.live.show` | Retired materializer | Read-only live/API/ops view replaces scheduled console output. |
| `reports.live.clean` | Implemented | cache-cli exact key, pure validation, dry-run, gated executor, run history |
| `reports.live_tag_date.build` | Implemented | cache-cli exact key, pure validation, dry-run, gated executor, run history |
| `ai.channel` | Owned by AI slice | ai-cli / ai-derived-cli; see AI parity/review notes |
| `ai.daily` | Owned by AI slice | ai-cli / ai-derived-cli; see AI parity/review notes |
| `ai.daily.catchup` | Owned by AI slice | ai-cli / ai-derived-cli; see AI parity/review notes |
| `ai.mayor_person` | Owned by AI slice | ai-cli / ai-derived-cli; see AI parity/review notes |
| `ai.period` | Owned by AI slice | ai-cli / ai-derived-cli; see AI parity/review notes |
| `ai.event` | Owned by AI slice | ai-cli / ai-derived-cli; see AI parity/review notes |
| `ai.days_refresh` | Owned by AI slice | ai-cli / ai-derived-cli; see AI parity/review notes |
| `ai.hourly` | Owned by AI slice | ai-cli / ai-derived-cli; see AI parity/review notes |
| `youtube.comments.queue` | Implemented, other slice | youtube-cli / ingestion source workflows |
| `youtube.comments.fetch` | Implemented, other slice | youtube-cli / ingestion source workflows |
| `reports.channel_predictions.build` | Implemented | cache-cli exact key, pure validation, dry-run, gated executor, run history |
| `reports.keyword_relations.build` | Implemented | cache-cli exact key, pure validation, dry-run, gated executor, run history |
| `reports.keyword_cloud.build` | Implemented | cache-cli exact key, pure validation, dry-run, gated executor, run history |

Validation for the cache slice: real isolated MariaDB fixtures cover publication/replay, unknown-count lineage, complete closed-month requirements, interrupted publication, cap refusal, live hourly zero/peak observations, TS-row cleanup exclusion, counts/schedule freshness, exact photo terms, prediction parity, keyword relation/tags_all shapes, and TVBS upload/poll/retire isolation. Fake HTTP is used throughout. Opus reviews are recorded locally and findings are addressed before handoff.

Intentional metric change: maintained tag.observe vocabulary + exact title/description evidence replaces legacy news burst/weight divisors. Calendar day/cloud snapshots include observed source rows as of generation; they do not certify upstream archival completeness. Current calendar windows are marked open. Monthly rollups require closed complete local day buckets.
