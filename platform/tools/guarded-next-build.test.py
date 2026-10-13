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
        row = good(); row['sites']['blog']['totalSeconds'] = 6
        self.assertEqual(guard.reasons(row), [])
        row['sites']['blog']['totalSeconds'] = 6.01
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
        self.assertTrue(guard.signal_owned(123, signal.SIGSTOP, lambda _: [123, 124], lambda *args: signals.append(args)))
        self.assertEqual(signals, [(123, signal.SIGSTOP)])
        def refuse(_): raise RuntimeError('session mismatch')
        with self.assertRaises(RuntimeError):
            guard.signal_owned(123, signal.SIGSTOP, refuse, lambda *args: signals.append(args))
        self.assertEqual(len(signals), 1)

    def test_empty_group_not_signalled(self):
        self.assertFalse(guard.signal_owned(123, signal.SIGSTOP, lambda _: [], lambda *_: self.fail('signal sent')))

    def monitor(self, probe=lambda: good(), log=lambda *a, **k: None, competitors=lambda _: []):
        signals = []
        return guard.Monitor(123, 8 * guard.GIB, probe, log, lambda *args: signals.append(args), competitors), signals

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
