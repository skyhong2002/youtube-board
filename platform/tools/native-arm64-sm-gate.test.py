"""Offline regressions only; no SSH, probes, service or container execution."""
import copy
import datetime
import importlib.util
import json
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('sm_gate', Path(__file__).with_name('native-arm64-sm-gate.py'))
gate = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gate)
NOW = datetime.datetime(2026, 10, 14, tzinfo=datetime.timezone.utc)


def samples():
    ids = {'SM': '302c2528bd464ad0953cf5fa743b6171',
           'skyhong-blog': '35ead342bacc44dea3633ccd2cc3f309'}
    return {host: {'schema': 'yt-host-health-median-v2', 'observedHost': host,
                   'machineId': pin, 'measuredFromMachineId': pin,
                   'observedAt': NOW.isoformat(), 'freeBytes': 60 * 1024 ** 3,
                   'load1': 2, 'buildCount': 0, 'buildProcesses': [],
                   'browserCount': 0, 'browserProcesses': [],
                   'sites': {site: [{'startedAt': NOW.isoformat(), 'finishedAt': NOW.isoformat(),
                                    'exitCode': 0, 'status': 200, 'totalSeconds': 1, 'bytes': 1234,
                                    'cfCacheStatus': 'HIT'} for _ in range(3)]
                             for site in gate.LIMITS}} for host, pin in ids.items()}


class GateTests(unittest.TestCase):
    def test_two_hosts_without_mint_and_remote_times_reference(self):
        data = samples()
        for row in data['skyhong-blog']['sites']['youtube']: row['totalSeconds'] = 3
        result = gate.evaluate(data, NOW)
        self.assertTrue(result['ok'])
        self.assertFalse(result['admissionGranted'])

    def test_sm_relative_time_gate(self):
        data = samples()
        for row in data['SM']['sites']['blog']: row['totalSeconds'] = 6.17
        self.assertTrue(gate.evaluate(data, NOW)['ok'])
        for site, limit in gate.LIMITS.items():
            changed = copy.deepcopy(data)
            for row in changed['SM']['sites'][site]: row['totalSeconds'] = limit + .001
            self.assertFalse(gate.evaluate(changed, NOW)['ok'])

    def test_any_host_http_and_curl_failures(self):
        for host in gate.HOSTS:
            for field, value in [('status', 503), ('status', 403), ('exitCode', 56), ('exitCode', 28)]:
                data = samples()
                data[host]['sites']['tag'][1][field] = value
                self.assertFalse(gate.evaluate(data, NOW)['ok'])

    def test_one_slow_success_uses_median_but_two_slow_fail(self):
        data = samples()
        rows = data['SM']['sites']['youtube']
        rows[0]['totalSeconds'] = 10
        self.assertTrue(gate.evaluate(data, NOW)['ok'])
        rows[1]['totalSeconds'] = 10
        self.assertFalse(gate.evaluate(data, NOW)['ok'])

    def test_missing_extra_or_invalid_raw_attempts_fail_closed(self):
        for mutate in [lambda rows: rows.pop(),
                       lambda rows: rows.append(copy.deepcopy(rows[0])),
                       lambda rows: rows[0].update(secret='sensitive-sentinel'),
                       lambda rows: rows[0].update(cfCacheStatus='sensitive-sentinel'),
                       lambda rows: rows[0].update(bytes=-1),
                       lambda rows: rows[0].update(totalSeconds=float('nan')),
                       lambda rows: rows[0].update(startedAt=(NOW-datetime.timedelta(seconds=31)).isoformat())]:
            data = samples(); mutate(data['SM']['sites']['youtube'])
            result = gate.evaluate(data, NOW)
            self.assertFalse(result['ok'])
            self.assertNotIn('sensitive-sentinel', json.dumps(result))

    def test_old_single_sample_rejected(self):
        data = samples(); data['SM']['schema'] = 'yt-host-health-v1'
        self.assertFalse(gate.evaluate(data, NOW)['ok'])

    def test_generated_measurements_flow_into_gate_and_timeout_fails(self):
        import subprocess
        from types import SimpleNamespace
        spec = importlib.util.spec_from_file_location('probe_cases', Path(__file__).with_name('native-arm64-sm-probe.py'))
        probe = importlib.util.module_from_spec(spec); spec.loader.exec_module(probe)
        ns = {'subprocess': subprocess, 'datetime': datetime, 'sites': {s: 'https://' + s + '.observe.tw/' for s in gate.LIMITS}}
        exec(compile(probe.SITE_SOURCE.rsplit('rows=collect_sites()', 1)[0], '<offline-probe>', 'exec'), ns)
        run = lambda *a, **kw: SimpleNamespace(returncode=0, stderr='', stdout='CF-Cache-Status: MISS\n\nYT_PROBE_METRICS 200 1.0 5678')
        data = samples()
        for host in gate.HOSTS:
            data[host]['sites'] = ns['collect_sites'](run, lambda: NOW.isoformat())
        result = gate.evaluate(data, NOW)
        self.assertTrue(result['ok'])
        self.assertEqual(result['medianSeconds']['SM']['tag'], 1.0)
        data['SM']['sites']['tag'][0].update(exitCode=28, status=None, bytes=None, totalSeconds=None)
        result = gate.evaluate(data, NOW)
        self.assertFalse(result['ok'])
        self.assertIsNone(result['medianSeconds']['SM']['tag'])

    def test_resource_and_freshness_fail_closed(self):
        for host in gate.HOSTS:
            for field, value in [('freeBytes', 40 * 1024 ** 3 - 1), ('load1', 12.01),
                                 ('observedAt', (NOW - datetime.timedelta(seconds=31)).isoformat())]:
                data = samples()
                data[host][field] = value
                self.assertFalse(gate.evaluate(data, NOW)['ok'])
            data = samples()
            data[host].update(buildCount=1, buildProcesses=[{'pid': 3, 'name': 'docker', 'etimes': 1}])
            self.assertFalse(gate.evaluate(data, NOW)['ok'])

    def test_browser_global_sum(self):
        data = samples()
        for host in gate.HOSTS:
            data[host].update(browserCount=1, browserProcesses=[{'pid': 4, 'name': 'chrome', 'etimes': 1}])
        self.assertTrue(gate.evaluate(data, NOW)['ok'])
        data['SM']['browserProcesses'].append({'pid': 5, 'name': 'chrome', 'etimes': 1})
        data['SM']['browserCount'] = 2
        self.assertFalse(gate.evaluate(data, NOW)['ok'])

    def test_strict_schema_and_identity_never_echo_sensitive_values(self):
        for host in gate.HOSTS:
            for field in ['extra', 'machineId', 'observedHost', 'observedAt']:
                data = samples()
                data[host][field] = 'sensitive-sentinel'
                result = gate.evaluate(data, NOW)
                self.assertFalse(result['ok'])
                self.assertNotIn('sensitive-sentinel', json.dumps(result))
        data = samples()
        data['Mint'] = copy.deepcopy(data['SM'])
        self.assertFalse(gate.evaluate(data, NOW)['ok'])


if __name__ == '__main__':
    unittest.main()
