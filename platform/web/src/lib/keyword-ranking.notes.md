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
  `youtube-channel-weighted-decay-v1` with finite scores and a complete comparison; null
  views show 「無觀看值」, never 0. Match coverage (fresh/source) is described as matching
  progress only; examples are described as illustrative, not a population sample.
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
