"""Mock every Docker, cgroup, clock, sleep and authenticated-gate boundary."""
import copy
import datetime
import importlib.util
from pathlib import Path
import sys
import unittest

spec = importlib.util.spec_from_file_location('executor', Path(__file__).with_name('native-arm64-executor.py'))
module = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = module
spec.loader.exec_module(module)
NOW = datetime.datetime(2026, 10, 13, 10, 0, tzinfo=datetime.timezone.utc)


def identity(**updates):
    fields = dict(container_id='a' * 64, image_id='sha256:' + 'b' * 64, owner='YT-owner',
                  generation='job-1', ops_sha='c' * 40, started_at='2026-10-13T09:59:00Z',
                  leader_pid=1234, leader_starttime=5000,
                  cgroup_path='/sys/fs/cgroup/system.slice/docker-' + 'a' * 64 + '.scope',
                  cgroup_device=29, cgroup_inode=45678)
    fields.update(updates)
    return module.Identity(**fields)


class Backend:
    def __init__(self, pin):
        self.pin = pin
        self.rows = [{
            'Id': pin.container_id, 'Image': pin.image_id, 'RestartCount': 0, 'Mounts': [],
            'Config': {'Labels': {module.LABELS[k]: v for k, v in {
                'owner': pin.owner, 'generation': pin.generation, 'ops_sha': pin.ops_sha,
                'app_sha': module.APP_SHA}.items()}},
            'HostConfig': {'Privileged': False, 'PidMode': '', 'NetworkMode': 'none',
                           'CgroupnsMode': 'private', 'CapAdd': None, 'CapDrop': ['ALL'],
                           'Devices': [], 'Binds': None,
                           'SecurityOpt': ['no-new-privileges:true'], 'AutoRemove': False,
                           'RestartPolicy': {'Name': 'no', 'MaximumRetryCount': 0}},
            'State': {'StartedAt': pin.started_at, 'FinishedAt': '0001-01-01T00:00:00Z',
                      'Restarting': False, 'Dead': False, 'Running': True, 'Paused': False,
                      'Pid': pin.leader_pid, 'Status': 'running', 'ExitCode': 0},
        }]
        self.members = {pin.leader_pid: pin.leader_starttime, 1235: 5001}
        self.frozen = False
        self.calls = []
        self.dispatch_result = True
        self.change_state = True
        self.time = 0.0
        self.gate_authenticated = True
        self.snapshots = []
        self.read_failure = False
        self.sleeps = []

    def inspect(self, spec):
        self.calls.append(('inspect', copy.deepcopy(spec)))
        return copy.deepcopy(self.rows)

    def dispatch(self, spec):
        self.calls.append(('dispatch', copy.deepcopy(spec)))
        if self.dispatch_result is not True:
            return self.dispatch_result
        if self.change_state:
            state = self.rows[0]['State']
            operation = 'kernel-kill' if spec.get('kind') == 'owned-cgroup-v2-kill' else spec['argv'][1]
            if operation in ('pause', 'unpause'):
                state['Paused'] = operation == 'pause'
                state['Status'] = 'paused' if state['Paused'] else 'running'
                self.frozen = state['Paused']
            elif operation == 'kernel-kill':
                state.update(Running=False, Paused=False, Pid=0, Status='exited', FinishedAt=NOW.isoformat())
                self.members = {}
                self.frozen = False
        return True

    def snapshot(self, pin):
        if self.read_failure:
            raise PermissionError('mock cgroup denied')
        if self.snapshots:
            return copy.deepcopy(self.snapshots.pop(0))
        return {'containerId': pin.container_id, 'cgroupPath': pin.cgroup_path,
                'cgroupDevice': pin.cgroup_device, 'cgroupInode': pin.cgroup_inode,
                'pathIdentityVerified': True, 'descendantsComplete': True,
                'frozen': self.frozen, 'members': dict(self.members)}

    def clock(self):
        self.time += .01
        return self.time

    def sleep(self, interval): self.sleeps.append(interval)

    def executor(self):
        return module.Executor(self.pin, self.inspect, self.dispatch, self.snapshot,
                               lambda gate: self.gate_authenticated, lambda: NOW,
                               self.clock, self.sleep)


def gate(pin):
    return {**pin.binding(), 'schema': 'yt-executor-admitted-gate-v1',
            'verifiedAt': NOW.isoformat(), 'mintLockHeldForWholeJob': True,
            'durableReservationHeld': True, 'globalSlotAcknowledged': True, 'hostHealthCurrent': True,
            'operatorResumeAuthorized': True, 'resumeAuthorizationId': 'mock-explicit-resume-1'}


class LifecycleTests(unittest.TestCase):
    def setUp(self):
        self.pin = identity()
        self.backend = Backend(self.pin)
        self.job = self.backend.executor()

    def dispatched(self):
        return ['kernel-kill' if spec.get('kind') == 'owned-cgroup-v2-kill' else spec['argv'][1]
                for kind, spec in self.backend.calls if kind == 'dispatch']

    def test_deploy_app073_accepted_but_frozen_fixture_app705_rejected(self):
        self.assertEqual(module.APP_SHA, '073985b8bc4bbcc9ffb5d43c1e1a26060bb8ac4a')
        self.assertTrue(self.job.pause()['remoteStopConfirmed'])
        backend = Backend(self.pin)
        backend.rows[0]['Config']['Labels'][module.LABELS['app_sha']] = '70529cff13b6b7f5b3e0571a229e2b61660f9df4'
        self.assertFalse(backend.executor().pause()['remoteStopConfirmed'])
        self.assertFalse(any(kind == 'dispatch' for kind, _ in backend.calls))

    def test_identity_is_full_and_separate_from_APP(self):
        for field, value in (('container_id', 'aaaa'), ('image_id', 'node:24'),
                             ('ops_sha', module.APP_SHA), ('leader_pid', True),
                             ('leader_starttime', -1), ('started_at', '2026-10-13T10:00:00'),
                             ('cgroup_device', True), ('cgroup_inode', 0),
                             ('cgroup_path', '/sys/fs/cgroup/..'), ('cgroup_path', '/sys/fs/cgroup/other')):
            with self.subTest(field=field), self.assertRaises(ValueError):
                identity(**{field: value})

    def test_fixed_specs_never_include_build_exec_or_shared_daemons(self):
        for operation in ('inspect', 'pause', 'unpause'):
            spec = module.docker_spec(operation, self.pin)
            self.assertEqual(spec['argv'][-1], self.pin.container_id)
            self.assertEqual(spec['timeoutSeconds'], 5)
            self.assertEqual(spec['env']['DOCKER_HOST'], 'unix:///var/run/docker.sock')
            self.assertEqual(spec['env']['DOCKER_CONFIG'], '/nonexistent/observe-owned-compiler')
            self.assertFalse(spec['runtimeReady'])
        for operation in ('build', 'exec', 'commit', 'export', 'import', 'load', 'rm', 'stop', 'kill', 'shutdown'):
            with self.assertRaises(ValueError):
                module.docker_spec(operation, self.pin)

    def test_pause_has_physical_two_snapshot_confirmation(self):
        result = self.job.pause()
        self.assertEqual(result['state'], 'stop-confirmed')
        self.assertTrue(result['remoteStopConfirmed'])
        self.assertFalse(result['reservationReleaseAllowed'])
        self.assertFalse(result['runtimeReady'])
        self.assertEqual(self.dispatched(), ['pause'])
        self.assertEqual(len(self.backend.sleeps), 1)

    def test_pause_dispatch_success_without_frozen_kernel_is_unknown(self):
        original = self.backend.snapshot
        def unfrozen(pin):
            row = original(pin)
            row['frozen'] = False
            return row
        self.job.cgroup = unfrozen
        result = self.job.pause()
        self.assertEqual(result['state'], 'STOP-unconfirmed-reservation-retained')
        self.assertFalse(result['remoteStopConfirmed'])
        self.assertLessEqual(len(self.backend.sleeps), 22)

    def test_false_none_or_error_dispatch_never_confirms_pause(self):
        for value in (False, None, 1):
            backend = Backend(self.pin)
            backend.dispatch_result = value
            self.assertFalse(backend.executor().pause()['remoteStopConfirmed'])
        self.job.dispatch = lambda spec: (_ for _ in ()).throw(OSError('mock daemon down'))
        self.assertFalse(self.job.pause()['remoteStopConfirmed'])

    def test_label_image_or_container_mismatch_prevents_dispatch(self):
        for field in ('Id', 'Image'):
            backend = Backend(self.pin)
            backend.rows[0][field] = 'wrong'
            self.assertFalse(backend.executor().pause()['remoteStopConfirmed'])
            self.assertFalse(any(kind == 'dispatch' for kind, _ in backend.calls))
        for label in module.LABELS.values():
            backend = Backend(self.pin)
            backend.rows[0]['Config']['Labels'][label] = 'wrong'
            self.assertFalse(backend.executor().pause()['remoteStopConfirmed'])
            self.assertFalse(any(kind == 'dispatch' for kind, _ in backend.calls))

    def test_restarted_container_or_pid_identity_prevents_dispatch(self):
        for field, value in (('StartedAt', NOW.isoformat()), ('Pid', 9999), ('Restarting', True)):
            backend = Backend(self.pin)
            backend.rows[0]['State'][field] = value
            self.assertFalse(backend.executor().pause()['remoteStopConfirmed'])
        self.backend.rows[0]['RestartCount'] = 1
        self.assertFalse(self.job.pause()['remoteStopConfirmed'])

    def test_privileged_host_namespace_and_added_capability_are_rejected(self):
        for field, value in (('Privileged', True), ('PidMode', 'host'), ('NetworkMode', 'host'),
                             ('CgroupnsMode', 'host'), ('CapAdd', ['SYS_ADMIN']),
                             ('CapDrop', []), ('Binds', ['/var/run/docker.sock:/socket']),
                             ('Devices', [{}]), ('SecurityOpt', ['seccomp=unconfined']),
                             ('AutoRemove', True), ('RestartPolicy', {'Name': 'always'})):
            backend = Backend(self.pin)
            backend.rows[0]['HostConfig'][field] = value
            self.assertFalse(backend.executor().pause()['remoteStopConfirmed'])
            self.assertFalse(any(kind == 'dispatch' for kind, _ in backend.calls))

    def test_unapproved_host_mount_prevents_physical_stop_claim(self):
        self.backend.rows[0]['Mounts'] = [{'Source': '/sys/fs/cgroup', 'Destination': '/host-cgroup'}]
        self.assertFalse(self.job.pause()['remoteStopConfirmed'])
        self.assertFalse(any(kind == 'dispatch' for kind, _ in self.backend.calls))

    def test_incomplete_wrong_path_or_unknown_cgroup_cannot_confirm(self):
        for field, value in (('containerId', 'other'), ('cgroupPath', '/sys/fs/cgroup/other'),
                             ('cgroupDevice', 999), ('cgroupInode', 999),
                             ('pathIdentityVerified', False), ('descendantsComplete', False),
                             ('frozen', None), ('members', {1234: True})):
            backend = Backend(self.pin)
            job = backend.executor()
            original = backend.snapshot
            job.cgroup = lambda pin, k=field, v=value: dict(original(pin), **{k: v})
            self.assertFalse(job.pause()['remoteStopConfirmed'])

    def test_cgroup_read_denial_retains_reservation(self):
        self.backend.read_failure = True
        result = self.job.pause()
        self.assertFalse(result['remoteStopConfirmed'])
        self.assertFalse(result['reservationReleaseAllowed'])

    def test_new_member_requires_two_stable_frozen_snapshots(self):
        original = self.backend.snapshot
        calls = [0]
        def changing(pin):
            calls[0] += 1
            row = original(pin)
            if calls[0] >= 3:
                row['members'][1236] = 5002
            return row
        self.job.cgroup = changing
        self.assertTrue(self.job.pause()['remoteStopConfirmed'])
        self.assertEqual(calls[0], 4)  # Initial read plus three confirmation reads.

    def test_pid_reuse_never_becomes_stable_pause(self):
        self.backend.members[1234] = 9999
        self.assertFalse(self.job.pause()['remoteStopConfirmed'])
        self.backend = Backend(self.pin)
        self.job = self.backend.executor()
        self.job.read()
        self.backend.members[1235] = 9999
        self.assertFalse(self.job.pause()['remoteStopConfirmed'])

    def test_empty_paused_claim_is_not_pause_or_terminal_proof(self):
        self.backend.members = {}
        result = self.job.pause()
        self.assertFalse(result['remoteStopConfirmed'])
        self.assertFalse(result['terminalConfirmed'])

    def test_stopped_known_identity_and_authenticated_gate_allow_resume(self):
        self.job.pause()
        result = self.job.resume(gate(self.pin))
        self.assertEqual(result['state'], 'running-observed')
        self.assertEqual(self.dispatched(), ['pause', 'unpause'])
        self.assertFalse(result['reservationReleaseAllowed'])

    def test_resume_unknown_pause_has_no_unpause_dispatch(self):
        self.job.resume(gate(self.pin))
        self.assertNotIn('unpause', self.dispatched())

    def test_each_gate_binding_and_freshness_required(self):
        for field in self.pin.binding():
            backend = Backend(self.pin)
            job = backend.executor()
            job.pause()
            bad = gate(self.pin)
            bad[field] = None
            result = job.resume(bad)
            self.assertFalse(result['remoteStopConfirmed'])
            self.assertFalse(any(spec['argv'][1] == 'unpause' for kind, spec in backend.calls if kind == 'dispatch'))
        for offset in (-1, 31):
            backend = Backend(self.pin)
            job = backend.executor()
            job.pause()
            bad = gate(self.pin)
            bad['verifiedAt'] = (NOW - datetime.timedelta(seconds=offset)).isoformat()
            job.resume(bad)
            self.assertFalse(any(spec['argv'][1] == 'unpause' for kind, spec in backend.calls if kind == 'dispatch'))

    def test_gate_truthiness_or_unauthenticated_claim_is_denied(self):
        for field in ('mintLockHeldForWholeJob', 'durableReservationHeld', 'globalSlotAcknowledged',
                      'hostHealthCurrent', 'operatorResumeAuthorized'):
            backend = Backend(self.pin)
            job = backend.executor()
            job.pause()
            bad = gate(self.pin)
            bad[field] = 1
            job.resume(bad)
            self.assertFalse(any(spec['argv'][1] == 'unpause' for kind, spec in backend.calls if kind == 'dispatch'))
        self.job.pause()
        self.backend.gate_authenticated = False
        self.job.resume(gate(self.pin))
        self.assertNotIn('unpause', self.dispatched())

    def test_operator_resume_authorization_cannot_be_replayed(self):
        self.job.pause()
        self.job.resume(gate(self.pin))
        self.job.pause()
        self.job.resume(gate(self.pin))
        self.assertEqual(self.dispatched().count('unpause'), 1)
        self.assertFalse(self.job.result()['reservationReleaseAllowed'])

    def test_new_explicit_authorization_after_pause_can_resume(self):
        self.job.pause()
        self.job.resume(gate(self.pin))
        self.job.pause()
        receipt = gate(self.pin)
        receipt['resumeAuthorizationId'] = 'mock-explicit-resume-2'
        self.assertEqual(self.job.resume(receipt)['state'], 'running-observed')
        self.assertEqual(self.dispatched().count('unpause'), 2)

    def test_gate_rechecked_after_pause_readback(self):
        self.job.pause()
        authentications = [0]
        def authenticate(g):
            authentications[0] += 1
            return authentications[0] == 1
        self.job.authenticate_gate = authenticate
        self.job.resume(gate(self.pin))
        self.assertNotIn('unpause', self.dispatched())
        self.assertEqual(authentications[0], 2)

    def test_out_of_band_unpause_denies_resume_and_requests_freeze(self):
        self.job.pause()
        self.backend.frozen = False
        self.backend.rows[0]['State'].update(Paused=False, Status='running')
        result = self.job.resume(gate(self.pin))
        self.assertNotIn('unpause', self.dispatched())
        self.assertEqual(self.dispatched(), ['pause', 'pause'])
        self.assertFalse(result['reservationReleaseAllowed'])

    def test_terminal_requires_exited_and_two_complete_empty_snapshots(self):
        self.job.pause()
        result = self.job.shutdown()
        self.assertTrue(result['terminalConfirmed'])
        self.assertTrue(result['coordinatorReleaseMayBeRequested'])
        self.assertFalse(result['reservationReleaseAllowed'])
        self.assertEqual(self.dispatched(), ['pause', 'kernel-kill'])
        kill = [spec for kind, spec in self.backend.calls if kind == 'dispatch'][-1]
        self.assertEqual(kill['kind'], 'owned-cgroup-v2-kill')
        self.assertEqual(kill['cgroupPath'], self.pin.cgroup_path)
        self.assertEqual(kill['cgroupDevice'], self.pin.cgroup_device)
        self.assertEqual(kill['cgroupInode'], self.pin.cgroup_inode)
        self.assertEqual(kill['file'], 'cgroup.kill')
        self.assertEqual(kill['value'], '1')
        self.assertTrue(kill['requiresVerifiedDirectoryFd'])

    def test_container_absence_never_releases(self):
        self.backend.rows = []
        result = self.job.shutdown()
        self.assertFalse(result['terminalConfirmed'])
        self.assertFalse(result['coordinatorReleaseMayBeRequested'])

    def test_exited_with_live_owned_descendant_is_unconfirmed(self):
        self.backend.rows[0]['State'].update(Running=False, Pid=0, Paused=False, Status='exited', FinishedAt=NOW.isoformat())
        self.backend.members = {1235: 5001}
        self.assertFalse(self.job.shutdown()['terminalConfirmed'])

    def test_shutdown_dispatch_not_equivalent_to_terminal(self):
        self.backend.change_state = False
        self.assertFalse(self.job.shutdown()['terminalConfirmed'])

    def test_missing_kernel_kill_support_does_not_release(self):
        original = self.backend.dispatch
        def unsupported(spec):
            if spec.get('kind') == 'owned-cgroup-v2-kill':
                raise OSError('mock no cgroup.kill support')
            return original(spec)
        self.job.dispatch = unsupported
        result = self.job.shutdown()
        self.assertFalse(result['terminalConfirmed'])
        self.assertFalse(result['coordinatorReleaseMayBeRequested'])
        self.assertFalse(result['reservationReleaseAllowed'])

    def test_clock_deadline_or_unknown_never_confirms(self):
        for bad_clock in (lambda: float('nan'), lambda: float('inf')):
            backend = Backend(self.pin)
            job = backend.executor()
            job.clock = bad_clock
            self.assertFalse(job.pause()['remoteStopConfirmed'])
        ticks = iter([0, 3])
        self.job.clock = lambda: next(ticks)
        self.assertFalse(self.job.pause()['remoteStopConfirmed'])

    def test_backend_does_not_receive_mutable_arbitrary_commands(self):
        self.job.pause()
        self.job.shutdown()
        for kind, spec in self.backend.calls:
            if spec.get('kind') == 'owned-cgroup-v2-kill':
                self.assertEqual(spec['containerId'], self.pin.container_id)
                self.assertEqual(spec['cgroupPath'], self.pin.cgroup_path)
                continue
            self.assertEqual(spec['argv'][0], '/usr/bin/docker')
            self.assertEqual(spec['argv'][-1], self.pin.container_id)
            self.assertNotIn('exec', spec['argv'])
            self.assertNotIn('build', spec['argv'])


if __name__ == '__main__':
    unittest.main()
