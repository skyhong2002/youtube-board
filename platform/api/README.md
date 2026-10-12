# YouTube Board TypeScript report API

Fastify 5 + Drizzle SQL + MariaDB. Runtime credentials stay in environment configuration. No endpoint runs Laravel, generates AI, invokes YouTube or writes application data.

From `platform/`:

```bash
npm run dev --workspace @youtube-board/api
npm run typecheck --workspace @youtube-board/api
npm run test --workspace @youtube-board/api
TEST_DATABASE_URL='mysql://youtube_rewrite:youtube_rewrite_local@127.0.0.1:23306/youtube_board_test_rewrite' npm run test --workspace @youtube-board/api
```

The URL above is the **local-only development credential** from the isolated compose setup. Normal startup reads `DATABASE_URL`; absent/unreachable connection returns 503. SQL or missing-schema defects return sanitized500 with driver-code-only logs. `/up` checks the process, `/ready` checks database connectivity. The runtime workstream adds its own combined web/API/ops launcher; this package entry point listens on `127.0.0.1:4100` by default.

`DATASET_KIND=fixture` labels synthetic YouTube responses. Maintained vocabulary responses separately identify real upstream news data and its actual scope. The integration fixtures create clearly named sample channels `990001/990002` and case-distinct video IDs; they never import production. Their fixed test clock is `2026-10-11T10:00:00Z`; outside that clock the live fixture correctly becomes stale. Fixture helpers exclusively accept the separate `youtube_board_test_rewrite` DB and restore test-owned vocabulary state after testing; they reject the development preview DB.

- API envelopes/types: `src/contracts.ts`
- Extended table/series contracts: `src/report-contracts.ts`
- Registration/error boundary: `src/app.ts`
- Read-only pool and baseline models: `src/db/`
- Report-specific readers: `src/reports/`
- Exact supported vs incomplete behavior: [PARITY.md](PARITY.md)

Pagination uses `limit=1..200`, `offset=0..100000`. Date filters require valid calendar dates. YouTube IDs preserve case. Numeric values outside safe JS integer precision become null rather than silently rounding. Observation metadata comes from source fields, separate from `requestedAt`. Missing source samples remain null/absent. AI event evidence retains source row IDs, every referenced video, and unresolved links.

The existing legacy database tables are mostly MyISAM; parallel SELECTs do not imply snapshot isolation. All production schema/cutover/write approvals remain separate from this local reader implementation. `/api/v1/status` reports registration, not parity completion.
