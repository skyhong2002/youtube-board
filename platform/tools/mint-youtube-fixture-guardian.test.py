"""Synthetic evidence/custody mocks only; no global flock, probe or process startup."""
import copy
import datetime as dt
import hashlib
import importlib.util
import json
from pathlib import Path
from types import SimpleNamespace
import sys
import unittest
from unittest.mock import Mock, patch


def module(name, file):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).with_name(file))
    result = importlib.util.module_from_spec(spec)
    sys.modules[name] = result
    spec.loader.exec_module(result)
    return result


guardian = module('yt_guardian_test', 'mint-youtube-fixture-guardian.py')
fixture = module('yt_fixture_guardian_test', 'mint-youtube-api-fixture.py')
relay = module('yt_relay_guardian_test', 'native-arm64-readonly-relay.py')
NOW = dt.datetime(2026, 10, 13, 12, tzinfo=dt.timezone.utc)
CONFIG = {'schema': 'yt-fixture-guardian-config-v1', 'estimatedSetupBytes': 1024,
          'grantAt': '2026-10-13T11:27:00Z', 'grantMessageId': 'synthetic-only',
          'grantMessageSha256': hashlib.sha256(b'Synthetic grant; not user evidence').hexdigest(),
          'fixture': {'schema': 'yt-fixture-config-v1', 'appSha': guardian.APP, 'opsSha': guardian.OPS,
                      'owner': 'yt-owner', 'generation': 'guardian-mock-01', 'lockfileSha256': 'b' * 64,
                      'baseDigest': 'sha256:' + 'c' * 64, 'appRoot': '/isolated/app', 'serve': False,
                      'machineIds': ['1' * 32, '2' * 32, '3' * 32],
                      'knownHostsSha256': ['4' * 64, '5' * 64, '6' * 64]}}
C = fixture.contract(CONFIG['fixture'])
CUSTODY = {'device': 1, 'inode': 42, 'kernelKey': '00:01:42', 'holderPid': 123}


def grant():
    return {'schema': 'yt-authoritative-user-slot-observation-v1', 'origin': 'authoritative-user-session',
            'currentOwner': 'YT', 'previousOwner': 'tag', 'appSha': guardian.APP, 'opsSha': guardian.OPS,
            'owner': 'yt-owner', 'generation': 'guardian-mock-01', 'scope': 'mint-youtube-synthetic-fixture',
            'grantMessage': 'Synthetic grant; not user evidence', 'grantMessageSha256': CONFIG['grantMessageSha256'],
            'grantMessageId': CONFIG['grantMessageId'], 'grantAt': CONFIG['grantAt'], 'observedAt': NOW.isoformat(),
            'coordinationMode': 'human-slot-plus-common-flock-and-durable-registry'}


def health():
    result = {}
    for i, host in enumerate(fixture.admission.HOSTS):
        row = {'schema': 'yt-host-health-v1', 'observedHost': host, 'machineId': C.machine_ids[i],
               'measuredFromMachineId': C.machine_ids[i], 'observedAt': NOW.isoformat(),
               'freeBytes': 80 * guardian.GIB, 'load1': 1, 'buildCount': 0, 'browserCount': 0,
               'sites': {name: {'exitCode': 0, 'status': 200, 'totalSeconds': .1} for name in fixture.admission.SITE_LIMITS}}
        if host != 'Mint':
            row['transport'] = {'controller': 'Mint', 'strictPinnedSsh': True,
                                'knownHostsSha256': C.known_hosts_sha256[i], 'exitCode': 0,
                                'scriptSha256': hashlib.sha256(fixture.admission.readonly_script(host).encode()).hexdigest()}
        result[host] = row
    return result


class GuardianMocks(unittest.TestCase):
    def test_default_preview_does_not_read_config_import_adapters_or_acquire_lock(self):
        with patch.object(sys, 'argv', ['guardian']), patch('builtins.print') as output, patch.object(guardian, 'reviewed_config') as review, patch.object(guardian, 'supervise') as supervise, patch.object(guardian, 'acquire') as lock:
            guardian.main()
            self.assertIn('"executionAllowed": false', output.call_args.args[0])
            review.assert_not_called(); supervise.assert_not_called(); lock.assert_not_called()

    def test_execute_without_exact_config_review_never_supervises(self):
        with patch.object(sys, 'argv', ['guardian', '--execute']), patch.object(guardian, 'supervise') as supervise:
            with self.assertRaisesRegex(ValueError, 'REVIEWED_EXECUTION_CONFIG_REQUIRED'):
                guardian.main()
            supervise.assert_not_called()

    def test_authority_is_observed_from_adapter_not_caller_booleans(self):
        adapter = SimpleNamespace(observe_user_slot=Mock(return_value=grant()))
        self.assertEqual(guardian.authority(adapter, CONFIG, NOW)['currentOwner'], 'YT')
        for change in [lambda row: row.update(currentOwner='blog'), lambda row: row.update(scope='build'),
                       lambda row: row.update(opsSha='a' * 40), lambda row: row.update(grantMessage='altered'),
                       lambda row: row.update(grantMessageId='other'), lambda row: row.update(coordinationMode='private-unheld-lease'),
                       lambda row: row.update(observedAt=(NOW-dt.timedelta(seconds=31)).isoformat())]:
            row = grant(); change(row); adapter.observe_user_slot.return_value = row
            with self.assertRaises(ValueError): guardian.authority(adapter, {**CONFIG, 'operatorExecutionAuthorized': True, 'globalSlot': True}, NOW)

    def test_packet_derives_legacy_flags_after_kernel_registry_and_health_checks(self):
        reservation = {'state': 'running', 'binding': C.binding(), 'kernelKey': CUSTODY['kernelKey']}
        with patch.object(guardian, 'verify_fd', return_value=CUSTODY):
            row = guardian.packet(fixture, C, grant(), health(), 7, reservation, NOW, 1024)
            self.assertEqual(fixture.binding_failures(row, C, NOW), [])
            self.assertEqual(row['guardian']['targetOpsSha'], guardian.OPS)
            self.assertEqual(row['guardian']['sourceSha256'], hashlib.sha256(guardian.HERE.read_bytes()).hexdigest())
            self.assertNotEqual(row['guardian']['sourceSha256'], row['bootstrap']['opsSha'])
            self.assertFalse(row['bootstrap']['servingAuthorized'])
            self.assertNotIn('readiness', row)

    def test_health_missing_stale_competing_or_global_browser_three_denies(self):
        reservation = {'state': 'reserved', 'binding': C.binding(), 'kernelKey': CUSTODY['kernelKey']}
        for change in [lambda rows: rows.pop('SM'), lambda rows: rows['Mint'].update(buildCount=1),
                       lambda rows: rows['skyhong-blog'].update(observedAt=(NOW-dt.timedelta(seconds=31)).isoformat()),
                       lambda rows: [rows[h].update(browserCount=1) for h in rows],
                       lambda rows: rows['SM']['transport'].update(scriptSha256='0' * 64),
                       lambda rows: rows['SM']['sites']['blog'].update(totalSeconds=6.18)]:
            rows = health(); change(rows)
            with patch.object(guardian, 'verify_fd', return_value=CUSTODY), self.assertRaises(ValueError):
                guardian.packet(fixture, C, grant(), rows, 7, reservation, NOW, 1024)

    def test_unknown_reservation_or_unheld_fd_never_emits_admission(self):
        for state in ['unknown-retained', 'stop-requested', 'local-terminal-confirmed']:
            reservation = {'state': state, 'binding': C.binding(), 'kernelKey': CUSTODY['kernelKey']}
            with patch.object(guardian, 'verify_fd', return_value=CUSTODY), self.assertRaises(ValueError):
                guardian.packet(fixture, C, grant(), health(), 7, reservation, NOW, 1024)
        with patch.object(guardian, 'verify_fd', side_effect=ValueError('ACTUAL_KERNEL_FD_CUSTODY_REQUIRED')), self.assertRaises(ValueError):
            guardian.packet(fixture, C, grant(), health(), 7, {}, NOW, 1024)

    def test_fdinfo_must_bind_flock_to_actual_fd_not_merely_same_inode(self):
        s = SimpleNamespace(st_dev=1, st_ino=42, st_mode=0o100600)
        with patch.object(guardian.os, 'fstat', return_value=s), patch.object(guardian.os, 'stat', return_value=s), patch.object(Path, 'read_text', return_value='pos: 0\nlock:\t1: FLOCK ADVISORY WRITE 123 00:01:42 0 EOF\n'):
            self.assertEqual(guardian.verify_fd(7)['kernelKey'], '00:01:42')
        with patch.object(guardian.os, 'fstat', return_value=s), patch.object(guardian.os, 'stat', return_value=s), patch.object(Path, 'read_text', return_value='pos: 0\n'):
            with self.assertRaisesRegex(ValueError, 'ACTUAL_KERNEL_FD_CUSTODY_REQUIRED'): guardian.verify_fd(7)

    def test_existing_reservation_never_auto_clears_or_reuses_generation(self):
        with patch.object(Path, 'exists', return_value=True), patch.object(guardian, 'persist') as write:
            with self.assertRaisesRegex(ValueError, 'EXISTING_GLOBAL_RESERVATION'):
                guardian.reserve(C, CUSTODY, grant())
            write.assert_not_called()

    def test_reservation_is_durable_before_spawn_and_no_child_command_uses_shell(self):
        events = []
        with patch.object(Path, 'exists', return_value=False), patch.object(guardian, 'identity', return_value={'pid': 123}), patch.object(guardian, 'persist', side_effect=lambda *a, **kw: events.append((a, kw))):
            row = guardian.reserve(C, CUSTODY, grant())
            self.assertEqual(row['state'], 'reserved')
            self.assertIsNone(row['supervisor'])
            self.assertEqual(str(events[0][0][0]), guardian.REGISTRY)
            self.assertTrue(events[0][1]['exclusive'])

    def test_missing_authority_publisher_never_acquires_lock_or_starts_supervisor(self):
        config = {**CONFIG, 'authorityAdapterPath': '/missing/publisher.py', 'authorityAdapterSha256': 'a' * 64}
        with patch.object(guardian, 'load_pinned', side_effect=FileNotFoundError), patch.object(guardian, 'acquire') as lock, patch.object(guardian.subprocess, 'Popen') as spawn:
            with self.assertRaises(FileNotFoundError): guardian.supervise(config)
            lock.assert_not_called(); spawn.assert_not_called()

    def test_no_terminal_receipt_means_no_release_even_with_exited_supervisor(self):
        child = SimpleNamespace(pid=123, poll=lambda: 1)
        config = {'fixture': {**CONFIG['fixture'], 'workspace': '/isolated/workspace'}}
        with patch.object(guardian, 'identity', side_effect=FileNotFoundError), patch.object(guardian, 'private_read', side_effect=FileNotFoundError):
            with self.assertRaises(FileNotFoundError):
                guardian.terminal(fixture, config, C, child, {'pid': 123}, 7, NOW)

    def test_partial_source_start_and_wrong_terminal_binding_cannot_release(self):
        child = SimpleNamespace(pid=123, poll=lambda: 1)
        config = {'fixture': {**CONFIG['fixture'], 'workspace': '/isolated/workspace'}}
        with patch.object(guardian, 'identity', side_effect=FileNotFoundError), patch.object(guardian, 'private_read', return_value=b'{"ready":false}'):
            with self.assertRaisesRegex(ValueError, 'EXACT_LOCAL_TERMINAL_RECEIPT_REQUIRED'):
                guardian.terminal(fixture, config, C, child, {'pid': 123}, 7, NOW)

    def test_terminal_receipt_freshness_and_empty_fd_readback_are_both_required(self):
        child = SimpleNamespace(pid=123, poll=lambda: 0)
        config = {'fixture': {**CONFIG['fixture'], 'workspace': '/isolated/workspace'}}
        row = {**C.binding(), 'observedAt': NOW.isoformat(), 'localFixtureChildrenTerminal': True,
               'remoteStopProof': False, 'reservationReleaseAllowed': False, 'ready': False}
        raw = json.dumps(row).encode()
        with patch.object(guardian, 'identity', side_effect=FileNotFoundError), patch.object(guardian, 'private_read', return_value=raw), patch.object(guardian, 'verify_fd', return_value=CUSTODY), patch.object(guardian, 'utc', return_value=NOW), patch.object(Path, 'iterdir', return_value=iter([])):
            self.assertEqual(guardian.terminal(fixture, config, C, child, {'pid': 123}, 7, NOW), hashlib.sha256(raw).hexdigest())
        row['observedAt'] = (NOW-dt.timedelta(seconds=31)).isoformat()
        with patch.object(guardian, 'identity', side_effect=FileNotFoundError), patch.object(guardian, 'private_read', return_value=json.dumps(row).encode()), patch.object(guardian, 'utc', return_value=NOW):
            with self.assertRaisesRegex(ValueError, 'CURRENT_RUN_TERMINAL_RECEIPT_REQUIRED'):
                guardian.terminal(fixture, config, C, child, {'pid': 123}, 7, NOW-dt.timedelta(seconds=40))
        # Permission/identity uncertainty in actual proc scanning must propagate,
        # never count as absent survivors and never become terminal proof.
        with patch.object(guardian, 'identity', side_effect=FileNotFoundError), patch.object(guardian, 'private_read', return_value=raw), patch.object(guardian, 'verify_fd', return_value=CUSTODY), patch.object(guardian, 'utc', return_value=NOW), patch.object(Path, 'iterdir', side_effect=PermissionError):
            with self.assertRaises(PermissionError):
                guardian.terminal(fixture, config, C, child, {'pid': 123}, 7, NOW)

    def test_actual_setup_allocation_above_two_gib_denies(self):
        config = {'fixture': {**CONFIG['fixture'], 'workspace': '/isolated/workspace', 'nodeBinary': '/isolated/node'}}
        s = SimpleNamespace(st_mode=0o100600, st_dev=1, st_ino=42, st_blocks=2*guardian.GIB//512+1)
        with patch.object(Path, 'exists', return_value=True), patch.object(Path, 'is_symlink', return_value=False), patch.object(Path, 'is_dir', return_value=False), patch.object(Path, 'lstat', return_value=s):
            with self.assertRaisesRegex(ValueError, 'ACTUAL_SETUP_BUDGET_EXCEEDED'):
                guardian.setup_bytes(config)

    def test_guardian_inherits_fd_and_persists_terminal_before_closing_custody(self):
        config = {**CONFIG, 'authorityAdapterPath': '/reviewed/authority.py', 'authorityAdapterSha256': 'a'*64,
                  'probeAdapterPath': '/reviewed/relay.py', 'probeAdapterSha256': 'b'*64,
                  'fixtureSupervisorSha256': 'c'*64, 'fixture': {**CONFIG['fixture'],
                  'opsRoot': '/isolated/ops5a', 'workspace': '/isolated/workspace', 'admissionPath': '/isolated/admission.json'}}
        adapter = SimpleNamespace(observe_user_slot=lambda *_: grant())
        child = SimpleNamespace(pid=456, poll=lambda: 0)
        events = []
        def record(path, row, **kw): events.append(('persist', str(path), copy.deepcopy(row)))
        def spawn(argv, **kw): events.append(('spawn', argv, kw)); return child
        def proc(pid): return {'pid': pid, 'pgid': pid, 'session': pid, 'startTicks': '1'}
        actual_digest = guardian.digest
        with patch.object(guardian, 'load_pinned', side_effect=[adapter, object(), fixture]), patch.object(Path, 'is_file', return_value=True), patch.object(Path, 'is_symlink', return_value=False), patch.object(Path, 'read_bytes', return_value=b'synthetic-admission-dependency'), patch.object(guardian, 'digest', side_effect=lambda raw: guardian.ADMISSION_SOURCE_SHA256 if raw==b'synthetic-admission-dependency' else actual_digest(raw)), patch.object(fixture, 'verify_source'), patch.object(Path, 'read_text', return_value=C.machine_ids[1]), patch.object(Path, 'exists', return_value=False), patch.object(guardian, 'setup_bytes', return_value=1024), patch.object(guardian, 'acquire', return_value=7), patch.object(guardian, 'verify_fd', return_value=CUSTODY), patch.object(guardian, 'identity', side_effect=proc), patch.object(guardian, 'utc', return_value=NOW), patch.object(guardian, 'persist', side_effect=record), patch.object(guardian, 'observe_three_hosts', return_value=health()), patch.object(guardian.subprocess, 'Popen', side_effect=spawn), patch.object(guardian, 'terminal', return_value='d'*64), patch.object(guardian.os, 'close', side_effect=lambda fd: events.append(('close', fd))):
            result = guardian.supervise(config)
        first_reserve = next(i for i, e in enumerate(events) if e[0]=='persist' and e[1]==guardian.REGISTRY)
        launched = next(i for i,e in enumerate(events) if e[0]=='spawn')
        stopped = next(i for i,e in enumerate(events) if e[0]=='persist' and e[1]==guardian.REGISTRY and e[2]['state']=='local-terminal-confirmed')
        closed = next(i for i,e in enumerate(events) if e[0]=='close')
        self.assertLess(first_reserve, launched); self.assertLess(stopped, closed)
        self.assertEqual(events[launched][2]['pass_fds'], (7,))
        self.assertEqual(events[launched][1][:2], ['/usr/bin/python3','-B'])
        self.assertNotIn('shell', events[launched][2])
        self.assertFalse(result['reservationReleased']); self.assertFalse(result['runtimeReady'])

    def test_observation_entry_requires_reviewed_gate_before_persisting(self):
        gate = module('guardian_gate_test', 'mint-youtube-fixture-gate.py')
        cases = module('guardian_collector_cases', 'native-arm64-probe-collector.test.py')
        gate_path = str(Path(__file__).with_name('mint-youtube-fixture-gate.py').resolve())
        config = {**CONFIG, 'gateAdapterPath': gate_path,
                  'gateAdapterSha256': hashlib.sha256(Path(gate_path).read_bytes()).hexdigest(),
                  'probeAdapterSha256': 'a'*64, 'fixture': {**CONFIG['fixture'],
                  'machineIds': [relay.SM_ID, relay.MINT_ID, relay.BLOG_ID],
                  'knownHostsSha256': [relay.SM_PIN, '0'*64, relay.BLOG_PIN], 'admissionPath': '/isolated/admission.json'}}
        for denied in (False, True):
            observations = cases.rows()
            byname = {row['name']: row['result'] for row in observations}
            if denied: byname['SM']['sites']['youtube']['totalSeconds'] = 2.001
            outputs = [byname['Mint'], byname['SM'], byname['relay']]
            calls = []
            class Runner:
                def run(self, argv, seconds):
                    calls.append((argv, seconds))
                    return 0, json.dumps(outputs.pop(0)).encode(), b''
            def helpers(_source, scope): scope['BoundedRunner'] = Runner
            actual_digest = guardian.digest
            with patch.object(guardian, 'load_pinned', return_value=gate) as loaded, patch.object(guardian, 'exec', side_effect=helpers, create=True), patch.object(guardian, 'private_read', return_value=b'synthetic-pin'), patch.object(Path, 'stat', return_value=SimpleNamespace(st_mode=0o100600, st_uid=guardian.os.getuid())), patch.object(guardian, 'digest', side_effect=lambda raw: relay.SM_PIN if raw==b'synthetic-pin' else actual_digest(raw)), patch.object(guardian, 'utc', return_value=cases.NOW), patch.object(guardian, 'persist') as saved:
                if denied:
                    with self.assertRaisesRegex(ValueError, 'REVIEWED_THREE_HOST_AGGREGATE_DENIED'):
                        guardian.observe_three_hosts(config, fixture, relay)
                    saved.assert_not_called()
                else:
                    result = guardian.observe_three_hosts(config, fixture, relay)
                    self.assertEqual(result['skyhong-blog']['transport']['actualHopController'], 'SM')
                    self.assertEqual(result['SM']['transport']['route'], ['Mint','SM'])
                    self.assertEqual(saved.call_count, 2)
                    self.assertTrue(saved.call_args.args[1]['aggregate']['ok'])
                loaded.assert_called_once_with(gate_path, config['gateAdapterSha256'], 'yt_reviewed_fixture_gate')
            self.assertEqual(calls[0][0], ['/usr/bin/python3','-c',fixture.admission.readonly_script('Mint')])
            self.assertEqual(calls[2][0], ['/usr/bin/python3','-c',relay.mint_script()])

    def test_observation_entry_bad_adapter_pin_never_probes(self):
        with patch.object(guardian, 'load_pinned', side_effect=ValueError('REVIEWED_ADAPTER_SOURCE_REQUIRED')), patch.object(guardian, 'exec', create=True) as helper, patch.object(guardian, 'persist') as saved:
            with self.assertRaises(ValueError):
                guardian.observe_three_hosts({'gateAdapterPath':'/isolated/gate.py','gateAdapterSha256':'0'*64}, fixture, relay)
            helper.assert_not_called();saved.assert_not_called()


if __name__ == '__main__':
    unittest.main()
