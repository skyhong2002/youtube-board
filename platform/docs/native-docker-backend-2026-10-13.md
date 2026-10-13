# Fixed Docker backend source

APP remains `70529cff13b6b7f5b3e0571a229e2b61660f9df4`; TAG owns the
global slot. This packet performs no Docker call, probe, startup, build, capture,
install or host identity inspection. It belongs to separate OPS preparation.

`native-arm64-docker-io.py` adds an explicit-call local backend for the reviewed
executor's exact inspect/pause/unpause specifications. Construction/import has no
execution. No CLI, container launcher, arbitrary exec, image operation, daemon
build, Docker kill/stop/removal, admission grant or reservation release exists.

The backend requires an explicit tool SHA-256/device/inode/size/mode pin; no pin
is inferred from a path, mock or caller `runtimeReady` flag. It opens root-owned
protected `/usr/bin/docker` through no-follow directory FDs, hashes the held file,
checks stable metadata and ARM64 ELF identity, then executes that inherited FD.
The environment fixes the local Unix socket and configuration pathname; pathname
absence/contents and socket peer/daemon identity remain unverified runtime trust
prerequisites.
The tool pin and actual container/PID/cgroup identity are still unobserved.

The runner bounds stdout and stderr together to 65,536 bytes and uses a five-second
monotonic deadline per CLI call, covering tool verification and the child. It closes
pipes and attempts at most 0.5 seconds of cleanup of its own CLI child on unknown/
timeout/over-cap output. It does not signal a container or shared Docker daemon.
As with the kernel backend, synchronous filesystem reads and process creation
are not hard-preempted; live supervision remains required.

Inspect requests a fixed Go-template projection without environment, commands,
raw mount/bind paths, arbitrary labels or daemon error text. The backend rejects
duplicate JSON keys, unexpected fields/values, source/image/owner/starttime drift
and unsupported hardening. No raw stdout/stderr is included in errors. Pause and
unpause each require a new matching local inspection before dispatch. Dispatch
acknowledgement proves no physical STOP, resume, terminal state or admission;
the reviewed Executor must enforce authenticated gates and cgroup readback.

Tests inject all tool filesystem, clock, Popen, selector, pipe-read and inspection
boundaries. The Go template is source-reviewed only, not tried against Docker.
No mock result is an execution or runtime-readiness receipt.

Remaining executable prerequisites: independently observe the exact protected
tool and owned container/PID/cgroup identity, verify native toolchain/runtime,
wire bounded-call supervision and the kernel backend, settle all-owner durable
coordinator/Mint flock/lease and crash-surviving watchdog custody, verify deleted-
cgroup terminal cleanup, and review a contained compiler/userspace OCI packaging
launcher. A source-only adapter cannot release any of those gates.
