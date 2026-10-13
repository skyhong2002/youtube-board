"""No-start mocks only; no SQL server, network, SSH or global lock operation."""
import copy
import datetime as dt
import hashlib
import importlib.util
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('yt_fixture', Path(__file__).with_name('mint-youtube-api-fixture.py'))
fixture = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = fixture
spec.loader.exec_module(fixture)
bridge_spec = importlib.util.spec_from_file_location('fixture_bridge_cases', Path(__file__).with_name('mint-youtube-fixture-gate.test.py'))
bridge = importlib.util.module_from_spec(bridge_spec)
bridge_spec.loader.exec_module(bridge)
now = bridge.cases.NOW
config = {'schema': 'yt-fixture-config-v1', 'appSha': fixture.APP_SHA, 'opsSha': 'a' * 40,
          'owner': 'yt-owner', 'generation': 'fixture-01', 'lockfileSha256': 'b' * 64,
          'baseDigest': 'sha256:' + 'c' * 64, 'appRoot': '/isolated/app',
          'machineIds': [bridge.cases.relay_cases.relay.SM_ID, bridge.cases.relay_cases.relay.MINT_ID, bridge.cases.relay_cases.relay.BLOG_ID], 'knownHostsSha256': [bridge.cases.relay_cases.relay.SM_PIN, '0' * 64, bridge.cases.relay_cases.relay.BLOG_PIN],
          'admissionPath': '/isolated/admission.json', 'opsRoot': str(fixture.HERE.parents[1]),
          'sourceReceipt': '/isolated/source.json'}


def packet():
    c = fixture.contract(config)
    binding = c.binding()
    p = {'bootstrap': {**binding, 'schema': 'yt-fixture-bootstrap-admission-v1',
                      'scope': 'mint-youtube-synthetic-fixture', 'state': 'admitted',
                      'operatorExecutionAuthorized': True, 'observedAt': now.isoformat()},
         'slot': {**binding, 'schema': 'yt-global-slot-v1', 'verifiedAt': now.isoformat(),
                  'globalSingleBuildSlotGranted': True, 'remoteHostsAccounted': True,
                  'queueReleasedForYT': True, 'otherOwnersIdle': True, 'previousOwner': 'tag',
                  'operatorMessage': 'Mock fixture-only acknowledgement, never execution evidence'},
         'reservation': {**binding, 'schema': 'yt-reservation-v1', 'durable': True,
                         'held': True, 'releaseRequiresRemoteTerminalProof': True,
                         'observedAt': now.isoformat()}, 'health': {}}
    evidence, _ = bridge.BridgeTests().evidence()
    p.update(evidence)
    return p


class FixtureMocks(unittest.TestCase):
    def test_separate_fixture_admission_does_not_require_its_own_readiness(self):
        self.assertEqual(fixture.binding_failures(packet(), fixture.contract(config), now), [])
        self.assertNotIn('readiness', packet())

    def test_null_mismatch_stale_missing_slot_and_health_are_denied(self):
        c = fixture.contract(config)
        self.assertTrue(fixture.binding_failures(None, c, now))
        for change in [lambda p: p.pop('bootstrap'), lambda p: p['bootstrap'].update(opsSha='d' * 40),
                       lambda p: p['bootstrap'].update(observedAt=(now - dt.timedelta(seconds=31)).isoformat()),
                       lambda p: p['bootstrap'].update(operatorExecutionAuthorized=False),
                       lambda p: p['slot'].update(queueReleasedForYT=False),
                       lambda p: p['reservation'].update(held=False),
                       lambda p: p['health']['Mint'].update(buildCount=1),
                       lambda p: p['health']['SM'].pop('transport'),
                       lambda p: p['health']['skyhong-blog']['sites']['blog'].update(status=503)]:
            p = packet(); change(p)
            self.assertTrue(fixture.binding_failures(p, c, now))

    def test_unknown_source_and_admission_never_acquire_lock_or_start_sql_process(self):
        for supplied in [None, {}, {**packet(), 'bootstrap': None}]:
            with patch.object(fixture, 'private_json', return_value=supplied), patch.object(fixture, 'utc', return_value=now), patch.object(fixture.subprocess, 'Popen') as popen, patch.object(fixture, 'acquire_lock') as lock:
                with self.assertRaises(Exception):
                    fixture.start_fixture(config, {'verify_source': lambda *_: None})
                popen.assert_not_called(); lock.assert_not_called()
        with patch.object(fixture.subprocess, 'Popen') as popen, patch.object(fixture, 'acquire_lock') as lock:
            def deny(*_): raise ValueError('EXACT_SOURCE_TREE_MISMATCH')
            with self.assertRaisesRegex(ValueError, 'EXACT_SOURCE_TREE_MISMATCH'):
                fixture.start_fixture(config, {'verify_source': deny})
            popen.assert_not_called(); lock.assert_not_called()

    def test_executing_ops_copy_cannot_attest_another_clean_root(self):
        with self.assertRaisesRegex(ValueError, 'EXECUTING_OPS_ROOT_MISMATCH'):
            fixture.verify_source({**config, 'opsRoot': '/another/ops'}, fixture.contract(config))

    def test_missing_common_lock_denies_before_native_start(self):
        with patch.object(fixture.os, 'open', side_effect=FileNotFoundError), patch.object(fixture.subprocess, 'Popen') as popen:
            with self.assertRaises(FileNotFoundError): fixture.acquire_lock()
            popen.assert_not_called()

    def test_config_never_inherits_production_environment(self):
        with patch.dict(fixture.os.environ, {'DATABASE_URL': 'PRODUCTION_PLACEHOLDER', 'OPENAI_API_KEY': 'PRIVATE_PLACEHOLDER', 'GOOGLE_CLIENT_SECRET': 'PRIVATE_PLACEHOLDER'}):
            env = fixture.child_env(config, 7)
            self.assertFalse(set(env) & {'DATABASE_URL', 'OPENAI_API_KEY', 'GOOGLE_CLIENT_SECRET', 'NODE_OPTIONS', 'LD_LIBRARY_PATH'})
            self.assertEqual(env['DATASET_KIND'], 'fixture')

    def test_spawn_custody_registered_before_proc_read_failure(self):
        child = type('Child', (), {'pid': 456, 'poll': lambda self: None})()
        children = []
        with patch.object(fixture, 'owned_identity', side_effect=OSError('Mock proc failure')):
            with self.assertRaises(OSError): fixture.register_child(children, child)
        self.assertEqual(children, [(child, None)])
        with patch.object(fixture.os, 'killpg') as kill:
            with self.assertRaisesRegex(ValueError, 'STOP_UNCONFIRMED_CHILD_IDENTITY_UNKNOWN'): fixture.stop_owned(children)
            kill.assert_not_called()

    def test_stop_proof_is_local_only_and_never_releases_reservation(self):
        self.assertEqual(fixture.stop_owned([]), {'localFixtureChildrenTerminal': True, 'remoteStopProof': False, 'reservationReleaseAllowed': False})

    def test_serving_permission_required_before_start(self):
        with patch.object(fixture, 'private_json', return_value=packet()), patch.object(fixture, 'utc', return_value=now), patch.object(fixture.subprocess, 'Popen') as popen:
            with self.assertRaisesRegex(ValueError, 'SERVING_ADMISSION_REQUIRED'):
                fixture.start_fixture({**config, 'serve': True}, {'verify_source': lambda *_: None})
            popen.assert_not_called()

    def test_continuing_guard_still_requires_current_health_and_zero_builds(self):
        p = packet(); p['health']['Mint']['observedAt'] = (now - dt.timedelta(seconds=31)).isoformat()
        self.assertTrue(fixture.binding_failures(p, fixture.contract(config), now, starting=False))


if __name__ == '__main__':
    unittest.main()
