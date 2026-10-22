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
| #3 insufficient report history | `d295b7c` | `c51bebd` | Natural 15:29 and 15:47 runs completed: each selected/applied 100, skipped 0, deferred 1; original affected item handled and historical failure retained. |
| #7 discovery failures; #2 dormant comment quota | `f0f2ed5` | `c51bebd` | Natural discovery batches completed. Failure-path visibility has regression coverage; no live all-skipped reproduction claimed. Comment schedules remain zero; collection/UI not enabled. |
| #6 competing event lookup | `a996ce3` | AI-daily worker `dce5c87` | Deployed at 15:22:58 after queue active/wait counts were zero; healthy task started 15:23:04. Natural AI-workload acceptance pending. |
| #6 derived-report marker join | `ba8594d` | Web `dba0a00` | Web-only deployment submitted 15:37:22; task started 15:37:34, sitemap ready 15:38:43, healthy/update completed by 15:38:57. Normal-traffic observation continues. |

Actual image mapping after the final targeted deployment:

- Web: `sha256:d83c340590678896480647e80bce3a8bb450897d36010d652e176015db652578` (`dba0a00b72bb04ef875bf0755875826f3935202e`), superseding `aa33175` image `sha256:732494ca2b82561031680750f03d0b020d001bec8b2f2e1e66c9781b2baa63bc`.
- AI-daily worker: `sha256:a12b06a1b682c325defa1c9ee6d07e038f795dd1849ddab8f8ee2a879a7959ab` (`dce5c87cb5b2249fbeb14d815e8fa38286aabbd6`).
- Remaining eight TS services: `sha256:65038431f29a06ff1e989a77b777a60e32c65bdafffd51d691a8a04df3f40861` (`c51bebd`).
- Original rollback image: `sha256:7112ee12168fba952e3d4bcd922d1410e6dd79f63a962bafb0487d0f42f09ec6` (`628d13e`).

This is intentionally a mixed-image compose. Do not use a release helper that
assumes every service has the same old image. The targeted releases verified the
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

After the idle worker was replaced, old queries continued from successive temporary
CLI containers. Read-only socket/cgroup inspection at 15:35 mapped DB connection
18017 (`10.0.1.122:43922`) to network namespace 4026534857, PID 3958062 and container
`42bc32716d25` (`priceless_lovelace`, old aa33175 image). Docker launcher 3958010
belonged to login session 240406, under `run-aidaily-eve` and `ai-events-retry`.
The existing `/tmp/ai-events-retry.sh` calls `/tmp/run-aidaily-events-cli.sh` with
`days-refresh --execute --retry-failed --skip-daily --skip-cache`. Script-fact
inspection confirmed the launcher reads the Web service's current image each
time. No argv containing credentials, SQL literals or environment values was
recorded. This work neither started, changed nor stopped that external retry
loop.

Follow-up inspection corrected an initial assumption about automatic uptake:
container `1b64b665a7aa`, started 15:38:59, already used the new dba0a00 image but
mounted `/home/ubuntu/event.0-legacy.ts` over `ai/src/event.ts` and
`/home/ubuntu/daily-source.edd8eb6.ts` over `ai/src/daily-source.ts`, both read-only.
Its event source SHA256 was `6a51fd5ad43161e7ad061984eacb68f29e1407c600d37532e06ce5c691714ec8`,
so changing the image alone cannot replace this old query. Live EXPLAIN still
showed the approximately 719,180-row full scan at 15:43.

A zero-write preview verifies that applying exactly the tested `a996ce3` query
change, with every other byte preserved, produces SHA256
`91b1009539036d228b2278f35619b2f464af629cabf563e4bf4eaa841b0eff77`.
The scratch repair script checks both hashes, preserves ownership/mode, makes a
backup and atomically replaces the file so an existing bind mount keeps its old
inode and only future invocations change. It has **not** been applied by this
implementation task. The user selected **root coordination with the existing
session** to adopt this one-query repair. Root owns that follow-up; no additional
approval request is pending here. The daily-source override, current process and
retry loop remain untouched by this task. Before adoption, root/the owning session
should confirm the original hash still matches; after adoption, verify a future
invocation mounts the repaired hash and uses the indexed plan. The prepared
script is `youtube-repair-event-overlay.py` in the scratch evidence directory.

## Derived-report join defect (#6)

Normal Web traffic at 15:32:38 and 15:32:47 exposed another repeated expensive
SELECT, in `api/src/reports/derived-cache.ts`. Its UTF-8 source identity was
compared directly with an ASCII match identity. Live EXPLAIN showed approximately
42,548 source candidates joined to an `ALL` scan of 96,632 marker rows with a
block nested-loop join, because the cross-charset equality did not use the
marker PRIMARY index.

The minimal change converts the outer source identity to ASCII for indexed
candidate selection and preserves the existing binary residual for exact identity
and lossy-conversion rejection. A bounded production EXPLAIN changed marker access
from `ALL`/96,632 rows to `eq_ref`/PRIMARY/one row; no index, schema, capacity or
timeout settings changed. Nineteen isolated MariaDB derived-report tests passed,
including actual PRIMARY access, exact results before/after and case-distinct
video identities. API typecheck passed. The deployed file hash is
`8bdbdb80201bcf4a1e64036a654c4165665de75a380d12f6d69c2a3c3c213be6`.

The `dba0a00` image is a single-file COPY layer onto `dce5c87`; it also carries the
event identity fix for future CLI invocations using the Web image. The 15:37:22
rollout was planned, with old/new Web processes overlapping under unchanged
start-first policy. Root's shared-host sample `shared-host-1538.json` covers this
rollout: new PIDs 3971589/3971590 belong to the production task `c2e5de38929b`,
not diagnostic or candidate servers. Sitemap generation finished in 42.115 s.

At 15:39:43, the new process still recorded a ranking statement timeout under
shared load. A single normal API read at 15:40:38 returned 200 in 1.714 s but
reported `derived.status=unavailable`, `reason=read-budget` with zero rows; it is
not complete report acceptance. The unchanged budget and coverage semantics were
preserved. #6 remains under investigation; neither SQL repair establishes a
complete historical 502/root-cause resolution.

At 15:44:58, a normal `/api/v1/home` read completed in 354 ms with categories
`available` and weekly/today keyword sections `synchronized`. Both keyword windows
advanced to 15:39:59; this proves successful section generation after the failed
15:39 refresh, not just an HTTP status. Subsequent reader statement deadlines at
15:46:46.516 and 15:47:39.380 (the latter with two coalesced diagnostics) invalidate
any sustained-recovery claim. Neither log identifies the failing report stage,
so these occurrences cannot be attributed to ranking specifically. Web remained
the same healthy task through the 15:50:36 capture.

Bounded observations at 15:50:37–54 verified the deployed derived-source marker
join on an actual Web query: `m` used `eq_ref / PRIMARY / rows=1`. The outer video
scan used the PRIMARY index with an estimate of 719,200 rows at one second elapsed;
that snapshot alone does not prove another defect or actual rows consumed.
The external CLI still executed the old `ALL / 719200` event lookup in the final
sample. CPU PSI some avg10 was 24.75–27.94%, IO full avg10 0.31–1.42%; InnoDB
physical-read counters stayed unchanged and no InnoDB row-lock waits were seen.
These interval-specific metrics neither explain all prior outages nor establish
causality for the latest deadlines. #6 remains open pending external-source
adoption and subsequent natural workload acceptance; no additional deployment
was made after dba0a00.

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
The event and derived-join follow-up images each copy one source file, with no
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

A second natural run, `9e8a9d1b-c49d-4a53-a9e5-275a3800f37c`, completed at
15:47:04.199 with the same selected/applied 100, skipped 0, deferred 1 and
truncated false. The original item again recorded `insufficient_history`,
preserved `nextCheckAt=2026-10-22 19:18:28` Taipei, and naturally advanced its
scheduling row `mtime` to 23:47:00 Taipei. The failed result hash remained
unchanged. This validates repeated scheduling without postponing the earlier due
time; it does not claim an additional source observation or growth estimate.

The historical report execution
`61f5121d-21f6-4676-a562-ad0a2c830096` remains failed with result SHA256
`2a3f70b26f2f15fe1ba36d32cf94e4cfcff25115026bea782f65edd1e64995ef`.
Its queue failure `37b877900099b6572080fc115d7bbedf4d16e34312a02824fd783dcc19118b1d`
retains failed score `1792679347152`. The old 14:47 failure also remains failed.
Scheduler container `fbf0da555d1c` still has its original 14:56:28 start time;
the new successful run did not erase historical attention or failed results.

Focused tests and quota limitations are also documented in
`issue-repairs-2026-10-22.md`. No PR, GitHub comment or issue closure was created.
