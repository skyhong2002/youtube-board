# F2-07: source view-count missingness, offline investigation

No concrete F2 aggregate/presentation/sorting defect was established. Existing code
preserves an unknown total, labels a known subtotal, and ranks keywords by heat,
video count and source key. This change adds regression tests and source evidence;
it does not change writers, source data, scheduling, or sorting. F2-07 runtime
diagnosis and continued source coverage remain open.

Inspected checkout: `61af6a562a4ff21a7c46530a8ee67825036e59a7` plus these new
tests/document. Frozen APP pin remains
`70529cff13b6b7f5b3e0571a229e2b61660f9df4`; no build or capture was performed.
The [remaining-scope record](youtube-remaining-scope-2026-10-13.md), line 31,
supplies prior evidence that these source NULLs were not introduced by the report
JOIN. This investigation did not independently repeat that live observation.
Laravel remains the production ingestion owner. TypeScript ingestion below is
production-target source, not evidence of an activated TS writer.

## Source paths that can create or retain missingness

| Source evidence | Implication, conditional on the actual runtime row/run |
| --- | --- |
| `database/schema/legacy-dashboard-baseline.sql:609,625,733,742–749,758` | Baseline video/schedule counts permit NULL; video/monthly/history tables are MyISAM, monthly JSON is text, and history counters require non-NULL values. This baseline does not establish the current production schema or column widths. |
| `app/Services/Ingestion/ChannelVideosDiscoveryIngestion.php:287–305` | Discovery upserts snippet metadata and a schedule identity without assigning views. A newly discovered source row can legitimately remain NULL until a separate successful stats run. Existing counts are not explicitly overwritten here. |
| `app/Services/Ingestion/VideoStatisticsPreview.php:32–34,103–140` | Explicit video-id lookup uses `urt_video` without the ordinary date/due filters. `today` uses due `urt_video` rows with NULL views, published within 7 days and strictly before now−2hours. Default selection uses due `urt_video_schedule` rows within 210 days and strictly before now−2hours. Missing schedule identities, older rows, future retry times or recent publication can therefore exclude a missing source row from a particular normal selection. |
| `app/Services/Ingestion/VideoStatisticsPreview.php:30–31,46–52`; `VideoStatisticsIngestion.php:45–50` | The Laravel preview calls the API only for explicit video-id intent or a first batch greater than floor(80% of batch size); the executor also requires nonempty rows. A smaller eligible batch can remain unpolled under that preview. This does not prove any observed gap was caused by the threshold. |
| `app/Services/Ingestion/YoutubeDataApiClient.php:300–325`; `VideoStatisticsIngestion.php:132–145,412–422` | Missing/invalid views, or invalid *present* optional counts, omit the parsed stats item. A missing parsed item defers the selected row and does not assign views. Absent optional counts alone are permitted as unknown. A sanitized `api_item_missing` reason does not distinguish provider omission from parser rejection. |
| `app/Services/Ingestion/VideoStatisticsIngestion.php:66–125,156–165,333–334` | Key-pool exhaustion/quota-window stop the remaining work; other API failures skip a batch before publishing statistics. These API/prewrite failures can retain NULL. Per-item processing exceptions log a reason and exception class, but `item_processing_failed` alone does not prove source values remained untouched: the schedule-source path updates `urt_video` before its schedule upsert, so a later failure can follow a successful nontransactional source write. No current credentials, actual responses or runtime logs were inspected. |
| `app/Services/Ingestion/VideoStatisticsIngestion.php:198–206,270–289,296–334` | Existing monthly JSON is decoded with exceptions before writes; eligible history and monthly log writes precede source statistics. Repeated malformed JSON or failure of a preceding write can repeatedly preserve NULL. Missing optional counts merely skip NOT NULL history when no previous value is known; they do not independently prevent source views being written after a successful monthly write. Source/schedule writes can also fail; MyISAM does not promise rollback of preceding successful writes. |

The monthly-point condition at `VideoStatisticsIngestion.php:254–268` omits an
all-zero view/like point, but source values at 296/302 are assigned the parsed
view count unconditionally afterward. A measured zero is distinct from NULL;
omission of that point alone does not explain a source NULL.

The TS publisher follows the same relevant history-before-source pattern at
`platform/ingestion/src/video-statistics.ts:18–34`. Its JSON helper at
`platform/ingestion/src/legacy-db.ts:34–39` accepts absent/empty storage as an
empty map but rejects malformed/scalar/nonempty-array JSON. Laravel's decoder
at 198–206 has different acceptance details; TS mock results are not Laravel
runtime or full parser-parity evidence. TS selection at 38–43 uses the 7/210 day
sources, due/date bounds and active backoff; unlike the Laravel preview above,
it also permits an aged selected batch to trigger an API call. No activation or
policy change was made to either path.

## F2 coverage and ordering

`platform/api/src/reports/home-exploration.ts:95,104` pairs `COUNT(viewCount)`
with the known-value sum. `COALESCE(SUM(viewCount),0)` is that subtotal only,
with measured-count evidence; it is not a zero substitute for the unknown total.
`home-keyword-ranking.ts:37,53–56` makes total `views` NULL whenever any video
is unmeasured. Its ordering at 60 uses heat descending, video count descending,
then key. `platform/web/src/lib/keyword-ranking.ts:52–57` shows `無觀看值`,
separately labels a partial subtotal, omits a subtotal when no video is measured,
and displays a fully measured zero as `0 次`.

New regressions exercise both supplied aggregate-record shapes and presentation
for partial, all-missing, partial-known-zero and fully-measured-zero cases, plus
heat/tie ordering before and after views become known. They do not execute the
report SQL or prove the actual source/aggregate data is complete.

## Validation and limits

All commands used already-installed local dependencies; no installs, builds,
DB connections, server startup, production access, external HTTP, captures or
probes were performed. Commands were run from the specified package directories:

| Directory | Command | Result |
| --- | --- | --- |
| `platform/ingestion` | `../node_modules/.bin/vitest run test/video-statistics-missingness.test.ts` | 11 mock tests passed. Actual publisher/parser functions, synthetic connection/fetch/ledger adapters, valid/zero observations, rejected JSON, failed history/monthly writes and dry-run query bindings. |
| `platform/api` | `../node_modules/.bin/vitest run test/home-keyword-missingness.test.ts test/home-keyword-ranking.test.ts` | 12 tests passed, including 5 new aggregate/presentation cases. |
| `platform/web` | `node --import tsx --test src/lib/keyword-ranking.test.ts` | 9 existing presentation/markup tests passed. This is not browser/capture evidence. |
| `platform/ingestion`, `platform/api` | `../node_modules/.bin/tsc --noEmit` | Both passed; no emitted build. |

The synthetic connection models one identity per table and assignment/failure
ordering only. It does not verify SQL evaluation, affected-row behavior,
constraints, isolation, locks, transactions, retries under contention or actual
polling. Tests do not establish a historical cause or current production health.

Before runtime closure, the original owner workflow needs a narrowly approved
diagnosis: partition actual NULL rows by age, schedule identity, due/retry state
and prior successful stats/history evidence; inspect sanitized stats outcomes
and installed schema/code; distinguish missing API items from invalid parsed
counts and history/write failures; then use a reviewed bounded preview/execute
path with required backup/ownership gates and compare raw source values and
measured/unknown coverage before and after. No such execution is authorized or
claimed by this offline report, and no manual DB edits are proposed.
