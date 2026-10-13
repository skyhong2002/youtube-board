"""Explicit-call Linux cgroup-v2 kernel IO; no runtime backend is wired here.

Import performs no host inspection. Default IO methods use real OS syscalls only
when observe()/shutdown() is explicitly called with an externally verified owned
container Identity. Tests replace every IO/clock/inspection boundary. There is no
CLI, launcher, Docker client, coordinator, watchdog, automatic cleanup or release.

Reads/writes stay relative to no-follow directory FDs with pinned device/inode.
Byte/task/directory/entry limits and monotonic checks bound accepted work, but do
not hard-preempt a synchronous kernel read, open, scandir or inspection callback.
Live integration still needs a supervised bounded-call adapter and all-owner
custody. Deleted cgroups stay unknown; missing paths are never empty evidence.
"""
from contextlib import contextmanager
from dataclasses import asdict, fields, is_dataclass
import importlib.util
import math
import os
from pathlib import Path
import re
import stat
import sys
import time

_name = 'youtube_native_arm64_executor_for_cgroup_io'
_spec = importlib.util.spec_from_file_location(_name, Path(__file__).with_name('native-arm64-executor.py'))
executor = importlib.util.module_from_spec(_spec)
sys.modules[_name] = executor
_spec.loader.exec_module(executor)

DIRECTORY_FLAGS = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC
READ_FLAGS = os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC | os.O_NONBLOCK
WRITE_FLAGS = os.O_WRONLY | os.O_NOFOLLOW | os.O_CLOEXEC | os.O_NONBLOCK
CGROUP_ROOT = '/sys/fs/cgroup'
FILE_LIMIT = 65536
MOUNTINFO_LIMIT = 262144
TASK_LIMIT = 4096
GROUP_LIMIT = 256
ENTRY_LIMIT = 32768


class SystemIO:
    """No constructor side effects; tiny syscall surface for injected mocks."""
    def open(self, path, flags, parent=None): return os.open(path, flags, dir_fd=parent)
    def close(self, fd): os.close(fd)
    def fstat(self, fd): return os.fstat(fd)
    def stat_child(self, name, parent): return os.stat(name, dir_fd=parent, follow_symlinks=False)
    def read(self, fd, count): return os.read(fd, count)
    def write(self, fd, data): return os.write(fd, data)
    def getpid(self): return os.getpid()
    def names(self, fd):
        with os.scandir(fd) as entries:
            for entry in entries:
                yield entry.name


class CgroupBackend:
    def __init__(self, identity, io=None, clock=None, timeout=1.0):
        identity = self._normalize_identity(identity)
        executor.require(type(timeout) in (int, float) and math.isfinite(timeout) and 0 < timeout <= 1,
                         'Kernel IO observation limit must be positive and at most one second')
        self.identity = identity
        self.io = SystemIO() if io is None else io
        self.clock = time.monotonic if clock is None else clock
        self.timeout = timeout

    @staticmethod
    def _normalize_identity(identity):
        # Hyphenated tools are loaded through importlib; independent consumers can
        # have another module instance. Revalidate identical dataclass fields
        # rather than relying on Python class-object identity across loaders.
        executor.require(is_dataclass(identity) and not isinstance(identity, type),
                         'Reviewed container Identity dataclass required')
        values = asdict(identity)
        executor.require(set(values) == {field.name for field in fields(executor.Identity)},
                         'Identity field contract changed')
        return executor.Identity(**values)

    def _deadline(self):
        now = self.clock()
        executor.require(type(now) in (int, float) and math.isfinite(now), 'Unknown monotonic clock')
        return [now, now + self.timeout]

    def _tick(self, bounds):
        now = self.clock()
        executor.require(type(now) in (int, float) and math.isfinite(now) and bounds[0] <= now <= bounds[1],
                         'Kernel IO observation stale/overrun')
        bounds[0] = now

    def _dir_stat(self, fd):
        value = self.io.fstat(fd)
        executor.require(stat.S_ISDIR(value.st_mode) and value.st_nlink > 0, 'Live directory FD required')
        return value

    @contextmanager
    def _path(self, path, bounds):
        # Only these fixed roots and the validated Identity cgroup path are used.
        executor.require(path in ('/proc', self.identity.cgroup_path), 'Unexpected kernel root')
        current = self.io.open('/', DIRECTORY_FLAGS)
        try:
            self._dir_stat(current)
            for component in path.split('/')[1:]:
                self._tick(bounds)
                child = self.io.open(component, DIRECTORY_FLAGS, current)
                try:
                    self._dir_stat(child)
                except Exception:
                    self.io.close(child)
                    raise
                self.io.close(current)
                current = child
            self._tick(bounds)
            yield current
        finally:
            self.io.close(current)

    @contextmanager
    def _child_dir(self, parent, name, bounds):
        executor.require(isinstance(name, str) and re.fullmatch(r'[A-Za-z0-9._-]+', name) and
                         name not in ('.', '..'), 'Unsupported kernel child name')
        self._tick(bounds)
        fd = self.io.open(name, DIRECTORY_FLAGS, parent)
        try:
            self._dir_stat(fd)
            self._tick(bounds)
            yield fd
        finally:
            self.io.close(fd)

    def _read(self, parent, name, bounds, limit=FILE_LIMIT, device=None):
        executor.require(isinstance(name, str) and re.fullmatch(r'[A-Za-z0-9._-]+', name) and
                         name not in ('.', '..'), 'Fixed kernel file required')
        self._tick(bounds)
        fd = self.io.open(name, READ_FLAGS, parent)
        try:
            info = self.io.fstat(fd)
            executor.require(stat.S_ISREG(info.st_mode) and info.st_nlink > 0 and
                             (device is None or info.st_dev == device), 'Unexpected kernel file/namespace')
            data = bytearray()
            for _ in range(limit // 4096 + 2):
                self._tick(bounds)
                part = self.io.read(fd, min(4096, limit + 1 - len(data)))
                executor.require(isinstance(part, bytes), 'Unknown kernel read')
                data.extend(part)
                executor.require(len(data) <= limit, 'Kernel read exceeds byte cap')
                if not part:
                    self._tick(bounds)
                    return data.decode('ascii')
            raise ValueError('Kernel read incomplete')
        finally:
            self.io.close(fd)

    def _pinned(self, fd):
        info = self._dir_stat(fd)
        executor.require(info.st_dev == self.identity.cgroup_device and info.st_ino == self.identity.cgroup_inode,
                         'Cgroup directory device/inode changed')

    def _mount(self, group, proc, bounds):
        own_pid = self.io.getpid()
        executor.require(type(own_pid) is int and own_pid > 0, 'Unknown observer process')
        with self._child_dir(proc, str(own_pid), bounds) as observer:
            mounts = self._read(observer, 'mountinfo', bounds, MOUNTINFO_LIMIT)
            with self._child_dir(observer, 'fdinfo', bounds) as fdinfo:
                descriptor = self._read(fdinfo, str(group), bounds)
        ids = [line.split()[1] for line in descriptor.splitlines() if line.startswith('mnt_id:')]
        executor.require(len(ids) == 1 and ids[0].isdecimal(), 'Directory mount identity unavailable')
        matched = []
        for line in mounts.splitlines():
            before, separator, after = line.partition(' - ')
            fields, kind = before.split(), after.split()
            if fields and fields[0] == ids[0]:
                matched.append((fields, kind, separator))
        expected_device = f'{os.major(self.identity.cgroup_device)}:{os.minor(self.identity.cgroup_device)}'
        executor.require(len(matched) == 1 and len(matched[0][0]) >= 6 and matched[0][2] and
                         matched[0][0][2] == expected_device and matched[0][0][3] == '/' and
                         matched[0][0][4] == CGROUP_ROOT and matched[0][1] and matched[0][1][0] == 'cgroup2',
                         'Host cgroup-v2 mount does not match held FD')

    def _events(self, group, bounds):
        text = self._read(group, 'cgroup.events', bounds, device=self.identity.cgroup_device)
        values = {}
        for line in text.splitlines():
            parts = line.split()
            executor.require(len(parts) == 2 and parts[0] not in values, 'Malformed cgroup events')
            values[parts[0]] = parts[1]
        executor.require(values.get('frozen') in ('0', '1') and values.get('populated') in ('0', '1'),
                         'Unknown kernel freezer/population state')
        return values['frozen'] == '1', values['populated'] == '1'

    def _task(self, proc, tid, relative_group, bounds):
        with self._child_dir(proc, str(tid), bounds) as process:
            raw = self._read(process, 'stat', bounds)
            prefix, closing, tail = raw.rpartition(')')
            fields = tail.split()
            executor.require(closing and prefix.split('(', 1)[0].strip() == str(tid) and len(fields) >= 20 and
                             fields[0] in 'RSDTtZXIWPK' and len(fields[0]) == 1 and fields[19].isdecimal(),
                             'Unknown task identity/starttime')
            membership = self._read(process, 'cgroup', bounds).strip().splitlines()
            executor.require(membership == ['0::' + relative_group], 'Task escaped pinned cgroup subtree')
            return int(fields[19])

    def _scan(self, group, proc, bounds):
        members, topology, groups, entries = {}, {}, [0], [0]
        def descend(fd, relative):
            groups[0] += 1
            executor.require(groups[0] <= GROUP_LIMIT, 'Cgroup subtree exceeds group cap')
            info = self._dir_stat(fd)
            executor.require(info.st_dev == self.identity.cgroup_device, 'Cross-filesystem cgroup descendant')
            text = self._read(fd, 'cgroup.threads', bounds, device=self.identity.cgroup_device)
            tids = text.splitlines()
            executor.require(len(tids) <= TASK_LIMIT and all(x.isdecimal() and int(x) > 0 for x in tids),
                             'Task list unknown/over cap')
            # Include per-group thread placement, not just global IDs: migrating
            # a task between already existing children is a topology change too.
            topology[relative] = (info.st_dev, info.st_ino, tuple(sorted(int(x) for x in tids)))
            for raw_tid in tids:
                tid = int(raw_tid)
                executor.require(tid not in members and len(members) < TASK_LIMIT, 'Duplicate/reused/over-cap task')
                members[tid] = self._task(proc, tid, relative, bounds)
            for name in self.io.names(fd):
                self._tick(bounds)
                entries[0] += 1
                executor.require(entries[0] <= ENTRY_LIMIT and isinstance(name, str) and
                                 re.fullmatch(r'[A-Za-z0-9._-]+', name) and name not in ('.', '..'),
                                 'Cgroup entries unknown/over cap')
                child = self.io.stat_child(name, fd)
                executor.require(not stat.S_ISLNK(child.st_mode), 'Cgroup symlink refused')
                if stat.S_ISDIR(child.st_mode):
                    with self._child_dir(fd, name, bounds) as descendant:
                        actual = self._dir_stat(descendant)
                        executor.require((actual.st_dev, actual.st_ino) == (child.st_dev, child.st_ino),
                                         'Cgroup child replaced during scan')
                        descend(descendant, relative + '/' + name)
        descend(group, self.identity.cgroup_path[len(CGROUP_ROOT):])
        return members, topology

    def _observe_held(self, group, proc, bounds):
        self._pinned(group)
        self._mount(group, proc, bounds)
        before = self._events(group, bounds)
        members, topology = self._scan(group, proc, bounds)
        repeated_members, repeated_topology = self._scan(group, proc, bounds)
        executor.require((members, topology) == (repeated_members, repeated_topology),
                         'Task identities/cgroup topology changed between bounded scans')
        after = self._events(group, bounds)
        executor.require(before == after and after[1] == bool(members), 'Kernel population/freezer changed during scan')
        if self.identity.leader_pid in members:
            executor.require(members[self.identity.leader_pid] == self.identity.leader_starttime,
                             'Owned leader PID starttime changed')
        self._pinned(group)
        # Resolve the pathname again, without ever redirecting IO to a replacement.
        with self._path(self.identity.cgroup_path, bounds) as current:
            self._pinned(current)
        self._tick(bounds)
        return {'containerId': self.identity.container_id, 'cgroupPath': self.identity.cgroup_path,
                'cgroupDevice': self.identity.cgroup_device, 'cgroupInode': self.identity.cgroup_inode,
                'pathIdentityVerified': True, 'descendantsComplete': True,
                'frozen': after[0], 'members': members}

    def observe(self, identity):
        executor.require(self._normalize_identity(identity) == self.identity, 'Backend identity binding changed')
        bounds = self._deadline()
        with self._path(self.identity.cgroup_path, bounds) as group, self._path('/proc', bounds) as proc:
            return self._observe_held(group, proc, bounds)

    def shutdown(self, spec, inspect):
        """No default inspector or dispatch: exact owner inspection is mandatory.

        The future inspector must authenticate the local Docker transport and
        enforce call limits. Only a fresh owned live container and verified held
        cgroup FD can reach the one-byte write. Success is dispatch ONLY; the
        existing lifecycle still needs two complete terminal/empty observations.
        """
        executor.require(spec == executor.shutdown_spec(self.identity) and callable(inspect),
                         'Exact owned shutdown request and inspector required')
        bounds = self._deadline()
        with self._path(self.identity.cgroup_path, bounds) as group, self._path('/proc', bounds) as proc:
            observation = self._observe_held(group, proc, bounds)
            state = executor.inspect_state(inspect(executor.docker_spec('inspect', self.identity)), self.identity)
            executor.require(state['running'], 'Kernel shutdown requires owned live container')
            executor.require(observation['members'].get(self.identity.leader_pid) == self.identity.leader_starttime,
                             'Owned live leader missing from pinned cgroup')
            self._tick(bounds)
            # Keep the original verified directory open across inspection and
            # write; a later pathname replacement never redirects this write.
            self._pinned(group)
            with self._path(self.identity.cgroup_path, bounds) as current:
                self._pinned(current)
            self._tick(bounds)
            target = self.io.open('cgroup.kill', WRITE_FLAGS, group)
            try:
                info = self.io.fstat(target)
                executor.require(stat.S_ISREG(info.st_mode) and info.st_nlink > 0 and
                                 info.st_dev == self.identity.cgroup_device, 'Unexpected cgroup kill file')
                self._tick(bounds)
                written = self.io.write(target, b'1')
                executor.require(type(written) is int and written == 1, 'Kernel kill write incomplete')
                self._tick(bounds)
                return True
            finally:
                self.io.close(target)
