# ISR stale responses, Brotli and cache diagnostics — 2026-10-12

The gateway previously treated every Next `x-nextjs-cache: STALE` entity as
private. This caused a shared-cache bypass at the first read after each ISR
interval, even when Next supplied valid anonymous HTML and a public stale
allowance. The gateway now permits one second of shared freshness only when
that allowance remains. Explicit Age consumes the original freshness/stale
window. Missing Age is treated as at least the complete freshness interval;
no-store/private/no-cache/must-revalidate/proxy-revalidate still disallow stale
sharing. The route's own TTL caps stale-while-revalidate.

The normal compiled-script integrity checks and hash CSP still run on the
complete HTML before sharing. Credential, API-key, query, RSC, wildcard Vary,
Set-Cookie, failed rendering, wrong marker and non-200 guards remain in place.
An expired or invalid upstream policy remains private. Vary preserves Next's
representation dimensions plus credentials and Accept-Encoding.

HTML compression negotiates Brotli, gzip or identity using client quality
values. Brotli uses asynchronous quality4 compression while retaining the
existing bounded HTML render lease. Decoded HTML/CSP remain identical, and
no-transform is retained. When the client explicitly refuses all supported
representations the gateway returns a private406 with no body.

Fixed-size diagnostics count every validated HTML cache decision and its
fixed reasons; cumulative/window private ratios, STALE and shared STALE counts
are emitted at most once per minute on traffic. JSON-only stderr output works
with Fastify logger:false and skips output under backpressure. It contains no
URL, query, IP, cookie, user agent, token, account data or raw error. These are
policy-decision counts: failures before HTML validation and errors sending a
response are outside this denominator. Counters reset when the process restarts.

Validation: 109 focused tests and isolated API typecheck passed, including
STALE freshness/window boundaries, CSP/body hashes, Vary, private credentials,
Brotli roundtrip/quality negotiation, log backpressure and diagnostic counters.
No frontend rebuild, database change, writer handoff or edge rule change is
part of this release. The preceding immutable 2ea4080 image is the rollback.
