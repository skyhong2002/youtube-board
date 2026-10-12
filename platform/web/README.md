# 有影儀表板 web

Next.js 16 / React 19 front end for the TypeScript rewrite. It uses a YouTube red brand with accessible red variants for text and controls, while following the light/dark theme, responsive report navigation, and ECharts approach of tag.observe.tw. Existing Laravel deployment is separate.

```sh
# Run from platform/
npm run dev --workspace=@youtube-board/web
npm run typecheck --workspace=@youtube-board/web
npm run test --workspace=@youtube-board/web
npm run build --workspace=@youtube-board/web
```

The development server listens on port 3100. Use the host's reachable Tailscale address for user previews. The API is fetched by Server Components; the browser does not require access to the private API port.

## Configuration

- `YOUTUBE_API_BASE_URL`: server-only API base, default `http://127.0.0.1:4100/api/v1`.
- `YOUTUBE_PUBLIC_URL`: canonical public web origin. Required for RSS in production; for example `https://youtube.observe.tw`. A local production-build preview should set its actual Tailscale preview origin.
- `YOUTUBE_ALLOWED_DEV_ORIGINS`: comma-separated development hostnames. The current development host defaults to `100.85.214.25`; this controls Next's development resources and the development-only RSS origin fallback.

## Implemented UI

- Home dashboard; live ranking with optional 60-second refresh and background-tab pause.
- Channel directory/profile/videos, video observations, and charts with an accessible numeric fallback.
- Daily AI topics, source-video evidence, canonical daily-event links, and preserved ambiguous same-name groups.
- Shared vocabulary with source/coverage/version attribution, separate channel taxonomy, and exact-text video matching evidence.
- Custom boards with up to 20 channels, keyword filtering, local browser bookmarks, and shareable URLs. Corrupt bookmarks are never silently overwritten; edits read current storage and listen for other-tab changes.
- `/feeds/videos.xml`: filtered source-video RSS, source observation timestamps, XML escaping, fixture markings, and a configured/allowlisted origin.
- `/compare/titles`: side-by-side character-level wording comparison. It preserves source titles and does not infer shared events or coordination.
- Declarative report rendering for additional API report families: filters, metrics, word distributions, separate series charts, tables, pagination, and source links.
- Legacy PHP and `/ch/` redirects delegate to the reviewed shared compatibility module.

The API determines which report families are available. A missing database, absent observation, unsupported migration slice, unknown record, and numeric zero have distinct handling. Rendering a report family is not by itself evidence of Laravel behavior parity. See the repository's migration ledger for remaining routes and production cutover gates.

## Verification

Focused tests cover bookmark corruption and merging, source-link validation, missing observations, case-sensitive video IDs, source evidence offsets, title comparisons, RSS escaping/origin/source dates, and route resolution. Desktop collaborative-browser checks exercised the live API, vocabulary pagination, synthetic video charts, title comparison, and bookmark creation. Mobile layout uses responsive styles; the collaborative browser's resize operation timed out during the initial validation, so that pass remains outstanding.

Two CLI Proxy reviews explicitly returned `claude-opus-5-5`. Findings about bookmark overwrite, malformed API responses, RSS origin/caching, XML noncharacters, and status fallbacks were addressed. Reviews do not replace regression tests or production-data parity checks.

Nothing in this package changes production credentials, schedules ingestion jobs, or writes to the production database.
