# Operator surface replacement

The Laravel app remains the production owner until a separately approved handoff. These are TypeScript candidate contracts; no production route or writer was changed.

| Laravel surface | TypeScript replacement | Deliberate scope |
| --- | --- | --- |
| `/ops/ingestion` | Same UI path; authenticated `/api/ops/ingestion` inventory/policy and `/api/ops/workflows` queue catalog | Reports implementation, CLI/queue/read-only/retired entry, exact ownership/allowlist gates. Legacy schedule strings are references, not evidence of the current scheduler. |
| `/ops/ingestion/data-capture`, `/ops/ingestion/report-processing`, `/ops/ingestion/{jobKey}` | Select the named workflow in `/ops/ingestion`; reviewed `jobs/src/cli.ts` commands remain the complete CLI entry | No separate duplicate writer dashboards. Unsupported old internal URLs do not perform actions. |
| POST `/ops/ingestion/run` | POST `/api/ops/workflows/preview`, then `/run` | Input validation is not source eligibility. Bearer, origin, execution, workflow ownership, scheduler and production allowlists remain required. Google editorial administration never grants source execution. |
| `/ops/ingestion/runs/{runId}` | `/api/ops/workflows/jobs/{queueId}` plus `/api/ops/ingestion/history?workflow=…` in the console | Queue records can expire. Durable source/cache, AI and Telegram journals are separate; IDs are not assumed interchangeable. |
| `/ops/integrations` | Configuration/ownership inventory in the console and reviewed per-workflow readiness CLI | Provider connectivity, real quota, actual due/next schedule and scheduler registry are explicitly uninspected. Reading the console never probes providers or creates schedules. |
| `/ops/deploy/dokploy` | Existing guarded HMAC deploy relay | Disabled by default; separate deployment approval and reviewed configuration required. |

## Durable metadata reader

`GET /api/ops/ingestion/history` requires the existing operator Bearer token, returns `no-store`, and accepts only a known `workflow` and `limit` (default25/max50). The reader selects fixed identity/status/time columns, at most limit+1 rows. It never selects input, result, prompt, provider, source snapshots or error bodies. Unknown stored status is `unknown`; no metadata row is evidence of success. Migration014 adds matching workflow/time/identity indexes on four TypeScript journal tables, without changing legacy sources or journal content.

- Source/cache jobs: `ts_job_runs`, updated instant from `UNIX_TIMESTAMP` (TIMESTAMP).
- AI: `ts_ai_runs`, stored Taipei DATETIME. Daily/hourly rows are stage results; source failures or early pipeline blocks may produce no AI row. `ai.daily.catchup` and `ai.days_refresh` describe their actual child journals instead of inventing a parent run.
- Telegram: `ts_notification_runs`, stored UTC DATETIME. A run’s status does not replace per-dispatch/attempt reconciliation for uncertain sends.
- Vocabulary sync/import: shared `ts_vocabulary_runs`, ordered by **creation** time. The schema does not identify sync versus import independently. Creation time is not recent progress time.
- Video matching: durable per-video evidence/version markers, no standalone run journal. The API states this limitation.

Latest metadata is intentionally not a universal audit explorer, full outcome dump, retry API or proof of a live worker. Complete diagnostics still use the relevant reviewed CLI/journal and notification reconciliation procedures. No automatic replay or destructive maintenance is provided here.

## UI and runtime

The token stays only in React state. Controls are locked while a request is outstanding, so changing credentials/workflow cannot relabel an old response. Clearing the token also clears loaded inventory/history. Both production Fastify and the development Next bridge use fixed owned endpoint/method allowlists; the bridge targets only the configured API origin and does not follow redirects. Reader metadata uses the same mother-site table scrolling component.

Readiness for rollout includes applying migration014 through the reviewed deployment migration process and retaining SELECT access to the four TypeScript journals. DDL remains a migration privilege; it is not granted to the runtime reader. The production writer handoff and backup gates in the main runbook still apply.
