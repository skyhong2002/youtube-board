"""Fixed local Docker CLI backend source; never invoked on import/construction.

Only inspect/pause/unpause for one pinned owned container are supported. There is
no launcher, exec/build/image/kill/stop/removal operation, admission grant, lease,
watchdog or CLI entrypoint. The existing Executor must authenticate admission and
physical cgroup state; this lower-level backend cannot authorize runtime use.

System IO is available only through explicit methods. Tests inject file syscalls,
Popen, selector/read, clocks and inspections; no actual Docker call is required.
Kernel tool IO is capped/checks deadlines but cannot hard-preempt a syscall.
"""
from contextlib import contextmanager
from dataclasses import asdict, dataclass, fields, is_dataclass
import hashlib
import importlib.util
import json
import math
import os
from pathlib import Path
import re
import selectors
import stat
import subprocess
import sys
import time

_name = 'youtube_native_arm64_executor_for_docker_io'
_spec = importlib.util.spec_from_file_location(_name, Path(__file__).with_name('native-arm64-executor.py'))
executor = importlib.util.module_from_spec(_spec)
sys.modules[_name] = executor
_spec.loader.exec_module(executor)

OUTPUT_CAP = 65536
TOOL_CAP = 128 * 1024 * 1024
DIR_FLAGS = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC
FILE_FLAGS = os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC | os.O_NONBLOCK


@dataclass(frozen=True)
class ToolPin:
    sha256: str
    device: int
    inode: int
    size: int
    mode: int

    def __post_init__(self):
        executor.require(isinstance(self.sha256, str) and re.fullmatch(r'[0-9a-f]{64}', self.sha256) and
                         type(self.device) is int and self.device >= 0 and
                         type(self.inode) is int and self.inode > 0 and
                         type(self.size) is int and 20 <= self.size <= TOOL_CAP and
                         type(self.mode) is int and 0 <= self.mode <= 0o777 and
                         self.mode & 0o111 and not self.mode & 0o022,
                         'Explicit protected Docker tool pin required')


class ToolIO:
    def open(self, name, flags, parent=None): return os.open(name, flags, dir_fd=parent)
    def close(self, fd): os.close(fd)
    def fstat(self, fd): return os.fstat(fd)
    def read(self, fd, count): return os.read(fd, count)


class BoundedRunner:
    def __init__(self, popen=None, selector=None, read=None):
        self.popen = subprocess.Popen if popen is None else popen
        self.selector = selectors.DefaultSelector if selector is None else selector
        self.read = os.read if read is None else read

    def run(self, argv, fd, env, bounds, clock):
        process = None
        poller = None
        output = {'stdout': bytearray(), 'stderr': bytearray()}
        def remaining():
            now = clock()
            executor.require(type(now) in (int, float) and math.isfinite(now) and bounds[0] <= now < bounds[1],
                             'Docker CLI deadline/clock unavailable')
            bounds[0] = now
            return bounds[1] - now
        try:
            remaining()
            process = self.popen(argv, executable='/proc/self/fd/' + str(fd), pass_fds=(fd,),
                                 stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                 cwd='/', env=env, start_new_session=True)
            poller = self.selector()
            poller.register(process.stdout, selectors.EVENT_READ, 'stdout')
            poller.register(process.stderr, selectors.EVENT_READ, 'stderr')
            total = 0
            while poller.get_map():
                for key, _ in poller.select(min(.1, remaining())):
                    remaining()
                    part = self.read(key.fileobj.fileno(), min(4096, OUTPUT_CAP + 1 - total))
                    executor.require(isinstance(part, bytes), 'Unknown Docker CLI pipe read')
                    if not part:
                        poller.unregister(key.fileobj)
                        continue
                    total += len(part)
                    executor.require(total <= OUTPUT_CAP, 'Docker CLI output over cap')
                    output[key.data].extend(part)
            code = process.wait(timeout=remaining())
            remaining()
            executor.require(type(code) is int, 'Unknown Docker CLI terminal status')
            return code, bytes(output['stdout']), bytes(output['stderr'])
        except Exception:
            if process is not None:
                # Only our fixed local CLI child; never a daemon/container/job.
                try:
                    if process.poll() is None: process.kill()
                    process.wait(timeout=.5)
                except Exception:
                    pass
            raise ValueError('Docker CLI response unavailable/unknown') from None
        finally:
            if poller is not None: poller.close()
            if process is not None:
                for stream in (process.stdout, process.stderr):
                    if stream is not None: stream.close()


def inspect_template():
    # No Env, command, raw mounts/binds, arbitrary labels, credentials or daemon
    # Error strings are requested. Nonempty mounts/binds are unsupported markers.
    def value(path): return '{{json .' + path + '}}'
    labels = ','.join(json.dumps(label) + ':{{json (index .Config.Labels ' + json.dumps(label) + ')}}'
                      for label in executor.LABELS.values())
    state = ','.join(json.dumps(key) + ':' + value('State.' + key) for key in
                     ('StartedAt', 'FinishedAt', 'Running', 'Paused', 'Pid', 'Status', 'Restarting', 'Dead', 'ExitCode'))
    host = ','.join(json.dumps(key) + ':' + value('HostConfig.' + key) for key in
                    ('Privileged', 'PidMode', 'NetworkMode', 'CgroupnsMode', 'CapAdd', 'CapDrop',
                     'SecurityOpt', 'AutoRemove', 'RestartPolicy'))
    return ('[{"Id":' + value('Id') + ',"Image":' + value('Image') + ',"RestartCount":' + value('RestartCount') +
            ',"Mounts":{{if .Mounts}}[{"unsupported":true}]{{else}}[]{{end}},"Config":{"Labels":{' + labels +
            '}},"State":{' + state + '},"HostConfig":{' + host +
            ',"Binds":{{if .HostConfig.Binds}}["unsupported"]{{else}}null{{end}},' +
            '"Devices":{{if .HostConfig.Devices}}["unsupported"]{{else}}[]{{end}}}}]')


class DockerBackend:
    def __init__(self, identity, tool_pin, io=None, runner=None, clock=None):
        executor.require(is_dataclass(identity) and not isinstance(identity, type), 'Typed owned identity required')
        data = asdict(identity)
        executor.require(set(data) == {f.name for f in fields(executor.Identity)}, 'Identity contract changed')
        self.identity = executor.Identity(**data)
        executor.require(isinstance(tool_pin, ToolPin), 'Explicit Docker tool pin required')
        self.pin = tool_pin
        self.io = ToolIO() if io is None else io
        self.runner = BoundedRunner() if runner is None else runner
        self.clock = time.monotonic if clock is None else clock

    def _tick(self, bounds):
        now = self.clock()
        executor.require(type(now) in (int, float) and math.isfinite(now) and bounds[0] <= now < bounds[1],
                         'Docker backend deadline/clock unavailable')
        bounds[0] = now

    def _match(self, info):
        executor.require(stat.S_ISREG(info.st_mode) and info.st_uid == 0 and info.st_gid == 0 and
                         info.st_nlink > 0 and (info.st_dev, info.st_ino, info.st_size, stat.S_IMODE(info.st_mode)) ==
                         (self.pin.device, self.pin.inode, self.pin.size, self.pin.mode),
                         'Docker tool filesystem identity changed')

    @contextmanager
    def _tool(self, bounds):
        opened = []
        try:
            fd = self.io.open('/', DIR_FLAGS)
            opened.append(fd)
            for component in (None, 'usr', 'bin'):
                if component is not None:
                    self._tick(bounds)
                    fd = self.io.open(component, DIR_FLAGS, fd)
                    opened.append(fd)
                info = self.io.fstat(fd)
                executor.require(stat.S_ISDIR(info.st_mode) and info.st_uid == 0 and
                                 info.st_nlink > 0 and not stat.S_IMODE(info.st_mode) & 0o022,
                                 'Protected Docker tool directory required')
            self._tick(bounds)
            fd = self.io.open('docker', FILE_FLAGS, fd)
            opened.append(fd)
            before = self.io.fstat(fd)
            self._match(before)
            digest, total, header = hashlib.sha256(), 0, b''
            for _ in range(self.pin.size // (1024 * 1024) + 2):
                self._tick(bounds)
                chunk = self.io.read(fd, min(1024 * 1024, self.pin.size + 1 - total))
                executor.require(isinstance(chunk, bytes), 'Unknown Docker tool read')
                if not chunk: break
                if not header: header = chunk[:20]
                total += len(chunk)
                executor.require(total <= self.pin.size, 'Docker tool byte cap exceeded')
                digest.update(chunk)
            after = self.io.fstat(fd)
            self._match(after)
            executor.require(total == self.pin.size and digest.hexdigest() == self.pin.sha256 and
                             header[:6] == b'\x7fELF\x02\x01' and int.from_bytes(header[18:20], 'little') == 183 and
                             (before.st_mtime_ns, before.st_ctime_ns) == (after.st_mtime_ns, after.st_ctime_ns),
                             'Exact stable ARM64 ELF Docker tool required')
            self._tick(bounds)
            yield fd
        finally:
            for fd in reversed(opened): self.io.close(fd)

    def _execute(self, operation):
        spec = executor.docker_spec(operation, self.identity)
        now = self.clock()
        executor.require(type(now) in (int, float) and math.isfinite(now), 'Unknown Docker backend clock')
        bounds = [now, now + spec['timeoutSeconds']]
        argv = list(spec['argv'])
        if operation == 'inspect':
            argv[2:2] = ['--format', inspect_template()]
        with self._tool(bounds) as fd:
            code, stdout, stderr = self.runner.run(argv, fd, dict(spec['env']), bounds, self.clock)
        self._tick(bounds)
        executor.require(type(code) is int and code == 0 and isinstance(stdout, bytes) and isinstance(stderr, bytes) and
                         len(stdout) + len(stderr) <= OUTPUT_CAP, 'Docker CLI response failed/unknown')
        return stdout, stderr

    def inspect(self, spec):
        executor.require(spec == executor.docker_spec('inspect', self.identity), 'Altered inspection request')
        stdout, stderr = self._execute('inspect')
        executor.require(not stderr, 'Docker inspection emitted diagnostic/unknown response')
        try:
            def unique_object(pairs):
                result = {}
                for key, item in pairs:
                    executor.require(key not in result, 'Duplicate Docker projection key')
                    result[key] = item
                return result
            value = json.loads(stdout, object_pairs_hook=unique_object)
            executor.inspect_state(value, self.identity)
            # Strict projected keys prevent a mocked/alternate transport returning
            # unexpected data from being exposed to a caller as sanitized output.
            row = value[0]
            executor.require(set(row) == {'Id', 'Image', 'RestartCount', 'Mounts', 'Config', 'State', 'HostConfig'} and
                             set(row['Config']) == {'Labels'} and set(row['Config']['Labels']) == set(executor.LABELS.values()) and
                             set(row['State']) == {'StartedAt', 'FinishedAt', 'Running', 'Paused', 'Pid', 'Status',
                                                  'Restarting', 'Dead', 'ExitCode'} and
                             set(row['HostConfig']) == {'Privileged', 'PidMode', 'NetworkMode', 'CgroupnsMode', 'CapAdd',
                                                       'CapDrop', 'SecurityOpt', 'AutoRemove', 'RestartPolicy', 'Binds', 'Devices'},
                             'Unexpected Docker inspection fields')
            executor.timestamp(row['State']['FinishedAt'])
            executor.require(type(row['State']['ExitCode']) is int and
                             row['HostConfig']['CapDrop'] == ['ALL'] and
                             row['HostConfig']['SecurityOpt'] == ['no-new-privileges:true'] and
                             row['HostConfig']['Devices'] == [], 'Unexpected Docker projection values')
            return value
        except Exception:
            raise ValueError('Docker identity projection unavailable/mismatched') from None

    def dispatch(self, spec):
        operations = [op for op in ('pause', 'unpause') if spec == executor.docker_spec(op, self.identity)]
        executor.require(len(operations) == 1, 'Unsupported/altered lifecycle request')
        operation = operations[0]
        state = executor.inspect_state(self.inspect(executor.docker_spec('inspect', self.identity)), self.identity)
        executor.require(state['running'] and (operation != 'unpause' or state['paused']),
                         'Owned current lifecycle state required')
        stdout, stderr = self._execute(operation)
        executor.require(not stderr and stdout.strip() == self.identity.container_id.encode('ascii'),
                         'Owned Docker dispatch acknowledgement unknown')
        # Dispatch acknowledgement is not physical STOP/resume proof or admission.
        return True
