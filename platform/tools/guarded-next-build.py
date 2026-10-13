"""Run one local Next build after operator slot release; pause only our process group.

This does not control Docker/BuildKit daemon work or remote packaging. Those stages
need their own host-side guard, and must not be launched through this wrapper.
This local STOP readback does not implement a cross-host lease/admission reservation,
APP/OPS identity or isolated-readiness verifier, or a native remote executor adapter.
No work or probes occur on import. A paused process is never automatically resumed.
"""
import argparse
import datetime
import fcntl
import json
import math
import os
from pathlib import Path
import shutil
import signal
import subprocess
import time

GIB = 1024 ** 3
PROCESS_STATES = frozenset('RSDTtZXIWPK')
SITES = {'tag': 'https://tag.observe.tw/', 'blog': 'https://blog.observe.tw/', 'youtube': 'https://youtube.observe.tw/'}
GATE_BASELINE = json.loads(Path(__file__).with_name('performance-gate-baseline.json').read_text())
SITE_LIMITS = {site: max(2, 2 * GATE_BASELINE['sites'][site]['medianSeconds']) for site in SITES}
assert all(SITE_LIMITS[site] == GATE_BASELINE['sites'][site]['limitSeconds'] for site in SITES)


def valid_slot_notice(notice, now=None):
    # A remote-host exception or old blog completion cannot reserve the global slot.
    if not (notice.get('owner') == 'YT' and notice.get('globalSingleBuildSlotGranted') is True
            and notice.get('remoteHostsAccounted') is True and notice.get('queueReleasedForYT') is True
            and notice.get('otherOwnersIdle') is True and bool(notice.get('operatorMessage'))):
        return False
    try:
        verified = datetime.datetime.fromisoformat(notice['verifiedAt'].replace('Z', '+00:00'))
        if verified.tzinfo is None:
            return False
        age = ((now or datetime.datetime.now(datetime.timezone.utc)) - verified).total_seconds()
        return 0 <= age <= 120
    except (KeyError, TypeError, ValueError, AttributeError):
        return False


def reasons(sample, starting=False, estimate_bytes=0):
    failures = []
    free = sample.get('freeBytes')
    floor = (40 if starting else 30) * GIB
    if not isinstance(free, (int, float)) or not math.isfinite(free) or free < floor:
        failures.append('disk-start-40GiB' if starting else 'disk-stop-30GiB')
    if starting and isinstance(free, (int, float)) and free - estimate_bytes < 30 * GIB:
        failures.append('estimated-artifacts-cross-30GiB')
    load = sample.get('load1')
    if not isinstance(load, (int, float)) or not math.isfinite(load) or load > 12 or load < 0:
        failures.append('load-over-12-or-unknown')
    metrics = sample.get('sites', {})
    for site in SITES:
        value = metrics.get(site, {})
        total = value.get('totalSeconds')
        # Fail closed on timeout, incomplete response, redirects and unknown values.
        if value.get('exitCode') != 0 or value.get('status') != 200:
            failures.append(site + '-response-unavailable')
        if not isinstance(total, (int, float)) or not math.isfinite(total) or not 0 <= total <= SITE_LIMITS[site]:
            failures.append(site + '-complete-response-over-baseline-limit-or-unknown')
    return failures


def sample():
    result = {'freeBytes': shutil.disk_usage('/home').free, 'load1': os.getloadavg()[0], 'sites': {}}
    for site, url in SITES.items():
        try:
            response = subprocess.run(['curl', '--silent', '--show-error', '--max-time', str(SITE_LIMITS[site] + 1),
                                       '--output', '/dev/null', '--user-agent', 'youtube-board-verify/1.0',
                                       '--header', 'DNT: 1', '--header', 'Accept: text/html', '--write-out', '%{http_code} %{time_total}', url],
                                      capture_output=True, text=True, timeout=SITE_LIMITS[site] + 2)
            status, total = response.stdout.split()
            result['sites'][site] = {'exitCode': response.returncode, 'status': int(status), 'totalSeconds': float(total)}
        except (OSError, ValueError, subprocess.TimeoutExpired):
            result['sites'][site] = {'exitCode': -1, 'status': None, 'totalSeconds': None}
    # Re-read after requests; do not act on an earlier free-space/load sample.
    result.update(freeBytes=shutil.disk_usage('/home').free, load1=os.getloadavg()[0])
    return result


def competing_builds(exclude_group=None):
    matches = []
    for path in Path('/proc').iterdir():
        if not path.name.isdecimal() or int(path.name) == os.getpid():
            continue
        try:
            if exclude_group is not None and os.getpgid(int(path.name)) == exclude_group:
                continue
            argv = (path / 'cmdline').read_bytes().split(b'\0')
        except (FileNotFoundError, ProcessLookupError):
            continue
        except PermissionError:
            raise RuntimeError('Cannot establish global build availability')
        names = [os.path.basename(a.decode(errors='replace')) for a in argv if a]
        if ('next' in names and 'build' in names) or ('docker' in names and ('build' in names or 'buildx' in names)) or (names and 'next-build' in names[0]):
            matches.append(int(path.name))
    return matches


def owned_members(group):
    """The setsid session and process group must both match our recorded child ID."""
    members = []
    for path in Path('/proc').iterdir():
        if not path.name.isdecimal():
            continue
        try:
            pid = int(path.name)
            if os.getpgid(pid) == group:
                if group == os.getpgrp() or os.getsid(pid) != group:
                    raise RuntimeError('Refuse signal: owned session mismatch')
                # Zombies perform no work and cannot react to signals.
                state = (path / 'stat').read_text().rsplit(')', 1)[1].split()[0]
                if state != 'Z':
                    members.append(pid)
        except (FileNotFoundError, ProcessLookupError):
            continue
    return members


def owned_states(group, tracked=()):
    """Read Linux (starttime, state) for the owned session/group and its descendants.

    Tracked identities must not escape or be reused. New members/descendants are
    checked too. This cannot contain an unknown process orphaned outside the
    session before the first snapshot; remote/daemon containment remains unsupported.
    """
    if not isinstance(group, int) or group <= 0 or group in (os.getpgrp(), os.getsid(0)):
        raise RuntimeError('Refuse readback: owned session mismatch')
    records = {}
    for path in Path('/proc').iterdir():
        if not path.name.isdecimal():
            continue
        try:
            fields = (path / 'stat').read_text().rsplit(')', 1)[1].split()
            state, parent, process_group, session, started = fields[0], int(fields[1]), int(fields[2]), int(fields[3]), int(fields[19])
            if len(state) != 1 or started < 0:
                raise ValueError('Invalid process identity')
            records[int(path.name)] = (parent, process_group, session, started, state)
        except (FileNotFoundError, ProcessLookupError):
            continue  # A vanished task performs no more work.
        except (OSError, ValueError, IndexError) as error:
            raise RuntimeError('Owned stop readback unavailable') from error
    admitted = set(tracked) | {pid for pid, row in records.items() if row[1] == group or row[2] == group}
    # Catch a child that changed its process group/session while its parent is
    # still identifiable. Never signal the escaped process or a shared daemon.
    while True:
        children = {pid for pid, row in records.items() if row[0] in admitted}
        if children <= admitted:
            break
        admitted.update(children)
    states = {}
    for pid in admitted:
        row = records.get(pid)
        if row is None:
            continue
        _, process_group, session, started, state = row
        if process_group != group or session != group or pid in tracked and started != tracked[pid][0]:
            raise RuntimeError('Refuse stop confirmation: escaped or reused owned identity')
        if state not in PROCESS_STATES:
            raise RuntimeError('Unknown owned process state')
        if state != 'Z':
            states[pid] = (started, state)
    return states


def confirm_owned_stopped(group, initial, readback=owned_states, timeout=1.0, interval=0.05,
                          clock=time.monotonic, sleep=time.sleep):
    """Bounded readback, requiring two stable stopped/exited snapshots.

    False/unknown never establishes a physical pause. IO/clock/sleep are injectable
    so tests never inspect /proc, signal processes, sleep or start main/probes.
    """
    if not initial or not math.isfinite(timeout) or not 0 < timeout <= 2 or not math.isfinite(interval) or not 0.01 <= interval <= timeout:
        return False
    tracked = dict(initial)
    started_at = clock()
    if not math.isfinite(started_at):
        return False
    deadline = started_at + timeout
    previous = None
    last_time = started_at
    for _ in range(math.ceil(timeout / interval) + 2):
        current = readback(group, tracked)
        for pid, identity in current.items():
            if not isinstance(pid, int) or pid <= 0 or not isinstance(identity, tuple) or len(identity) != 2:
                raise RuntimeError('Invalid owned stop readback')
            started, state = identity
            if not isinstance(started, int) or started < 0 or state not in PROCESS_STATES:
                raise RuntimeError('Unknown owned process state')
            if pid in tracked and started != tracked[pid][0]:
                raise RuntimeError('Refuse stop confirmation: reused owned identity')
        tracked.update(current)
        surviving = {pid: identity for pid, identity in current.items() if identity[1] != 'Z'}
        now = clock()
        if not math.isfinite(now) or now < last_time or now > deadline:
            return False
        last_time = now
        stopped = all(identity[1] in ('T', 't') for identity in surviving.values())
        identities = {pid: identity[0] for pid, identity in surviving.items()}
        if stopped and previous == identities:
            return True
        previous = identities if stopped else None
        if now >= deadline:
            return False
        sleep(min(interval, deadline - now))
    return False


def signal_owned(group, sig, members=owned_members, signal_group=os.killpg,
                 readback=owned_states, confirm=confirm_owned_stopped):
    if not members(group):
        return False
    initial = readback(group) if sig == signal.SIGSTOP else None
    if sig == signal.SIGSTOP and not initial:
        return False
    try:
        if signal_group(group, sig) is False:
            return False
        return confirm(group, initial, readback) if sig == signal.SIGSTOP else True
    except ProcessLookupError:
        return False


class Monitor:
    """One tick; injected IO permits offline tests of failure and recovery paths."""
    def __init__(self, group, estimate, probe, log, send, competitors, cancel_resume=lambda: False):
        self.group, self.estimate = group, estimate
        self.probe, self.log, self.send, self.competitors = probe, log, send, competitors
        self.cancel_resume = cancel_resume
        self.paused = False
        self.stop_confirmed = False
        self.stop_requested = False
        self.resume_requested = False

    def pause(self, failures):
        self.paused = True  # Remain fail-closed even if audit IO itself fails.
        self.resume_requested = False
        self.stop_confirmed = False
        try:
            if self.send(self.group, signal.SIGSTOP) is not True:
                raise RuntimeError('Owned STOP was not confirmed')
            self.stop_confirmed = True
        except Exception:
            failures = [*failures, 'STOP-unconfirmed-operator-recovery-required']
            # Preserve guardian/lock; never broaden signals to unrelated processes.
            try:
                os.write(2, b'CRITICAL: owned build STOP could not be confirmed; operator recovery required.\n')
            except OSError:
                pass
        try:
            self.log('paused' if self.stop_confirmed else 'STOP-unconfirmed', failures=failures,
                     processGroup=self.group, stopConfirmed=self.stop_confirmed)
        except Exception:
            pass

    def tick(self, leader_exited=False):
        try:
            if self.stop_requested or leader_exited:
                self.stop_requested = False
                self.resume_requested = False
                self.pause(['operator-stop-signal' if not leader_exited else 'leader-exited-with-live-descendants'])
                return
            if self.paused:
                # An out-of-band SIGCONT does not silently disable monitoring.
                if self.send(self.group, signal.SIGSTOP) is not True:
                    self.pause(['STOP-readback-failed'])
                    return
                self.stop_confirmed = True
                if not self.resume_requested:
                    return
                self.resume_requested = False
                current = self.probe()
                blocked = reasons(current, starting=True, estimate_bytes=self.estimate)
                if self.competitors(self.group):
                    blocked.append('competing-build')
                self.log('explicit-resume-preflight', sample=current, failures=blocked)
                if not blocked and not self.cancel_resume():
                    if self.send(self.group, signal.SIGCONT) is not True:
                        raise RuntimeError('Owned resume dispatch failed')
                    self.paused = False
                    self.stop_confirmed = False
                return
            self.resume_requested = False  # A request made before a failure is not recovery approval.
            current = self.probe()
            blocked = reasons(current)
            self.log('sample', sample=current, failures=blocked)
            if blocked:
                self.pause(blocked)
        except Exception:
            self.pause(['monitor-failure'])


def safe_to_finish(members, monitor):
    """Empty ordinary membership cannot release an unresolved STOP reservation.

    Keep the guardian/local flock alive after false/failed ownership readback;
    group disappearance alone is not proof that an escaped executor stopped.
    """
    return not members and (not monitor.paused or monitor.stop_confirmed is True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--platform-root', required=True, type=Path)
    parser.add_argument('--slot-release-receipt', required=True, type=Path)
    parser.add_argument('--log', required=True, type=Path)
    parser.add_argument('--estimated-gib', required=True, type=float)
    args = parser.parse_args()
    if not math.isfinite(args.estimated_gib) or args.estimated_gib <= 0:
        parser.error('A positive artifact estimate is required')
    notice = json.loads(args.slot_release_receipt.read_text())
    if not valid_slot_notice(notice):
        parser.error('Fresh global single-build slot and YT queue-release receipt including remote hosts required')
    root = args.platform_root.resolve(strict=True)
    cli = root / 'node_modules/next/dist/bin/next'
    if not cli.is_file():
        parser.error('Existing installed Next required; this wrapper never installs dependencies')
    lock = open('/tmp/observe-sites-build.lock', 'a')
    fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    if competing_builds():
        raise RuntimeError('Global build slot occupied; no build started')
    requests = {'stop': False, 'resume': False}
    monitor_holder = [None]
    def request_stop(_signal, _frame): requests['stop'] = True
    def request_resume(_signal, _frame):
        if monitor_holder[0] is not None and monitor_holder[0].paused:
            requests['resume'] = True
    signal.signal(signal.SIGINT, request_stop)
    signal.signal(signal.SIGTERM, request_stop)
    signal.signal(signal.SIGUSR1, request_resume)
    # Exclusive output prevents overwriting any old release/test/build evidence.
    with args.log.open('x') as log:
        def record(event, **fields):
            log.write(json.dumps({'at': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'event': event, **fields}) + '\n')
            log.flush()
        initial = sample()
        blocked = reasons(initial, starting=True, estimate_bytes=args.estimated_gib * GIB)
        record('preflight', sample=initial, failures=blocked, estimatedGiB=args.estimated_gib, performanceGateBaseline=GATE_BASELINE)
        if blocked:
            return 75
        # Other threads may not yet honor flock; rescan after the HTTP preflight.
        if requests['stop'] or competing_builds():
            record('start-denied', reason='stop-request-or-competing-build')
            return 75
        env = os.environ.copy()
        # Public measurement ID is build-inlined; preserve the approved production
        # setting. Candidate hostname/DNT guards and capture network blocks remain.
        env.update(NEXT_TELEMETRY_DISABLED='1', NEXT_PUBLIC_GA_ID='G-X2G1PLNP7K', NODE_OPTIONS='--max-old-space-size=2048')
        cpu = str(min(os.sched_getaffinity(0)))
        with Path(str(args.log) + '.output').open('x') as output:
            # Re-read at launch: HTTP preflight may age the receipt or the
            # coordinator may revoke the slot while those probes complete.
            try:
                slot_current = valid_slot_notice(json.loads(args.slot_release_receipt.read_text()))
            except (OSError, ValueError, TypeError, AttributeError):
                slot_current = False
            if not slot_current:
                record('start-denied', reason='global-slot-receipt-stale-invalid-or-revoked')
                return 75
            process = subprocess.Popen(['nice', '-n', '19', 'ionice', '-c3', 'taskset', '-c', cpu,
                                        'node', str(cli), 'build', '--webpack'],
                                       cwd=root / 'web', env=env, stdout=output, stderr=output, start_new_session=True)
            monitor = Monitor(process.pid, args.estimated_gib * GIB, sample, record, signal_owned, competing_builds, lambda: requests['stop'])
            monitor_holder[0] = monitor
            try:
                record('started', guardianPid=os.getpid(), pid=process.pid, processGroup=process.pid, cpu=cpu)
            except Exception:
                monitor.pause(['start-receipt-failure'])
            while True:
                try:
                    leader_exited = process.poll() is not None
                    if safe_to_finish(owned_members(process.pid), monitor):
                        break
                    monitor.stop_requested |= requests['stop']
                    monitor.resume_requested |= requests['resume']
                    requests.update(stop=False, resume=False)
                    monitor.tick(leader_exited=leader_exited)
                except Exception:
                    monitor.pause(['supervisor-failure'])
                time.sleep(5)
            process.wait()
            record('finished', code=process.returncode, wasPaused=monitor.paused)
            return process.returncode


if __name__ == '__main__':
    raise SystemExit(main())
