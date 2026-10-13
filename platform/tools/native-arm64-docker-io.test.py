"""Fake tool filesystem, runner, Popen, selector, pipe reads and clocks only."""
import copy
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import stat
import sys
from types import SimpleNamespace
import unittest

spec = importlib.util.spec_from_file_location('docker_backend', Path(__file__).with_name('native-arm64-docker-io.py'))
docker = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = docker
spec.loader.exec_module(docker)
ELF = b'\x7fELF\x02\x01' + b'\0' * 12 + (183).to_bytes(2, 'little') + b'mock-docker-tool'


def identity():
    return docker.executor.Identity(container_id='a' * 64, image_id='sha256:' + 'b' * 64,
        owner='YT-owner', generation='job-1', ops_sha='c' * 40, started_at='2026-10-13T09:59:00Z',
        leader_pid=1234, leader_starttime=5000, cgroup_path='/sys/fs/cgroup/system.slice/docker-' + 'a' * 64 + '.scope',
        cgroup_device=29, cgroup_inode=45678)


def projection(pin, paused=True):
    return [{'Id': pin.container_id, 'Image': pin.image_id, 'RestartCount': 0, 'Mounts': [],
        'Config': {'Labels': {docker.executor.LABELS[k]: v for k, v in {
            'owner': pin.owner, 'generation': pin.generation, 'ops_sha': pin.ops_sha,
            'app_sha': docker.executor.APP_SHA}.items()}},
        'HostConfig': {'Privileged': False, 'PidMode': '', 'NetworkMode': 'none',
            'CgroupnsMode': 'private', 'CapAdd': None, 'CapDrop': ['ALL'], 'Devices': [], 'Binds': None,
            'SecurityOpt': ['no-new-privileges:true'], 'AutoRemove': False,
            'RestartPolicy': {'Name': 'no', 'MaximumRetryCount': 0}},
        'State': {'StartedAt': pin.started_at, 'FinishedAt': '0001-01-01T00:00:00Z',
            'Running': True, 'Paused': paused, 'Status': 'paused' if paused else 'running',
            'Pid': pin.leader_pid, 'Restarting': False, 'Dead': False, 'ExitCode': 0}}]


class ToolFS:
    def __init__(self):
        self.nodes = {}
        for index, name in enumerate(('/', '/usr', '/usr/bin')):
            self.nodes[name] = SimpleNamespace(st_mode=stat.S_IFDIR | 0o755, st_uid=0, st_gid=0,
                st_dev=77, st_ino=index + 1, st_size=0, st_nlink=1, st_mtime_ns=1, st_ctime_ns=1)
        self.nodes['/usr/bin/docker'] = SimpleNamespace(st_mode=stat.S_IFREG | 0o755, st_uid=0, st_gid=0,
            st_dev=77, st_ino=88, st_size=len(ELF), st_nlink=1, st_mtime_ns=1, st_ctime_ns=1)
        self.data = ELF
        self.fds = {}
        self.opens = []
        self.next_fd = 100
        self.time = 0.0
        self.step = .001

    def pin(self):
        return docker.ToolPin(hashlib.sha256(ELF).hexdigest(), 77, 88, len(ELF), 0o755)
    def open(self, path, flags, parent=None):
        full = path if parent is None else self.fds[parent]['path'].rstrip('/') + '/' + path
        self.opens.append((full, flags, parent))
        assert flags & os.O_NOFOLLOW and flags & os.O_CLOEXEC
        info = self.nodes[full]
        if stat.S_ISLNK(info.st_mode): raise OSError('mock nofollow denied')
        if flags & os.O_DIRECTORY and not stat.S_ISDIR(info.st_mode): raise NotADirectoryError('mock not directory')
        fd = self.next_fd
        self.next_fd += 1
        self.fds[fd] = {'path': full, 'offset': 0}
        return fd
    def close(self, fd): del self.fds[fd]
    def fstat(self, fd): return copy.copy(self.nodes[self.fds[fd]['path']])
    def read(self, fd, count):
        offset = self.fds[fd]['offset']
        result = self.data[offset:offset + count]
        self.fds[fd]['offset'] += len(result)
        return result
    def clock(self):
        self.time += self.step
        return self.time


class FakeRunner:
    def __init__(self, io): self.io, self.calls, self.responses = io, [], []
    def run(self, argv, fd, env, bounds, clock):
        assert fd in self.io.fds
        self.calls.append((argv, fd, env, list(bounds)))
        return self.responses.pop(0)


class Stream:
    def __init__(self, fd): self.fd, self.closed = fd, False
    def fileno(self): return self.fd
    def close(self): self.closed = True


class FakeProcess:
    def __init__(self):
        self.stdout, self.stderr = Stream(1000), Stream(1001)
        self.done, self.killed, self.waits = False, False, []
    def poll(self): return 0 if self.done else None
    def kill(self): self.killed = True
    def wait(self, timeout):
        self.waits.append(timeout)
        self.done = True
        return 0


class FakeSelector:
    def __init__(self): self.keys, self.closed = {}, False
    def register(self, stream, event, name):
        self.keys[stream.fd] = SimpleNamespace(fileobj=stream, data=name)
    def unregister(self, stream): del self.keys[stream.fd]
    def get_map(self): return self.keys
    def select(self, timeout): return [(key, 1) for key in list(self.keys.values())]
    def close(self): self.closed = True


class DockerTests(unittest.TestCase):
    def setUp(self):
        self.pin = identity()
        self.io = ToolFS()
        self.runner = FakeRunner(self.io)
        self.backend = docker.DockerBackend(self.pin, self.io.pin(), self.io, self.runner, self.io.clock)

    def inspect(self, rows=None):
        self.runner.responses.append((0, json.dumps(projection(self.pin) if rows is None else rows).encode(), b''))
        return self.backend.inspect(docker.executor.docker_spec('inspect', self.pin))

    def tearDown(self): self.assertEqual(self.io.fds, {})

    def test_construction_has_no_execution_or_host_io(self):
        self.assertEqual(self.io.opens, [])
        self.assertEqual(self.runner.calls, [])
        self.assertFalse(hasattr(docker, 'main'))

    def test_inspect_uses_fixed_projection_and_local_socket(self):
        self.assertEqual(self.inspect(), projection(self.pin))
        argv, fd, env, _ = self.runner.calls[0]
        self.assertEqual(argv[:3], ['/usr/bin/docker', 'inspect', '--format'])
        self.assertEqual(argv[-1], self.pin.container_id)
        self.assertEqual(argv[3], docker.inspect_template())
        self.assertEqual(env['DOCKER_HOST'], 'unix:///var/run/docker.sock')
        self.assertEqual(env['DOCKER_CONFIG'], '/nonexistent/observe-owned-compiler')
        self.assertNotIn('.Config.Env', argv[3])
        self.assertNotIn('.State.Error', argv[3])
        self.assertNotIn('{{json .Mounts}}', argv[3])
        self.assertGreater(fd, 0)

    def test_unknown_container_source_cannot_be_supplied_as_json_flag(self):
        with self.assertRaises(ValueError):
            docker.DockerBackend({'runtimeReady': True}, self.io.pin(), self.io, self.runner, self.io.clock)

    def test_tool_pin_must_be_explicit_protected_and_native(self):
        for field, value in (('sha256', 'latest'), ('inode', 0), ('size', docker.TOOL_CAP + 1),
                             ('mode', 0o777), ('mode', 0o644)):
            values = dict(sha256=hashlib.sha256(ELF).hexdigest(), device=77, inode=88, size=len(ELF), mode=0o755)
            values[field] = value
            with self.assertRaises(ValueError): docker.ToolPin(**values)
        self.io.data = b'not a native ELF file but padded to size'
        with self.assertRaises(ValueError): self.inspect()
        self.assertEqual(self.runner.calls, [])

    def test_tool_owner_device_inode_size_mode_changes_deny_spawn(self):
        for field, value in (('st_uid', 1000), ('st_gid', 1000), ('st_dev', 99), ('st_ino', 99),
                             ('st_size', 99), ('st_mode', stat.S_IFREG | 0o777)):
            io = ToolFS()
            setattr(io.nodes['/usr/bin/docker'], field, value)
            runner = FakeRunner(io)
            backend = docker.DockerBackend(self.pin, self.io.pin(), io, runner, io.clock)
            with self.assertRaises(ValueError): backend.inspect(docker.executor.docker_spec('inspect', self.pin))
            self.assertEqual(runner.calls, [])
            self.assertEqual(io.fds, {})

    def test_root_directory_mutability_and_symlink_are_denied(self):
        for path, field, value in (('/usr', 'st_uid', 1000), ('/usr/bin', 'st_mode', stat.S_IFDIR | 0o777),
                                   ('/usr/bin/docker', 'st_mode', stat.S_IFLNK | 0o777)):
            io = ToolFS()
            setattr(io.nodes[path], field, value)
            runner = FakeRunner(io)
            backend = docker.DockerBackend(self.pin, self.io.pin(), io, runner, io.clock)
            with self.assertRaises((ValueError, OSError)):
                backend.inspect(docker.executor.docker_spec('inspect', self.pin))
            self.assertEqual(io.fds, {})

    def test_hash_or_native_architecture_mismatch_is_denied(self):
        self.io.data = ELF[:-1] + b'X'
        with self.assertRaises(ValueError): self.inspect()
        self.assertFalse(self.runner.calls)
        data = bytearray(ELF)
        data[18:20] = (62).to_bytes(2, 'little')
        self.io.data = bytes(data)
        pin = docker.ToolPin(hashlib.sha256(self.io.data).hexdigest(), 77, 88, len(ELF), 0o755)
        backend = docker.DockerBackend(self.pin, pin, self.io, self.runner, self.io.clock)
        with self.assertRaises(ValueError): backend.inspect(docker.executor.docker_spec('inspect', self.pin))

    def test_tool_changed_while_hashing_is_denied(self):
        original = self.io.read
        def changed(fd, count):
            value = original(fd, count)
            self.io.nodes['/usr/bin/docker'].st_mtime_ns += 1
            return value
        self.io.read = changed
        with self.assertRaises(ValueError): self.inspect()
        self.assertFalse(self.runner.calls)

    def test_altered_socket_env_tool_or_container_spec_is_denied_before_io(self):
        for field, value in (('argv', ['/usr/bin/docker', 'exec', self.pin.container_id, 'sh']),
                             ('env', {'DOCKER_HOST': 'tcp://unknown:2375'}), ('timeoutSeconds', 100)):
            spec = docker.executor.docker_spec('inspect', self.pin)
            spec[field] = value
            with self.assertRaises(ValueError): self.backend.inspect(spec)
        for operation in ('exec', 'build', 'image', 'kill', 'stop'):
            with self.assertRaises(ValueError): self.backend.dispatch({'argv': ['/usr/bin/docker', operation]})
        self.assertFalse(self.io.opens)

    def test_owner_native_image_startedat_or_privilege_mismatch_is_denied(self):
        for section, field, value in ((None, 'Id', 'other'), (None, 'Image', 'other'),
                                     ('State', 'StartedAt', '2026-10-13T00:00:00Z'),
                                     ('HostConfig', 'Privileged', True)):
            rows = projection(self.pin)
            (rows[0] if section is None else rows[0][section])[field] = value
            with self.assertRaises(ValueError): self.inspect(rows)

    def test_unexpected_secret_fields_are_never_returned(self):
        for section in ('Config', 'State', 'HostConfig'):
            rows = projection(self.pin)
            rows[0][section]['Env'] = ['SECRET=fake-sensitive-value']
            with self.assertRaisesRegex(ValueError, '^Docker identity projection unavailable/mismatched$'):
                self.inspect(rows)

    def test_unexpected_value_or_duplicate_json_key_is_denied(self):
        for section, field, value in (('State', 'FinishedAt', 'fake-sensitive-value'),
                                     ('State', 'ExitCode', True),
                                     ('HostConfig', 'CapDrop', ['ALL', 'fake-sensitive-value']),
                                     ('HostConfig', 'SecurityOpt', ['no-new-privileges:true', 'fake-sensitive-value'])):
            rows = projection(self.pin)
            rows[0][section][field] = value
            with self.assertRaisesRegex(ValueError, '^Docker identity projection unavailable/mismatched$'):
                self.inspect(rows)
        raw = json.dumps(projection(self.pin)).encode().replace(b'"Id":', b'"Id":"unexpected","Id":', 1)
        self.runner.responses.append((0, raw, b''))
        with self.assertRaises(ValueError): self.backend.inspect(docker.executor.docker_spec('inspect', self.pin))

    def test_malformed_json_nonzero_or_overcap_response_is_unknown(self):
        for result in ((0, b'bad json fake-secret', b''), (1, b'', b'fake-sensitive-value'),
                       (0, b'x' * (docker.OUTPUT_CAP + 1), b'')):
            self.runner.responses.append(result)
            with self.assertRaises(ValueError) as caught:
                self.backend.inspect(docker.executor.docker_spec('inspect', self.pin))
            self.assertNotIn('fake-sensitive-value', str(caught.exception))
            self.assertNotIn('fake-secret', str(caught.exception))

    def test_pause_or_unpause_need_new_owned_inspection(self):
        for operation in ('pause', 'unpause'):
            self.runner.responses.extend([(0, json.dumps(projection(self.pin)).encode(), b''),
                                          (0, (self.pin.container_id + '\n').encode(), b'')])
            self.assertTrue(self.backend.dispatch(docker.executor.docker_spec(operation, self.pin)))
        self.assertEqual([call[0][1] for call in self.runner.calls], ['inspect', 'pause', 'inspect', 'unpause'])

    def test_unpause_of_not_paused_container_is_denied(self):
        self.runner.responses.append((0, json.dumps(projection(self.pin, paused=False)).encode(), b''))
        with self.assertRaises(ValueError): self.backend.dispatch(docker.executor.docker_spec('unpause', self.pin))
        self.assertEqual(len(self.runner.calls), 1)

    def test_dispatch_acknowledgement_is_not_assumed(self):
        self.runner.responses.extend([(0, json.dumps(projection(self.pin)).encode(), b''),
                                      (0, b'other-container', b'')])
        with self.assertRaises(ValueError): self.backend.dispatch(docker.executor.docker_spec('pause', self.pin))

    def test_timeout_during_tool_verification_prevents_spawn(self):
        self.io.step = 1
        with self.assertRaises(ValueError): self.inspect()
        self.assertFalse(self.runner.calls)


class RunnerTests(unittest.TestCase):
    def setup_runner(self, stdout=b'[]', stderr=b'', silent=False):
        process, poller, calls = FakeProcess(), FakeSelector(), []
        buffers = {1000: stdout, 1001: stderr}
        now = [0.0]
        def clock():
            now[0] += .01
            return now[0]
        def popen(argv, **kwargs):
            calls.append((argv, kwargs))
            return process
        def read(fd, count):
            data, buffers[fd] = buffers[fd][:count], buffers[fd][count:]
            return data
        if silent: poller.select = lambda timeout: []
        runner = docker.BoundedRunner(popen, lambda: poller, read)
        return runner, process, poller, calls, clock

    def run_fake(self, runner, clock):
        return runner.run(['/usr/bin/docker', 'inspect', 'a' * 64], 42,
            {'DOCKER_HOST': 'unix:///var/run/docker.sock'}, [0, 5], clock)

    def test_pinned_fd_execution_and_pipe_capture_are_mocked(self):
        runner, process, poller, calls, clock = self.setup_runner(b'[]', b'warning')
        self.assertEqual(self.run_fake(runner, clock), (0, b'[]', b'warning'))
        argv, kwargs = calls[0]
        self.assertEqual(kwargs['executable'], '/proc/self/fd/42')
        self.assertEqual(kwargs['pass_fds'], (42,))
        self.assertNotIn('shell', kwargs)
        self.assertEqual(kwargs['cwd'], '/')
        self.assertTrue(process.stdout.closed and process.stderr.closed and poller.closed)
        self.assertFalse(process.killed)

    def test_combined_output_cap_kills_only_own_cli_child(self):
        runner, process, poller, calls, clock = self.setup_runner(b'x' * docker.OUTPUT_CAP, b'y')
        with self.assertRaises(ValueError): self.run_fake(runner, clock)
        self.assertTrue(process.killed)
        self.assertTrue(process.stdout.closed and process.stderr.closed and poller.closed)
        self.assertEqual(process.waits[-1], .5)

    def test_silent_pipe_timeout_has_bounded_cleanup(self):
        runner, process, poller, calls, clock = self.setup_runner(silent=True)
        with self.assertRaises(ValueError): self.run_fake(runner, clock)
        self.assertTrue(process.killed)
        self.assertTrue(poller.closed)

    def test_clock_unknown_prevents_child_creation(self):
        runner, process, poller, calls, _ = self.setup_runner()
        with self.assertRaises(ValueError): self.run_fake(runner, lambda: float('nan'))
        self.assertEqual(calls, [])


if __name__ == '__main__':
    unittest.main()
