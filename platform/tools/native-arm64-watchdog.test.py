"""All effects and observations are mocked; no probes, processes or signals."""
import copy
import datetime
import importlib.util
from pathlib import Path
import unittest

def load(name, filename):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).with_name(filename))
    module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
    return module

watchdog = load('watchdog', 'native-arm64-watchdog.py')
cases = load('gate_cases', 'native-arm64-sm-gate.test.py')

class Executor:
    identity = object()
    def __init__(self):
        self.members = {123: 456}
        self.paused = False
        self.stop_confirmed = True
        self.pause_calls = 0
        self.read_failure = False
    def read(self):
        if self.read_failure: raise ValueError('sensitive-sentinel')
        return {'running': True, 'paused': self.paused}, dict(self.members), self.paused
    def pause(self):
        self.pause_calls += 1
        self.paused = True
        return {'state': 'stop-confirmed' if self.stop_confirmed else 'STOP-unconfirmed-reservation-retained',
                'remoteStopConfirmed': self.stop_confirmed}

class WatchdogTests(unittest.TestCase):
    def setUp(self):
        self.executor = Executor()
        self.samples = cases.samples()
        self.samples['skyhong-blog'].update(freeBytes=35 * 1024 ** 3, buildCount=1,
            buildProcesses=[{'pid': 123, 'name': 'node', 'etimes': 1}])
        self.memory = {host: {'observedAt': cases.NOW.isoformat(), 'availableBytes': 2 * 1024 ** 3}
                       for host in watchdog.gate.HOSTS}
        self.slot = True
        self.job = watchdog.Watchdog(self.executor, lambda: self.samples, lambda: self.memory,
                                    lambda _: self.slot, lambda: cases.NOW)

    def test_own_compiler_runs_between_40_and_30_without_mutating_raw_receipt(self):
        original = copy.deepcopy(self.samples)
        result = self.job.tick()
        self.assertEqual(result['state'], 'running-observed')
        self.assertEqual(result['health']['diskFloorGiB'], 30)
        self.assertFalse(result['reservationReleaseAllowed'])
        self.assertEqual(self.executor.pause_calls, 0)
        self.assertEqual(self.samples, original)
        self.assertFalse(watchdog.gate.evaluate(self.samples, cases.NOW)['ok'])

    def test_low_disk_load_http_and_competing_build_pause_owned_job(self):
        for mutate in (
            lambda d: d['skyhong-blog'].update(freeBytes=30 * 1024 ** 3 - 1),
            lambda d: d['SM'].update(load1=12.01),
            lambda d: d['SM']['sites']['youtube'][2].update(exitCode=28),
            lambda d: d['skyhong-blog']['sites']['tag'][0].update(status=503),
            lambda d: d['skyhong-blog'].update(buildCount=2, buildProcesses=[
                {'pid': 123, 'name': 'node', 'etimes': 1}, {'pid': 999, 'name': 'docker', 'etimes': 1}]),
            lambda d: d['SM'].update(buildCount=1, buildProcesses=[{'pid': 123, 'name': 'node', 'etimes': 1}]),
        ):
            self.setUp(); mutate(self.samples)
            self.assertEqual(self.job.tick()['state'], 'stop-confirmed')
            self.assertEqual(self.executor.pause_calls, 1)

    def test_slot_loss_or_memory_unknown_low_or_stale_never_releases(self):
        for field, value in [('availableBytes', 768 * 1024 ** 2 - 1), ('availableBytes', None),
                             ('observedAt', (cases.NOW-datetime.timedelta(seconds=31)).isoformat())]:
            self.setUp(); self.memory['SM'][field] = value
            self.assertEqual(self.job.tick()['state'], 'stop-confirmed')
        self.setUp(); self.slot = False
        self.assertFalse(self.job.tick()['reservationReleaseAllowed'])

    def test_read_or_pause_unknown_never_claims_stop_or_echoes_error(self):
        self.executor.read_failure = True
        self.executor.stop_confirmed = False
        result = self.job.tick()
        self.assertFalse(result['remoteStopConfirmed'])
        self.assertFalse(result['reservationReleaseAllowed'])
        self.assertNotIn('sensitive-sentinel', str(result))

    def test_paused_work_never_resumes_automatically(self):
        self.executor.paused = True
        self.assertEqual(self.job.tick()['state'], 'stop-confirmed')
        self.assertEqual(self.job.tick()['state'], 'stop-confirmed')

    def test_pause_backend_exception_retains_custody_and_sanitizes_error(self):
        def unavailable(): raise ValueError('sensitive-sentinel')
        self.executor.pause = unavailable
        self.slot = False
        result = self.job.tick()
        self.assertFalse(result['remoteStopConfirmed'])
        self.assertFalse(result['reservationReleaseAllowed'])
        self.assertNotIn('sensitive-sentinel', str(result))

    def test_latest_owned_snapshot_accepts_worker_forks_but_not_other_pids(self):
        def observe():
            self.executor.members[124] = 457
            self.samples['skyhong-blog'].update(buildProcesses=[{'pid': 124, 'name': 'node', 'etimes': 1}])
            return self.samples
        self.job.observe_health = observe
        self.assertEqual(self.job.tick()['state'], 'running-observed')

    def test_running_exclusion_needs_owned_context_and_cannot_mask_SM_builds(self):
        self.assertFalse(watchdog.gate.evaluate(self.samples, cases.NOW, starting=False)['ok'])
        self.assertFalse(watchdog.gate.evaluate(self.samples, cases.NOW, owned_build_pids=frozenset({123}))['ok'])

    def test_final_owned_read_can_expire_memory_while_health_remains_fresh(self):
        clock = [cases.NOW]
        self.job.now = lambda: clock[0]
        for row in self.memory.values():
            row['observedAt'] = (cases.NOW-datetime.timedelta(seconds=29)).isoformat()
        original = self.executor.read
        calls = [0]
        def delayed_read():
            calls[0] += 1
            if calls[0] == 2:
                clock[0] += datetime.timedelta(seconds=2)
            return original()
        self.executor.read = delayed_read
        result = self.job.tick()
        self.assertEqual(result['state'], 'stop-confirmed')
        self.assertEqual(result['reason'], 'runtime-memory-expired-during-readback')
        self.assertEqual(self.executor.pause_calls, 1)
        self.assertEqual(calls[0], 2)

    def test_final_slot_auth_can_expire_memory_while_health_remains_fresh(self):
        clock = [cases.NOW]
        self.job.now = lambda: clock[0]
        for row in self.memory.values():
            row['observedAt'] = (cases.NOW-datetime.timedelta(seconds=29)).isoformat()
        calls = [0]
        def delayed_auth(_):
            calls[0] += 1
            if calls[0] == 2:
                clock[0] += datetime.timedelta(seconds=2)
            return True
        self.job.authenticate_slot = delayed_auth
        result = self.job.tick()
        self.assertEqual(result['state'], 'stop-confirmed')
        self.assertEqual(self.executor.pause_calls, 1)
        self.assertFalse(result['reservationReleaseAllowed'])
        self.assertEqual(calls[0], 2)

    def test_final_memory_and_health_share_one_decision_timestamp(self):
        from unittest.mock import patch
        decisions = []
        original_memory = watchdog.memory_valid
        original_health = watchdog.gate.evaluate
        def memory_check(data, now):
            decisions.append(('memory', now))
            return original_memory(data, now)
        def health_check(data, now, **kwargs):
            decisions.append(('health', now))
            return original_health(data, now, **kwargs)
        with patch.object(watchdog, 'memory_valid', memory_check), patch.object(watchdog.gate, 'evaluate', health_check):
            self.assertEqual(self.job.tick()['state'], 'running-observed')
        self.assertEqual([name for name, _ in decisions], ['memory', 'memory', 'health'])
        self.assertEqual(decisions[-2][1], decisions[-1][1])

if __name__ == '__main__': unittest.main()
