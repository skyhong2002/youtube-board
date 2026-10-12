# Authentication and ingress security review

This is local implementation/review evidence for the TypeScript preview. It does not authorize production configuration changes or writer handoff. The inspected account contract remains [accounts-contract.md](accounts-contract.md); deployment requirements remain in the existing handoff documents.

## Client identity and bounded request budgets

Fastify accepts forwarded address information only from the explicitly configured `AUTH_TRUSTED_PROXY_CIDRS` ingress. Production refuses an absent allowlist. Configure the actual Traefik address, not every private network or a blanket trust-all value. An address in an attacker-supplied `X-Forwarded-For` prefix is not automatically trusted.

`api/src/ingress-client-ip.ts` uses Fastify's **nearest untrusted** `request.ip`. Only if that address belongs to the pinned official Cloudflare ranges does it accept one syntactically valid, zone-free `CF-Connecting-IP`. Otherwise it ignores that header and keeps the selected address. Arrays, comma lists, whitespace and malformed values are rejected. The15 IPv4 and7 IPv6 ranges were verified through `https://api.cloudflare.com/client/v4/ips` on2026-10-12, etag `38f79d050aa027e3be3865e495dcc9bc`; there is no runtime range fetch. Operators must review future range changes. Cloudflare is deliberately **not** added to Fastify's trusted-proxy chain: the helper checks the edge hop before using the separate client field.

This handles a Traefik deployment that resets forwarded chains to its Cloudflare peer. A direct origin client cannot activate a forged CF header merely by injecting a CF-looking XFF prefix. Tests cover direct/untrusted clients, trusted Traefik→CF, extra forged prefixes, native/mapped IPv4 and IPv6. This source-level and Fastify-injection evidence is separate from a real ingress canary, which remains a release check.

IPv6 privacy addresses share a `/64` rate bucket; mapped IPv4 uses the same bucket as native IPv4. The per-process LRU holds at most2048 client cells. Independent fixed-window global budgets bound accepted cardinality churn after eviction. Login starts allow20/10minutes/network and4000 globally; callback30/minute and3000 globally; session lookup and session-view120/minute and12000 globally. Reader writes and private RSS have separate60/minute limits with12000 global budgets. These are per-process controls, not a distributed fleet quota or protection from all request/CPU load. A legitimate large NAT may share a bucket, and the global ceiling intentionally limits availability under a distributed flood.

Rate-limit exceptions now preserve HTTP429, `Retry-After:60`, `RATE_LIMITED` and private/no-store headers through both the root API handler and the encapsulated reader-account handler. Direct limiter responses retain their configured retry interval. No rejected session lookup reaches the database after exhaustion.

## Cookies and stored OAuth flows

Session and OAuth binding cookies contain an opaque32-byte token and a truncated HMAC signature using a separate purpose/name-derived key. The server validates the signature in memory **before** looking up a session or consuming a flow. Malformed, unsigned, duplicate or forged cookies cannot trigger those database queries. Cookie values remain HttpOnly, SameSite=Lax and Secure/host-only on HTTPS. Database token digests and CSRF purposes remain independently derived.

**Existing preview sessions and pending OAuth flows minted before signed-cookie support require sign-in again.** No automatic unsigned-cookie acceptance is provided. Account data is not deleted by this cookie-format change. Rotating the session secret likewise invalidates prior cookies/flows and requires the documented operator process.

Flow insertion holds the existing named database lock and a transaction. It removes a bounded set of expired flows, replaces an existing browser binding, counts no more than10000 rows, and evicts the oldest one when full before inserting the new flow. The normal write path therefore maintains a10000-flow bound without permanently rejecting every new login at saturation. Eviction intentionally expires the oldest still-pending login; its eventual callback fails state validation and the user can restart. Callback consumption remains transactional and single-use. A pre-existing manually overfilled table is not promised to shrink to10000 in one operation.

## HTML CSP and cache behavior

The Next proxy creates a fresh nonce for each HTML request and overwrites both incoming `x-nonce` and incoming CSP before rendering. The root layout reads request headers, making the nonce-bearing layout dynamic. The response uses the same nonce and `Cache-Control:private, no-store`; shared/intermediary HTML caching must not be enabled. The policy restricts script execution with nonce plus strict-dynamic, denies objects, limits frames to YouTube embeds and restricts forms/base/ancestors to the same origin. Development alone permits unsafe-eval. Styles still allow inline declarations for the existing UI/charts; this is not a claim that every CSP directive is maximally strict.

Public image optimization intentionally bypasses the per-HTML nonce/no-store policy and retains its separate exact-source/size/redirect boundary. API, feed, static and media routes use their own controls. Local pure-response tests verify a spoofed nonce/policy is replaced, successive responses differ, request and response policies match, and image optimization receives no HTML nonce. Real built-page hydration/cache/header behavior remains part of the root runtime/browser check.

## Review packets and local credential hygiene

`tools/review-redact.py` is defense in depth for explicitly selected review packets, not a complete secret scanner. The independent review found that bare TOKEN/PASSWORD/SECRET keys and escaped/multiline quoted values could escape the earlier expression. It now masks those complete scalars, including camelcase names and triple-quoted values, alongside URL passwords and Bearer credentials. Source selection and manual inspection remain required; arbitrary unlabelled secrets cannot be identified reliably by regex. `opus-review.py` still sends only the supplied packet to the fixed local CLI Proxy and accepts only actual nonempty `claude-opus-5-5` responses with finish reason `stop`. Truncated/wrong-model results do not count as review.

The local script audit inspected sensitive assignments without displaying values and compared candidates privately against the running **local preview** configuration. It found an old token literal inside the embedded JavaScript in `.local/runtime-closure-ops.py`, replaced it with a fresh ephemeral random token for each script run, and confirmed the preview has no configured `TS_OPS_TOKEN`. No active preview credential matched; no preview rotation or production operation was performed. This scoped check is not a claim that all unrelated ignored artifacts contain no sensitive data.

## Verification scope

Focused source/API checks cover ingress normalization, bounded rate behavior, signed session/flow verification before DB, genuine root/reader429 error handling and unchanged account protections. Pure Next response checks cover nonce/cache separation; offline Python transport/redaction tests make no provider requests. The separate saturation database regression uses the dedicated guarded test database, inserts only its own random-prefix flows, refuses a pre-existing flow fixture, verifies concurrent oldest eviction and binding renewal, and cleans only those owned rows. Exact executed totals and the database follow-up result are retained in `.local/reviews/security-final-codex.md`; a skipped or merely written database test is never counted as executed evidence.
