# Frontend cutover execution — 2026-10-12

**Current state: public traffic has been rolled back to Laravel.** The TS
candidate remains healthy, its independent state schema is preserved, and
account routes return private/no-store maintenance503. No background workflow
has transferred ownership. The rollback is intentional while two report SQL
timeouts are corrected; it is not a Google account failure.

## Deployment and database protection

- Source commit `5ccbca1` was pushed to main. Laravel autodeployment completed;
  the separate scheduler retained its original container and image.
- The [consistent backup and verified isolated restore](production-backup-2026-10-12.md)
  preceded schema/account creation. The reviewed frontend bootstrap created
  `youtube_board_ts`:36 physical TS tables and36 source views; source writes0,
  plan hash `5e65dbc590a2fab6693209c18880ab86aa8d721378b1a7c61514d5e67c9ea9d1`.
- Fresh `youtube_ts_report` and `youtube_ts_state` accounts are restricted to
  `10.0.1.0/255.255.255.0`. Report is SELECT-only; state has exact own-schema
  auth/reader privileges. No source-table DDL/DML grant was added. Bootstrap
  verified effective grants and view definers. Credentials are in Dokploy env;
  the privileged bootstrap URL existed only for the one-shot process.
- Dokploy compose `9nooPi3GmbojRUGs_jBiT`, stack `youtube-board-ts-6oukfq`, owns
  separate web and secret-free account-maintenance services. Both verified
  image ID `sha256:a200fb01f3a3228f80e413447550e7871056d0bb2db79f4ca9972fb802d51b83`.
  All TS background, ops service-token and deploy-relay gates remain disabled.
- Swarm ignored the initial service-level tmpfs shorthand. The corrected stack
  uses a long-form tmpfs volume at `/tmp`,64MiB; both tasks are healthy with
  read-only root filesystems. Media is a separate read-only bind mount, initially
  empty rather than populated with preview fixtures.

## Ingress and rollback evidence

The generated Laravel route file is unchanged. A separate operator-owned
`/etc/dokploy/traefik/dynamic/youtube-board-ts-cutover.yml` uses unique names and
is replaced with fsync plus atomic rename. The actual Traefik file provider
watches the directory. Fixed priorities: Laravel fallback110, account
maintenance200, optional public TS300, Laravel `/ops`400. Removing only the
public TS router is the complete rollback; it does not change databases,
schedulers or account state.

Swarm's service VIP changed the observed request peer to shared network endpoint
`10.0.1.16`. The TS load-balancer targets therefore use `tasks.<service>` DNS,
bypassing the VIP and preserving the pinned Traefik address `10.0.1.17`.
Fastify trusts only that address; it accepts CF-Connecting-IP only when its
nearest untrusted hop belongs to the official Cloudflare ranges. Actual HTTPS
traffic proved the Cloudflare chain, and direct-origin forged XFF/CF headers
were rejected. No broad overlay trust was introduced. The temporary diagnostic
router was removed and its process was time-bounded.

The internal rehearsal route was IP-restricted and included the same ops pin.
One atomic replacement converged to Laravel in2,640ms; all25 transition probes
returned200. Eight private/encoded paths returned maintenance503/no-store;
private POSTs did likewise. `/authentication` remained404 and webhook GET405.
All rehearsal/candidate routes were removed from the final public configurations.

One-step rollback on the manager (the command contains no credentials):

```bash
ssh skyhong.tw 'sudo python3 /home/ubuntu/youtube-ts-cutover-build/20261012/install-route.py < /home/ubuntu/youtube-ts-cutover-build/20261012/routing-rollback.yml'
```

Verify live Traefik routers after the reload delay, `/up` has the Laravel
response, and `/auth/me` returns `ACCOUNT_MAINTENANCE`503/private/no-store.
Stopping the TS container alone is not a routing rollback.

## Acceptance and discovered gap

- Candidate and post-switch78 legacy redirects matched expected destinations.
- Six live source API samples matched Laravel, except previously reviewed
  optional `cache_window:null` metadata; no new number/order/content difference.
- CSP/HTML nonce agreement, fresh nonce per request, HSTS31536000, private HTML
  caching, RSS origin, sitemap and robots were verified at Cloudflare ingress.
- Actual-data desktop and390px mobile views had no horizontal overflow; images
  loaded and the theme toggle switched the channel page to dark mode.
- Public TS routing was enabled at **07:53:46UTC /15:53:46 Taipei**. Automated
  OAuth start passed at07:54:13UTC: anonymous status200, Google302, exact
  production callback, S256/state/nonce and Secure/HttpOnly/SameSite flow cookie.
  `tag.observe.tw` and `blog.observe.tw` each remained200.
- The initial27 HTML/probe requests returned200, but that was **insufficient
  acceptance**. Subsequent direct API probes showed `/api/v1/live/channels` and
  full-text video search timing out at the existing5-second SQL bound. Their
  HTML renderers display an error panel while returning200. Tag video listing
  also showed the same5-second latency pattern and is included in the repair.
- Public routing was rolled back at **07:55:50UTC /15:55:50 Taipei** and verified.
  The5-second bound is retained. Query optimization and fresh packaged/live
  acceptance are required before repeating cutover. The strengthened check
  pairs exact API queries with HTML and rejects all six known failure/not-found
  headings; status200 alone can no longer pass a report.

The user authorized two administrator identities after the rollback. Their
allowlist was saved in Dokploy and will take effect in the corrected candidate
deployment. No account is elevated merely for signing in; the user-confirmed
allowlist determines admin binding. Human production login remains pending.

Opus review returned the requested model with `stop`. Adopted candidate/private
route separation, restricted rehearsal, independent atomic configuration and
deployed-image/health assertions. The suggestion to trust the whole overlay was
rejected in favor of the tested exact-peer/Cloudflare validation. Initial
truncated review output was not counted. Private evidence, including all
failure attempts and corrections, is in ignored `.local/dokploy/` and
`.local/reviews/frontend-execution-*`; it contains no outbound review secrets.

## SQL correction prepared before the second attempt

The repaired live-channel query ranks observations once and aggregates each
channel in the same statement; it no longer rescans the date window per channel.
On the immutable restored source, all251 raw rows and seven complete report DTOs
matched. Default execution fell from1,046ms to24ms; the366-day case completed in
536ms. Repeated observations, peak ties, byte-exact IDs and latest titles retain
the original semantics.

Text search counts matching rows and chooses bounded primary keys in one scan,
then fetches only those keys, rechecking the original predicates in case Laravel
changed source text/classification between statements. Totals are measured at
selection time; concurrent writes may shorten a page, as the source is not a
cross-statement snapshot. Invalid or truncated key aggregates fail closed.
Unfiltered/category listings keep their original query plans. Full DTOs for
25/50/1,000-row searches matched188,971 hits in the clone; four concurrent
50-row searches completed in2.51–2.82s. The5s SQL deadline was not increased.
These are clone measurements; production acceptance must be recorded separately.

Independent Codex review found the second-read predicate issue above; it was
adopted and covered by a real MariaDB mutation-between-statements regression.
The existing Opus-reviewed routing, least-privilege grants and rollback plan are
unchanged. No source migration, index addition or ownership handoff is part of
this repair.

Final local repair validation: all six workspace/runtime typechecks passed;
the API suite passed666 tests across87 files with isolated MariaDB enabled and
zero skipped tests. The independent focused change suites also passed. An earlier
run overlapped an in-progress test edit and was discarded; the final run used the
frozen report files.

## Second candidate result — remains on Laravel

Commit `0132fc5` was built on ARM64 and deployed to both separate TS services;
runtime image ID is
`sha256:b167129fe10f36c9d579f9ac30562c31180bbea2a1c3aba9d6211c5c80cdefb3`.
Both are healthy with the expected read-only root/tmpfs/media mounts, and the
two authorized admin addresses are confirmed in the running allowlist. Public
routing remains Laravel; private maintenance is retained. Only the header-based
candidate routes were added back for verification.

The repaired production live-channel API passed in243ms (253 total channels,
50 page rows). However exact video text search still intermittently reaches the
5s SQL limit. A bounded read-only profile measured4,845ms for the text COUNT
alone across672,010 source rows and about1GB of MyISAM data; the compact
count/page aggregate took4,971ms and its bounded primary-key payload took8ms.
The source view is ALGORITHM=MERGE; this is not a materialized-view artifact.
Tag102 listing also failed under contention, then passed in2,447ms in isolation.
No further public cutover occurred. Clone speedup evidence does not override
these failed production acceptance checks.

Next repair separates exact indexed page retrieval from expensive total counts.
Any unavailable total must be represented explicitly, with honest UI copy and
previous/next navigation; no estimated count or silently narrowed date range is
acceptable. A boundary query must preserve full-history membership, null ordering
and primary-key ties. This deliberate pagination difference requires focused
contract/UI tests and fresh production acceptance before another switch.

The indexed boundary/payload formulation was subsequently probed read-only on
the production DB: `台灣`51-row lookahead completed in13ms (8ms boundary), and
taxonomy102 in4ms. This is SQL evidence, not yet deployed application acceptance.
See [the explicit pagination contract and remaining bounds](video-list-search.md).

Indexed-page final local gate: all six workspace/runtime typechecks passed;
87 API files /665 tests passed with MariaDB enabled and no skipped tests. Web
suite99 tests passed, including actual rendered unknown-total pagination,
keyword headings, RSS scope and explicit refinement help for bounded searches.
