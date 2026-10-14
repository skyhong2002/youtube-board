# YT consistency with tag T-ref

Reference: tag commit `ff511870`, `docs/cross-site-consistency.md` SHA256 `3d8e72036aab6cc73b3061f1b1d94afb1292d39b4bf86f1a65fc83945632eb91`. Reference production web `7dc59c3c17f6d6420354c3d4df733549071f2bb4`, BUILD_ID `4nl3B-BcT4mA9uh47rm0Z`, API `dc7b814e220606202a408d21e73b1d6e7c61fe16`. The source reference is pinned; newer tag builds require new evidence. Source comparison is not browser acceptance.

## Shared foundation

| Area | YT source | Current comparison / remaining work |
| --- | --- | --- |
| Layout/navigation | `platform/web/src/app/layout.tsx`, `components/SiteHeader.tsx`, `SiteNavigation.tsx`, `NavPending.tsx`, `SiteFooter.tsx` | Already adapts tag header/footer/navigation; max-w-6xl/16px padding, same sans font order and theme attribute. Product links, search and account API stay YT-specific. Actual new-release visual comparison pending. |
| Theme | `platform/web/src/app/globals.css`, `app/_home/home.module.css` | Same semantic paper/panel/line/ink/muted/accent/tint tokens and zinc light/dark palette. Authorized brand difference: YouTube red #FF0000 and accessible red text, rather than tag orange. Blue/green media categories keep their data meaning. |
| Tables/cards | `lib/table-styles.ts`, `components/TableScroller.tsx`, `ReportTable.tsx`, `DataViews.tsx` | Reuses sticky lead, table-frame/card colors, measured scroll position and narrow data-label stacks. First correction batch adds measured desktop scroll guidance and mobile live cards. |
| Data meaning | `api/src/reports/groups.ts`, `group-definitions.ts` | Group IDs/memberships unchanged; distinguish two/two_all scope, label item counts as terms vs subcategories. Source current-office labels do not certify current office; source update date remains real. |
| Shared tags/images | the existing tag profile/relations components and their API adapters | Existing explicit approved relations, attribution, license, anonymous fetch and private/no-store behavior retained. No merging aliases/co-occurrence or article and YouTube metrics. Exact component names/coverage are indexed in the UI ledger; no new privacy acceptance inferred here. |
| Missing/error | `components/ReportUI.tsx`, `app/error.tsx`, observation value components | Existing missing/empty/read-failure states stay distinct; read failure never becomes zero. Loading/error variants and auth still need actual isolated-state review. |
| Method notes | `components/SiteFooter.tsx`, `MethodDisclosure.tsx`, per-report notes | Global provenance exists; page-specific notes are not all consolidated into tag-style fixed footer slots yet. Remains F4 pending. |
| Controls | `lib/report-styles.ts` and report-specific components | Some inherited generic controls use 36px min-height rather than T-ref44px; remaining F4 control/touch-target audit pending. Do not silently call the whole site aligned. |

## Deliberate page differences

- `/live/current`: phone uses tag-style single-column cards because long video titles plus eight observation columns made the prior sticky lead around60px wide. Each card preserves full title, channel attribution, all three observed counts, sampling warning, timestamp, classification links and original source. Desktop retains the shared scrollable table with a measured overflow hint. Empty state is still distinct and has no synthetic zeros.
- `/groups`: the original two/2 and two_all/7 are distinct sets of configured subcategories. The broader label now says 台灣／中國立場與其他頻道分類. 項目數 plus the explicit counting note avoids claiming these are numbers of channels. Names inherited from old source data are not independently verified current office lists; no production data was changed.
- Home: YT video/channel/live observations and red wordmark differ from tag article counts/third data column. Common layout tokens and readable light/dark metadata are the comparison target; numeric parity is not meaningful.

Candidate actual visual evidence, production DNT1 captures and independent transcripts belong separately in `docs/ui-review-ledger`. This first batch does not close F4, all routes or all loading/empty/error/auth/interaction states.
