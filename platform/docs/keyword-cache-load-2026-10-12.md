# Keyword API cache and load protection — 2026-10-12

The indexed keyword query hotfix removed the observed five-second timeout, but
subsequent public measurements included a 2.39-second request while a canary
and normal production activity overlapped. No statement history was captured
at that peak; attributing it to a particular job would be speculative. After
the canary ended, no canary/presentation containers or active DB statements
remained and a database CPU sample was 0.01%. No vocabulary matching, avatar
resolution or collection jobs were executed during that investigation.

## Change

- Successful public v1 GET/HEAD JSON responses advertise shared cache lifetimes:
  ordinary reports 60 seconds, live reports 30, vocabulary 300, API metadata
  3600. Stale-while-revalidate is twice the shared lifetime.
- Requests carrying Cookie, Authorization, x-api-key or RSC, and responses
  setting cookies, remain private/no-store. Errors, non-JSON, mutations and
  wildcard Vary are not shared. Existing Vary dimensions are preserved.
- Each report service coalesces identical keyword-video requests. Successful
  results are held for 15 seconds after completion, with 32 entries, four
  distinct pending loads, a 2 MiB individual result limit and an 8 MiB retained
  string/key budget. Ready entries use LRU eviction; pending entries are never
  evicted to admit additional SQL. Distinct overflow returns the documented
  503 response, without launching more SQL. Results are cloned before use.
- Exact terms, every current filter and scope remain isolated. Failed and
  unavailable results are not retained. Cursor requests only coalesce pending
  work, so future cursor expiration/version validation cannot be bypassed.

This cache reduces repeated work; it does not guarantee cold-query latency.
Relative windows and source changes can lag the short cache TTL. The cache is
per process; pending/transient response allocations are outside its retained
8 MiB budget. No source data, credentials, schema, grants or writer ownership
are changed.

## Verification and operation

Isolated release lane based on cb186be: API typecheck and 102 focused tests
passed, plus 35 enabled isolated-MariaDB report tests, covering cache bounds, concurrency, mutation isolation, header policy,
gateway forwarding and CSP regression tests. Deployment uses a pinned image
with the existing compiled frontend unchanged. Canary requests are paced at
least two seconds apart; load samples use bounded concurrency with automatic
abort on failures or sustained slow responses. Heavy local work remains serial
and low priority.

Cloudflare API eligibility is managed by the other operator. Origin shared
headers do not themselves prove an edge HIT. Record actual edge headers,
latency distribution and load limits after deployment; do not infer historical
load attribution or promise an arbitrary-traffic SLA from a small sample.

Rollback: redeploy the preceding pinned cb186be image with the existing
Dokploy compose configuration, leaving environment, routes, accounts and
Laravel scheduler unchanged. No database restore is required for this patch.
