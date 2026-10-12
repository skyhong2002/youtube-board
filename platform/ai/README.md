# TypeScript AI workflows

This package implements channel, daily, hourly, event details, endpoint-day event
mapping, derived topic/video caches, bounded day refresh, neutral mayor/person coverage quotations, and source-first daily/hourly
pipelines and catchup. Legacy report tables are recoverable projections of `ts_ai_runs`.
It does not activate production writers or install a schedule.

## Commands

Run from `platform/` after local bootstrap and jobs migrations:

```sh
npm run start -w @youtube-board/jobs -- ai:channel --channel-id=76 --from='2026-10-10 00:00:00' --to='2026-10-10 23:59:59'
npm run start -w @youtube-board/jobs -- ai:daily --from='2026-10-10 00:00:00' --to='2026-10-10 23:59:59' --call-limit=45 --missing-only
npm run start -w @youtube-board/jobs -- ai:hourly:pipeline --hour=1 --period=1 --source-max-results=50
npm run start -w @youtube-board/jobs -- ai:daily:pipeline --date=yesterday --channel-video-limit=120
npm run start -w @youtube-board/jobs -- ai:mayor-person --city=taipei --person='蔣萬安' --date=2026-10-10
npm run start -w @youtube-board/jobs -- ai:event --date=2026-10-10 --event='Exact daily topic' --prompt-type=summary
npm run start -w @youtube-board/jobs -- ai:period --from=2026-10-09 --to=2026-10-10
npm run start -w @youtube-board/jobs -- reports:ai-topic:build --date=2026-10-10
npm run start -w @youtube-board/jobs -- ai:days-refresh --from=2026-10-09 --to=2026-10-10 --call-limit=45
npm run start -w @youtube-board/jobs -- ai:daily:catchup --date=2026-10-10 --call-limit=45
```

Preview is default. `--execute` requires exact TypeScript ownership, ingestion,
and production gates. Scheduled execution additionally checks scheduler gates.
Scheduled daily/hourly use the source-first pipeline adapters; direct
`ai:daily` / `ai:hourly` are manual-only. Every invoked subworkflow rechecks its own authorization. Runtime worker/ops
registration uses the same strict argument parser as CLI.

`ai.daily` refreshes configured channels with >=10 videos. Failed channels are
reported, while successful channels still feed each daily condition. The final
status remains partial failure if any stage failed. Default channel input is
120 videos (direct channel command can request up to 500). Daily source cap is
1000; hourly cap is 5000 and truncation blocks inference. Default user token is
`CLI` for channel/daily/event/period, and `cli` for hourly, matching Laravel.

Omitted hourly condition excludes channel tags 31 and 41. Explicit `all` selects
tag 102. Both legacy modes store `condition_type=all`; new TS runs refuse to
replace a published opposite-mode TS snapshot at the same business key
(`hourly_scope_conflict`). Preserved legacy hourly rows return scopeUnverified because historical mode is unknown. Choose one mode per period/token before writer handoff.

`--missing-only` preserves valid TS rows and unowned historical JSON rows without imposing the newer schema (reported as legacy_present_unvalidated). Once a missing daily result requires a source refresh, the channel stage rechecks current source identity even in catchup mode. Normal daily pipeline crawls
sources before generation. Hourly pipeline refreshes every configured channel via
`youtube.channels.videos.general`, with an aggregate request cap. Each uploads
window must be exhausted or have an observed oldest publication at/before the
window start; a short page with a continuation token is not sufficient. This
matches the legacy bounded-window approach, not an entire archive export.
Incomplete or missing channels block inference. Scheduled adapters reject windows that have not ended; manual today/hour=0 remains an explicitly provisional observation. Hourly missing-only skips source APIs when a row already exists. The first source command execution IDs and
coverage are captured with the immutable AI input; later refreshes remain in workflow execution logs/results, and do not rewrite that original evidence. The bound source text itself
controls idempotence rather than changing crawl IDs.

Catchup first checks all six daily conditions: when complete it makes no source or AI calls. Otherwise it
requires `youtube.tag_videos.backfill`, `ai.channel`, `ai.daily` and
`ai.daily.catchup` authorization, completes a bounded tag-102 uploads crawl
(without unrelated vocabulary cache generation), and only then runs missing-only
AI. Partial/capped/failed source crawls block inference. Pipeline date aliases `today` and `yesterday` resolve once in Taipei time.
Original channel-batching aliases remain unported.

Days refresh accepts 1–7 explicit days, a shared logical-completion budget and
optional skip-daily/events/period/cache flags. Topic caches are independent from
event and period prerequisites; cache failures remain visible but do not suppress
valid event work. Re-running reuses completed immutable inputs. Each event has
summary, people and media variants. Empty fact/opinion arrays are valid when
source evidence is insufficient. Mayor/person coverage uses an intentionally different, factual-only contract: AI selects verbatim source quotations containing the named person, byte-exact video references are validated, and counts/limitations are generated deterministically. Strategy, political persuasion, risk/action advice and inferred support are absent. Defaults match the old city= taipei, yesterday in Taipei, token=CLI, target limit=10, call limit=10; comma-separated configured people are supported. At most eight videos from local title/description literal matches are shown. Initial selection uses view ranking; subsequent runs pin the journaled selection (including validated or failed attempts) unless matching video count or selected text availability changes. View/comment updates do not spend another completion, and original observed counters remain frozen with the journal. New matching-video counts are part of identity, so changed source coverage creates a new revision. Views/comments are cumulative observed snapshots, missing counts remain null, and names may have homonyms. The 2026-05-28 city/person configuration is versioned. This safe replacement intentionally omits legacy weighted category/related-keyword caches and candidate-tailored strategic output.

## Provider and recovery

The provider requires `OPENAI_BASE_URL`, `OPENAI_API_KEY` and alias `sky-quality`.
It uses `max_completion_tokens`, low reasoning effort and strict object schema.
Daily minima are bounded by available source pair counts, so two sources with
one event each do not force five invented topics. Channel output budget is 4096 tokens, daily 12288. Unsupported string schema
constraints are removed from the outbound schema while local validators enforce
text length and exact IDs. A synthetic request through the actual local gateway
passed the same channel schema and validator on 2026-10-12; no YouTube or
production data was involved.

Each logical completion has at most three HTTP attempts for 429/502/503/504,
with Retry-After capped at 2 seconds. Authentication failures and uncertain
network failures are not retried within a completion. Call limits count logical
completions; maximum provider attempts are three times that limit. Successful
attempt count, actual model and numeric usage are journaled. No error bodies or
credentials are logged. Shutdown aborts in-flight fetch and stops later stages.

Scheduled catchup can recover a no-result failed run automatically. Attempts are persisted before dispatch; at most three logical completions per immutable input may run automatically. Malformed/uncertain failures wait five minutes; known transient HTTP failures may retry on the next run. After three, explicit retry-failed or a changed source identity is required. A crashed
`running` run requires its connection lock to be free and a five-minute cooldown
before scheduled retry. The remote outcome can be uncertain after process death;
a later recovery can incur another provider charge. Manual uncertain retries use
`--retry-failed`. A budget rejection before dispatch writes no attempt.

All AI writer locks match Laravel `AiBusinessKeyLock::name`: `ytb:ai:` prefix,
workflow identity shape, lowercasing/PAD SPACE normalization and PHP Unicode JSON
encoding. Holding a Laravel-named lock on a second MariaDB connection blocks TS.
The ownership gate remains necessary: locks prevent overlap, not sequential
alternation by two authorized writers.

Validated output is journaled before a MyISAM projection. Replay repairs a missing
projection without inference. Compare-and-set failures never publish a new cache
journal. This is recoverability, not cross-table ACID. A TS daily projection uses
its exact source snapshot; missing or corrupt snapshots fail closed. A subsequent
legacy overwrite is an ownership conflict and requires regeneration through the
reviewed daily workflow; do not silently reinterpret it with mutable caches.
Legacy-only derived reads reject channel sources modified after the daily ctime
boundary, because historical source text cannot be reconstructed safely.

Invalid output topics are discarded before the minimum valid-topic check. Valid
references can appear in multiple topics, as in Laravel. Each reference is still
byte-exact. Unrelated malformed/ambiguous channel sources are omitted with counts;
valid channels continue. An hourly topic may reference one source video.

Period generation maps exact titles from two endpoint days. It does not force
keyword/person-similarity matches; the same person or subject alone is not evidence
that stories are the same event. This is a deliberate difference from Laravel's
additional deterministic similarity merge.

Topic caches retain legacy JSON field names, actual video counts and channel
classification weights. News-vocabulary counts are never mixed into these
metrics. Missing durations remain null. Cache journals include observed video
statistics, so refreshed metrics create new revisions. Retention/compaction must
be introduced before long-term production use; bounded journal payloads fail
closed above 8 MB.

## Validation and parity

```sh
AI_DB_TEST=1 DB_DATABASE=youtube_board_test_rewrite DB_PASSWORD=youtube_rewrite_local npm run test -w @youtube-board/ai
```

Tests use only dedicated local fixtures, fake AI providers and cleanup scoped to
owned rows. They cover cross-token isolation, byte-exact source pairing, immutable
lineage, invalid-topic filtering, transient retries, shutdown, legacy lock
contention, scheduled recovery/cooldown, channel failure continuation, six-row
missing-only short circuit, incomplete source crawl, projection repair and CAS
failure. Root `npm run test:integration` supplies all DB flags and runs suites in
a serial isolated lane.

| Legacy job | Local implementation | Remaining parity / handoff |
|---|---|---|
| `ai.channel` | Period, cap, journal, projection | Production provider-quality comparison |
| `ai.daily` | Source-first adapter, channel refresh, six conditions, budget, missing-only | Channel batching CLI aliases |
| `ai.hourly` | Source-first adapter, relative window, implicit/explicit taxonomy, exact IDs | Approved production handoff and source-quality comparison |
| `ai.event` | Summary/people/media, exact evidence, journal/recovery | Multi-event CLI selector; quality comparison |
| `ai.period` | Endpoint-day mappings, grounded titles, projection | Intentional absence of forced similarity merge |
| `ai.daily.catchup` | All-six short circuit, source-first, exact gates | Legacy command aliases and scheduled deployment |
| `ai.days_refresh` | Bounded orchestration, budget, resumable journals | Per-stage legacy CLI budgets/batch aliases |
| `reports.ai_topic.build` | Grounded legacy JSON cache with lineage | Journal retention policy |
| `ai.mayor_person` | Guarded factual quotations, exact source links, capped evidence, journal/replay | Intentional omission of tactical advice and weighted legacy category metrics; production quality/handoff |

All production ownership handoffs, runtime schedules and provider/source-quality
comparisons remain operator-controlled. Local code coverage is not evidence of
production parity. Opus review text is retained in ignored local review artifacts.
