# F2 effective-keyword UI: intentional differences from tag.observe.tw

Reused from tag-visuals: `/ranking` table layout (hidden `#` column on phones with the
rank moved into the sticky cell, `table.lead`/`leadBox`/`leadExtra`, one-line rows in
`TableScroller card`), `Sparkline` + `sparklineRuns` (gaps for missing samples), and the
`FooterMethod` 「本頁資料來源與計算方式」 disclosure (`components/MethodDisclosure.tsx`).

Intentional differences:

- Colour: brand red (`text-brand-700` / `dark:text-brand-400`, via `currentColor`)
  replaces tag's fixed `#c2410c` sparkline, so light and dark themes both work. The
  homepage keeps its existing `.rankUp` / `.rankSame` tokens for the compact list.
- Metrics: 熱度 / 升溫 / 走勢 / 影片 / 標題／說明 / 頻道 / 已測觀看 / 代表頻道 replace
  爆發力 / 變動 / 分數 / 篇數 / 一起出現 / 媒體 / 相似稿. No sortable headers: /keywords is a
  query-free ISR page reusing the `home` API cache; the API's order is kept.
- Window switch: the homepage's client radio switch (`KeywordWindowSwitch`), not query
  links, so the canonical page stays cached; `?window=today` sets the initial pane on the
  filtered render.
- Images: a fixed 48×27 representative-video thumbnail in the sticky cell (`leadExtra`,
  hidden when a phone table is scrolled sideways). It uses `VideoThumbnail` (canonical
  i.ytimg mqdefault, existing next/image whitelist, 48/96 widths); only the first row of
  the initially selected window is eager. Tag rows have no images.
- Honesty rules: heat, rise and trend show 「資料不足」 unless the API reports
  `youtube-channel-weighted-decay-v1` with finite scores and a complete comparison. Fully missing measurements read
  「無觀看值」; partial measurements show a floored lower bound (≥) with the missing
  video count; missing values never become zero. Match coverage (fresh/source) is
  matching progress only; examples are described as illustrative, not a population sample.
- /vocabulary keeps the complete original pool and adds a read-only 「排行顯示」 column
  from `displayExclusion`; there are no override controls.

Backend dependencies (fields read defensively): `HomeKeywordSummary` ranking fields
(`rankingMethod`, `comparison`, `exclusions`, row `heatScore`/`rise`/`trend`/
`representativeVideoId`/`channel`/`sourceTerms`/`knownViews`/`measuredViewVideos`),
`VocabularyTerm.displayExclusion`, and `VideoRow.keywordEvidence` (≤3 per video; absent →
「沒有命中片段」).

Review-driven UI fixes (2026-10-12 20:09 UTC): implemented by a separate Opus 5.5
CLI execution in session `ff13df03-faef-4d0e-b687-ae218358b0bc`, following actual
GPT-6.1 Sol candidate screenshot review. Evidence snippets keep the matched span
visible on narrow screens; redundant mobile preface copy moves into the existing
method disclosure while scope counts remain visible. Warning punctuation is
joined consistently. Body foreground/background use tag's unlayered token rule.
Private execution receipts: `platform/.local/f2/opus-ui-evidence-result.json` and
`platform/.local/f2/opus-ui-token-result.json`. These are implementation receipts,
not independent visual approvals. New-SHA screenshots/review remain required.

Thumbnail fallback (`components/VideoThumbnail.tsx`): one canonical `mqdefault.jpg`
request, no retries or variants. The wrapper exposes `data-thumbnail-src` (the original
public URL, kept after failure) and `data-thumbnail-state` = missing | pending | loaded |
error. Only `loaded` (naturalWidth > 0) is a real image; the placeholder SVG is never one.
Lazy images not yet requested (empty currentSrc) stay `pending` at hydration. These
attributes support evidence capture; they do not replace checking the rendered image.

Mobile identity (729bcf7 review): rows stay one line and the lead keeps tag's 9.5rem /
5.5rem-scrolled caps. Below `sm`, `table.leadWide` hides rank, inline categories and the
48px video thumbnail at rest so the entity's icon + name get the lead; from `sm` up they
show as before. Live rows on phones lead with the channel avatar + name on the same video
link, then the title (full text in `title`); the 頻道 column is unchanged. The homepage
ranking keeps the term on its own line and folds metrics into one truncating line whose
link title carries heat, rise, counts and the views summary (≥ measured subtotal with missing count, or 無觀看值 when entirely unknown).

/mayor coverage (`components/MayorShare.tsx`): each rolling-7-day date is joined to its
report row's `observedBuckets` (expected 28 = 4 categories × 7 days), not to the
source-wide `meta.coverage.expectedBuckets`. Invalid or missing counts are unknown. A
latest-date badge sits above the candidate cards and the chart caption lists every
incomplete date with its count. The chart draws complete dates as a solid line, and
incomplete or unknown dates as dashed segments with hollow markers. The tooltip shows
the date's coverage. A recorded 0 at 28/28 stays a charted 0. The raw table is unchanged.
The same encoding, shared from `lib/bucket-coverage.ts`, applies to the per-candidate raw
`TimeChart`s on /mayor only, through an optional `coverage` prop. Other reports pass none
and render as before. With coverage, the raw table gains a 分類日桶 column, and the
tooltip shows 涵蓋未知 instead of a count when the count is unknown. Complete points use
small solid markers, so an isolated complete value, including 0, stays visible. Each
maximal run of incomplete or unknown dates gets its own dashed series, padded only with
the complete finite point directly before and after the run. A dashed line therefore
never crosses a complete→complete interval: P,C,C,P draws dashed P–C and C–P only. Shares
fail closed: if any candidate's value is missing on a date, every share for that date is
n/a, never a 100% renormalised over the rest. All-zero dates stay 0%.
