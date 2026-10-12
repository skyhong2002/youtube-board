# Rewrite review corrections, 2026-10-12

The twelve babysit findings were corrected before any production data comparison. No production database was accessed or changed. Reviews were sent to CLI Proxy model `claude-opus-5-5`; actual responses completed normally. Raw local packets/responses are ignored under `.local/reviews/` and temporary agent review files, not deployment artifacts.

| Finding | Correction and regression evidence |
| --- | --- |
| Future video freshness | `video.updatedAt` excludes `urt_video.stime`; a future scheduling fixture does not advance report freshness. |
| Keyword rows disappear after statistics | Worker-shared title/description digest plus source primary key replaces `mtime` equality. Filter and count use the same condition, with stale/unprocessed coverage. Real MariaDB Unicode, escaping and control-character digest tests pass. |
| Schedule timestamp ownership | Schedule-source statistics preserve original `urt_video.mtime/stime`; only `urt_video` source refreshes them. Real database test includes paired previous counters/timestamps. |
| Channel AI selected date | Selected date defines report window; tests include prior-day source rows. |
| Channel active flag | List and profile admit NULL or nonpositive deleted flags. |
| SQL errors | Schema/query defects return500 and safe driver codes; connection/access/timeouts return503. Actual adapter errors tested; no raw query parameters/provider messages logged. |
| Fixture isolation | Dedicated `youtube_board_test_rewrite`, exact loopback/port checks before API fixture connections, shared jobs/ingestion guards. `.env.example` sets fixture provenance. Synthetic vocabulary also retains fixture provenance. |
| Empty event | Empty direct-event query normalized to omitted; corrupt daily associations404. |
| Query length | Shared100 UTF-16-unit limit; overlong board/RSS requests400 without truncation/Retry-After. Actual HTTP100/101 boundary verified. |
| Unported analytics | Initially corrected to explicit501 before streaming; subsequently replaced with a dedicated, bounded source-backed analytics API/UI after MariaDB tests and three Opus reviews. See [video analytics](video-analytics.md). |
| Matching window timezone | `changedSince` converted with Taipei SQL datetime; regression covers a nonzero offset. |
| Vocabulary case rules | Full and observed windows use the same MariaDB lowercase semantics, including Turkish dotted I. |

Combined baseline verification after these corrections: API57 + web21 + jobs26 + ingestion25 =129 passing tests, including all enabled MariaDB cases, plus36 redirect tests. Subsequent provenance regression increased API to58; standalone test-target guard adds1. These counts are a dated checkpoint, not a promise that later work adds no tests. The four existing workspaces and runtime typechecked; new AI work is validated in its own ongoing workstream.

Opus follow-up assumptions checked against source: channel `stime` is included by Laravel's `ReportFreshness` channel-count group and is not the video's future scheduling timestamp; evidence deletion uses the actual composite FK `ON DELETE CASCADE`; YouTube identifier columns use binary collations; API and frontend both count UTF-16 units. No speculative schema or source-semantic changes were made for these findings.

Full vocabulary import also preserves the entire upstream manifest and raw term provenance; verifies strict timestamps, Unicode and hashes; reserves `tag-` IDs across all observed-store methods; locks publication state; bounds matcher capacity before publishing; and revalidates local payload checksums on load. Equal export timestamps retain current. Oversized imports remain staged and cannot move current. Retrying downloads all pinned pages intentionally. The upstream full export remains un-deployed; no pre-release full snapshot is a production dependency.

Additional reader robustness: MariaDB statement deadlines cancel slow SQL and bounded pool-acquisition waits release late connections. Real DB deadline/recovery tests pass; MariaDB timeout errno1969 is explicitly classified because mysql2 does not provide its symbolic code. These changes undergo their own Opus follow-up.

Whole-site parity remains incomplete. Refer to `../api/PARITY.md`, ingestion package notes, and runtime documentation rather than treating a successful route or these tests as complete Laravel replacement.


## Babysit second round

All ten categories were implemented before any ownership transfer. Actual source/AI Opus review records are under `.local/reviews/source-*` and `ai-*`; follow-up findings were corrected rather than treating model approval as validation.

| Finding | Correction and evidence |
| --- | --- |
| AI daily recovery | Bounded 429/502/503/504 retries, durable capped recovery/cooldown, missing-only/catch-up, successful-channel continuation and cooperative 240-second worker shutdown. No automatic ambiguous stalled replay. |
| Hourly all scope | Omitted condition selects NOT [31,41] with all business key; explicit all is scoped consistently. Default token `cli`, Laravel lock vectors verified against PHP. |
| Zero channel counts | Zero-view source response skips with backoff; missing statistics records attempt without fabricated counts/freshness. |
| Cross-writer claims/locks | Laravel-compatible comment claim/renew/release, completed-row exclusion and archived claim time; AI lowercase business locks. Per-workflow Laravel stop/drain remains mandatory. |
| Quota breaker | Distinct quota-exhausted skip state; breaker persistence best-effort; actual MysqlQuotaLedger job-level budget/breaker tests make no provider request after denial. |
| Live uploads due | Live group polling retains ordered group selection without general-upload due filtering. |
| Comments retry/legacy formats | Explicit reset/requeue, bounded larger resumable snapshots, duplicate author/old JSON tolerance, cursor-only pages and excess embedded replies; normal defaults one page (max three), queue cap20. |
| AI validation/schema | Per-topic sanitization, sparse-hour support, invalid channel inputs omitted with coverage; channel120/4096 bounds; exact schema synthetic inference verified through gateway. No production inference performed. |
| Uploads/durations parity | Unordered premiere metadata retained, one-page cadence sampling, missing stats backoff, newest-first missing durations and attempted-row exclusion. |
| Required DB lane | `npm run test:integration` pins isolated `youtube_board_test_rewrite`, enables all DB/Redis flags and fails on absent prerequisites. CI adds same lane plus build; GitHub CI has not yet run. |

The 02:04 local checkpoint passed API142, jobs67, ingestion58, AI61 and notifications31, plus frontend and tool suites with all integration flags enabled. More reports and editorial workflows were added afterward; `.local/integration-latest.log` is the current executed checkpoint, and the final candidate must be rebuilt/retested after those changes.

Additional queue/scheduler reviews corrected status snapshots after connection close, irreversible ambiguous submission tombstones, independent audit/watermark persistence, absent-baseline and clock-skew attention, and shutdown preservation of all known/unknown submission identities. No recurring schedule is enabled by default. The latest root Opus follow-up found no high/medium defect; low-severity raw-byte dump hashing and pre-connection failure diagnostics were also fixed.

The local backup drill now pins Docker and DB identity, restores only to a new disposable database, checks rows/base-table DDL/triggers/database charset, retains private hash diagnostics, and rejects unsupported views/routines/events. It passed 84 tables, 6 triggers and 618 preview rows; production backup/restore is still unverified.

After migration011, the 02:59 local restore rehearsal again passed exact rows, DDL, schema and triggers:85 tables,8 triggers,618 preview rows. Private manifest `.local/restore-drill/920f07381a374f719361b9a8051151b9/manifest.json`. Docker-specific ignore rules now exclude all `.local` review/restore scratch data from build context.


## Babysit third round

| Finding | Local implementation and review result |
| --- | --- |
| Hourly Telegram handoff | Laravel-compatible UTC hourly / Taipei daily slot claims, recent legacy-activity refusal, PHP-compatible title/cache encoding and seen markers after delivery. Manual uncertain→sent reconciliation also writes the verified marker atomically and requires cache-store/prefix attestation. Real MariaDB tests use fake senders; stopped-writer handoff remains mandatory. Four actual Opus reviews completed. |
| Merge reversibility | Accepted explicit-warning option: signed preview and console/execute control clearly state merge is irreversible; split cannot restore prior alias identity or deduplicated active snapshot. No unmerge is promised. |
| Public audit history | Migration011 indexed event/audit lookup and merge targets, existing audit backfill, bounded indexed global latest100, combined source/history payload budget and optimistic revision409. MariaDB23 plus pure capacity3 passed; actual second Opus review found no verified blocker. Migration runbook requires all editorial writers stopped until new-code deployment/backfill verification. |
| Audit actor wording | Console explicitly identifies one shared server service account; audit cannot identify the individual behind a shared credential. |
| Story snapshot stability | Hash captures stable ID/story key/title/first-seen fields, so polling-only changes preserve preview and unchanged refresh semantics. |
| Optional channel AI | Known capacity bounds, connection faults and optional missing AI sidecar degrade each affected profile section with stable coverage states. Unknown-column/schema programmer errors still surface500. Actual MariaDB40 and three returned Opus reviews passed. |

The03:05 packaged checkpoint passed local readiness/pages/RSS/redirects and idle web/worker drain. See `../runtime/REVIEW.md` for exact counts, image identity and remaining production-validation limitations. Further report parity work continues; this correction checkpoint is not full migration completion.


## Babysit fourth round — verified 2026-10-12

The current source and the final1,029-test isolated-lane log were independently
checked by Codex; no new test execution is claimed by this audit.

| Finding | Verified correction |
| --- | --- |
| Live aggregate routes missing | `/live/channels`, `/live/hours` and `/live/trends/daily` are registered; route-level MariaDB tests cover their reader integration. |
| Global keyword fallback reads unrelated videos | Binary literal title/description SQL prefilter precedes source budgets; maintained evidence determines final inclusion. No-tag fixtures with10,001 unrelated videos and unavailable-vs-schema-error cases pass. Optional fallback caps return unavailable coverage, while mandatory cache-read caps retain422. |
| Legacy query compatibility | Redirects clamp ranking/page bounds, map comment limit to sourceLimit, use default sort for invalid legacy columns and media for unknown legacy groups; modern validation remains strict. |
| Duplicate comment source videos | Category archive join selects the latest byte-exact video PK. The duplicate-video fixture verifies source limits, newest metadata and unchanged participation counts. |

Detailed file/test evidence: ignored `.local/reviews/round4-current-codex.md`.
The audit corrected stale fallback422 wording in `api/CLOUD-DAYS-PARITY.md`;
this was a documentation inconsistency, not an outstanding implementation defect.
Production acceptance and documented source-contract differences remain separate.
