# Home UI source map

The homepage now uses the actual mother-site implementation from the user's read-only checkout at `/home/deck/Projects/tag.analysis.tw`, with YouTube observations and the red 有影儀表板 identity. The mother checkout was not edited.

| Mother source | Local adaptation |
| --- | --- |
| `web/src/app/page.tsx` | `web/src/app/page.tsx`: same masthead → three-column ranking/focus/sidebar → two-panel bottom band → compact scope/method flow. |
| `web/src/app/_home/home.module.css` | `web/src/app/_home/home.module.css`: original .85/2/1 grid,20px gaps,1000px two-column breakpoint,640px center-first stack, card borders/radii, heading bars, type scale and light/dark variables. |
| `web/src/app/_home/Masthead.tsx` | Local `Masthead.tsx`: generated red square mark at128px desktop/104px mobile, same tagline/edition hierarchy, accessible full-name h1 and `home-masthead` anchor for the shared header. |
| `web/src/components/WordCloud.tsx`, `WordCloudView.tsx`, `WordCloudView.module.css`, `web/src/lib/word-cloud.mts` | Copied into `_home`: native server placement and responsive hover/focus/touch cards. NavPending import uses the local shared shell. Word labels use own-property dictionary construction so inherited JavaScript keys cannot suppress terms. |
| `NewsImage` slots | `VideoPicture.tsx`: allowed YouTube image hosts, neutral local fallback and empty alt for decorative linked thumbnails. Synthetic fixture mode never requests fictional source thumbnails. |

The global shell, header, footer, theme, navigation and brand artwork are separate coordinated changes. The home module removes its redundant full-viewport minimum height and outer padding because the shared root main already owns the1152px container,16px horizontal padding and24px vertical opening. The source128/104px masthead dimensions remain unchanged. The mobile module’s redundant20px top padding is also removed to avoid double root padding. Additional local CSS only styles YouTube counts, textual channel classifications, source-method disclosure and the scope summary.

## Honest data substitutions

- Keyword ranking and cloud use the maintained shared vocabulary's fresh YouTube matching evidence. Font size is observed video count, not article count, growth or a fabricated score. Missing cumulative views remain unknown; partial known-view sums have a visible marker and card disclosure.
- The mother reporter activity list becomes observed channel activity. The focus hero/story list uses stored AI topics or explicitly labeled source-signal groupings, with their own source dates and citation units. The edition date also uses recorded observation time (or the saved AI date), never render/request time; live summary counts are explicitly unique channels, matching SQL.
- The right rail shows fresh live observations and channel classifications. Political camp differences, news headline equivalence and reader-popularity metrics are not inferred from unrelated YouTube counts.
- Lower panels use distinct remaining category and live-video slices, avoiding duplicated source entries from the right rail. Classification overlaps, increments versus cumulative views, observation windows, stale/unprocessed matching evidence and fixture data remain disclosed.
- Unavailable/unsynchronized keywords and unavailable categories never render leftover rows as current results. An unavailable cloud produces no blank content panel or invented terms; the left ranking area reports the actual unavailable/not-synchronized/no-match state.

## Validation

The web typecheck and33 web tests passed after the Opus corrections, including source-date and stale/unavailable-vocabulary regressions. Native browser inspection at390px verified center-first mobile flow; at1280px it verified three columns (approximately238/561/280px),24px hero type, parent typography and no horizontal page overflow. The masthead was then corrected to the parent's exact128/104px square dimensions and typechecked again. Root-owned comparison captures verify the combined final shell and homepage.

Actual CLI Proxy Opus review evidence is recorded in `.local/reviews/home-mother-ui*.json`; only responses containing returned review text count as reviews.

The first actual Opus review findings were addressed, including source-date honesty, unique-channel labels, unavailable states, distinct content slices and hydration-time image failure handling. Local accessibility improvements retain the parent visuals: Escape dismissal, linked tooltip descriptions, named/focused touch cards, readable unknown-view markers, channel-link deduplication and cross-browser opening of method details. The second actual Opus review confirmed no remaining medium-or-higher blockers. Its residual low-severity keyboard notes were also fixed: hover Escape works without moving focus, inactive clouds do not intercept Escape, and touch cards close when keyboard focus leaves. Channel IDs are validated/deduplicated and path-encoded. Both reviews returned text. HTTP200 provider placeholder thumbnails remain a known visual limitation; valid120px thumbnails are not rejected by a blanket size heuristic.
