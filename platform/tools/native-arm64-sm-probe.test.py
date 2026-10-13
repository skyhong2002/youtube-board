"""Mock curl only; never probes a host or executes generated process scan."""
import datetime
import importlib.util
import json
from pathlib import Path
import subprocess
from types import SimpleNamespace
import unittest

spec = importlib.util.spec_from_file_location('probe', Path(__file__).with_name('native-arm64-sm-probe.py'))
probe = importlib.util.module_from_spec(spec)
spec.loader.exec_module(probe)


def helpers():
    ns = {'subprocess': subprocess, 'datetime': datetime, 'sites': {
        'tag': 'https://tag.observe.tw/', 'blog': 'https://blog.observe.tw/',
        'youtube': 'https://youtube.observe.tw/'}}
    exec(compile(probe.SITE_SOURCE.rsplit('rows=collect_sites()', 1)[0], '<mock-curl>', 'exec'), ns)
    return ns


class ProbeTests(unittest.TestCase):
    def test_three_attempts_raw_metrics_DNT_no_sensitive_headers(self):
        calls = []
        def run(argv, **kwargs):
            calls.append(argv)
            self.assertIn('DNT: 1', argv)
            self.assertIn('youtube-board-verify/1.0', argv)
            self.assertNotIn('--location', argv)
            return SimpleNamespace(returncode=0, stderr='', stdout=
                'HTTP/2 200\r\nSet-Cookie: sensitive-sentinel\r\nCF-Cache-Status: HIT\r\n'
                '\nYT_PROBE_METRICS 200 1.25 4321')
        ticks = iter(f'2026-10-14T00:00:{i:02d}+00:00' for i in range(18))
        data = helpers()['collect_sites'](run, lambda: next(ticks))
        self.assertEqual(len(calls), 9)
        for rows in data.values():
            self.assertEqual(len(rows), 3)
            for row in rows:
                self.assertLess(row['startedAt'], row['finishedAt'])
                self.assertEqual((row['exitCode'], row['status'], row['totalSeconds'], row['bytes'], row['cfCacheStatus']),
                                 (0, 200, 1.25, 4321, 'HIT'))
        self.assertNotIn('sensitive-sentinel', json.dumps(data))

    def test_curl_timeout_records_28_with_raw_fields(self):
        def run(argv, **kwargs):
            raise subprocess.TimeoutExpired(argv, 17)
        data = helpers()['collect_sites'](run)
        for rows in data.values():
            for row in rows:
                self.assertEqual(row['exitCode'], 28)
                self.assertIsNone(row['totalSeconds'])
                self.assertIsNotNone(row['finishedAt'])

    def test_partial_curl_error_retains_real_code_status_and_bytes(self):
        def run(argv, **kwargs):
            return SimpleNamespace(returncode=28, stderr='sensitive-sentinel',
                stdout='HTTP/2 200\r\nCF-Cache-Status: DYNAMIC\r\n\nYT_PROBE_METRICS 200 15.0 123')
        rows = helpers()['collect_sites'](run)['tag']
        self.assertEqual((rows[0]['exitCode'], rows[0]['bytes']), (28, 123))
        self.assertNotIn('sensitive-sentinel', json.dumps(rows))

    def test_malformed_metrics_and_unknown_cache_value_sanitized(self):
        for text in ['\nYT_PROBE_METRICS 200 nan 1', 'sensitive-sentinel']:
            run = lambda *a, **kw: SimpleNamespace(returncode=0, stdout=text, stderr='')
            rows = helpers()['collect_sites'](run)['tag']
            self.assertEqual(rows[0]['exitCode'], 0)
            self.assertIsNone(rows[0]['totalSeconds'])
            self.assertNotIn('sensitive-sentinel', json.dumps(rows))
        run = lambda *a, **kw: SimpleNamespace(returncode=0, stderr='', stdout=
            'CF-Cache-Status: sensitive-sentinel\n\nYT_PROBE_METRICS 200 1 1')
        self.assertEqual(helpers()['collect_sites'](run)['tag'][0]['cfCacheStatus'], 'UNKNOWN')

    def test_generated_probe_uses_v2_and_preserves_process_scan(self):
        for host in ('SM', 'skyhong-blog'):
            script = probe.readonly_script(host)
            compile(script, '<inert-generated-probe>', 'exec')
            self.assertIn("'schema':'yt-host-health-median-v2'", script)
            self.assertIn('range(3)', script)
            self.assertIn("('runc','buildkit-runc')", script)
        with self.assertRaises(ValueError):
            probe.readonly_script('Mint')


if __name__ == '__main__':
    unittest.main()
