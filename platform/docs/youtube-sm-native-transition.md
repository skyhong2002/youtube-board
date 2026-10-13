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
