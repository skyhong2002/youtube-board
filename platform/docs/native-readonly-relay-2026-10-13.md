# Read-only Mint to SM to skyhong-blog relay preparation

The user handed the human global build slot to YT at 11:27 UTC. This source-only
supplement grants no admission and executes no relay. APP remains
`70529cff13b6b7f5b3e0571a229e2b61660f9df4`; the requested fixture OPS target is
`5a5be6833ee2f32d35bce021db43d3627fdd7c8f`. This new supplement is separate source,
not proof that either target is running. OPS runtime SHA and readiness remain null.

Direct Mint to skyhong-blog failed authentication with the existing credentials.
The relay uses two explicit SSH clients: Mint to `deck@100.85.214.25`, then SM to
`ubuntu@100.81.220.33` using the existing SM key pathname. No key bytes are read,
copied or printed by this module; no new credentials, accounts or grants exist.
Both clients ignore SSH configuration, require strict public host pins, disable
agent/X11/port forwarding, and use literal destinations and fixed Python scripts.
No proxy, tunnel or arbitrary remote command is supported.

Mint uses the existing `sm-known-hosts-20261013` pin. SM requires a separate
private 0600 file at
`/home/deck/.cache/youtube-ui-review/relay-pins/blog-known-hosts-bcffee599f754cf7`,
containing only the existing verified public host entry, SHA-256
`bcffee599f754cf7b423dfe1517c6dce9ced8dc64da95f497d2cc1caab7152b9`.
The observed ED25519 fingerprint is
`SHA256:BG/VrIOoTclF4+830uXsRYiyeqECkEWeDVLNwy1kRO4`.
This preparation neither seeds that file nor executes either SSH leg.
The existing SSH/Python/curl binaries, private credential, host root and pin
parent directories remain trusted runtime prerequisites. OpenSSH reopens the
validated pin pathname; a concurrent pathname replacement is not prevented by
the validation FD. The source does not attest tool bytes or root integrity.

The blog script is an exact embedded copy of the independently reviewed
admission module's fixed `readonly_script('skyhong-blog')`, hash
`249a2747eb0d50b9cb2d339115f975e47c3ade8ae80d152aabeeec0790f68583`.
It measures complete homepage HTML with DNT:1, no JavaScript, cookies, redirects,
DB/provider requests or browser. It returns home filesystem free bytes, load,
conservative build/browser counts, machine ID and sanitized HTTP metrics.
It does not establish Docker filesystem capacity, filesystem independence,
global browser count or whole-system idle state; those remain separate checks.

Each controller verifies its own machine ID and its child public pin before
dispatch. SM bounds its SSH client to 15 seconds; Mint bounds its client to 22
seconds. Combined stdout/stderr is capped at 64 KiB per client. Selector draining
and monotonic deadlines bound observed work; synchronous reads and Popen are not
hard-preempted. Unknown/over-cap/timeout cleanup kills only that controller's own
SSH client and attempts a 0.5-second wait. This proves no remote termination.
Already dispatched read-only probes may finish after connection loss.

Receipts retain each actual inner argv, script hash, public pin metadata, machine
boundary, timestamps, exit status and byte counts. Raw stderr is never returned.
Mint checks the exact nested SM argv/hash/pin and health identity; caller `ok` or
admission flags cannot grant trust. Health must be at most 30 seconds old, load
at most 12, home free at least 40 GiB, build count zero and browser roots at most
two. All three homepages must complete with status 200 and total time at most
tag 2 / blog 6.17 / YT 2 seconds. Every unknown fails closed. The outer operator
collector must record its actual Mint invocation, source/script hash, exit status
and timestamp separately; constructing this text is not invocation evidence.
`validate_receipt(raw, now)` provides pure exact-binding validation for that
authenticated collector. It reports origin Mint, actual blog controller SM and
the full route; it does not fabricate the old direct-Mint transport fields.
It returns no SM or Mint health sample; those hosts need their own exact original
probes. Supplied JSON and `ok` remain unauthenticated without the actual collector.
The public parser caps UTF-8 input at 64 KiB, object depth at 32 and traversed
items at 4096; cyclic/exotic caller objects and parser recursion fail closed.
Rejected nested health is validated before attachment, so its raw payload is
absent from unknown receipts.

Tests inject pin IO, identity, runner, Popen, selectors, pipe reads and clocks.
Independent source review must accept exact bytes before live relay execution.
Even successful relay health cannot substitute for shared durable coordinator,
whole-remote-job Mint lock custody, isolated fixture readiness, physical STOP
proof, toolchain/runtime identity, startup/build permission or visual acceptance.
