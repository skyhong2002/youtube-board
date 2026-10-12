# Video analytics rewrite

`/videos/:id/analytics` now has a dedicated read-only API and Next.js report. It reads exact-case `urt_video`, `urt_video_live_log`, `urt_video_log`, and completed `urt_comment` rows. It shows hourly/daily concurrent-viewer peaks, historical public statistics, hourly/daily comment counts, author totals, and top liked comments. Ordinary video overview remains a separate tab.

Each series returns its latest `limit` points (1–200; default 50); rankings return the top `limit`. Missing observations remain null or absent. Source freshness excludes scheduling `stime`. Taipei dates are preserved, comments include replies, and unfinished comment batches never expose their payloads. Both Laravel and TypeScript writers define `comments_count` as threads plus replies.

Bounds: latest 366 live records and 120 monthly statistics records; each log family has an independent 4 MiB SQL transfer budget and 64 KiB per-row maximum. Comment batches accept at most 8 MiB text plus 2 MiB author metadata, additionally capped below the server's `@@max_allowed_packet` with 64 KiB overhead reserved. At most 20,000 comment/reply entries are interpreted and each displayed text is limited to 10,000 Unicode codepoints. Coverage reports skipped bytes/rows, invalid entries/times, duplicate IDs/dates, missing IDs, and truncation. SQL cumulative byte budgets conservatively count oversized rows, so later eligible rows can also be omitted; omissions remain visible.

Intentional interpretation differences: live daily/overall peak combines both recorded `max_current` and valid samples (legacy daily chart used samples alone). Comment original text is preferred and React-escaped; display HTML is stripped only when original text is absent. No missing statistics are synthesized as zero.

## Runtime and validation

The rewrite compose target is MariaDB 11.4. The bounded log queries require window-function support (MariaDB 10.2+); production handoff must verify a supported server before enabling the rewrite. Local validation used MariaDB `11.4.12-MariaDB-ubu2404`, `max_allowed_packet=16777216`, mysql2 `dateStrings:true`, and the dedicated `youtube_board_test_rewrite` fixture database. This does not constitute production inspection or write approval.

Focused tests: 10 parser/API tests plus 6 real MariaDB tests passed, including ID case isolation, pending payload exclusion, future scheduling freshness, missing/invalid statistics, Unicode truncation, oversized author blobs, and SQL live-transfer budgeting with independent history retained. API/web typechecks and 22 web tests passed. Native-browser desktop inspection and HTTP 200/400 checks use the explicitly labelled synthetic preview dataset.

Three actual Opus 5.5 review responses are retained locally in `.local/reviews/video-analytics{,-followup,-final}.json`. Final review found no concrete blockers to local preview integration. Production migration/approval remains a separate release gate.

## Video overview comment summary

`/videos/:id` now includes `commentSummary` beside the independent `video.comments` provider total. The overview labels the latter as YouTube's public count, while the archive summary shows stored batch counters and successfully decoded comments/replies/accounts separately. Those numbers are not a coverage percentage and are not expected to match the provider count. The summary links to the full analytics report.

Both readers use the same `loadVideoComments` bounded byte-exact SQL and `parseVideoComments` interpretation. Missing, pending, malformed and oversized sources expose null decoded counts in both analytics and summary (including coverage metadata); a valid empty completed batch remains zero. A truncated batch is explicitly partial. Pending batches expose neither payload, stored counters nor freshness. The summary separately labels the latest source comment time and the archive row's observed update time; neither reads scheduling `stime`. Duplicate/invalid/unnamed entries retain the analytics coverage semantics.

The summary still decodes the bounded archive to preserve accurate deduplicated counts, but its parser mode retains no comment result rows, builds no chart arrays and performs no ranking sorts. Payloads over the comment-byte cap suppress both comment and author text at SQL level. The video overview's preexisting video/duration/history/live queries now also use indexed-plus-byte-exact identity predicates, matching analytics for IDs differing only by case.

Focused validation: 22 tests passed (13 parser/API, 9 real MariaDB), API/web typechecks passed, and 23 web tests passed. Tests compare summary versus actual analytics across all six statuses, separate provider count from archive count, verify SQL excludes oversized author transfer, preserve latest-comment/observation timestamps, and check case-colliding video IDs. Native browser inspection at390px confirmed the new summary, fixture warning and analytics link without horizontal page overflow. Three actual Opus reviews completed; the final two returned no blockers. Findings were addressed: null coverage counts, no summary ranking work, SQL author exclusion and failure-safe fixture restoration. Review packets/results live in `.local/reviews/video-comment-summary{,-followup,-final}.json`. No production access or data handoff occurred.
