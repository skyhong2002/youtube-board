"""Offline mocks only: no SSH, /proc, locks, signals, probes, services or builds."""
import copy
import datetime
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import subprocess
import sys
from types import SimpleNamespace
import unittest
from unittest.mock import patch
from contextlib import redirect_stdout

spec = importlib.util.spec_from_file_location('admission', Path(__file__).with_name('native-arm64-admission.py'))
admission = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = admission
spec.loader.exec_module(admission)
NOW = datetime.datetime(2026, 10, 13, 10, 0, tzinfo=datetime.timezone.utc)
AT = NOW.isoformat()


def contract(**updates):
    fields = dict(ops_sha='a' * 40, owner='YT-owner', generation='job-1',
                  lockfile_sha256='b' * 64, base_digest='sha256:' + 'c' * 64,
                  source_root='/home/ubuntu/youtube-ts-builds/app-70529',
                  machine_ids=('1' * 32, '2' * 32, '3' * 32),
                  known_hosts_sha256=('4' * 64, '5' * 64, '6' * 64))
    fields.update(updates)
    return admission.Contract(**fields)


def packet(c):
    binding = c.binding()
    p = {
        'slot': {**binding, 'schema': 'yt-global-slot-v1', 'verifiedAt': AT,
                 'globalSingleBuildSlotGranted': True, 'remoteHostsAccounted': True,
                 'queueReleasedForYT': True, 'otherOwnersIdle': True, 'previousOwner': 'tag',
                 'operatorMessage': 'Mock operator explicitly releases YT global slot'},
        'reservation': {**binding, 'schema': 'yt-reservation-v1', 'durable': True, 'held': True,
                        'releaseRequiresRemoteTerminalProof': True, 'observedAt': AT},
        'mintLock': {**binding, 'path': admission.LOCK_PATH, 'held': True, 'controller': 'Mint',
                     'machineId': c.machine_ids[1], 'holderPid': 1234, 'inode': 5678,
                     'leaseId': 'mock-lease-1', 'custodyUntilRemoteTerminalProof': True, 'observedAt': AT},
        'identity': {**binding, 'sourceClean': True, 'sourceRoot': c.source_root,
                     'opsReviewed': True, 'platform': 'linux', 'arch': 'arm64',
                     'nodeVersion': '24.15.0', 'nodeModulesAbi': '137', 'libc': 'glibc',
                     'nextWorkers': 2, 'observedAt': AT},
        'readiness': {**binding, 'schema': 'yt-isolated-readiness-v1', 'isolated': True, 'ready': True,
                      'sourceWritesDisabled': True, 'productionApi': False,
                      'fixtureSha256': '7' * 64, 'observedAt': AT},
        'estimatedBytes': {h: 8 * admission.GIB for h in admission.HOSTS}, 'health': {},
    }
    for i, host in enumerate(admission.HOSTS):
        p['health'][host] = {
            'schema': 'yt-host-health-v1', 'observedHost': host,
            'machineId': c.machine_ids[i], 'measuredFromMachineId': c.machine_ids[i],
            'observedAt': AT, 'freeBytes': 60 * admission.GIB, 'load1': 1,
            'buildCount': 0, 'browserCount': 0,
            'sites': {site: {'exitCode': 0, 'status': 200, 'totalSeconds': .5}
                      for site in admission.SITES},
            'transport': {'controller': 'Mint', 'strictPinnedSsh': True,
                          'knownHostsSha256': c.known_hosts_sha256[i], 'exitCode': 0,
                          'scriptSha256': hashlib.sha256(admission.readonly_script(host).encode()).hexdigest()},
        }
    return p


def mocked_probe(argvs, denied=False, response=None):
    """Execute generated text with every OS/IO module replaced; no live probes."""
    calls = []
    class FakePath:
        def __init__(self, path): self.path = path
        @property
        def name(self): return self.path.rsplit('/', 1)[-1]
        def iterdir(self): return [FakePath('/proc/' + str(i + 100)) for i in range(len(argvs))]
        def __truediv__(self, name): return FakePath(self.path + '/' + name)
        def read_bytes(self):
            if denied: raise PermissionError('mock unreadable proc')
            i = int(self.path.split('/')[2]) - 100
            return b'\0'.join(x.encode() for x in argvs[i])
        def read_text(self): return '1' * 32
    def run(argv, **kwargs):
        calls.append((argv, kwargs))
        return response or SimpleNamespace(returncode=0, stdout='200 0.5')
    modules = {
        'pathlib': SimpleNamespace(Path=FakePath),
        'os': SimpleNamespace(path=SimpleNamespace(basename=os.path.basename), getloadavg=lambda: (1, 1, 1)),
        'shutil': SimpleNamespace(disk_usage=lambda path: SimpleNamespace(free=60 * admission.GIB)),
        'subprocess': SimpleNamespace(run=run, TimeoutExpired=subprocess.TimeoutExpired),
        'datetime': SimpleNamespace(datetime=SimpleNamespace(now=lambda tz: NOW), timezone=datetime.timezone),
    }
    output = io.StringIO()
    with patch.dict(sys.modules, modules), redirect_stdout(output):
        exec(compile(admission.readonly_script('SM'), '<mock-readonly-script>', 'exec'), {})
    return json.loads(output.getvalue()), calls


class PreparationTests(unittest.TestCase):
    def setUp(self):
        self.c = contract()
        self.p = packet(self.c)

    def failures(self, p=None, now=NOW):
        return admission.preparation_failures(self.p if p is None else p, self.c, now)

    def test_consistent_observations_never_grant_execution(self):
        self.assertEqual(self.failures(), [])
        result = admission.ReservationPreparation(self.c).observe(self.p, NOW)
        self.assertEqual(result['state'], 'preparation-observations-consistent')
        for key in ('runtimeReady', 'executionAllowed', 'reservationReleaseAllowed',
                    'remoteStopConfirmed', 'localStopCountsAsRemoteProof'):
            self.assertIs(result[key], False)

    def test_ops_must_be_explicit_full_independent_pin(self):
        for value in (None, '', 'main', 'a' * 39, admission.APP_SHA):
            with self.subTest(value=value), self.assertRaises(ValueError):
                contract(ops_sha=value)

    def test_reject_contract_paths_and_digest_aliases(self):
        for root in ('relative', '/', '/tmp/../app', '/tmp//app', '/tmp/app;id', '/tmp/app\n'):
            with self.subTest(root=root), self.assertRaises(ValueError):
                contract(source_root=root)
        with self.assertRaises(ValueError):
            contract(base_digest='node:24')
        with self.assertRaises(ValueError):
            contract(machine_ids=('1' * 32,) * 3)

    def test_each_receipt_requires_exact_binding(self):
        for receipt in ('slot', 'reservation', 'mintLock', 'identity', 'readiness'):
            for field in self.c.binding():
                p = copy.deepcopy(self.p)
                p[receipt][field] = None
                with self.subTest(receipt=receipt, field=field):
                    self.assertTrue(self.failures(p))

    def test_global_slot_acknowledgment_and_queue_are_explicit(self):
        for field in ('globalSingleBuildSlotGranted', 'remoteHostsAccounted',
                      'queueReleasedForYT', 'otherOwnersIdle'):
            p = copy.deepcopy(self.p)
            p['slot'][field] = 1  # Truthiness cannot stand in for explicit true.
            self.assertIn('fresh-explicit-global-YT-slot-required', self.failures(p))
        for field, value in (('previousOwner', 'blog'), ('operatorMessage', ' ')):
            p = copy.deepcopy(self.p)
            p['slot'][field] = value
            self.assertTrue(self.failures(p))

    def test_slot_freshness_and_clock_uncertainty(self):
        for offset in (-1, 121):
            self.assertTrue(self.failures(now=NOW + datetime.timedelta(seconds=offset)))
        for value in ('2026-10-13T10:00:00', 'bad', None):
            p = copy.deepcopy(self.p)
            p['slot']['verifiedAt'] = value
            self.assertTrue(self.failures(p))

    def test_health_freshness_boundary(self):
        self.assertEqual(self.failures(now=NOW + datetime.timedelta(seconds=30)), [])
        self.assertTrue(self.failures(now=NOW + datetime.timedelta(seconds=30.001)))

    def test_durable_reservation_not_merely_free_flock(self):
        for field in ('durable', 'held', 'releaseRequiresRemoteTerminalProof'):
            p = copy.deepcopy(self.p)
            p['reservation'][field] = False
            self.assertIn('durable-current-reservation-required', self.failures(p))

    def test_whole_job_mint_lock_custody(self):
        for field, value in (('path', '/tmp/observe-sites-build.lock'), ('controller', 'SM'),
                             ('held', False), ('custodyUntilRemoteTerminalProof', False),
                             ('holderPid', True), ('inode', 0), ('leaseId', None)):
            p = copy.deepcopy(self.p)
            p['mintLock'][field] = value
            self.assertIn('Mint-whole-job-lock-custody-required', self.failures(p))

    def test_stop_unknown_retains_reservation_even_after_recovery(self):
        model = admission.ReservationPreparation(self.c)
        self.assertEqual(model.observe(self.p, NOW)['failures'], [])
        p = copy.deepcopy(self.p)
        p['mintLock']['held'] = False
        self.assertEqual(model.observe(p, NOW)['state'], 'STOP-unconfirmed-reservation-retained')
        result = model.observe(self.p, NOW)
        self.assertFalse(result['reservationReleaseAllowed'])
        self.assertIn('Mint-whole-job-lock-custody-required', result['failures'])

    def test_lock_identity_change_retains_custody(self):
        for field in ('holderPid', 'inode', 'leaseId'):
            model = admission.ReservationPreparation(self.c)
            model.observe(self.p, NOW)
            p = copy.deepcopy(self.p)
            p['mintLock'][field] = 'new-lease' if field == 'leaseId' else 99999
            self.assertIn('lock-custody-changed', model.observe(p, NOW)['failures'])

    def test_local_stop_or_empty_groups_do_not_release(self):
        p = copy.deepcopy(self.p)
        p['reservation']['held'] = False
        p.update(localStopConfirmed=True, ownedMembers=[], terminal=True, sshExited=True)
        result = admission.ReservationPreparation(self.c).observe(p, NOW)
        self.assertFalse(result['remoteStopConfirmed'])
        self.assertFalse(result['reservationReleaseAllowed'])

    def test_each_native_identity_gate(self):
        for field, value in (('sourceClean', False), ('opsReviewed', False), ('arch', 'x64'),
                             ('platform', 'darwin'), ('nodeVersion', '22.0.0'),
                             ('nodeModulesAbi', '136'), ('libc', 'musl'), ('nextWorkers', 3),
                             ('sourceRoot', '/tmp/other')):
            p = copy.deepcopy(self.p)
            p['identity'][field] = value
            self.assertIn('exact-clean-reviewed-OPS-APP-native-arm64-identity-required', self.failures(p))

    def test_production_api_cannot_replace_isolated_readiness(self):
        for field, value in (('isolated', False), ('ready', None), ('sourceWritesDisabled', False),
                             ('productionApi', True), ('fixtureSha256', None)):
            p = copy.deepcopy(self.p)
            p['readiness'][field] = value
            self.assertIn('matching-isolated-readiness-required', self.failures(p))

    def test_participating_host_identity_and_pinned_ssh(self):
        for host in admission.HOSTS:
            for field in ('machineId', 'measuredFromMachineId', 'observedHost'):
                p = copy.deepcopy(self.p)
                p['health'][host][field] = 'wrong'
                self.assertTrue(self.failures(p))
        for host in ('SM', 'skyhong-blog'):
            for field in ('controller', 'strictPinnedSsh', 'knownHostsSha256', 'scriptSha256', 'exitCode'):
                p = copy.deepcopy(self.p)
                p['health'][host]['transport'][field] = None
                self.assertIn(host + '-pinned-cross-host-transport-unverified', self.failures(p))

    def test_disk_threshold_and_artifact_reserve_on_every_host(self):
        for host in admission.HOSTS:
            p = copy.deepcopy(self.p)
            p['health'][host]['freeBytes'] = 40 * admission.GIB
            self.assertEqual(self.failures(p), [])
            p['health'][host]['freeBytes'] -= 1
            self.assertIn(host + '-disk-floor-or-unknown', self.failures(p))
            p['health'][host]['freeBytes'] = 40 * admission.GIB
            p['estimatedBytes'][host] = 10 * admission.GIB + 1
            self.assertIn(host + '-artifact-estimate-or-reserve-unknown', self.failures(p))

    def test_running_disk_floor_is_separate_from_start(self):
        row = self.p['health']['Mint']
        row['freeBytes'] = 30 * admission.GIB
        self.assertEqual(admission.health_failures(row, 'Mint', self.c, NOW, starting=False), [])
        row['freeBytes'] -= 1
        self.assertIn('Mint-disk-floor-or-unknown', admission.health_failures(row, 'Mint', self.c, NOW, starting=False))

    def test_load_nonfinite_unknown_and_true_are_denied(self):
        for value in (None, True, float('nan'), float('inf'), -1, 12.001):
            p = copy.deepcopy(self.p)
            p['health']['Mint']['load1'] = value
            self.assertIn('Mint-load-or-unknown', self.failures(p))

    def test_complete_html_gates_for_all_sites_all_hosts(self):
        for host in admission.HOSTS:
            for site, limit in admission.SITE_LIMITS.items():
                for field, value in (('status', 503), ('status', 302), ('exitCode', 28),
                                     ('totalSeconds', None), ('totalSeconds', limit + .001)):
                    p = copy.deepcopy(self.p)
                    p['health'][host]['sites'][site][field] = value
                    self.assertIn(host + '-' + site + '-complete-html-unavailable-or-slow', self.failures(p))

    def test_unknown_or_competing_build_counts(self):
        for value in (None, True, -1, 1):
            p = copy.deepcopy(self.p)
            p['health']['skyhong-blog']['buildCount'] = value
            self.assertIn('skyhong-blog-competing-or-unknown-builds', self.failures(p))

    def test_global_two_browser_limit_includes_all_hosts(self):
        for host in admission.HOSTS:
            self.p['health'][host]['browserCount'] = 1
        self.assertIn('global-two-browser-limit', self.failures())

    def test_unknown_packet_is_sticky_nonreleasable(self):
        for p in (None, [], {}, {'mintLock': []}, {'health': None}):
            result = admission.ReservationPreparation(self.c).observe(p, NOW)
            self.assertEqual(result['state'], 'STOP-unconfirmed-reservation-retained')
            self.assertTrue(result['failures'])

    def test_exact_compiler_specs_cannot_run(self):
        for stage in admission.STAGES:
            cmd = admission.command_spec(stage, self.c)
            self.assertTrue(admission.validate_command(cmd, self.c))
            self.assertFalse(cmd['executionAllowed'])
            self.assertEqual(cmd['argv'][:5], ['nice', '-n', '19', 'ionice', '-c3'])
            for field, value in (('cwd', '/tmp'), ('host', 'Mint'), ('executionAllowed', True),
                                 ('argv', ['sh', '-c', 'docker build .']), ('env', {'DATABASE_URL': 'fake'})):
                bad = copy.deepcopy(cmd)
                bad[field] = value
                with self.assertRaises(ValueError):
                    admission.validate_command(bad, self.c)

    def test_packaging_and_arbitrary_commands_have_no_adapter(self):
        for stage in ('packaging', 'docker', 'shell', 'npm install', None):
            with self.assertRaises(ValueError):
                admission.command_spec(stage, self.c)

    def test_dependency_spec_keeps_compiler_tools_in_production_env(self):
        cmd = admission.command_spec('dependencies', self.c)
        self.assertEqual(cmd['env']['NODE_ENV'], 'production')
        self.assertEqual(cmd['argv'][-2:], ['ci', '--include=dev'])

    def test_readonly_probe_argv_is_strict_pinned_and_bounded(self):
        for host in ('SM', 'skyhong-blog'):
            pin = {'regular': True, 'symlink': False, 'ownedByController': True, 'mode': 0o600,
                   'sha256': self.c.known_hosts_sha256[admission.HOSTS.index(host)]}
            result = admission.readonly_ssh_spec(host, 'deck@100.85.214.25', '/var/lib/observe-worker/known-hosts', pin, self.c)
            argv = result['argv']
            for option in ('StrictHostKeyChecking=yes', 'GlobalKnownHostsFile=/dev/null',
                           'ProxyCommand=none', 'ClearAllForwardings=yes', 'RequestTTY=no', 'ConnectionAttempts=1'):
                self.assertIn(option, argv)
            self.assertEqual(result['timeoutSeconds'], 40)
            self.assertEqual(result['maxOutputBytes'], 65536)
            self.assertFalse(result['executionAllowed'])
            compile(admission.readonly_script(host), '<readonly-script>', 'exec')

    def test_readonly_probe_rejects_injection_and_unknown_pin(self):
        pin = {'regular': True, 'symlink': False, 'ownedByController': True, 'mode': 0o600, 'sha256': '4' * 64}
        for destination in ('-oProxyCommand=bad', 'deck@host', 'deck@1.2.3.999', 'deck@1.2.3.4;id'):
            with self.assertRaises(ValueError):
                admission.readonly_ssh_spec('SM', destination, '/tmp/pins', pin, self.c)
        for field, value in (('regular', False), ('symlink', True), ('ownedByController', False),
                             ('mode', 0o644), ('sha256', None)):
            bad = dict(pin, **{field: value})
            with self.assertRaises(ValueError):
                admission.readonly_ssh_spec('SM', 'deck@1.2.3.4', '/tmp/pins', bad, self.c)

    def test_generated_probe_detects_shared_daemon_and_browser_roots(self):
        row, calls = mocked_probe([['/usr/bin/buildkitd'], ['node', '/opt/next', 'build'],
                                   ['docker', 'buildx', 'build', '.'], ['next-build'],
                                   ['chrome'], ['chrome', '--type=renderer']])
        self.assertEqual(row['buildCount'], 4)
        self.assertEqual(row['browserCount'], 1)
        self.assertEqual(len(calls), 3)
        for argv, kwargs in calls:
            self.assertEqual(argv[:2], ['/usr/bin/curl', '--disable'])
            self.assertIn('DNT: 1', argv)
            self.assertIn('Accept: text/html', argv)
            self.assertIn('youtube-board-verify/1.0', argv)
            self.assertNotIn('--location', argv)
            self.assertEqual(kwargs['env'], {'PATH': '/usr/bin:/bin', 'LANG': 'C'})
            self.assertLessEqual(kwargs['timeout'], 8.17)

    def test_generated_probe_never_turns_proc_denial_into_zero(self):
        with self.assertRaises(PermissionError):
            mocked_probe([['node']], denied=True)

    def test_generated_probe_returns_unknown_for_malformed_http(self):
        row, _ = mocked_probe([], response=SimpleNamespace(returncode=0, stdout='not a metric'))
        for site in admission.SITES:
            self.assertEqual(row['sites'][site], {'exitCode': -1, 'status': None, 'totalSeconds': None})


if __name__ == '__main__':
    unittest.main()
