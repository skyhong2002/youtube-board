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
    return {host: {'schema': 'yt-host-health-v1', 'observedHost': host,
                   'machineId': pin, 'measuredFromMachineId': pin,
                   'observedAt': NOW.isoformat(), 'freeBytes': 60 * 1024 ** 3,
                   'load1': 2, 'buildCount': 0, 'buildProcesses': [],
                   'browserCount': 0, 'browserProcesses': [],
                   'sites': {site: {'exitCode': 0, 'status': 200, 'totalSeconds': 1}
                             for site in gate.LIMITS}} for host, pin in ids.items()}


class GateTests(unittest.TestCase):
    def test_two_hosts_without_mint_and_remote_times_reference(self):
        data = samples()
        data['skyhong-blog']['sites']['youtube']['totalSeconds'] = 3
        result = gate.evaluate(data, NOW)
        self.assertTrue(result['ok'])
        self.assertFalse(result['admissionGranted'])

    def test_sm_relative_time_gate(self):
        data = samples()
        data['SM']['sites']['blog']['totalSeconds'] = 6.17
        self.assertTrue(gate.evaluate(data, NOW)['ok'])
        for site, limit in gate.LIMITS.items():
            changed = copy.deepcopy(data)
            changed['SM']['sites'][site]['totalSeconds'] = limit + .001
            self.assertFalse(gate.evaluate(changed, NOW)['ok'])

    def test_any_host_http_and_curl_failures(self):
        for host in gate.HOSTS:
            for field, value in [('status', 503), ('status', 403), ('exitCode', 56)]:
                data = samples()
                data[host]['sites']['tag'][field] = value
                self.assertFalse(gate.evaluate(data, NOW)['ok'])

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
