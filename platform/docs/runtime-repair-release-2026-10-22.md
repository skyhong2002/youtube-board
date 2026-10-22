# Runtime repair release — 2026-10-22

Production is `youtube.observe.tw`, Dokploy compose `youtube-board-ts-6oukfq` on
skyhong-blog. Times below are UTC. The legacy deployment was not accessed.

## Source and deployed images

The release branch `release/runtime-monitoring-20261022` starts from the actual
production source `628d13e59563ccd8392cb51b681128d58838f362`. It excludes main's
unrelated AI changes `357749c` and `9415779`.

| Change | Main commits (pushed) | Release source | Production acceptance |
| --- | --- | --- | --- |
| #4 scheduler readiness | `b538a30`, `1e740c6` | `c51bebd` | Healthy scheduler since 14:56:28; historical queue failure retained. Controlled 80-second failing-worker proof retained three failed jobs, one attempt each, with 16/16 ready responses and durable attention. |
| #6 classified reader/readiness diagnostics | `cdafd7b`, `614f58e` | Web `aa33175` | Web-only deployment at 15:10:54; healthy actual task started 15:10:56. Diagnosed live statement deadlines and connection-acquire timeout; outage remains open. |
| #3 insufficient report history | `d295b7c` | `c51bebd` | Natural 15:29 run completed: selected/applied 100, skipped 0, deferred 1; original affected item handled and historical failure retained. |
| #7 discovery failures; #2 dormant comment quota | `f0f2ed5` | `c51bebd` | Natural discovery batches completed. Failure-path visibility has regression coverage; no live all-skipped reproduction claimed. Comment schedules remain zero; collection/UI not enabled. |
| #6 competing event lookup | `a996ce3` | AI-daily worker `dce5c87` | Deployed at 15:22:58 after queue active/wait counts were zero; healthy task started 15:23:04. Natural AI-workload acceptance pending. |

Actual image mapping after the final targeted deployment:

- Web: `sha256:732494ca2b82561031680750f03d0b020d001bec8b2f2e1e66c9781b2baa63bc` (`aa33175`).
- AI-daily worker: `sha256:a12b06a1b682c325defa1c9ee6d07e038f795dd1849ddab8f8ee2a879a7959ab` (`dce5c87cb5b2249fbeb14d815e8fa38286aabbd6`).
- Remaining eight TS services: `sha256:65038431f29a06ff1e989a77b777a60e32c65bdafffd51d691a8a04df3f40861` (`c51bebd`).
- Original rollback image: `sha256:7112ee12168fba952e3d4bcd922d1410e6dd79f63a962bafb0487d0f42f09ec6` (`628d13e`).

This is intentionally a mixed-image compose. Do not use a release helper that
assumes every service has the same old image. Both targeted releases verified the
entire parsed compose except the one image scalar, retained the exact environment,
and wrote private backups under `platform/.local/dokploy/`. Workers remain one
replica, stop-first. No queue replay, scheduler changes, row edits or new AI calls
were used to validate the release.

## Live #6 evidence and minimal query repair

Homepage returned 503 at 15:02–15:03 while the container remained healthy. Logs
identified keyword ranking/term-labels failures; readiness probes alone did not
test those queries. Sampled recovery at 15:04–15:06 was not a repair.

After reader-boundary diagnostics deployed, normal traffic produced
`statement-deadline / ER_STATEMENT_TIMEOUT`, including ranking failure at
15:13:25 and 15:14:42. At 15:15:12, connection acquisition also timed out. Limits
remain unchanged: six reader connections, 24 pending acquisitions, three-second
acquisition deadline, ordinary five-second statements and the existing
15-second keyword statement ceiling.

Bounded read-only observations used two-second SQL deadlines and `SHOW EXPLAIN
FOR` existing connections, without rerunning the expensive requests. At 15:15,
term-labels and ranking used the evidence PRIMARY index (`ref` access); ranking
had several temporary-table/filesort stages. No InnoDB lock waits were observed;
InnoDB physical reads barely advanced. Host CPU/IO pressure varied across the
interval. These observations do not exclude MyISAM reads or establish the cause
of the earlier outage. Performance Schema was disabled; no configuration was
changed to enable it.

At 15:17:40, 15:17:48 and 15:17:57, the AI-daily principal repeatedly executed the
event-video hydration SELECT with `ALL` access, no possible index and an estimated
719,131 rows. The source was `ai/src/event.ts`: casting `videoId` to BINARY in the
only predicate prevented indexed candidate selection. A bounded EXPLAIN of one
captured 44-ID request changed from 719,131 estimated rows to a 44-row `videoId`
index range when adding an ordinary `videoId IN (...)` predicate before the
unchanged binary residual. Only that lookup was changed; source validation,
publication, models, budgets, schedules and backfill behavior were preserved.

An isolated MariaDB test on a connection-local table verifies actual index access,
unchanged exact-case results despite a case-insensitive index, request identity
deduplication, and rejection of duplicate/missing source identities: three passes.
AI typecheck passed. The release image imported the source without network access;
its file SHA256 matched `108d8336cb64b4d4cf9fc97b60c96f7e0873ce89217e261df5d572d51b2f8a97`.

This repairs a demonstrated competing full scan. It does **not** prove that all
ranking failures or historical 502s are fixed. Natural refreshes under ordinary
load and the next existing AI job still need observation; no load test or replay
was started. #5 AI backfill remains unresolved.

After the idle worker was replaced, an existing connection using the AI-daily
principal still ran the old lookup through 15:24. Its observed peer
`10.0.1.117:35198` could not be mapped to a current local container or service VIP;
ownership remains unconfirmed. No unknown process or connection was terminated.
The deployed idle worker's code is verified, but the continuing caller needs an
ownership check before any intervention. By the 15:26 bounded samples this query
was no longer visible; that does not establish completion or ownership.

Reader deadlines continued through 15:26:32, including pool-admission failures at
15:25:24. A single full homepage GET at 15:25:54 returned 200 in 538 ms. This is
explicitly sampled availability while #6 remains open. The separate shared-host
metadata sample at 15:22:41–15:22:57 showed MariaDB CPU at approximately 37–69% with
little physical reading, and CPU pressure higher than full IO pressure; its file
name `shared-host-1527.json` is not its timestamp. It cannot explain earlier 503s
retroactively or attribute them to Infovore.

## Build and operational limits

The initial full Next build exited 137 inside its 1536 MiB limit after compilation;
it was not deployed. Subsequent runtime images retained unchanged production web
and dependency artifacts. API/jobs/ingestion/runtime typechecks passed in the
checked runtime image, and the reader follow-up passed API/runtime checks.
The final event repair image only copies one source file onto `aa33175`, with no
compiler or dependency installation. Build limits were one CPU / 1536 MiB,
nice 19 and idle I/O priority. No host-global limits or other services changed.
Completed owned source staging was removed; recipes, build logs and rollback
images were retained. There is no active build from this work.

The initial Web task rolled back when its sitemap preparation exceeded the
existing startup probe window. A subsequent unchanged deployment completed;
no timeout or readiness relaxation was made. Each targeted deployment retained
the remaining containers and their start times.

## Natural report and retained failure

The natural 15:29 slot completed at 15:29:02.749 with execution
`ac77c081-fccf-49f5-8057-e28ae97c29fc`: selected 100, applied 100, skipped 0,
deferred 1, truncated false. The original affected item was applied and deferred
as `insufficient_history`, retaining its earlier `nextCheckAt=2026-10-22 19:18:28`
(Taipei). Its scheduling row `mtime` advanced naturally to 23:29:01 Taipei.
No manual replay or row update occurred.

The historical report execution
`61f5121d-21f6-4676-a562-ad0a2c830096` remains failed with result SHA256
`2a3f70b26f2f15fe1ba36d32cf94e4cfcff25115026bea782f65edd1e64995ef`.
Its queue failure `37b877900099b6572080fc115d7bbedf4d16e34312a02824fd783dcc19118b1d`
retains failed score `1792679347152`. The old 14:47 failure also remains failed.
Scheduler container `fbf0da555d1c` still has its original 14:56:28 start time;
the new successful run did not erase historical attention or failed results.

Focused tests and quota limitations are also documented in
`issue-repairs-2026-10-22.md`. No PR, GitHub comment or issue closure was created.
