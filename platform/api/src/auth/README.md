# Google account core

Adapted from `tag.analysis.tw` commit `afe0a653`,
`app/src/auth/google-login.ts` and `app/src/auth/store.ts`. This module preserves
that family's reader/admin/session contract while replacing browser-stored OAuth
flow JSON and unsigned claim decoding with server-side single-use flows and JOSE
RS256 verification. It does not register a wildcard or prefix hook. Root owns the
Fastify/runtime integration, reader routes, editorial gates and Next proxy.

`await registerAuth(app, options)` returns `AuthRuntime`: `enabled`, `origin`,
`currentUser`, `requireReader`, `requireAdmin`, and `actor(user)`. Guards send their
own rejection and return null. Write guards require exact configured Origin,
`X-CSRF-Token`, and (when present) `Sec-Fetch-Site: same-origin`. Any Authorization
header suppresses cookie authentication. Root's explicit service-token path must
handle that branch separately, without falling back to a session.

- `GET /auth/google?next=...` starts login; `next` is a validated internal path,
  stored in the flow row, default `/my`.
- `GET /auth/google/callback` consumes that flow before token exchange. Every
  callback outcome clears its flow cookie. Safe error redirects are
  `/login?error=state|cancelled|invalid|failed`.
- `GET /auth/me` returns the shared `AccountSession`, including a session-bound
  CSRF token only for a valid user. User output never includes a Google sub,
  session hash or OAuth verifier.
- `POST /auth/logout` requires write guard and returns204 after revocation.
- `GET /auth/users` requires admin and returns shared `AccountUsers`, at most500
  users by most recent login. UTC timestamps are ISO8601 with `Z`.
- `PUT /auth/users/:id/role` accepts `{role:'admin'|'reader'}`. It cannot modify
  the acting admin or an active configuration-admin binding. The store locks and
  rechecks actor/target before updating and appending audit in one transaction.

JSON failures use `{error:{code}}`: `AUTH_DISABLED`503,
`SIGN_IN_REQUIRED`/`SESSION_AUTH_REQUIRED`401, `ADMIN_REQUIRED`/
`CSRF_REJECTED`/`ROLE_FORBIDDEN`403, `LOGIN_RATE_LIMITED`429,
`INVALID_ROLE_REQUEST`/`ROLE_SELF`400, `ROLE_NOT_FOUND`404, `ROLE_CONFIG`409.
The root error handler should map sanitized `AuthStoreFailure` to
`AUTH_UNAVAILABLE`503. All account replies are private/no-store, noindex and
no-referrer; no CORS headers are added.

## Configuration and storage

Required: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `AUTH_SESSION_SECRET`
(at least32bytes of operator-generated random material). `AUTH_PUBLIC_ORIGIN`
defaults to `https://youtube.observe.tw` and production accepts only that exact
origin. Local HTTP is restricted to loopback hosts; HTTPS uses host-only
`__Host-` cookies, HTTP uses explicit development names. `AUTH_ADMIN_EMAILS`
uses trimmed lowercase exact emails, without Gmail dot/plus rewriting.

Absent/partial/invalid settings or missing schema disable authentication without
breaking public pages. The server only checks schema; an operator must apply
`jobs/migrations/012_accounts.sql` explicitly. The independent write pool is
bounded to3connections/12queued acquisitions,3s acquisition and5s statements.
All auth SQL dates use UTC; the YouTube report reader's Taipei connection stays
separate.

Identity is exclusively `google_sub` with byte-exact uniqueness. A configuration
admin email is permanently bound to its first verified Google sub in
`ts_auth_admin_bindings`; recycled emails cannot inherit it. Role grants and
configuration-binding events are append-only audited. Session role is read from
current user/grant state on every request. Runtime environment changes require
normal process reload; with the new config an allowlist removal takes effect on
the next request, unless a separate explicit grant still applies.

Session tokens are random256bits and only HKDF-domain-separated HMAC digests are
stored. Sessions expire absolutely after30days, rotate on login, revoke on logout,
and are capped at20/account. Secret rotation invalidates sessions, flow bindings
and CSRF tokens; root's independently random personal RSS tokens are unaffected.
Flows expire after10minutes, are consumed atomically even on invalid state or
cancellation, and contain nonce/PKCE verifier only on the server. Start requests
are limited to20/IP/10minutes in a bounded2048-entry map; the DB flow table is
capped at10000 with serialized cleanup/replacement. Deployment should provide a
trusted request IP; no forwarded host/origin is used for callbacks or redirects.

The token exchange and JWKS endpoints are fixed Google HTTPS URLs, responses are
bounded to64KiB, requests time out after15s, redirects are disabled, and JOSE
accepts RS256 only. Audience/issuer/authorized-party/nonce/verified-email/iat/exp
are checked. Tokens and upstream diagnostic bodies never appear in errors or
logs. Provider injection is a constructor-only test seam, never an environment
or request-selected endpoint.

## Verification

Current focused verification:31passing tests (17flow/config/session/role,
6realRSA/JOSE with local fetch doubles,8MariaDB store cases). No live Google
requests or production database access were used. The DB tests use only the
isolated localhost `youtube_board_test_rewrite` database. Immutable synthetic
audit rows are retained; test accounts are disabled and their sessions/flows
cleaned. Core awaits the combined account/editorial security review coordinated
by root. Real Google Console redirect registration and one user acceptance flow
remain operator handoff work.
