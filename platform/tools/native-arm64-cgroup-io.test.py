"""Injected filesystem/clock/inspection only; no OS kernel reads or writes."""
import copy
from dataclasses import asdict, fields, make_dataclass
import datetime
import importlib.util
import os
from pathlib import Path
import stat
import sys
from types import SimpleNamespace
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('kernel_backend', Path(__file__).with_name('native-arm64-cgroup-io.py'))
kernel = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = kernel
spec.loader.exec_module(kernel)
CGROUP = '/sys/fs/cgroup/system.slice/docker-' + 'a' * 64 + '.scope'


def identity():
    return kernel.executor.Identity(container_id='a' * 64, image_id='sha256:' + 'b' * 64,
        owner='YT-owner', generation='job-1', ops_sha='c' * 40, started_at='2026-10-13T09:59:00Z',
        leader_pid=1234, leader_starttime=5000, cgroup_path=CGROUP, cgroup_device=29, cgroup_inode=45678)


def inspection(pin):
    return [{'Id': pin.container_id, 'Image': pin.image_id, 'RestartCount': 0, 'Mounts': [],
        'Config': {'Labels': {kernel.executor.LABELS[k]: v for k, v in {
            'owner': pin.owner, 'generation': pin.generation, 'ops_sha': pin.ops_sha,
            'app_sha': kernel.executor.APP_SHA}.items()}},
        'HostConfig': {'Privileged': False, 'PidMode': '', 'NetworkMode': 'none',
            'CgroupnsMode': 'private', 'CapAdd': None, 'CapDrop': ['ALL'], 'Devices': [], 'Binds': None,
            'SecurityOpt': ['no-new-privileges:true'], 'AutoRemove': False,
            'RestartPolicy': {'Name': 'no', 'MaximumRetryCount': 0}},
        'State': {'StartedAt': pin.started_at, 'Running': True, 'Paused': True, 'Status': 'paused',
            'Pid': pin.leader_pid, 'Restarting': False, 'Dead': False, 'ExitCode': 0}}]


class FakeIO:
    def __init__(self):
        self.nodes = {}
        self.fds = {}
        self.next_fd = 100
        self.opens = []
        self.writes = []
        self.inode_counter = 10000
        self.time = 0.0
        self.step = .00001
        self.event_sequence = []
        for directory in ('/', '/sys', '/sys/fs', '/sys/fs/cgroup', '/sys/fs/cgroup/system.slice',
                          CGROUP, CGROUP + '/workers', '/proc', '/proc/999', '/proc/999/fdinfo',
                          '/proc/1234', '/proc/1235'):
            self.directory(directory)
        self.nodes[CGROUP]['stat'].st_ino = 45678
        self.file(CGROUP + '/cgroup.events', b'frozen 1\npopulated 1\n')
        self.file(CGROUP + '/cgroup.threads', b'1234\n')
        self.file(CGROUP + '/cgroup.kill', b'')
        self.file(CGROUP + '/workers/cgroup.events', b'frozen 1\npopulated 1\n')
        self.file(CGROUP + '/workers/cgroup.threads', b'1235\n')
        self.file('/proc/999/mountinfo', b'42 1 0:29 / /sys/fs/cgroup rw - cgroup2 cgroup rw\n')
        for tid, start, group in ((1234, 5000, CGROUP), (1235, 5001, CGROUP + '/workers')):
            self.task(tid, start, group)

    def info(self, path, mode):
        self.inode_counter += 1
        return SimpleNamespace(st_mode=mode, st_nlink=1,
            st_dev=29 if path.startswith('/sys/fs/cgroup') else 99, st_ino=self.inode_counter)

    def directory(self, path):
        self.nodes[path] = {'stat': self.info(path, stat.S_IFDIR | 0o755), 'data': b''}

    def file(self, path, data):
        self.nodes[path] = {'stat': self.info(path, stat.S_IFREG | 0o600), 'data': data}

    def task(self, tid, start, group):
        if '/proc/' + str(tid) not in self.nodes:
            self.directory('/proc/' + str(tid))
        fields = ['S'] + ['0'] * 18 + [str(start)]
        self.file('/proc/' + str(tid) + '/stat', (f'{tid} (worker) ' + ' '.join(fields) + '\n').encode())
        self.file('/proc/' + str(tid) + '/cgroup', ('0::' + group[len(kernel.CGROUP_ROOT):] + '\n').encode())

    def open(self, path, flags, parent=None):
        full = path if parent is None else self.fds[parent]['path'].rstrip('/') + '/' + path
        self.opens.append((full, flags, parent))
        assert flags & os.O_NOFOLLOW
        assert flags & os.O_CLOEXEC
        if full.startswith('/proc/999/fdinfo/'):
            self.file(full, b'pos: 0\nmnt_id: 42\n')
        if full not in self.nodes:
            raise FileNotFoundError('mock missing kernel file')
        node = self.nodes[full]
        if stat.S_ISLNK(node['stat'].st_mode):
            raise OSError('mock no-follow symlink')
        if flags & os.O_DIRECTORY and not stat.S_ISDIR(node['stat'].st_mode):
            raise NotADirectoryError('mock wrong file type')
        data = node['data']
        if full == CGROUP + '/cgroup.events' and self.event_sequence:
            data = self.event_sequence.pop(0)
        fd = self.next_fd
        self.next_fd += 1
        self.fds[fd] = {'path': full, 'stat': copy.copy(node['stat']), 'data': data, 'offset': 0,
                        'parentInode': self.fds[parent]['stat'].st_ino if parent is not None else None}
        return fd

    def close(self, fd):
        if fd not in self.fds:
            raise AssertionError('double close')
        del self.fds[fd]

    def fstat(self, fd): return copy.copy(self.fds[fd]['stat'])
    def stat_child(self, name, parent):
        path = self.fds[parent]['path'].rstrip('/') + '/' + name
        return copy.copy(self.nodes[path]['stat'])
    def read(self, fd, count):
        handle = self.fds[fd]
        result = handle['data'][handle['offset']:handle['offset'] + count]
        handle['offset'] += len(result)
        return result
    def write(self, fd, data):
        self.writes.append((copy.deepcopy(self.fds[fd]), data))
        return len(data)
    def names(self, fd):
        prefix = self.fds[fd]['path'].rstrip('/') + '/'
        return (path[len(prefix):] for path in list(self.nodes)
                if path.startswith(prefix) and '/' not in path[len(prefix):])
    def getpid(self): return 999
    def clock(self):
        self.time += self.step
        return self.time


class KernelTests(unittest.TestCase):
    def setUp(self):
        self.pin = identity()
        self.io = FakeIO()
        self.backend = kernel.CgroupBackend(self.pin, io=self.io, clock=self.io.clock)

    def observe(self): return self.backend.observe(self.pin)
    def shutdown(self, inspector=None):
        return self.backend.shutdown(kernel.executor.shutdown_spec(self.pin),
            (lambda spec: inspection(self.pin)) if inspector is None else inspector)

    def tearDown(self):
        self.assertEqual(self.io.fds, {}, 'No leaked mock descriptors')

    def test_constructor_and_import_do_not_probe(self):
        self.assertEqual(self.io.opens, [])
        self.assertEqual(self.io.writes, [])
        self.assertFalse(hasattr(kernel, 'main'))

    def test_independent_importlib_identity_is_revalidated(self):
        OtherIdentity = make_dataclass('OtherIdentity', [(f.name, f.type) for f in fields(self.pin)])
        other = OtherIdentity(**asdict(self.pin))
        self.assertEqual(self.backend.observe(other)['members'], {1234: 5000, 1235: 5001})
        other.cgroup_inode = 99999
        with self.assertRaises(ValueError): self.backend.observe(other)
        with self.assertRaises(ValueError): self.backend.observe(asdict(self.pin))

    def test_recursive_thread_snapshot_matches_lifecycle_contract(self):
        result = self.observe()
        self.assertEqual(result['members'], {1234: 5000, 1235: 5001})
        self.assertTrue(result['frozen'])
        self.assertTrue(result['descendantsComplete'])
        self.assertEqual(result['cgroupDevice'], 29)
        self.assertEqual(result['cgroupInode'], 45678)
        self.assertEqual(kernel.executor.cgroup_members(result, self.pin)[0], result['members'])
        self.assertEqual(self.io.writes, [])

    def test_mocked_kernel_backend_confirms_lifecycle_pause_without_docker_dispatch(self):
        calls = []
        job = kernel.executor.Executor(self.pin, lambda spec: inspection(self.pin),
            lambda spec: calls.append(spec), self.backend.observe, lambda gate: False,
            lambda: datetime.datetime(2026, 10, 13, tzinfo=datetime.timezone.utc),
            self.io.clock, lambda interval: None)
        result = job.pause()
        self.assertTrue(result['remoteStopConfirmed'])
        self.assertFalse(result['reservationReleaseAllowed'])
        self.assertFalse(result['runtimeReady'])
        self.assertEqual(calls, [])
        self.assertEqual(self.io.writes, [])

    def test_every_directory_and_file_open_is_no_follow(self):
        self.observe()
        for _, flags, _ in self.io.opens:
            self.assertTrue(flags & os.O_NOFOLLOW)
            self.assertTrue(flags & os.O_CLOEXEC)
        self.assertTrue(any(path == CGROUP + '/workers' and flags & os.O_DIRECTORY
                            for path, flags, _ in self.io.opens))

    def test_symlink_directory_or_file_is_never_followed(self):
        for path in ('/sys/fs', CGROUP + '/cgroup.events', CGROUP + '/workers'):
            with self.subTest(path=path):
                io = FakeIO()
                io.nodes[path]['stat'].st_mode = stat.S_IFLNK | 0o777
                backend = kernel.CgroupBackend(self.pin, io=io, clock=io.clock)
                with self.assertRaises((OSError, ValueError)):
                    backend.observe(self.pin)
                self.assertEqual(io.fds, {})

    def test_device_inode_pin_is_required(self):
        for field, value in (('st_dev', 77), ('st_ino', 9999), ('st_nlink', 0)):
            io = FakeIO()
            setattr(io.nodes[CGROUP]['stat'], field, value)
            with self.assertRaises(ValueError):
                kernel.CgroupBackend(self.pin, io=io, clock=io.clock).observe(self.pin)
            self.assertEqual(io.fds, {})

    def test_mount_type_device_root_or_mount_id_cannot_be_claimed(self):
        for text in (b'42 1 0:29 / /sys/fs/cgroup rw - tmpfs none rw\n',
                     b'42 1 0:99 / /sys/fs/cgroup rw - cgroup2 none rw\n',
                     b'42 1 0:29 /delegated /sys/fs/cgroup rw - cgroup2 none rw\n',
                     b'43 1 0:29 / /sys/fs/cgroup rw - cgroup2 none rw\n'):
            self.io.nodes['/proc/999/mountinfo']['data'] = text
            with self.assertRaises(ValueError):
                self.observe()

    def test_directory_replacement_before_final_path_check_is_unknown(self):
        original = self.io.names
        def changed(fd):
            for name in original(fd): yield name
            if self.io.fds[fd]['path'] == CGROUP:
                self.io.nodes[CGROUP]['stat'].st_ino = 77777
        self.io.names = changed
        with self.assertRaises(ValueError): self.observe()

    def test_child_replaced_between_stat_and_open_is_unknown(self):
        original = self.io.stat_child
        def replaced(name, fd):
            result = original(name, fd)
            path = self.io.fds[fd]['path'] + '/' + name
            if path == CGROUP + '/workers':
                self.io.nodes[path]['stat'].st_ino += 1
            return result
        self.io.stat_child = replaced
        with self.assertRaises(ValueError): self.observe()

    def test_missing_task_or_deleted_cgroup_is_not_empty(self):
        for path in ('/proc/1235/stat', CGROUP):
            io = FakeIO()
            del io.nodes[path]
            with self.assertRaises(FileNotFoundError):
                kernel.CgroupBackend(self.pin, io=io, clock=io.clock).observe(self.pin)
            self.assertEqual(io.fds, {})

    def test_pid_starttime_reuse_or_task_escape_fails(self):
        self.io.task(1234, 9999, CGROUP)
        with self.assertRaises(ValueError): self.observe()
        self.io.task(1234, 5000, CGROUP)
        self.io.nodes['/proc/1235/cgroup']['data'] = b'0::/other/job\n'
        with self.assertRaises(ValueError): self.observe()

    def test_kernel_freezer_population_changes_during_scan_fail(self):
        self.io.event_sequence = [b'frozen 1\npopulated 1\n', b'frozen 0\npopulated 1\n']
        with self.assertRaises(ValueError): self.observe()

    def test_task_added_after_first_scan_with_unchanged_events_is_not_complete(self):
        self.io.nodes[CGROUP + '/cgroup.events']['data'] = b'frozen 0\npopulated 1\n'
        original = self.io.names
        changed = [False]
        def late_task(fd):
            for name in original(fd): yield name
            if self.io.fds[fd]['path'] == CGROUP and not changed[0]:
                changed[0] = True
                self.io.nodes[CGROUP + '/cgroup.threads']['data'] = b'1234\n1236\n'
                self.io.task(1236, 5002, CGROUP)
        self.io.names = late_task
        with self.assertRaisesRegex(ValueError, 'between bounded scans'): self.observe()
        self.assertTrue(changed[0])
        self.assertEqual(self.io.writes, [])

    def test_child_added_after_first_scan_with_unchanged_events_is_not_complete(self):
        original = self.io.names
        changed = [False]
        def late_child(fd):
            for name in original(fd): yield name
            if self.io.fds[fd]['path'] == CGROUP and not changed[0]:
                changed[0] = True
                self.io.directory(CGROUP + '/new-child')
                self.io.file(CGROUP + '/new-child/cgroup.threads', b'1236\n')
                self.io.task(1236, 5002, CGROUP + '/new-child')
        self.io.names = late_child
        with self.assertRaisesRegex(ValueError, 'between bounded scans'): self.observe()
        self.assertTrue(changed[0])
        self.assertEqual(self.io.writes, [])

    def test_task_migration_between_existing_groups_is_not_complete(self):
        original = self.io.names
        changed = [False]
        def migrate(fd):
            for name in original(fd): yield name
            if self.io.fds[fd]['path'] == CGROUP and not changed[0]:
                changed[0] = True
                self.io.nodes[CGROUP + '/cgroup.threads']['data'] = b'1234\n1235\n'
                self.io.nodes[CGROUP + '/workers/cgroup.threads']['data'] = b''
                self.io.task(1235, 5001, CGROUP)
        self.io.names = migrate
        with self.assertRaisesRegex(ValueError, 'between bounded scans'): self.observe()
        self.assertTrue(changed[0])

    def test_unchanging_running_group_needs_two_complete_passes(self):
        self.io.nodes[CGROUP + '/cgroup.events']['data'] = b'frozen 0\npopulated 1\n'
        scans = [0]
        original = self.io.names
        def counted(fd):
            if self.io.fds[fd]['path'] == CGROUP: scans[0] += 1
            return original(fd)
        self.io.names = counted
        self.assertEqual(self.observe()['members'], {1234: 5000, 1235: 5001})
        self.assertEqual(scans[0], 2)

    def test_populated_true_with_empty_scan_is_unknown(self):
        self.io.nodes[CGROUP + '/cgroup.threads']['data'] = b''
        self.io.nodes[CGROUP + '/workers/cgroup.threads']['data'] = b''
        with self.assertRaises(ValueError): self.observe()

    def test_complete_empty_population_is_readonly_terminal_input(self):
        self.io.nodes[CGROUP + '/cgroup.threads']['data'] = b''
        self.io.nodes[CGROUP + '/workers/cgroup.threads']['data'] = b''
        self.io.nodes[CGROUP + '/cgroup.events']['data'] = b'frozen 0\npopulated 0\n'
        self.assertEqual(self.observe()['members'], {})
        self.assertFalse(self.io.writes)

    def test_duplicate_tid_or_malformed_task_list_is_unknown(self):
        for data in (b'1234\n1234\n', b'-1234\n', b'unknown\n'):
            self.io.nodes[CGROUP + '/cgroup.threads']['data'] = data
            with self.assertRaises(ValueError): self.observe()

    def test_bytes_tasks_groups_and_entries_are_capped(self):
        for constant, limit in (('FILE_LIMIT', 8), ('TASK_LIMIT', 1), ('GROUP_LIMIT', 1), ('ENTRY_LIMIT', 1)):
            # _read default is frozen at definition, so force an oversized file
            # separately; other caps are checked dynamically.
            if constant == 'FILE_LIMIT': continue
            with patch.object(kernel, constant, limit), self.assertRaises(ValueError):
                self.observe()
        self.io.nodes[CGROUP + '/cgroup.events']['data'] = b'x' * (kernel.FILE_LIMIT + 1)
        with self.assertRaises(ValueError): self.observe()

    def test_unreadable_or_nonregular_kernel_files_fail_closed(self):
        self.io.nodes[CGROUP + '/cgroup.events']['stat'].st_mode = stat.S_IFIFO | 0o600
        with self.assertRaises(ValueError): self.observe()
        self.io.nodes[CGROUP + '/cgroup.events']['stat'].st_mode = stat.S_IFREG | 0o600
        original = self.io.open
        def denied(path, flags, parent=None):
            if path == 'cgroup.threads': raise PermissionError('mock permission denied')
            return original(path, flags, parent)
        self.io.open = denied
        with self.assertRaises(PermissionError): self.observe()

    def test_deadline_overrun_or_unknown_clock_fails_before_write(self):
        self.io.step = .51
        with self.assertRaises(ValueError): self.shutdown()
        self.assertEqual(self.io.writes, [])
        for clock in (lambda: float('nan'), lambda: float('inf')):
            self.backend.clock = clock
            with self.assertRaises(ValueError): self.observe()

    def test_exact_shutdown_writes_only_one_byte_to_held_owned_fd(self):
        calls = []
        def inspector(spec):
            calls.append(spec)
            return inspection(self.pin)
        self.assertTrue(self.shutdown(inspector))
        self.assertEqual(len(self.io.writes), 1)
        handle, data = self.io.writes[0]
        self.assertEqual(handle['path'], CGROUP + '/cgroup.kill')
        self.assertEqual(handle['parentInode'], 45678)
        self.assertEqual(data, b'1')
        self.assertEqual(calls[0], kernel.executor.docker_spec('inspect', self.pin))

    def test_shutdown_spec_cannot_redirect_target_or_value(self):
        for field, value in (('cgroupPath', '/sys/fs/cgroup/other'), ('value', '0'),
                             ('file', 'cgroup.freeze'), ('containerId', 'other'), ('cgroupInode', 99)):
            spec = kernel.executor.shutdown_spec(self.pin)
            spec[field] = value
            with self.assertRaises(ValueError):
                self.backend.shutdown(spec, lambda spec: inspection(self.pin))
        self.assertEqual(self.io.opens, [])
        self.assertEqual(self.io.writes, [])

    def test_shutdown_requires_fresh_owned_inspection_and_live_leader(self):
        def wrong_owner(spec):
            rows = inspection(self.pin)
            rows[0]['Config']['Labels'][kernel.executor.LABELS['owner']] = 'other'
            return rows
        with self.assertRaises(ValueError): self.shutdown(wrong_owner)
        self.assertEqual(self.io.writes, [])
        self.io.nodes[CGROUP + '/cgroup.threads']['data'] = b''
        with self.assertRaises(ValueError): self.shutdown()
        self.assertEqual(self.io.writes, [])

    def test_path_replacement_during_inspection_does_not_write_new_cgroup(self):
        def replaced(spec):
            self.io.nodes[CGROUP]['stat'].st_ino = 98765
            return inspection(self.pin)
        with self.assertRaises(ValueError): self.shutdown(replaced)
        self.assertEqual(self.io.writes, [])

    def test_inspection_deadline_expiry_cannot_reach_write(self):
        def late(spec):
            self.io.time += 2
            return inspection(self.pin)
        with self.assertRaises(ValueError): self.shutdown(late)
        self.assertEqual(self.io.writes, [])

    def test_missing_symlink_or_incomplete_kill_file_does_not_confirm(self):
        del self.io.nodes[CGROUP + '/cgroup.kill']
        with self.assertRaises(FileNotFoundError): self.shutdown()
        self.io.file(CGROUP + '/cgroup.kill', b'')
        self.io.nodes[CGROUP + '/cgroup.kill']['stat'].st_mode = stat.S_IFLNK | 0o777
        with self.assertRaises((OSError, ValueError)): self.shutdown()
        self.io.file(CGROUP + '/cgroup.kill', b'')
        self.io.write = lambda fd, data: 0
        with self.assertRaises(ValueError): self.shutdown()


if __name__ == '__main__':
    unittest.main()
