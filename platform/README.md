# 有影儀表板 — TypeScript platform

This is the whole production system for youtube.observe.tw: the public frontend since 2026-10-12 and every background workflow since the 2026-10-18 scheduler handoff ([record](docs/scheduler-handoff-record-2026-10-18.md)). The Laravel application it replaced was deleted from production and removed from the repository on 2026-10-19.

Node 24, Next.js 16 / React 19, Tailwind 4, ECharts, Fastify 5, Drizzle/MariaDB and Redis/BullMQ 6 match the reference platform's architecture. Patch versions may be newer where fixes are available. Packages and exact resolved versions are locked in `package-lock.json`.

## Local development

```sh
cd platform
npm ci
docker compose up -d --wait
cp .env.example .env
npm run db:bootstrap -- --execute
npm run dev
```

This Compose project creates separate volumes and exposes MariaDB/Redis only on loopback ports 23306/26379. Bootstrap refuses production mode, other database names and non-local hosts. It initializes the repository's approved schema-only baseline plus later tables and byte-exact YouTube identifier collations. It imports no production rows. The baseline still contains MyISAM tables: code must not assume rollback protects those writes.

The API listens on 4100 and Next on 3100. The browser receives data through server-rendered pages, so its machine does not need access to the internal API address. Share previews using the host's current Tailscale address after checking reachability. Do not present synthetic test data as current production data.

Google login, follows, saves, private RSS and per-user editorial administration are implemented but disabled when credentials are absent. See [account configuration and acceptance](docs/accounts-handoff.md). `APP_ENV=local` requires an explicit loopback `AUTH_PUBLIC_ORIGIN`; `preview` requires an explicit HTTPS origin distinct from production. Use a separate preview hostname, session secret and database; a separate Google client is recommended, while the current preview reuses a local project's client under explicit user authorization. `production` fixes the callback to `https://youtube.observe.tw/auth/google/callback`; a production build with no `APP_ENV` also defaults to this strict mode. Unknown modes fail closed. On2026-10-12 the user confirmed real Google login and account navigation in mobile Brave over Tailscale HTTPS; full reader/admin operations and the production OAuth combination remain separate acceptance checks.

```sh
npm run typecheck
npm test
npm run build
node --test tools/legacy-redirects.test.mjs
```

See [`jobs/README.md`](jobs/README.md) for the explicitly gated vocabulary synchronization and matching commands. The public tag article API yields a bounded **observed vocabulary**, not the complete canonical dictionary. Source/version/coverage labels are mandatory. The full indexed export producer/importer are locally implemented and cross-tested; upstream deployment remains separate. See [the handoff](docs/vocabulary-export-handoff.md).

## Migration tracking

[`inventory/legacy.json`](inventory/legacy.json) was generated from the Laravel route/job declarations, which were removed from the repository on 2026-10-19 after the handoff; it is now a frozen record. [`../docs/ui-rewrite-assessment.md`](../docs/ui-rewrite-assessment.md) records the accepted full TypeScript direction.

Review each slice against its existing report, source tables and fixtures. Verify empty data, missing cache, partial ingestion, case-sensitive IDs, time zones and data freshness. A successful response or matching route count alone does not establish parity. Public request time must never substitute for source observation time.

The current deployment continues using the root Dockerfile and Laravel scheduler. Production adoption needs verified restorable backups, read-only parity comparison, explicit per-job writer transfer and rollback instructions. No new production API/write job is enabled by these files. Operator tokens, preview/execute gates, signed deployment webhook verification and notification deduplication are implemented locally. Their production configuration and per-workflow handoff still need verification before retiring Laravel; see `runtime/README.md` and `notifications/README.md`.

## Opus review

Codex handles implementation, ordinary review and routine task division. Reserve Opus 5.5 for roughly one quarter to one third of review/design nodes, prioritizing accounts/security, production writers, rollout/rollback and substantial integration decisions. Combine small related changes, send only relevant diffs/contracts/test evidence, and choose an output budget appropriate to the question. Do not submit repeated or cosmetic reviews merely to meet a ratio. Prepare a secret-free packet and pass it on stdin:

```sh
python3 tools/opus-review.py < /path/to/review-packet.txt
```

The tool reads `CLI_PROXY_API_KEY` from its process environment and calls the existing host-local proxy. It never automatically attaches repository files or environment dumps. It verifies the returned model is `claude-opus-5-5` and rejects empty or truncated responses. Record findings, accepted/declined suggestions with reasons, tests and actual Codex/Opus review counts under ignored `.local/reviews/`; rejected attempts do not count as completed reviews. The model's advice does not replace executed validation.

## Dedicated test data

Development and tests use different databases. Keep `DATASET_KIND=fixture` for synthetic previews (included in `.env.example`). Tests accept only `youtube_board_test_rewrite` on the isolated loopback MariaDB. New Compose volumes create it automatically; for existing local volumes apply `tools/init-test-database.sql` using the Compose database administrator. Then run the required complete integration lane:

```sh
npm run test:integration
```

This initializes the test schema, applies additive local migrations and runs all workspaces sequentially with API, jobs, ingestion, AI, notifications and Redis test flags enabled. Missing database/Redis prerequisites fail the command; tests cannot silently pass by skipping those suites. The runner ignores runtime credentials and addresses, uses the fixed disposable Compose identity, and takes a database lock to prevent concurrent lane runners.

The credentials in the lane belong only to the disposable local Compose project. Test suites seed their own vocabulary and restore its pointer. Run database suites sequentially because shared current-version fixtures intentionally test global publication. Without the DB flags, tests report skipped integration cases; that is not full validation.

## Reviewed editorial workflows

`/events` provides stable event timelines and cross-source headline comparisons. `/manage/editorial` offers audited rename/merge/split, explicit snapshot refresh, and channel candidate review. Public source links preserve exact YouTube/AI/story identities and published tag.observe article versions; shared snapshot titles absent upstream are clearly labeled editor-transcribed. Authenticated mutations require preview hashes, expected versions and UUID request keys. Channel adoption is a separate operator-only CLI source workflow, with no automatic schedules. See [editorial workflow documentation](shared/editorial/README.md) for API routes, provenance, immutable history, replay guarantees and production gates.


## Feature contracts and handoff references

These documents describe implemented local behavior, deliberate differences and remaining acceptance requirements. They supplement the [API parity ledger](api/PARITY.md) and the historical Laravel [route inventory](../docs/legacy-inventory/routes.md) and [feature inventory](../docs/legacy-inventory/feature-parity.md); they do not authorize production replacement.

| Area | Contract |
| --- | --- |
| Accounts and editorial identity | [Account UI parity](web/ACCOUNT-UI-PARITY.md), [account API contracts](docs/accounts-contract.md), [configuration and real-login acceptance](docs/accounts-handoff.md) |
| Family branding | [Selected 有影儀表板 / YouTube-red assets and licenses](docs/brand-assets.md), [mother-site UI source map](web/UI-FAMILY.md) |
| Channel avatars and video thumbnails | [Local cache, refresh controls and volume handoff](docs/media-assets.md) |
| Remaining live reports | [Taxonomy and continuous history](api/LIVE-TAXONOMY-CONTINUOUS-PARITY.md), [live-term ranking](api/LIVE-TAG-RANKING-PARITY.md), [keyword/group comparisons](api/LIVE-COMPARISON-PARITY.md); individual video trend bounds are in the [API ledger](api/PARITY.md) |
| Prompt and hourly readers | [Shared-planner preview contract](api/PROMPT-PARITY.md), [bounded legacy hourly decoding and source history](docs/ai-report-history.md) |
| Archived channel history | [Retained child reports, active profiles and archive navigation](api/CHANNEL-RETENTION-PARITY.md) |
| Mayor-person observations | [Daily descriptive summary and seven-day raw media share](api/MAYOR-PERSON-PARITY.md) |
| Operator replacement | [Old-to-new surface disposition, durable history and rollout dependencies](docs/operator-surface-disposition.md) |
| Shareable boards | [Channel/category, maintained keyword and date scope across storage, sharing, pagination and RSS](web/BOARD-FILTER-PARITY.md) |
| Historical acceptance | [Approved-slice migration preservation, 36 route captures and offline replay](docs/historical-parity.md) |
| Release evidence | [Frozen local candidate, verified checks and outstanding production gates](docs/release-evidence.md) |

Laravel remains the production system of record. Configured Google login acceptance, representative approved-data comparison, restorable production backups and explicit per-workflow handoff remain separate from local tests and builds.
