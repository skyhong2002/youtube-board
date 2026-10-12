# TypeScript jobs

Implemented adapters cover shared vocabulary synchronization/matching, YouTube source ingestion, report cache builders, AI pipelines, notifications and guarded channel adoption. See `ingestion/CACHE-PARITY.md`, `ai/README.md` and `notifications/README.md` for exact scope and remaining differences. The optional BullMQ worker and separate recurring producer install no schedules by default. Laravel retains production ownership until each workflow is explicitly stopped, drained and transferred; registration alone is not a handoff.

`tag.observe.tw/api/v1/articles` supports fixed `since`/`until` windows of at most 31 days, cursor pagination and all article tags. This is **not the complete canonical vocabulary**: coverage is `observed-article-window`, and the upstream endpoint has no stable snapshot or change/deletion cursor. A complete local scan can miss edits or late arrivals while paging; repeat overlapping windows. Tags that leave a window are absent from that version, not deleted upstream. Old versions remain available for evidence. Upstream tags mix article keywords, edits and rule-derived fallback; per-term journalist attribution is unknown. The source is credited as 新文易數 tag.observe.tw.

Run from `platform` (local credentials should be provided in the process environment):

```sh
npm run start -w @youtube-board/jobs -- migrate --execute
npm run start -w @youtube-board/jobs -- vocabulary:sync --id=window-20261010 --since=2026-10-10T00:00:00Z --until=2026-10-11T00:00:00Z --max-pages=20
```

The second command defaults to **no network / no writes**. Add `--execute` to actually synchronize after explicitly setting `APP_ENV=local`, `TS_INGESTION_ENABLED=true` and `TS_INGESTION_OWNERS=tags.vocabulary.sync`. Local database host must be loopback/the compose DB and the database name must end in `_rewrite`. Database defaults: `127.0.0.1:23306`, `youtube_board_rewrite`, user `youtube_rewrite`; password is supplied via `DB_PASSWORD`. Redis defaults to `redis://127.0.0.1:26379`.

Caps return incomplete (exit 2), preserve the staged cursor, and leave the published snapshot unchanged. Re-run with the same id and exact window to resume. Published run ids are idempotent and make zero additional source requests. Pages fail closed on invalid payloads. New ids intentionally re-observe corrections in a window. Source calls use a shared fixed-origin paced client: anonymous starts are at least1,100ms apart; an optional personal API key allows a100ms minimum. HTTP429 alone permits at most two bounded Retry-After retries; interruptions keep checkpoints and the current published snapshot. See the rate-limit runbook below.

`worker --execute` and `vocabulary:sync ... --enqueue` also require `TS_SCHEDULER_ENABLED=true`. Production execution additionally requires `TS_INGESTION_PRODUCTION_ENABLED=true`, an exact `TS_INGESTION_WRITE_ALLOWLIST` entry and `TS_INGESTION_OWNERS` recording operator-approved ownership transfer. TS ownership config is an operator assertion, **not an interlock against the existing Laravel scheduler**; disable the corresponding old writer before transfer. The connection-scoped MariaDB lock serializes TS writers and disappears when its connection dies. Writes use that same connection. Do not enable new production jobs as part of deploying these files.

## Full indexed vocabulary export

`vocabulary:import --max-pages=100` previews importing a complete, immutable upstream
snapshot. `--execute` additionally requires ownership of `tags.vocabulary.import`
and the usual production allowlist when applicable. The importer validates the
fixed manifest, each page checksum, total count, binary UTF-8 order and full checksum
before publication. Partial runs retain staged terms but leave current unchanged;
retry replays the pinned pages within the explicit cap. Terms live in a separate
indexed table, preserving historical versions without oversized JSON packets.

Full snapshots take precedence over observed windows; a later window scan cannot
silently replace the complete dictionary. Evidence matching hydrates a fixed
version and uses a cached prefix trie with bounded input, nodes and evidence.
An absent term in a new full snapshot stops new matching but never deletes old
version evidence or claims the upstream editor deliberately deleted that term.

The upstream implementation is prepared in the isolated tag repository
worktree `tag-vocabulary-export`; it is **not deployed**. The importer therefore
fails closed against the public site until that reviewed endpoint is released and
the upstream export workflow is explicitly enabled. Local validation now also runs the real producer and HTTP routes through the real
importer using synthetic source rows and isolated MariaDB; see
[the contract check and release handoff](../docs/vocabulary-export-handoff.md).

## Upstream export contract

The implemented candidate exposes these file-backed contracts:

- `GET /api/v1/vocabulary/snapshots/current`: schema, immutable ID, generation time, count and checksums.
- `GET /api/v1/vocabulary/snapshots/{id}?cursor=N`: exact ordered labels, stable label hash, article counts, provenance, cursor and checksum.
- `GET /api/v1/vocabulary/changes?after=OLD&target=NEW`: immediate-predecessor differences; skipped generations require a full resnapshot.
- No aliases, editorial tombstones or merge history are asserted when upstream does not record them.

The implemented first export uses label hashes rather than invented editorial IDs,
and immediate-predecessor snapshot differences rather than an unbounded revision
log. Its coverage is `all-current-indexed-article-tags`: every current indexed term,
including rule-derived tags, but not archived articles outside that index. Missing
multiple snapshots triggers a full resynchronization. Existing article-window sync
remains available until the reviewed export is deployed; do not claim a live full
dictionary based on that fallback.

## Video matching and evidence

`videos:match --after-pk=0 --limit=100` reads the isolated `urt_video` table and previews matching without writes or external requests. Add `--execute` and include `tags.videos.match` in `TS_INGESTION_OWNERS` (plus the production allowlist when applicable) to persist results. The batch pins one published vocabulary version and returns `nextAfterPk`; follow it for a complete sweep. Start a new sweep from zero to pick up title/description corrections. A single batch is capped at 500 videos.

`ts_video_tag_matches` records even zero-match videos. `ts_video_tag_evidence` stores binary/case-sensitive video IDs, vocabulary version, source, original-text UTF-16 offsets, exact match, contextual snippet and rule version. Source text hashes make replays idempotent. Changed text atomically replaces evidence for that video/version; older vocabulary versions remain available. This evidence says the title/description literally contains a term. It does not establish an entity identity or assign a channel ideology.

Matching deliberately uses case-sensitive, normalization-free source text so every offset can be replayed exactly against the observed input. Latin/number/combining-mark boundaries prevent partial words; longest overlapping phrases win. Variants requiring normalization or semantic disambiguation need a later explicit rule version, with offset mapping. Current per-tag origin is unspecified by upstream.

Queue executions use one attempt: failure and page caps retain their checkpoint but never silently multiply the request budget. Re-enqueuing the same run id retries a failed queue job with the caller's explicit cap; a different time window for an existing run id is rejected. Run ids are hashed for stable queue identities. Timestamps must include a timezone and normalize to UTC. Total scans are capped at 1,000 pages / 50,000 articles; snapshots at 50,000 terms / 8 MB. Smaller windows are required when these limits are reached.

Verification: `npm test -w @youtube-board/jobs` is offline by default. Set `JOBS_DB_TEST=1 APP_ENV=test` and the isolated DB credentials to run MariaDB lock/transaction/evidence integration tests as well. Never point this test mode at production.

`videos:match --changed-since=2026-10-10T00:00:00Z --after-pk=0` provides a bounded correction sweep using `urt_video.mtime`; paginate with the same timestamp and a pinned `--version`. Choose overlapping lower bounds from the previous successful sweep start, and periodically do a full sweep to cover missing timestamps. This does not create an automatic schedule. Bad source identities/oversized matching input are returned as per-row `invalid` results while the page advances; database errors still fail the batch. Unchanged text refreshes source row metadata without rewriting evidence.

`source_observed_at` currently comes from legacy `urt_video.mtime` and means the source row's recorded update time, not a separately verified title capture time. Keep original evidence after a source video disappears for audit/history. Public current-video lists must inner join the current source using binary video IDs, and standalone evidence responses must indicate unavailable source when that join is missing. A lack of source data is not evidence of censorship or intent.

## YouTube workflows

Video statistics, live polling and tag uploads backfill are now executable via the jobs CLI, using the client/quota/writer implementation in [ingestion](../ingestion/README.md). They remain absent from recurring schedules and require their own exact ownership/write gates. Other unported workflows remain listed in `src/ports.ts`.

Integration tests now default to the dedicated `youtube_board_test_rewrite` database. `platform/shared/test-database.ts` rejects the preview database and non-loopback hosts. Tests seed their own vocabulary and source fixtures; existing preview data is not a test dependency.

Full-export verification retains the complete upstream manifest and raw per-term origin, unknown journalist attribution, and publication range. Matching keys preserve exact case and Unicode normalization. A conservative UTF-16 total budget is checked before either publication mode; published full payloads are checksummed again on load. Full snapshots with equal generated timestamps do not replace current; invalid current full metadata fails closed. Window run IDs cannot start with `tag-`.

Interrupted full imports deliberately replay all pinned pages, revalidating every digest; the checkpoint records progress, not a promise of network resume. Incomplete rows remain unreachable from the current pointer. No automatic retention/deletion runs; operator-reviewed cleanup may remove abandoned scanning runs and their terms after confirming no worker holds the vocabulary lock. Dense input above the 10,000 candidate evidence limit fails the whole item without publishing partial matches.

Pre-release full snapshots lacking `upstreamManifest`/`localPayloadChecksum` are intentionally not silently adopted. No such production snapshots were published (the export endpoint is not deployed). If an isolated development fixture contains one, explicitly remove its current pointer and test-owned evidence/terms/run, then re-import the source export after review. Existing observed-window snapshots remain compatible.


## Upstream pacing, daily windows and historical batches

Both article-window scans and full-snapshot HTTP reads use the same rate policy.
Anonymous requests default to1,100ms between starts (including the first request
of each new client); no credential is required. For the site's own approved
worker, `TAG_SERVICE_TOKEN` or `TAG_SERVICE_TOKEN_FILE` supplies `x-service-token`.
The upstream own-service allowance is6,000/minute per service and9,000/minute
across services; missing or invalid credentials remain in the60/minute anonymous
bucket. The client conservatively defaults to100ms (at most600 starts/minute),
not the quota edge, and keeps one serialized request stream.

Optional personal `TAG_SOURCE_API_KEY` or `TAG_SOURCE_API_KEY_FILE` remains
supported via `x-api-key`. Configure exactly one nonempty auth source across
all four variables; conflicting personal/service or env/file settings are
rejected rather than silently choosing a credential. Headers go only to the
fixed HTTPS tag origin and redirects are rejected. No secret file is discovered
automatically; the operator must explicitly configure its protected mount path.
Protect env/files in runtime configuration and never put credentials in CLI
arguments, plans, queue envelopes, URLs or review packets. Files contain one
ASCII token with an optional final newline, at most4KiB.

Both authenticated modes have a100ms default/minimum. Optional
`TAG_SOURCE_INTERVAL_MS` can slow any mode; values below its floor fail closed.
If upstream reports `x-ratelimit-limit:60`, the same client slows to at least
1,100ms for later starts (including retries); it never speeds up based on quota
headers or replaces the configured credential. This limits invalid-token
fallback traffic without logging credentials or interpreting error bodies.

Only429 retries automatically, at most twice after the initial request. The same
policy applies to per-service and services-global quota responses; no body or
scope parsing is needed. Integer
seconds and HTTP-date `Retry-After` values are honored, alongside the pacing floor;
missing/malformed headers use a bounded exponential fallback. A requested
cooldown above60seconds stops rather than retrying before the upstream deadline.
Response bodies from errors are discarded, never logged. Shutdown cancels waits
and in-flight requests. Network failures and other statuses are not retried by
the HTTP client. These are per-writer limits: keep the existing shared vocabulary
DB lock and one consumer; other services sharing the same outgoing IP/key also
consume the upstream quota. The HTTP retry count is separate from the durable
page cap, and retries request the exact same cursor without staging twice.

The scheduler now accepts this **example only**, not an installed schedule:

```json
{"version":1,"timezone":"Asia/Taipei","schedules":[{"id":"tag-vocabulary-daily","workflow":"tags.vocabulary.sync","cron":"17 3 * * *","window":"previous-day","options":{"max-pages":20}}]}
```

It derives the previous Taipei day as an exclusive `[since, until)` UTC window;
other automatic windows or fixed dates are rejected for this recurring workflow.
The existing ownership, production, scheduled-execution and allowlist gates still
apply. Generic scheduling translates into the existing resumable vocabulary queue
envelope. Repeated ticks do not retry failed vocabulary runs: inspect and explicitly
resume their original ID/window through `vocabulary:sync --enqueue`. A day exceeding
the page cap remains unpublished until resumed. Daily windows observe published
articles, not an upstream edit/deletion stream; periodically re-observe old days
with a new plan ID to pick up late corrections. Full snapshots retain precedence.

Generate an offline historical plan (at most366days) from `platform`:

```sh
npm run start -w @youtube-board/jobs -- vocabulary:plan --id=history-20261012 --since=2026-10-01T00:00:00+08:00 --until=2026-10-12T00:00:00+08:00 --max-pages=20
```

The plan splits at Taipei midnight, caps each invocation to20pages, assigns stable
run IDs and specifies a60second cooldown **between invocations, including resumed
batches**. It performs no fetch, DB write or queue submission and has no execute
flag. The authorized operator/agent executes one planned window at a time using
the existing `vocabulary:sync` command; if incomplete, resume that exact ID/window
before advancing. Observe the plan's cooldown rather than enqueueing every window
at once. Reusing a plan ID resumes work; a new ID intentionally re-observes it.
The plan does not merge observed windows into a canonical full dictionary.

No production schedule, sync, upstream export or key has been enabled by these
changes. Public rendering reads only the locally published vocabulary.
