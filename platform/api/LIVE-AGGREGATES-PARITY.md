# Live aggregate reports

This slice ports the concrete `LiveChannelsReport`, `LiveHoursReport`, and `LiveDailyTrendReport` contracts. It is SELECT-only and does not change ingestion ownership or the previously reviewed current/day/period/group-hour reports.

## Periods and controls

All three reports default to the latest global log date when it is at or before Taipei today; otherwise they use today. Laravel's inclusive days-back behavior is preserved: default `days=7` includes eight dates. The UI labels the actual interval and its inclusive date count. Channel `date` takes precedence over a range; hours supports `today` as an end-date offset; daily supports `from=year` and `today=1` as the distinct end-day chart inclusion flag. These parameters retain their route-specific meanings.

Hours permits31days lookback /32inclusive dates. Channels and daily permit366days lookback /367inclusive dates. The same ceilings apply to explicit ranges. Invalid calendars, dates outside2022-11-19 through today, reversed or oversized ranges return400 rather than Laravel's silent replacement, clamp or swap. A request captures one clock value. Inferred starts are clipped at the source beginning with a description notice; explicit out-of-range starts remain errors. `from=year` uses the requested end year rather than silently swapping a prior-year end. Hours/daily reject hidden single-date controls, and daily rejects hidden channel/text filters because its comparison is all-channel, matching PHP. Channel navigation and category/search controls are exposed; daily exposes all five groups and both metrics.

## Channel ranking

Only positive, safely representable stored `max_current` values contribute. Each legacy log row contributes separately to the channel sum and observation-row count, including repeated video/date rows. Rankings sort the sum descending, then channel ID. The maximum source row, breaking ties by newest date and PK, supplies the linked video, peak date and peak value; exact-case video IDs select display/raw fallback titles. The reviewed visible channel-category subset is included.

This deliberately differs from the former TypeScript implementation, which ranked single peaks, deduplicated video/day rows and mixed JSON sample maxima into these totals. UI labels now say **source-row peak sum** and **positive observation rows**, never unique videos or cumulative viewers. Null and zero stored maxima do not become channel-ranking rows.

## Hour/date matrix

The matrix has24hour rows and one column per requested date, with views/count controls, per-hour available-date totals, daily totals/observed-hour counts and source labels. Missing cells remain null; actual zero is retained. A daily count is video-hour observations, so a video measured in two hours contributes twice.

For each exact sorted all/any/excluded category selection and date, the latest cache metadata is read first. Only `hour_result` bodies are fetched, at most128KiB each and32dates, so unrelated cache blobs are never transferred. Missing/changed, oversized, empty or malformed existing bodies stay missing with visible notes; empty caches are never called populated published sources. Legacy caches have unknown vocabulary lineage; published TS buckets retain their recorded window notes.

Publication sidecars are consulted for **every requested date, including dates with no physical cache row**. Pending or unknown-view dates never fall through to source samples. A missing cache date may use bounded raw samples; a text search uses samples on lineage-visible dates because the precomputed category cache cannot answer a text predicate. This per-date cache/source composition is disclosed and deliberately improves Laravel's whole-window any-cache behavior.

Raw samples use the previously reviewed20,000-row,128KiB-per-row and8MiB-total loader. Repeated rows are deduplicated by exact video/date/hour with the maximum valid sample; the hourly matrix sums those video peaks. Sample omissions are disclosed globally and per source date. Stored daily peaks never substitute for missing hourly samples. Results are measured lower bounds, not same-instant online totals or complete24-hour totals.

## Daily category trends

The five group definitions are exactly `party`, `news`, `main`, `media`, and `china` from the PHP report. Values derive solely from positive stored log-row peaks and the channel's category membership; duplicate category IDs within a channel are deduplicated, while duplicate log rows remain separate observations.

Each chart point follows the original rounded **seven-date source sum divided by7**, with six warmup dates read before the requested interval. Its compact coverage table reports each category’s partial-window count and minimum/maximum positive-observation days out of7. Partial windows retain the original fixed divisor but are explicitly called observation lower-bound statistics, not complete seven-day averages. A window with no positive observations remains null. Category summary totals cover the requested dates including the final day. Charts default to excluding that final day, with a visible option to include it; a single-day window remains visible.

Groups overlap and cannot be summed as unique viewers. Source-row peaks, source samples and cached hour metrics are clearly distinguished. Stored source readers filter positive peaks and aggregate in SQL before transfer, preserving duplicate-row semantics. Daily groups date/category-string; channels group channel/category with a separate bounded peak-row lookup. The20,000 transferred aggregate-row cap and safe-integer sum checks fail422 on overflow; no log JSON is fetched. A20,001-source-row stress case validates that transfer bounds do not truncate real source totals. Query deadlines still bound server work.

## Validation

Focused validation passed62 API tests:10new pure and6new MariaDB aggregate cases,9prior live pure and4prior live database cases,27core database and6edge regressions. API typecheck passed. Fixtures cover repeated rows, case-distinct video IDs, stored/sample divergence, exact cache selection, missing-date fallback, real zero versus null, pending and unknown-view absent-row lineage, warmup/divisor coverage and end-date controls, plus20,001zero/positive source rows. Pure tests cover cache parsing, malformed/empty/oversized/changed bodies, per-date partial-sampling notices, SQL sum overflow, hidden-filter rejection and inclusive bounds. Native browser checks at390px confirmed the matrix and daily group/metric/coverage controls without horizontal page overflow.

Two actual CLI Proxy `claude-opus-5-5` reviews returned text (`.local/reviews/live-aggregates*.json`). The second found no remaining P1 blockers. The assumed duplicate-count risk is excluded by `urt_count.u_id` PRIMARY KEY in the baseline schema. A subsequent focused11-test run also verifies the new no-usable-source-samples label; API typecheck passed after that change.

Scalability limit: the20,001-row fixture covers few channels, not thousands of distinct channels. The channel peak lookup is correlated per channel and may hit the existing query deadline on very broad production-sized selections; it fails closed rather than returning truncated totals. This unverified performance case remains explicit pending a representative approved dataset. No production data was inspected for these tests.
