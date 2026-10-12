# Report and detail UI alignment

The report/detail layer follows the actual `tag.observe.tw` source in the read-only
`/home/deck/Projects/tag.analysis.tw` checkout. Product identity is 有影儀表板;
red branding belongs to the shared shell. This change preserves the existing API,
source coverage, publication status and distinct news/YouTube metrics.

## Source mapping

| Mother source | Adaptation |
| --- | --- |
| `web/src/app/(site)/ranking/page.tsx` | 24px semibold title, compact metadata, filters, ranking table |
| `web/src/app/(site)/tag/[tag]/page.tsx` | Shared term controls, coverage and source links |
| `web/src/app/(site)/eve/[id]/page.tsx`, `sections.tsx` | Event breadcrumb, section jump links, source headline comparison, timeline and history |
| `web/src/components/SectionTabs.tsx` | Horizontal tabs, neutral track, selected white/dark panel |
| `web/src/components/ArticleResults.tsx` | Compact pagination; query state retained, empty later pages have a return link |
| `web/src/components/TagChartCanvas.tsx` | ECharts legend/grid, small locked-width slider and loaded-range controls |
| `web/src/lib/graph-tooltip.mts` | Non-HTML tooltip output; rendered chart uses richText mode |
| Shared `TableScroller` / table primitives | Sticky leading column, mobile horizontal scrolling and small stacked tables |

Relevant implementation: `ReportUI`, `Filters`, `ExpandedReport`, `Charts`,
`EventAnalysis`, `VocabularyReport`, public `events` routes, `report-styles`,
`chart-window`, `ObservationValue`, and `editorial-history`.

Charts preserve null gaps and show isolated points. Window presets and panning
only navigate the already loaded points; they do not fabricate or fetch samples.
The full numeric table is available even if ECharts cannot load. Missing values
have explicit screen-reader text and remain different from observed zero.
News article counts remain labelled 新聞文章數; vocabulary provenance remains
visible, including the distinction between a windowed observation and a full
upstream indexed-article-tag snapshot.

## Validation

- `npm run typecheck -w web`: passed.
- `npm test -w web`: 32 passed, zero skips at the final shared-tree checkpoint.
- `git diff --check`: passed.
- New tests cover range clamping, null/zero accessible rendering, merged-event
  rename provenance and unsafe citation fallback even if the API is bypassed.
- Live browser preview used the Tailscale address `http://100.85.214.25:3100`.
- Desktop 1280×800 and mobile 390×844 ranking pages compared with the mother site.
- Mobile vocabulary and reports: viewport and page scroll width both 390px.
- Ranking table: 1780px content scrolls inside 356px container; setting scrollLeft
  to 200 worked without widening the page.
- `/live/hours?from=2026-10-11&to=2026-10-11`: 24 points, one observation, 23 nulls.
  Latest-seven preset displayed 17:00–23:00; earlier displayed 10:00–16:00 and
  cleared the latest-preset selection. The isolated point remained visible.
- The chart's SVG text changed from `#71717a` to `#a1a1aa` when switching light to
  dark via `data-theme`. Layout also observes system preference changes and writes
  that same attribute when no explicit theme preference is stored.
- `/channels/990001/trends?offset=100`: total30, empty current page, previous link
  retained (`offset=50`).
- Editorial directory empty state and fixture AI daily-event source detail checked.
  The preview has no editorial events, so a populated editorial detail screenshot
  was not claimed; merged rename presentation is covered by a dedicated test.
- A browser-discovered encoded-keyword heading defect was handed to the shell
  agent and fixed at the Next route parameter boundary. Recheck showed 交通逐日排行.

## Review evidence

Two actual `claude-opus-5-5` CLI Proxy reviews returned text:

- `.local/reviews/report-ui-review.json`
- `.local/reviews/report-ui-followup-review.json`

The follow-up found no remaining high-severity correctness blockers. Confirmed
issues were corrected: accessible missing values, empty-page pagination, merged
rename identity, range-control ARIA, clear-path consistency and safe citations.
Minor follow-up fixes added external-link screen-reader hints, nonfinite-cell
fallback and suppressed metric units for missing values. The theme mechanism and
pagination initial-empty guard were verified directly in layout/ReportUI source.
Highlight contrast is 5.91:1 light and 5.84:1 dark.

## Local visual evidence

Comparison images (mother left, rewrite right):

- `.local/evidence/report-ranking-desktop-comparison.png`
- `.local/evidence/report-ranking-mobile-comparison.png`

Original browser screenshots:

- Mother desktop: `/home/deck/.t3/userdata/browser-artifacts/browser-screenshot-tag-observe-tw-mv49f3cv-b6d895a6.png`
- Rewrite desktop: `/home/deck/.t3/userdata/browser-artifacts/browser-screenshot-100-85-214-25-mv49ecoy-f4b03caf.png`
- Mother mobile: `/home/deck/.t3/userdata/browser-artifacts/browser-screenshot-tag-observe-tw-mv49jxng-7bbefbb6.png`
- Rewrite mobile: `/home/deck/.t3/userdata/browser-artifacts/browser-screenshot-100-85-214-25-mv49kqmt-029c70bf.png`
- Mobile vocabulary: `/home/deck/.t3/userdata/browser-artifacts/browser-screenshot-100-85-214-25-mv49h1xc-66470e95.png`
- Mobile dark chart: `/home/deck/.t3/userdata/browser-artifacts/browser-screenshot-100-85-214-25-mv49jvrj-d87e3eb8.png`

These preview data are explicitly labelled synthetic fixtures. No production
reads, writes, DB reseeding, deployment or API changes were performed in this UI slice.

## Navigation follow-through

A subsequent reader-flow audit found and repaired these concrete navigation defects:

- The AI event analysis tab omitted its required `event` query and returned400.
- Keyword/tag video and tag channel lists did not expose their sibling reports.
- Sibling tabs discarded the selected explicit period and compatible taxonomy.
- Content-term groups advertised ranking/trend/live pages that only channel groups support.
- Event people/wall/history lacked a path back to the same analysis.
- Comparison, daily prompt preview and non-default wall variants lacked discoverable entries.

`report-navigation.ts` now owns the navigation policy. Tests use an explicit
source/destination matrix and resolve every generated tab through the public
route table. `from`/`to`, taxonomy and compatible identifiers are retained.
Route-specific sort, metric, relative-day/hour controls and pagination never leak
to sibling reports with different meanings or bounds. Same-page source `pk` and
controls remain intact. Day-only views use the selected interval endpoint;
channel prompt preview receives one date, matching its one-day workflow.

AI identifier semantics remain those of the reviewed API: a daily path requires
`event`; the legacy `/ai/events/:id?event=...` alias also means daily ID; a plain
`/ai/events/:id` pins an event primary key. Pinned links never gain an `event`
parameter. The renderer receives canonical URI-encoded paths from the Next
boundary; literal percent keyword tests ensure decoding happens only once.

Browser validation confirmed that event analysis→people→analysis retains the
same title/ID; keyword videos expose sibling tabs with the same explicit dates;
`/groups/tags_economy` no longer links to404 metrics; dated AI tabs are active;
`/channels/990001/ai/days?pk=990001` retains its source selector; and a channel
prompt preview opens successfully without attempting generation. Comparison
controls and keyword tab strips retain390px page width.

The remaining differences are intentional: YouTube-specific playback/analytics,
separate news versus video metric units, explicit synthetic preview warnings,
and explicit editorial review before joining events. The only remaining public
“YouTube Board” prose found by the audit describes the legacy project's history
and links to its old site; product branding is 有影儀表板.

Navigation review completed with three actual Opus responses in
`.local/reviews/navigation-flow-{review,followup-review,final-review}.json`.
The final response reports no remaining mandatory issues. Channel AI overview
links deliberately discard `date/days/type` because those parameters invoke its
legacy daily-report alias; this keeps overview and daily provenance distinct.
Whitespace-only event names follow the API's trimmed absent-value semantics.
The final checkpoint passed web typecheck,40 web tests and the new no-DB
`api/test/navigation-routes.test.ts`, which compares generated links with the
actual API registration list returned by `/status` (populated by register calls).


## Named classification / channel filters (2026-10-12)

Video and live forms now use source-backed name selectors, following the mother
site's compact neutral controls and red selected chips. They retain canonical
`tagid` / `or` / `not` comma semantics; `channelId` (single source `u_id`) remains
separate from the existing `channelIds` list condition. Duplicate query values
stay visibly invalid and retain every original hidden value until cleared.

`/api/v1/filter-options/{tags|channels}` returns only names and source IDs, capped
at20 plus a sentinel. Search is bounded to100 characters /400 bytes, resolves
selected IDs in batches of20 with concurrency3, and applies channel `flag_del`
and taxonomy `del_flag` active predicates. It performs no statistics count/join.
The existing Reader server-side5-second query deadline also bounds name scans.
The same-origin `/options` proxy has a fixed destination and validates exact
response identities; failed/missing selected names retain removable source IDs.
The controls provide abortable search, error/retry, keyboard options, Escape
focus restoration, close on Tab leaving, and trigger focus after chip removal.
Same-name selections display their source IDs.

Local fixture browser checks at390px verified actual source-name selection,
GET submission preserving the chosen channel/category, name search, missing ID
removal, error state retaining conditions, pending request cancellation on Escape,
and no horizontal overflow. Browser fetch override used for pending cancellation
was restored immediately. Mobile selector capture:
`/home/deck/.t3/userdata/browser-artifacts/browser-screenshot-100-85-214-25-mv4anqxv-af5b07bc.png`.
No production or DB writes were performed for this slice.

Editorial video source references also expose a local video observation link,
while preserving the original source link and provenance. This link does not
assert that a local observation exists; absent video reports keep the existing
unavailable/not-found state. Tag-comparison date controls default to the actual
returned first/last series date, avoiding blank range submissions.


Picker review validation: actual `claude-opus-5-5` responses are stored in
`.local/reviews/filter-picker-review.json` and `filter-picker-followup-review.json`.
Findings fixed include duplicate-value truncation, exact selected response ID
partition validation, per-batch exception isolation, same-name identity labels,
chip focus restoration, persistent live announcements, and inactive taxonomy
filtering. A null-relatedTarget focusout now leaves the popup mounted (outside
pointer events still close it), verified against real browser DOM followed by
successful option click. Invalid source conditions require explicit clearing
before selection. Comparison controls now enforce required enabled dates,
normalize ISO date points and visibly preserve ambiguous repeated parameters.
At this checkpoint:48 web tests and5 focused API tests pass, with web typecheck
passing; no database test lane was run for this bounded read-only UI slice.
Final returned review `filter-picker-final-review.json` reports no remaining
mandatory defects. Both API and web typecheck pass. Resolution notes record
upstream scalar-date validation and ascending comparison point ordering.

A subsequent native-browser check found uncontrolled filter state surviving
Next.js soft navigation (keyword live group URL/title switched from media to
position while the select still displayed media). Generic report, video/live
and comparison forms now remount for their current route/query/filter values,
so submitting after a tab transition retains the displayed route's conditions.
This bounded follow-up uses Codex cross-review and browser verification.
Codex follow-up found and fixed IME keyboard composition and accepted comparison
metric aliases. Native Chromium confirms composing ArrowDown/Enter/Escape leave
selection and popup intact; ordinary Enter afterward selects successfully.
`type=count_videos` now displays/submits `tags_video` (影片引用); tags_view and
total_views normalize to tags_views. Regression tests cover both changes.


## Final pinned-source layout correction (2026-10-12)

A renderer-family audit against mother `afe0a653` found and corrected remaining
layout drift: the source profile now uses the mother's compact header and19rem
right rail/mobile disclosure; maintained keyword detail uses its18rem rail and
compact content rows; both editorial and stored-AI event pages use its two-column
heading/cover grid, followed by full-width source sections. `SectionTabs` is now
shared by reader and report pages. Old unlayered table styles no longer override
copied mother utility typography/padding/hover rules. The existing title-comparison
page is reachable from the restored fourth navigation group, 看寫法.

See `docs/frontend-final-audit.md` for the full source matrix and deliberate
YouTube substitutions. New screenshots must use the rebuilt image; historical
captures above predate these corrections. This lane passed web typecheck and23
focused event/navigation/accessibility/account/media tests. Final integrated
build/browser evidence belongs to the release checkpoint.

### Channel recent-video list correction (2026-10-12)

The channel profile main column now uses mother `ArticleResults` divided rows
(`VideoResults`) instead of compressing the full 11-column report table beside
the 19rem source rail. Each row keeps channel attribution/avatar, published time,
title, description, thumbnail, views, likes and explicitly labelled YouTube
comment counts. A keyboard-accessible native disclosure retains recorded vs
provider comments, collection status, like share, authors, replies, comment
likes and observation timestamps; null and known zero remain distinct. The
standalone channel videos report retains its full report table. This fixes a
layout gap found in the packaged channel comparison, not an accepted difference.
