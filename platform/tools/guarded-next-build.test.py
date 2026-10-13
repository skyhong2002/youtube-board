import datetime
import importlib.util
from pathlib import Path
import signal
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('guard', Path(__file__).with_name('guarded-next-build.py'))
guard = importlib.util.module_from_spec(spec)
spec.loader.exec_module(guard)


def good():
    return {'freeBytes': 40 * guard.GIB, 'load1': 12,
            'sites': {name: {'exitCode': 0, 'status': 200, 'totalSeconds': 2} for name in guard.SITES}}


class Gates(unittest.TestCase):
    def test_thresholds(self):
        self.assertEqual(guard.reasons(good(), True, 8 * guard.GIB), [])
        row = good(); row['freeBytes'] -= 1
        self.assertIn('disk-start-40GiB', guard.reasons(row, True))
        row['freeBytes'] = 30 * guard.GIB
        self.assertEqual(guard.reasons(row), [])
        row['freeBytes'] -= 1
        self.assertIn('disk-stop-30GiB', guard.reasons(row))

    def test_frozen_measured_baseline(self):
        self.assertEqual(guard.SITE_LIMITS, {'tag': 2, 'blog': 6.17, 'youtube': 2})
        self.assertEqual(guard.GATE_BASELINE['measuredFromUTC'], '2026-10-13T05:47:30Z')
        self.assertEqual(guard.GATE_BASELINE['method']['samplesPerSite'], 5)

    def test_artifact_reserve(self):
        self.assertIn('estimated-artifacts-cross-30GiB', guard.reasons(good(), True, 11 * guard.GIB))

    def test_every_site_uses_complete_response(self):
        for site in guard.SITES:
            for delta in [{'totalSeconds': guard.SITE_LIMITS[site] + .01}, {'status': 503}, {'exitCode': 28}, {'totalSeconds': float('nan')}, {'status': None}]:
                row = good(); row['sites'][site].update(delta)
                self.assertTrue(guard.reasons(row), (site, delta))
        row = good(); del row['sites']['tag']
        self.assertTrue(guard.reasons(row))

    def test_explicit_relative_blog_limit(self):
        row = good(); row['sites']['blog']['totalSeconds'] = 6.17
        self.assertEqual(guard.reasons(row), [])
        row['sites']['blog']['totalSeconds'] = 6.1701
        self.assertTrue(guard.reasons(row))

    def test_remote_exception_cannot_reserve_global_slot(self):
        now = datetime.datetime(2026, 10, 13, 6, tzinfo=datetime.timezone.utc)
        for old in [{'remoteBuildAuthorized': True}, {'blogBuildFinished': True}]:
            self.assertFalse(guard.valid_slot_notice({'owner': 'YT', 'operatorMessage': 'old', **old}, now))
        notice = {'owner': 'YT', 'operatorMessage': 'coordinator released YT after blog',
                  'globalSingleBuildSlotGranted': True, 'remoteHostsAccounted': True,
                  'queueReleasedForYT': True, 'otherOwnersIdle': True, 'verifiedAt': now.isoformat()}
        self.assertTrue(guard.valid_slot_notice(notice, now))
        for key in ['globalSingleBuildSlotGranted', 'remoteHostsAccounted', 'queueReleasedForYT', 'otherOwnersIdle']:
            self.assertFalse(guard.valid_slot_notice({**notice, key: False}, now))
        for stamp in [None, 'invalid', '2026-10-13T06:00:00', '2026-10-13T06:00:01Z', '2026-10-13T05:57:59Z']:
            self.assertFalse(guard.valid_slot_notice({**notice, 'verifiedAt': stamp}, now))
        self.assertTrue(guard.valid_slot_notice({**notice, 'verifiedAt': '2026-10-13T05:58:00Z'}, now))

    def test_load_and_unknown(self):
        for value in [12.01, None, float('nan'), -1]:
            row = good(); row['load1'] = value
            self.assertTrue(guard.reasons(row))

    def test_only_validated_owned_group_stopped(self):
        signals = []
        self.assertTrue(guard.signal_owned(123, signal.SIGSTOP, lambda _: [123, 124], lambda *args: signals.append(args),
                                         readback=lambda *_: {123: (1, 'T'), 124: (2, 't')},
                                         confirm=lambda group, initial, readback: self.confirm(initial, readback)))
        self.assertEqual(signals, [(123, signal.SIGSTOP)])
        def refuse(_): raise RuntimeError('session mismatch')
        with self.assertRaises(RuntimeError):
            guard.signal_owned(123, signal.SIGSTOP, refuse, lambda *args: signals.append(args))
        self.assertEqual(len(signals), 1)

    def test_empty_group_not_signalled(self):
        self.assertFalse(guard.signal_owned(123, signal.SIGSTOP, lambda _: [], lambda *_: self.fail('signal sent')))

    def monitor(self, probe=lambda: good(), log=lambda *a, **k: None, competitors=lambda _: []):
        signals = []
        def send(*args):
            signals.append(args)
            return True
        return guard.Monitor(123, 8 * guard.GIB, probe, log, send, competitors), signals

    def confirm(self, initial, readback, timeout=.2, interval=.05):
        at = [0.0]
        def sleep(seconds):
            at[0] += seconds
        return guard.confirm_owned_stopped(123, initial, readback, timeout=timeout,
                                           interval=interval, clock=lambda: at[0], sleep=sleep)

    def test_stop_confirmation_requires_two_stable_stopped_snapshots(self):
        calls = []
        def readback(group, tracked):
            calls.append((group, dict(tracked)))
            return {123: (1, 'T'), 124: (2, 't')}
        self.assertTrue(self.confirm({123: (1, 'R'), 124: (2, 'S')}, readback))
        self.assertEqual(len(calls), 2)
        self.assertTrue(all(call[0] == 123 for call in calls))

    def test_running_member_times_out_without_physical_confirmation(self):
        calls = []
        def readback(*_):
            calls.append(True)
            return {123: (1, 'T'), 124: (2, 'R')}
        self.assertFalse(self.confirm({123: (1, 'R'), 124: (2, 'R')}, readback))
        self.assertEqual(len(calls), 5)

    def test_new_member_must_stop_before_confirmation(self):
        snapshots = iter([{123: (1, 'T')}, {123: (1, 'T'), 125: (3, 'R')},
                          {123: (1, 'T'), 125: (3, 'T')}, {123: (1, 'T'), 125: (3, 't')}, {123: (1, 'T'), 125: (3, 'R')}])
        # T/t are both stopped; a new member must first stop and then remain present.
        self.assertTrue(self.confirm({123: (1, 'R')}, lambda *_: next(snapshots)))
        snapshots = iter([{123: (1, 'T'), 125: (3, 'R')},
                          {123: (1, 'T'), 125: (3, 'T')}, {123: (1, 'T'), 125: (3, 'T')}])
        self.assertTrue(self.confirm({123: (1, 'R')}, lambda *_: next(snapshots)))

    def test_vanished_and_zombie_members_do_not_block_surviving_stopped_group(self):
        tracked = []
        def readback(_group, known):
            tracked.append(dict(known))
            return {123: (1, 'T'), 124: (2, 'Z')}
        self.assertTrue(self.confirm({123: (1, 'R'), 124: (2, 'R'), 125: (3, 'R')}, readback))
        self.assertIn(125, tracked[-1])  # Keep birth identity even after disappearance.
        self.assertTrue(self.confirm({123: (1, 'R')}, lambda *_: {}))

    def test_unknown_and_reused_readback_refuse_confirmation(self):
        for result in [{123: (1, '?')}, {123: (9, 'T')}, {123: None}]:
            with self.assertRaises(RuntimeError):
                self.confirm({123: (1, 'R')}, lambda *_: result)
        def fail(*_):
            raise OSError('mock readback failure')
        with self.assertRaises(OSError):
            self.confirm({123: (1, 'R')}, fail)

    def test_readback_timeout_and_poll_bounds_fail_closed(self):
        self.assertFalse(guard.confirm_owned_stopped(123, {123: (1, 'R')}, lambda *_: {123: (1, 'T')},
                         timeout=.1, interval=.05, clock=lambda: float('nan'), sleep=lambda _: self.fail('slept')))
        self.assertFalse(guard.confirm_owned_stopped(123, {123: (1, 'R')}, timeout=.1, interval=.00001))
        # A frozen injected clock cannot turn readback into an unbounded loop.
        count = [0]
        def running(*_):
            count[0] += 1
            return {123: (1, 'R')}
        self.assertFalse(guard.confirm_owned_stopped(123, {123: (1, 'R')}, running,
                         timeout=.1, interval=.05, clock=lambda: 0, sleep=lambda _: None))
        self.assertEqual(count[0], 4)

    def proc_states(self, tasks, tracked=()):
        class Task:
            def __init__(self, pid, data):
                self.name, self.data = str(pid), data
            def __truediv__(self, _):
                return self
            def read_text(self):
                if isinstance(self.data, Exception):
                    raise self.data
                state, parent, process_group, session, birth = self.data
                fields = [state, str(parent), str(process_group), str(session)] + ['0'] * 15 + [str(birth)]
                return self.name + ' (mock (worker)) ' + ' '.join(fields)
        class Proc:
            def iterdir(self):
                return [Task(pid, row) for pid, row in tasks.items()]
        with patch.object(guard, 'Path', lambda _: Proc()), patch.object(guard.os, 'getpgrp', return_value=999), patch.object(guard.os, 'getsid', return_value=999):
            return guard.owned_states(123, tracked)

    def test_linux_readback_identifies_new_members_and_vanished_tasks(self):
        self.assertEqual(self.proc_states({123: ('T', 1, 123, 123, 1),
                         124: ('t', 123, 123, 123, 2), 125: FileNotFoundError(),
                         999: ('R', 1, 999, 999, 3)}), {123: (1, 'T'), 124: (2, 't')})

    def test_linux_readback_refuses_escaped_session_group_descendant_and_pid_reuse(self):
        for tasks, tracked in [
            ({123: ('T', 1, 123, 777, 1)}, {}),
            ({123: ('T', 1, 777, 123, 1)}, {}),
            ({123: ('T', 1, 123, 123, 1), 124: ('R', 123, 777, 777, 2)}, {}),
            ({123: ('T', 1, 123, 123, 1), 125: ('T', 1, 777, 777, 3)}, {125: (3, 'R')}),
            ({123: ('T', 1, 123, 123, 9)}, {123: (1, 'R')}),
        ]:
            with self.assertRaises(RuntimeError):
                self.proc_states(tasks, tracked)
        with self.assertRaises(RuntimeError):
            self.proc_states({123: PermissionError('mock inaccessible stat')})
        with self.assertRaises(RuntimeError):
            self.proc_states({123: ('?', 1, 123, 123, 1)})

    def test_false_dispatch_or_failed_readback_never_confirms_or_broadens_signals(self):
        readback = lambda *_: {123: (1, 'R')}
        self.assertFalse(guard.signal_owned(123, signal.SIGSTOP, lambda _: [123], lambda *_: False,
                         readback=readback, confirm=lambda *_: self.fail('confirmation after False dispatch')))
        signals = []
        self.assertFalse(guard.signal_owned(123, signal.SIGSTOP, lambda _: [123], lambda *args: signals.append(args),
                         readback=readback, confirm=lambda group, initial, reader: self.confirm(initial, reader)))
        self.assertEqual(signals, [(123, signal.SIGSTOP)])

    def test_readback_error_after_dispatch_is_logged_unconfirmed_without_extra_signals(self):
        signals, events, reads = [], [], [0]
        def readback(*_):
            reads[0] += 1
            if reads[0] == 1:
                return {123: (1, 'R')}
            raise RuntimeError('mock state unreadable')
        def send(group, sig):
            return guard.signal_owned(group, sig, lambda _: [123], lambda *args: signals.append(args), readback=readback)
        monitor = guard.Monitor(123, 8 * guard.GIB, good,
                                lambda event, **fields: events.append((event, fields)), send, lambda _: [])
        with patch.object(guard.os, 'write'):
            monitor.pause(['test'])
        self.assertTrue(monitor.paused)
        self.assertFalse(monitor.stop_confirmed)
        self.assertEqual(events[-1][0], 'STOP-unconfirmed')
        self.assertEqual(signals, [(123, signal.SIGSTOP)])

    def test_pause_log_and_status_retain_false_or_failed_confirmation(self):
        for send in [lambda *_: False, lambda *_: None]:
            events = []
            monitor, signals = self.monitor(log=lambda event, **fields: events.append((event, fields)))
            monitor.send = send
            with patch.object(guard.os, 'write'):
                monitor.pause(['test'])
                self.assertTrue(monitor.paused)
                self.assertFalse(monitor.stop_confirmed)
                self.assertEqual(events[-1][0], 'STOP-unconfirmed')
                self.assertFalse(events[-1][1]['stopConfirmed'])
                self.assertIn('STOP-unconfirmed-operator-recovery-required', events[-1][1]['failures'])
                monitor.resume_requested = True
                monitor.tick()
            self.assertTrue(monitor.paused)
            self.assertFalse(monitor.resume_requested)
            self.assertNotIn((123, signal.SIGCONT), signals)
        events = []
        monitor, _ = self.monitor(log=lambda event, **fields: events.append((event, fields)))
        monitor.pause(['test'])
        self.assertTrue(monitor.stop_confirmed)
        self.assertEqual(events[-1][0], 'paused')
        self.assertTrue(events[-1][1]['stopConfirmed'])

    def test_empty_members_after_unconfirmed_stop_cannot_release_guardian(self):
        def fail(*_):
            raise RuntimeError('mock escaped or unreadable identity')
        for send in [lambda *_: False, fail]:
            monitor, _ = self.monitor()
            monitor.send = send
            with patch.object(guard.os, 'write'):
                monitor.pause(['test'])
            self.assertTrue(monitor.paused)
            self.assertFalse(monitor.stop_confirmed)
            self.assertFalse(guard.safe_to_finish([], monitor))
            # Repeated empty observations cannot silently clear the reservation.
            self.assertFalse(guard.safe_to_finish([], monitor))

    def test_safe_finish_requires_empty_members_and_normal_or_confirmed_status(self):
        monitor, _ = self.monitor()
        self.assertTrue(guard.safe_to_finish([], monitor))
        self.assertFalse(guard.safe_to_finish([123], monitor))
        monitor.pause(['confirmed observation'])
        self.assertTrue(monitor.stop_confirmed)
        self.assertTrue(guard.safe_to_finish([], monitor))
        self.assertFalse(guard.safe_to_finish([124], monitor))
        monitor.stop_confirmed = None
        self.assertFalse(guard.safe_to_finish([], monitor))

    def test_confirmed_exit_readback_allows_empty_guardian_finish(self):
        snapshots = iter([{123: (1, 'R')}, {}, {}])
        signals = []
        def send(group, sig):
            return guard.signal_owned(group, sig, lambda _: [123], lambda *args: signals.append(args),
                                      readback=lambda *_: next(snapshots),
                                      confirm=lambda _group, initial, reader: self.confirm(initial, reader))
        monitor = guard.Monitor(123, 8 * guard.GIB, good, lambda *a, **k: None, send, lambda _: [])
        monitor.pause(['test exit'])
        self.assertTrue(monitor.stop_confirmed)
        self.assertTrue(guard.safe_to_finish([], monitor))
        self.assertEqual(signals, [(123, signal.SIGSTOP)])

    def test_monitor_exceptions_pause(self):
        def fail(*a, **k): raise OSError('mock failure')
        for kwargs in [{'probe': fail}, {'log': fail}]:
            monitor, signals = self.monitor(**kwargs)
            monitor.tick()
            self.assertTrue(monitor.paused)
            self.assertIn((123, signal.SIGSTOP), signals)

    def test_termination_and_descendants_pause_without_auto_resume(self):
        for exited in [False, True]:
            monitor, signals = self.monitor()
            monitor.stop_requested = not exited
            monitor.tick(leader_exited=exited)
            monitor.tick()
            self.assertTrue(monitor.paused)
            self.assertEqual(signals, [(123, signal.SIGSTOP)] * 2)

    def test_resume_needs_explicit_request_and_all_gates(self):
        monitor, signals = self.monitor()
        monitor.pause(['test'])
        monitor.tick()
        self.assertNotIn((123, signal.SIGCONT), signals)
        monitor.resume_requested = True
        monitor.tick()
        self.assertFalse(monitor.paused)
        self.assertEqual(signals[-1], (123, signal.SIGCONT))
        monitor.probe = lambda: {**good(), 'load1': 13}
        monitor.tick()
        self.assertTrue(monitor.paused)

    def test_resume_blocks_other_build_or_bad_metrics(self):
        for kwargs in [{'competitors': lambda _: [999]}, {'probe': lambda: {**good(), 'freeBytes': 29 * guard.GIB}}]:
            monitor, signals = self.monitor(**kwargs)
            monitor.pause(['test']); monitor.resume_requested = True; monitor.tick()
            self.assertTrue(monitor.paused)
            self.assertNotIn((123, signal.SIGCONT), signals)

    def test_stop_failure_does_not_escape_or_resume(self):
        monitor, _ = self.monitor()
        def fail(*_): raise PermissionError('mock')
        monitor.send = fail
        with patch.object(guard.os, 'write'):
            monitor.pause(['test']); monitor.tick()
        self.assertTrue(monitor.paused)

    def test_stale_request_not_recovery_approval(self):
        monitor, signals = self.monitor(probe=lambda: {**good(), 'load1': 13})
        monitor.resume_requested = True
        monitor.tick(); monitor.probe = good; monitor.tick()
        self.assertTrue(monitor.paused)
        self.assertNotIn((123, signal.SIGCONT), signals)

    def test_stop_during_resume_preflight_vetoes_continue(self):
        monitor, signals = self.monitor()
        monitor.pause(['test']); monitor.resume_requested = True
        monitor.cancel_resume = lambda: True
        monitor.tick()
        self.assertTrue(monitor.paused)
        self.assertNotIn((123, signal.SIGCONT), signals)


if __name__ == '__main__':
    unittest.main()
