# YT: SM/direct-arm64 execution transition

Owner: d7967e77. The latest user instruction moves capture to SM and leaves native
arm64 build on skyhong-blog. Mint relay, controller and Mint lock are no longer
required for these stages. All Mint sources, receipts, fixtures and artifacts are
retained. No restore runs on SM. The build slot is currently blog's; YT goes next
only after babysit confirms handoff.

Deploy APP remains 073985b8bc4bbcc9ffb5d43c1e1a26060bb8ac4a. Reviewed historical
OPS remains c04434948c6486499783e1bcde4f8af2167a9262. New SM gate source requires
its own exact OPS SHA and independent review; previous reviews do not approve it.

## Baseline and gate

SM curl DNT:1, HTML only, five samples, median time_total, measured
2026-10-13T05:47Z: tag0.256s/blog3.085s/YT0.289s. Thresholds are respectively
2.0/6.17/2.0s (max(2s,2*baseline)). time_total includes rendering, edge and network;
it is not a measurement of origin rendering alone.

The pure native-arm64-sm-gate.py reuses the fixed reviewed strict health validator.
Exactly SM and skyhong-blog samples must be authenticated by the future direct
adapter, freshly measured within30s. Both hosts require zero existing builds,
load<=12, free /home>=40GiB and curl0/HTTP200 at all three sites. Browser sum<=2.
Only SM times gate performance. During build disk<30GiB pauses owned work; any
health failure pauses owned build/capture. nice19/ionice-c3 and Next workers<=2.
No raw invalid identity, extra fields or process argv is echoed by the gate.

## Native diagnostic result

The retained immutable arm64 image sha256:5b7d9171d9633c132766c65abd934c791787693a72b7f016bcd1408097dedadd
actually contains Node v24.21.0, ABI137, glibc2.36 and loadable sharp0.35.5, with
sharp-linux-arm64 and sharp-libvips-linux-arm64 packages. The initial smoke failed
at the exact v24.15.0 check. No receipt/version is rewritten. Babysit accepts the existing base under Node major24 plus ABI137; no version
is rewritten, and no replacement base pull or runtime upgrade is required. Diagnostic receipt SHA256
9cc44ea6b7a243d84fc9e07b538d51faf2acf34e8a2b8dd96347755824d82d59:
/home/deck/.cache/youtube-ui-review/remote_build-2026-10-13/approved-native-diagnostic-20261013T200143Z/native-diagnostic-result.json.

## Next execution preparation

1. Independent source review of SM gate; commit/push reviewed exact OPS.
2. Direct adapter: local SM probe plus existing strict-pinned SM->skyhong-blog SSH;
   preserve key/pins, use bounded output and strict schema, save exact argv/hash
   and independently recompute the two-host gate. No Mint hop or fresh Mint data.
3. Prepare the native compiler/package exact command with real Node version,
   disk/memory estimates and bounded owned-build pause/terminal readback. Bind APP,
   lockfile, base image and OPS bytes; never transfer x64 node_modules.
4. After blog hands back slot, send exact command and fresh two-host receipt to
   babysit. No build starts from health-only true or from this plan.
5. Same artifact on candidate: native/SSR/RSC/private-no-store checks, then SM
   DNT=1 screenshots with GA/GTM blocked before launch and saved network evidence.
   Main pages / and /keywords at1280/390, existing nonauthor reviewer. Manifest
   binds exact SHA/BUILD_ID; unseen states/routes remain pending in ledger.
6. Send exact Dokploy deployment and retained-image rollback commands with fresh
   probe for babysit check, deploy that same image without rebuilding, preserve
   read-only/no-new-privileges/GA config/crawler volume. Babysit verifies live UI.

This source/document checkpoint performs no probe, build, capture, candidate,
lock acquisition, container or production mutation.

## Major-version diagnostic checkpoint

Preauthorized read-only diagnostic rerun at2026-10-13T20:12:33Z passes: actual
Nodev24.21.0, ABI137, Linux/arm64, glibc2.36, sharp0.35.5 loads. Identity policy
requires Node major24 plus ABI137 (and Linux/arm64); four offline regressions pass.
Fresh SM/direct-blog probe aggregate.ok=true, temporary container removed,
production healthy and homepage200. No build or deployment. Exact retained base
sha256:5b7d9171d9633c132766c65abd934c791787693a72b7f016bcd1408097dedadd
remains the compiler-plan candidate, without any floating node tag substitution.
Diagnostic receipt:
/home/deck/.cache/youtube-ui-review/remote_build-2026-10-13/yt-native-major24-diag-20261013t201227z/native-diagnostic-result.json
SHA2564d822d358ed31e8f44ad5746809c1dc075354546fa4974f3c5caaa2388597d4a.

SM health-gate source32ab7dc39c2e6aa151772b56c0fe7e548c2ac181 received independent
GPT-6.1 Sol PASS, receipt003895cee99aef40e9209bc98b141fc82e1562c7cfbde0351ae642ff491852fa
at /home/deck/.cache/youtube-ui-review/ui_ledger-2026-10-13/review-logs/sm-direct-gate-independent-source-review-20261013T201121Z.json.
This is source-only, not build-slot authority or UI acceptance.

## Superseding gate policy: three measurements per site

User decision2026-10-13T20:47Z: time gating uses the median of three complete HTML
requests per site, compared with tag2.0/blog6.17/YT2.0 seconds. SM is still the
performance measurement host. A slow successful individual sample is not by
itself a failure. Any single curl error (including28), HTTP!=200 or5xx fails.
Both SM and skyhong-blog retain the fixed health/resource checks.

Use native-arm64-sm-probe.py generated read-only script and the v2 sm-gate, not
the old single-sample admission probe for the next execution. Receipts must keep
all raw attempts (three per site per host): startedAt, finishedAt, exitCode, status,
totalSeconds, bytes, cfCacheStatus. Unknown timeout metadata is null, not invented
zero; curl partial-transfer metadata is preserved. Only the controlled cache
status value is saved from headers; no cookie, complete headers or stderr body.
The median is recomputed from raw data, not supplied by a caller. Missing/extra
attempts, malformed/secret-bearing fields and the old schema fail closed.
UTC raw attempts and host observation must all be within30s at admission; a slow
probe batch cannot freshen older observations merely by printing a new timestamp.
Per curl timeout15s and outer execution cap must allow the sequential nine calls
(up to153s plus process scan); an expired batch cannot start a job. No new probe
or execution occurred while implementing this change. Reviewer PASS is required
before replacing the checked execution source; then exact command and a fresh
receipt go to babysit before build/candidate/capture/deploy.

Global1 build,2 browsers,load12,/home40->30GiB, owned-process pause and memory
protection remain mandatory. This health-only gate is neither slot authority nor
a running resource watchdog; those execution controls remain in the build plan.

## Exceptional a27 production deployment (2026-10-13T20:59Z)

Human directly authorized a27ec0e6 at20:57Z; direct service update outside Dokploy.
Sole ongoing YT deploy owner remains d7967e77; a27 reports no further independent
deployment. Current image `sha256:4f5e2a3ae63629a85f1463f778a7548b8cf53b758b881cb417e5d84f34276ffa` (tag youtube-board-ts:7d4d945).
Web UpdatedAt20:59:42.571053625Z; account-maintenance20:59:57.667726807Z.
This thread verified the full image, previous image and both UpdatedAt fields
via strict-pinned read-only service inspection.

a27 reports composition: prior7eb48f4 image `sha256:5b7d9171d9633c132766c65abd934c791787693a72b7f016bcd1408097dedadd` plus7d4d945 frontend
standalone tree and platform/api/src/reports/mayor.ts; other paths unchanged.
Do not describe this as a separately reproduced homogeneous full build.

Babysit21:01Z reported both1/1 Running; /, /keywords, /mayor,
/mayor/cities/taipei?days=90&to=2026-10-10 return200; opt-out browser GA0.
Taipei share chart: 蔣萬安36.8%,沈伯洋63.2%,郭璽0.0%, three lines on0–100% axis.
No capture paths/model UI transcript attached to this handoff; F2 successor
acceptance and pending route statuses are unchanged.

Rollback points: pre-a27 `sha256:5b7d9171d9633c132766c65abd934c791787693a72b7f016bcd1408097dedadd`; current production `sha256:4f5e2a3ae63629a85f1463f778a7548b8cf53b758b881cb417e5d84f34276ffa`.
The current image becomes the immediate rollback target for the F2 release.
a27 reports service rollback available for both services; no rollback executed.
Dokploy compose still points to the pre-a27 image according to a27. Do not run
its retained deploy configuration. Before the next checked Dokploy deployment,
persist the successor digest for BOTH services in compose and read it back.
APP `073985b8bc4bbcc9ffb5d43c1e1a26060bb8ac4a` and reviewed historicalOPS `c04434948c6486499783e1bcde4f8af2167a9262` are verified Git descendants
of `7d4d945acfb48c1a4a5d3ff8d8d6cb4097a89826`. Build/check that successor, deploy the same checked artifact,
verify mayor plus F2, and preserve both image recovery points.

Private handoff receipt: /home/deck/.cache/youtube-ui-review/remote_build-2026-10-13/a27-production-deployment-handoff-20261013T2059Z.json
SHA256 `964f9a269ee5699141fcd81b87398e8eb7e5e997674f66c4f87a861adda1072b`. This record is not build/capture/deployment permission.

## Native compiler command preparation after global slot handoff

YT received the global build slot at2026-10-13T21:08Z. Plan source local commit
9b409e40d4c4598a3fbf526b3bc6dbc7bbea901f, four offline mocks pass; independent
review in progress. Fixed APP073/base5b (Node24.21/ABI137). Source6,311,274bytes,
996tracked files; private source archive estimate8MiB. Additional build/image
disk estimate6GiB, duration8–20min, compiler2GiB RAM and512MiB tmpfs,2CPUs,
Nextcpus2, nice19/ionice3. Estimates are not measured results.

Command draft /tmp/babysit/mint-queue/youtube-native-build-073985b8-command-draft.json; not an executable approval request.
The actual owned-container identity/pause/terminal adapter must be integrated
for APP073 before start/commit: existing executor is frozenAPP705. Do not bypass
it or treat stopping the Docker client as stopping compiler daemon work.
Compiler plan is separated from image commit; package only after exit0 and a new
checked gate, with new runtimeWORKDIR entirely under the new source tree. Both
retained image5b and4f remain untouched.

Latest median probe /home/deck/.cache/youtube-ui-review/remote_build-2026-10-13/f2-native-build-preflight-20261013T211356Z/fresh-probe.json
SHA256829323836ddf8205f3bd98d613d23cc8368b75f5b02bda2a65877375ed895e84,
aggregate.ok=true; SM medians tag0.068670/blog2.089017/YT0.056200. Home SM59GiB,
blog92GiB, blogMemAvailable5,964,513,280bytes. This historical sample must refresh
before execution; no build/container/image/export/capture started by this step.

Compiler plan9b409e4 source-only independent PASS received: receipt
/home/deck/.cache/youtube-ui-review/ui_ledger-2026-10-13/review-logs/native-build-plan-independent-source-review-20261013T211843Z.json,
SHA256f46716df8801565cb9c148f514ba503990a1c6345b6f94df18b9433966ecfabf,
4author+52independent mocks. Lockfile pin
df597842a9b56d4fe32047ee776a53a8c6f18fb3a210720dcb6cf2b8a396d11f.
Native executor identity update45a2f0c fixes deployAPP073 and explicitly rejects
frozenAPP705 labels without dispatch;30executor+29cgroup+21Docker mocks pass.
Its independent review is in progress. Actual watchdog/dispatch/heartbeat and
terminal packaging integration remains necessary before executable build request;
no build started, draft remains executionAllowed=false.

## Global slot notice supersedes21:08 assignment

Babysit now assigns the next exclusive global slot to whichever of YT or tag
first submits a complete checkable exact build command; the other queues next.
YT does not hold a reservation merely because the21:08 message assigned it.
The actual controller must authenticate a current babysit handoff immediately
before execution; a historical notice or a source-only PASS is insufficient.

APP073 executor source45a2f0c independent PASS receipt
/home/deck/.cache/youtube-ui-review/ui_ledger-2026-10-13/review-logs/native-executor-app073-independent-source-review-20261013T212132Z.json,
SHA256e1db97334d0638869775fbf9bd937829640ce1d9636992d09c61dfe188e3e6ad.
Its review found old admitted-gate still required Mint lock. New source migration
uses strict yt-sm-native-executor-admitted-gate-v2, controllerSM/executorskyhong-blog,
jobCustodyHeldForWholeJob/globalSlotAcknowledged/hostHealthCurrent plus fresh
operator resume authorization authenticated by the existing callback. No Mint
lock evidence is synthesized; old schema/extra fields/wrong hosts are rejected.
Pause confirmation, cgroup identity, resume replay prevention and unknown-state
custody retention remain.32executor+29cgroup+21Docker offline mocks pass.
This migration still requires independent review and does not wire runtime IO.
No live probe, lock, build, container or image operation occurred this step.

## Latest slot notification: tag currently owns global build slot

Babysit reports tag acquired the sole global slot atUTC02:33 for SM web rebuild.
YT queues after tag and still needs fresh babysit handoff/command approval before
execution. No old handoff is promoted to current slot evidence.

Offline compiler watchdog tick is now implemented with explicit injected ports:
Executor.read verifies full owned container/cgroup before using the latest owned
PID snapshot to exclude ONLY skyhong-blog's compiler build clients. Raw receipt
values/counts are never overwritten. Startup stays40GiB/no builds; running gate
uses30GiB and still rejects SM builds or any other native-host build.
The watchdog checks current authenticated slot, median-v2 health and fresh memory
evidence (pause if either host available RAM<768MiB), then rechecks ownership and
slot after observations. All failures request only owned pause, report physical
STOP truthfully, retain custody, never auto-resume, never package or release.
Normal worker forks use the latest verified members; unknown or exited old clients
not in that snapshot are conservatively treated as competing/unknown work.
8watchdog+10gate+5probe=23 offline regressions passed. This is tick source, not
a live polling/controller/heartbeat/launcher or terminal cleanup adapter.
No probe, lock, build, capture, container or image operation performed this step.

## Latest global slot: open, not reserved for YT

Babysit reports tag returned the slot atUTC02:45 without building because of
memory admission. Next tag/YT owner is whichever first submits a complete exact
checkable command. A fresh confirmed handoff is still required before execution.

Watchdog review120fcf5 CHANGES REQUIRED (P1 W1): memory validated before final
owned read/slot auth could age29->31seconds while raw health remained fresh.
Original independent receipt retained at
/home/deck/.cache/youtube-ui-review/ui_ledger-2026-10-13/review-logs/native-watchdog-running-gate-independent-source-review-20261014T024345Z.json
SHA256f7b5e202e3437734310587c78d5b83366075302d0f8d9a5f1911b7ed6cdb1192.
Source now takes one decision timestamp AFTER both final IO boundaries and
rechecks BOTH memory and health at that timestamp. Read-delay and auth-delay
29->31s regressions correctly pause/retain custody; same-time assertion added.
11watchdog+10gate+5probe=26 focused mocks passed; independent re-review pending.
This fixes source only, not actual controller/heartbeat/terminal integration.
No fresh probe, lock, build, export, container or capture executed.
