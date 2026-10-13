# Native executor backend status

APP source remains `70529cff13b6b7f5b3e0571a229e2b61660f9df4`.
These tools belong to the separate OPS preparation source. TAG owns the global
slot; this packet starts no build, capture, API, container, probe or install.
OPS runtime identity, admission and runtime readiness remain unverified.

The reviewed admission validator prepares evidence contracts; the reviewed
executor models one owned container's freeze/resume/terminal lifecycle. The new
`native-arm64-cgroup-io.py` supplies explicit-call Linux kernel IO for that model:
no-follow directory FDs, device/inode and cgroup2 mount checks, bounded recursive
thread/starttime membership, two equal bounded passes of task identities and
per-group topology/placement, kernel freezer/population observations, and one
fixed `cgroup.kill` write through the held owned directory FD. It has no CLI or
launcher. Construction/import makes no host observation. Its tests inject every
kernel IO, clock and container-inspection boundary; no actual STOP is demonstrated.

The writer requires the exact shutdown specification and a new matching owned
container inspection. It returns dispatch success only. The existing lifecycle
still requires two complete exited/empty observations and leaves reservation
release to the coordinator. Missing/deleted cgroups remain unknown. A deleted
path cannot be synthesized as an empty snapshot.

| Prerequisite | Source status and remaining executable work |
| --- | --- |
| R01 native host backend | Kernel FD reader/writer source added, pending independent review. Still needs bounded fixed local-Docker transport, trusted identity acquisition, target architecture/toolchain proof and verified deleted-cgroup terminal cleanup. No live backend is wired. |
| R02 shared coordinator and watchdog | No implementation or interoperability proof. All tag/YT/blog owners must honor the same durable reservation and generation. Mint must retain its real shared flock across the entire remote job. A separate remote supervisor must survive controller/SSH loss and freeze the owned job on lease/health uncertainty. An empty flock or passing probe cannot grant a new slot. |
| R03 fixture and capture preparation | Owned by the fixture/retake workstreams. Their isolated fixture runner, tunnel and required UI states do not follow from native STOP source acceptance. |
| R04 kernel/SQL rehearsal | Not run. Requires later operator release and real owned sandbox identity, fresh gates, kernel pause/kill/terminal evidence and actual isolated SQL/API readiness. Mock receipts are source evidence only. |
| R05 build and packaging | Not run. Dedicated native compiler launch and contained userspace OCI packaging remain absent. No Docker/BuildKit daemon build, commit, export, import or load inherits the container freeze proof. |

The kernel reader accepts at most 1 second of observed work, 64 KiB per ordinary
file, 256 KiB mount metadata, 4,096 tasks, 256 cgroups and 32,768 directory entries.
Overrun, permission denial, mount/path replacement, PID reuse, changed membership/
topology between the two passes, incomplete scan or
unknown freezer state throws; the lifecycle retains admission. These checks do
not hard-preempt a synchronous syscall or inspector callback. Live integration
must provide an independently supervised bounded-call policy and recovery.

Parent read-only inventory reports existing base
`sha256:5b7d9171d9633c132766c65abd934c791787693a72b7f016bcd1408097dedadd`
as a local Linux/arm64 **image ID**, with empty `RepoDigests`. It is not evidence
of a registry manifest digest, a new APP build, a compiler-container workspace,
freezer support, watchdog custody or coordinator readiness.

The next source action is a fixed local-Docker read/dispatch adapter: only exact
inspect/pause/unpause specifications, explicit socket/config, strict output and
time caps, sanitized identity projection, and mock tests for socket/timeout/JSON/
ownership failures. It must acquire real container/PID/cgroup identity rather
than trust caller JSON. Independent source acceptance precedes any authorized
disposable native-container rehearsal. Before launch is written or used, settle
R02 with the shared queue owner; a private YT lease cannot reserve all owners' slot.
