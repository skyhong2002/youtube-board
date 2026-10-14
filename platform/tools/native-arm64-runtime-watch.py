"""Live, bounded watchdog wiring for one externally admitted native compiler.

This tool does NOT create/start/build/commit/remove containers, grant the slot,
resume work or deploy. The caller supplies independently checked identity/tool
pins and fresh observations over the authenticated controller SSH stdin. EOF,
invalid input, timeout or transport loss pauses only the owned compiler and
retains custody. Compiler exit requires separate terminal proof and packaging.
"""
import datetime as dt
import importlib.util
import json
import os
from pathlib import Path
import selectors
import signal
import sys
import time


def load(name, filename):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).with_name(filename))
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


executor_module = load('runtime_watch_executor', 'native-arm64-executor.py')
docker_module = load('runtime_watch_docker', 'native-arm64-docker-io.py')
cgroup_module = load('runtime_watch_cgroup', 'native-arm64-cgroup-io.py')
watchdog_module = load('runtime_watch_watchdog', 'native-arm64-watchdog.py')
MAX_PACKET = 131072
INPUT_WAIT_SECONDS = 10
OUTPUT_WAIT_SECONDS = 1
MAX_OUTPUT = 4096


def unique(pairs):
    value = {}
    for key, item in pairs:
        if key in value:
            raise ValueError('duplicate-field')
        value[key] = item
    return value


class PacketReader:
    """Read one bounded JSON line; no unbounded readline or raw error output."""
    def __init__(self, fd, clock=time.monotonic, selector=selectors.DefaultSelector, read=os.read):
        self.fd, self.clock, self.selector, self.read = fd, clock, selector, read
        self.buffer = b''

    def receive(self):
        deadline = self.clock() + INPUT_WAIT_SECONDS
        with self.selector() as poller:
            poller.register(self.fd, selectors.EVENT_READ)
            while b'\n' not in self.buffer:
                remaining = deadline - self.clock()
                if remaining <= 0 or not poller.select(remaining):
                    raise ValueError('controller-heartbeat-timeout')
                part = self.read(self.fd, min(4096, MAX_PACKET + 1 - len(self.buffer)))
                if not part:
                    raise ValueError('controller-transport-closed')
                self.buffer += part
                if len(self.buffer) > MAX_PACKET:
                    raise ValueError('controller-packet-over-cap')
            raw, self.buffer = self.buffer.split(b'\n', 1)
            return json.loads(raw, object_pairs_hook=unique)


class RuntimeWatch:
    def __init__(self, executor, receive, now):
        self.executor, self.receive, self.now = executor, receive, now
        self.packet = None
        self.sequence = -1
        self.watchdog = watchdog_module.Watchdog(
            executor, lambda: self.packet['samples'], lambda: self.packet['memory'],
            self.authenticate, now)

    def authenticate(self, identity):
        p = self.packet
        if not isinstance(p, dict) or p.get('binding') != identity.binding() or p.get('slotHeld') is not True:
            return False
        try:
            age = (self.now() - watchdog_module.gate.utc_timestamp(p['observedAt'])).total_seconds()
            return 0 <= age <= 30
        except (ValueError, TypeError, KeyError, OverflowError):
            return False

    def once(self):
        try:
            p = self.receive()
            if not isinstance(p, dict) or set(p) != {'schema', 'binding', 'sequence', 'slotHeld', 'observedAt', 'samples', 'memory'}:
                raise ValueError('unexpected-controller-fields')
            if p['schema'] != 'yt-native-runtime-heartbeat-v1' or type(p['sequence']) is not int or p['sequence'] <= self.sequence:
                raise ValueError('controller-sequence-invalid-or-replayed')
            self.sequence = p['sequence']
            self.packet = p
            if not self.authenticate(self.executor.identity):
                return self.watchdog.stop('controller-slot-invalid-stale-or-withdrawn')
            return self.watchdog.tick()
        except Exception:
            # Exception messages and received raw values may contain secrets.
            return self.watchdog.stop('controller-packet-unavailable-or-invalid')


def wire(identity, docker_pin, receive, now=lambda: dt.datetime.now(dt.timezone.utc)):
    """Real Docker/cgroup ports; callers cannot supply a fake physical STOP flag."""
    docker = docker_module.DockerBackend(identity, docker_pin)
    cgroup = cgroup_module.CgroupBackend(identity)
    executor = executor_module.Executor(identity, docker.inspect, docker.dispatch,
                                        cgroup.observe, lambda _: False,
                                        now, time.monotonic, time.sleep)
    return RuntimeWatch(executor, receive, now)


def emit(value, fd=1, clock=time.monotonic, selector=selectors.DefaultSelector,
         write=os.write, set_blocking=os.set_blocking):
    """SSH output must not prevent heartbeat expiry or physical owned pause."""
    raw = (json.dumps(value, sort_keys=True) + '\n').encode('utf-8')
    if len(raw) > MAX_OUTPUT:
        raise ValueError('fixed-state-output-over-cap')
    set_blocking(fd, False)
    deadline = clock() + OUTPUT_WAIT_SECONDS
    offset = 0
    with selector() as poller:
        poller.register(fd, selectors.EVENT_WRITE)
        while offset < len(raw):
            remaining = deadline - clock()
            if remaining <= 0 or not poller.select(remaining):
                raise ValueError('controller-output-deadline')
            try:
                count = write(fd, raw[offset:])
            except BlockingIOError:
                continue
            if type(count) is not int or not 0 < count <= len(raw) - offset:
                raise ValueError('controller-output-incomplete')
            offset += count


def cleanup(watch):
    # First perform physical STOP; even cleanup diagnostics must be bounded.
    result = watch.watchdog.stop('runtime-watch-interrupted-or-output-unavailable')
    try:
        emit(result)
    except Exception:
        pass
    return 1


def interrupt_watch(signum, frame):
    raise KeyboardInterrupt


def main():
    # Only fixed one owned identity supplied on argv; JSON files/values are not
    # taken from arbitrary paths or logged. No compiler launch is hidden here.
    if len(sys.argv) != 3:
        raise ValueError('exact-identity-and-docker-pin-json-required')
    identity = executor_module.Identity(**json.loads(sys.argv[1], object_pairs_hook=unique))
    docker_pin = docker_module.ToolPin(**json.loads(sys.argv[2], object_pairs_hook=unique))
    watch = wire(identity, docker_pin, PacketReader(sys.stdin.fileno()).receive)
    for signum in (signal.SIGTERM, signal.SIGHUP, signal.SIGINT):
        signal.signal(signum, interrupt_watch)
    try:
        while True:
            result = watch.once()
            # Only the fixed state/reason fields leave this worker. Accepted
            # health receipts are preserved by SM, not repeated here.
            out = {key: result[key] for key in ('state', 'reason', 'remoteStopConfirmed', 'reservationReleaseAllowed', 'runtimeReady') if key in result}
            emit(out)
            if result['state'] != 'running-observed':
                return 0 if result['state'] == 'terminal-proof-required' else 1
    except BaseException:
        for signum in (signal.SIGTERM, signal.SIGHUP, signal.SIGINT):
            signal.signal(signum, signal.SIG_IGN)
        return cleanup(watch)


if __name__ == '__main__':
    try:
        raise SystemExit(main())
    except (ValueError, TypeError, OSError):
        # Identity not verified: never dispatch against an arbitrary container.
        try:
            emit({'state': 'identity-unavailable-reservation-retained', 'runtimeReady': False})
        except Exception:
            pass
        raise SystemExit(1)
