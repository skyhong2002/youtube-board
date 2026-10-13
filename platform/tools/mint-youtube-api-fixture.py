"""OPS-only Mint synthetic DB/API supervisor; preview by default.

Only --execute starts local owned children, after an exact reviewed source receipt,
explicit fixture-only admission, acknowledged tag->YT slot, current host health and
actual common flock. No SSH, package install, build, production fallback or account
operation exists here. Native remote executor/STOP remains a separate pending scope.
The durable coordinator reservation is never released by this supervisor.
"""
import argparse
import datetime as dt
import fcntl
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import selectors
import signal
import socket
import subprocess
import time

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('yt_native_admission', HERE / 'native-arm64-admission.py')
admission = importlib.util.module_from_spec(spec)
import sys
sys.modules[spec.name] = admission
spec.loader.exec_module(admission)
gate_spec = importlib.util.spec_from_file_location('yt_fixture_gate', HERE / 'mint-youtube-fixture-gate.py')
gate = importlib.util.module_from_spec(gate_spec)
gate_spec.loader.exec_module(gate)
APP_SHA = admission.APP_SHA
LOCK_PATH = admission.LOCK_PATH
DB_NAME = 'youtube_board_test_rewrite'
TOOLS_ROOT = '/home/sky/observe-worker/db-tools/root/usr'


def require(value, code):
    if not value:
        raise ValueError(code)


def utc():
    return dt.datetime.now(dt.timezone.utc)


def private_json(path):
    p = Path(path)
    require(not p.is_symlink(), 'PRIVATE_JSON_SYMLINK')
    s = p.stat()
    require(s.st_uid == os.getuid() and s.st_mode & 0o077 == 0 and s.st_size <= 1024 * 1024 and p.is_file(), 'PRIVATE_JSON_REQUIRED')
    return json.loads(p.read_text())


def canonical(value):
    require(admission.absolute_path(value) and str(Path(value).resolve()) == value, 'CANONICAL_PRIVATE_PATH_REQUIRED')
    return Path(value)


def contract(config):
    require(config.get('schema') == 'yt-fixture-config-v1' and config.get('appSha') == APP_SHA, 'EXACT_APP_CONFIG_REQUIRED')
    return admission.Contract(config['opsSha'], config['owner'], config['generation'], config['lockfileSha256'],
                              config['baseDigest'], str(canonical(config['appRoot'])), tuple(config['machineIds']), tuple(config['knownHostsSha256']))


def binding_failures(packet, c, now, starting=True):
    """Fixture admission is deliberately separate from BUILD preparation/readiness."""
    failures = []
    if not isinstance(packet, dict):
        return ['BOOTSTRAP_PACKET_REQUIRED']
    boot = packet.get('bootstrap', {})
    if not (admission.bound(boot, c) and boot.get('schema') == 'yt-fixture-bootstrap-admission-v1' and
            boot.get('scope') == 'mint-youtube-synthetic-fixture' and boot.get('state') == 'admitted' and
            boot.get('operatorExecutionAuthorized') is True and admission.fresh(boot.get('observedAt'), now, 30)):
        failures.append('FRESH_EXPLICIT_FIXTURE_ADMISSION_REQUIRED')
    slot = packet.get('slot', {})
    if not (admission.bound(slot, c) and slot.get('schema') == 'yt-global-slot-v1' and
            admission.fresh(slot.get('verifiedAt'), now, 120) and slot.get('globalSingleBuildSlotGranted') is True and
            slot.get('remoteHostsAccounted') is True and slot.get('queueReleasedForYT') is True and
            slot.get('otherOwnersIdle') is True and slot.get('previousOwner') == 'tag' and
            isinstance(slot.get('operatorMessage'), str) and slot['operatorMessage'].strip()):
        failures.append('ACKNOWLEDGED_TAG_TO_YT_SLOT_REQUIRED')
    reserve = packet.get('reservation', {})
    if not (admission.bound(reserve, c) and reserve.get('schema') == 'yt-reservation-v1' and
            reserve.get('durable') is True and reserve.get('held') is True and
            reserve.get('releaseRequiresRemoteTerminalProof') is True and
            admission.fresh(reserve.get('observedAt'), now, 30)):
        failures.append('DURABLE_RESERVATION_REQUIRED')
    # Legacy all-host time/direct-Mint verdicts do not grant fixture admission.
    failures.extend(gate.packet_health_failures(packet, c, now))
    return failures


def source_tree(root):
    def git(*args):
        return subprocess.check_output(['/usr/bin/git', '-C', str(root), *args], stderr=subprocess.DEVNULL, timeout=10)
    require(not git('status', '--porcelain', '--untracked-files=all').strip(), 'CLEAN_SOURCE_REQUIRED')
    paths = git('ls-files', '-z').split(b'\0')
    manifest = []
    for raw in paths:
        if not raw:
            continue
        name = raw.decode('utf8')
        p = root / name
        require(p.is_file() and not p.is_symlink() and p.resolve().is_relative_to(root), 'REGULAR_TRACKED_SOURCE_REQUIRED')
        manifest.append([name, hashlib.sha256(p.read_bytes()).hexdigest()])
    return git('rev-parse', 'HEAD').decode().strip(), hashlib.sha256(json.dumps(manifest, separators=(',', ':')).encode()).hexdigest()


def dependency_tree(root):
    """Hash installed dependency bytes and internal links; no install or mutation."""
    base = root / 'platform/node_modules'
    require(base.is_dir() and not base.is_symlink() and base.resolve() == base, 'CANONICAL_DEPENDENCY_TREE_REQUIRED')
    manifest, total = [], 0
    for directory, dirs, files in os.walk(base, followlinks=False):
        for name in sorted(dirs + files):
            path = Path(directory) / name
            relative = str(path.relative_to(base))
            require(len(manifest) < 50000, 'DEPENDENCY_FILE_COUNT_CAP')
            if path.is_symlink():
                target = path.resolve(strict=True)
                require(target.is_relative_to(root), 'EXTERNAL_DEPENDENCY_LINK_DENIED')
                manifest.append([relative, 'link', os.readlink(path)])
            elif path.is_file():
                size = path.stat().st_size
                total += size
                require(total <= 2 * 1024 ** 3, 'DEPENDENCY_BYTE_CAP')
                hasher = hashlib.sha256()
                with path.open('rb') as stream:
                    for chunk in iter(lambda: stream.read(1048576), b''):
                        hasher.update(chunk)
                manifest.append([relative, 'file', hasher.hexdigest()])
            else:
                require(path.is_dir(), 'REGULAR_DEPENDENCY_REQUIRED')
    require(manifest, 'NONEMPTY_DEPENDENCY_TREE_REQUIRED')
    return hashlib.sha256(json.dumps(sorted(manifest), separators=(',', ':')).encode()).hexdigest()


def verify_source(config, c):
    require(canonical(config['opsRoot']) / 'platform/tools' == HERE and
            Path(admission.__file__).resolve() == HERE / 'native-arm64-admission.py', 'EXECUTING_OPS_ROOT_MISMATCH')
    receipt_path = canonical(config['sourceReceipt'])
    require(not receipt_path.is_symlink() and hashlib.sha256(receipt_path.read_bytes()).hexdigest() == config.get('sourceReceiptSha256'), 'PINNED_SOURCE_RECEIPT_REQUIRED')
    receipt = private_json(receipt_path)
    require(admission.bound(receipt, c) and receipt.get('schema') == 'yt-fixture-source-review-v1' and
            receipt.get('sourceApproved') is True and isinstance(receipt.get('reviewedBy'), str) and
            receipt['reviewedBy'] != '/root/f2_visual_sol', 'INDEPENDENT_SOURCE_REVIEW_REQUIRED')
    review = canonical(receipt['reviewReceipt'])
    require(hashlib.sha256(review.read_bytes()).hexdigest() == receipt.get('reviewReceiptSha256'), 'SOURCE_REVIEW_RECEIPT_MISMATCH')
    for key, pin in [('appRoot', APP_SHA), ('opsRoot', c.ops_sha)]:
        head, digest = source_tree(canonical(config[key]))
        require(head == pin and digest == receipt.get(key + 'TreeSha256'), 'EXACT_SOURCE_TREE_MISMATCH')
    require(hashlib.sha256((Path(c.source_root) / 'platform/package-lock.json').read_bytes()).hexdigest() == c.lockfile_sha256, 'APP_LOCKFILE_MISMATCH')
    require(receipt.get('dependencyTreeSha256') == config.get('dependencyTreeSha256') and dependency_tree(canonical(config['appRoot'])) == config['dependencyTreeSha256'], 'INSTALLED_DEPENDENCY_TREE_MISMATCH')
    for name in ['nodeBinary', 'mariadbd', 'installDb']:
        p = canonical(config[name])
        require(p.is_file() and hashlib.sha256(p.read_bytes()).hexdigest() == receipt.get(name + 'Sha256'), 'RUNTIME_TOOL_PIN_MISMATCH')


def acquire_lock(inherited_fd=None):
    if inherited_fd is None:
        fd = os.open(LOCK_PATH, os.O_RDWR | os.O_NOFOLLOW)
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BaseException:
            os.close(fd)
            raise
        holder = os.getpid()
    else:
        fd = os.dup(inherited_fd)
        holder = os.getppid()
    s = os.fstat(fd)
    actual = os.stat(LOCK_PATH, follow_symlinks=False)
    require((s.st_dev, s.st_ino) == (actual.st_dev, actual.st_ino), 'COMMON_LOCK_INODE_MISMATCH')
    verify_lock(fd, holder)
    return fd, holder


def verify_lock(fd, holder):
    s = os.fstat(fd)
    actual = os.stat(LOCK_PATH, follow_symlinks=False)
    require((s.st_dev, s.st_ino) == (actual.st_dev, actual.st_ino), 'COMMON_LOCK_CHANGED')
    kernel_key = f'{os.major(s.st_dev):02x}:{os.minor(s.st_dev):02x}:{s.st_ino}'
    lines = Path('/proc/locks').read_text().splitlines()
    require(any(len(x) >= 6 and x[1] == 'FLOCK' and x[3] == 'WRITE' and int(x[4]) == holder and
                x[5] == kernel_key for x in [line.split() for line in lines]), 'LIVE_KERNEL_FLOCK_REQUIRED')


def child_env(config, fd):
    # Explicit allowlist; never copy DATABASE_URL, cookies, provider keys, OAuth or proxy env.
    return {'PATH': '/usr/bin:/bin', 'LANG': 'C.UTF-8', 'TZ': 'UTC', 'NODE_ENV': 'test',
            'DATASET_KIND': 'fixture', 'NEXT_TELEMETRY_DISABLED': '1', 'MINT_YT_LOCK_FD': str(fd)}


def write_private(path, value):
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, 'w') as stream:
        stream.write(json.dumps(value, indent=2) + '\n')


def owned_identity(pid):
    raw = Path(f'/proc/{pid}/stat').read_text()
    fields = raw[raw.rfind(')') + 2:].split()
    return {'pid': pid, 'pgid': int(fields[2]), 'session': int(fields[3]), 'startTicks': fields[19]}


def group_members(identity):
    members = []
    for p in Path('/proc').iterdir():
        if not p.name.isdecimal():
            continue
        try:
            row = owned_identity(int(p.name))
        except FileNotFoundError:
            continue
        if row['pgid'] == identity['pgid'] and row['session'] == identity['session']:
            members.append(row)
    return members


def stop_owned(children, timeout=10):
    """Local fixture children only. Never signals a remote build or shared daemon."""
    for child, identity in reversed(children):
        require(identity is not None, 'STOP_UNCONFIRMED_CHILD_IDENTITY_UNKNOWN')
        members = group_members(identity)
        if members:
            require(child.poll() is None and owned_identity(child.pid) == identity, 'STOP_UNCONFIRMED_IDENTITY_CHANGED')
            os.killpg(identity['pgid'], signal.SIGTERM)
    end = time.monotonic() + timeout
    while time.monotonic() < end:
        for child, _ in children:
            child.poll()
        if all(not group_members(identity) for _, identity in children):
            return {'localFixtureChildrenTerminal': True, 'remoteStopProof': False, 'reservationReleaseAllowed': False}
        time.sleep(0.1)
    raise ValueError('STOP_UNCONFIRMED_RETAIN_RESERVATION')


def register_child(children, child):
    # Custody begins immediately after Popen, before any fallible /proc read.
    children.append((child, None))
    identity = owned_identity(child.pid)
    require(identity['pgid'] == child.pid and identity['session'] == child.pid, 'OWNED_CHILD_SESSION_REQUIRED')
    children[-1] = (child, identity)


def start_fixture(config, deps=None):
    """Run only after explicit execute. Dependencies injectable for no-start mocks."""
    d = deps or {}
    c = contract(config)
    (d.get('verify_source') or verify_source)(config, c)
    packet = private_json(config['admissionPath'])
    require(not binding_failures(packet, c, utc()), 'ADMISSION_OR_HEALTH_DENIED')
    if config.get('serve') is True:
        require(packet['bootstrap'].get('servingAuthorized') is True, 'SERVING_ADMISSION_REQUIRED')
    require(Path('/etc/machine-id').read_text().strip() == c.machine_ids[1], 'ACTUAL_MINT_REQUIRED')
    workspace = canonical(config['workspace'])
    require(workspace.is_relative_to(Path('/var/lib/observe-worker/youtube')) and workspace != Path('/var/lib/observe-worker/youtube'), 'PRIVATE_YT_WORKSPACE_REQUIRED')
    require(workspace.is_dir() and workspace.stat().st_uid == os.getuid() and workspace.stat().st_mode & 0o077 == 0, 'PRIVATE_YT_WORKSPACE_REQUIRED')
    require(config['mariadbd'] == TOOLS_ROOT + '/sbin/mariadbd' and config['installDb'] == TOOLS_ROOT + '/bin/mariadb-install-db', 'PINNED_DB_TOOLS_REQUIRED')
    fd, holder = (d.get('acquire_lock') or acquire_lock)(config.get('guardFd'))
    children, logs = [], []
    runtime = workspace / ('fixture-' + c.generation)
    stop_proof = None
    def guard(starting=False):
        verify_lock(fd, holder)
        current_packet = private_json(config['admissionPath'])
        require(not binding_failures(current_packet, c, utc(), starting=starting), 'GUARD_ADMISSION_LOST')
        if config.get('serve') is True:
            require(current_packet['bootstrap'].get('servingAuthorized') is True, 'SERVING_ADMISSION_REVOKED')
        require(all(os.fstat(log.fileno()).st_size <= 8 * 1024 * 1024 for log in logs), 'FIXTURE_LOG_BUDGET_EXCEEDED')
    def spawn(argv, log_name, pipe=False):
        guard(True)
        log = open(runtime / log_name, 'xb'); logs.append(log)
        child = subprocess.Popen(['/usr/bin/nice', '-n', '19', '/usr/bin/ionice', '-c', '3', *argv],
                                 cwd=workspace, env=child_env(config, fd), pass_fds=(fd,), start_new_session=True,
                                 stdout=subprocess.PIPE if pipe else log, stderr=log)
        register_child(children, child)
        return child
    try:
        guard(True)
        runtime.mkdir(mode=0o700)  # Existing generation never reused or deleted.
        datadir = runtime / 'db'
        sock = runtime / 'mysql.sock'
        require(len(str(sock).encode()) < 104, 'PRIVATE_SOCKET_PATH_TOO_LONG')
        for port in [23306, 23800]:
            with socket.socket() as check:
                check.bind(('127.0.0.1', port))  # Collision denies; never adopt another listener.
        version = subprocess.check_output([config['nodeBinary'], '--version'], env=child_env(config, fd), timeout=5).decode().strip()
        require(version == 'v24.15.0', 'NODE_RUNTIME_MISMATCH')
        init = spawn([config['installDb'], '--no-defaults', '--basedir=' + TOOLS_ROOT, '--datadir=' + str(datadir), '--auth-root-authentication-method=normal', '--skip-test-db'], 'init.log')
        require(init.wait(timeout=20) == 0, 'PRIVATE_DB_INIT_FAILED')
        guard(True)
        db = spawn([config['mariadbd'], '--no-defaults', '--basedir=' + TOOLS_ROOT, '--datadir=' + str(datadir), '--socket=' + str(sock), '--pid-file=' + str(runtime / 'mysql.pid'), '--bind-address=127.0.0.1', '--port=23306', '--skip-log-bin', '--event-scheduler=OFF', '--max-connections=12', '--innodb-buffer-pool-size=67108864'], 'mariadb.log')
        end = time.monotonic() + 15
        while not sock.exists() and time.monotonic() < end:
            guard(); require(db.poll() is None, 'PRIVATE_DB_EXITED'); time.sleep(0.1)
        require(sock.exists(), 'PRIVATE_DB_SOCKET_TIMEOUT')
        worker_config = {**c.binding(), 'appRoot': c.source_root, 'datadir': str(datadir), 'socket': str(sock),
                         'admissionPath': config['admissionPath'], 'bindAddress': '127.0.0.1', 'databasePort': 23306,
                         'apiPort': 23800, 'database': DB_NAME, 'dataset': 'fixture', 'fixtureClock': config['fixtureClock'],
                         'servingAuthorized': config.get('serve') is True,
                         'lockFd': fd, 'lockHolderPid': holder, 'lockInode': os.fstat(fd).st_ino,
                         'lockKernelKey': f'{os.major(os.fstat(fd).st_dev):02x}:{os.minor(os.fstat(fd).st_dev):02x}:{os.fstat(fd).st_ino}',
                         'supervisorPid': os.getpid()}
        worker_path = runtime / 'worker.json'
        write_private(worker_path, worker_config)
        loader = str(Path(c.source_root) / 'platform/node_modules/tsx/dist/loader.mjs')
        api = spawn([config['nodeBinary'], '--import', loader, str(canonical(config['opsRoot']) / 'platform/tools/mint-youtube-api-worker.mjs'), str(worker_path)], 'api.log', pipe=True)
        selector = selectors.DefaultSelector(); selector.register(api.stdout, selectors.EVENT_READ)
        startup = None; end = time.monotonic() + 25; output = b''
        os.set_blocking(api.stdout.fileno(), False)
        while startup is None and time.monotonic() < end:
            guard(); require(api.poll() is None and db.poll() is None, 'FIXTURE_CHILD_EXITED')
            if selector.select(0.2):
                output += os.read(api.stdout.fileno(), 65537)
                require(len(output) <= 65536, 'BOUNDED_STARTUP_RECEIPT_REQUIRED')
                if b'\n' in output:
                    line, rest = output.split(b'\n', 1)
                    require(not rest.strip(), 'SINGLE_STARTUP_RECEIPT_REQUIRED')
                    startup = json.loads(line)
        selector.close()
        require(startup is not None and startup.get('ready') is True and startup.get('appSha') == APP_SHA and startup.get('opsSha') == c.ops_sha, 'ACTUAL_FIXTURE_READINESS_REQUIRED')
        receipt = {'schema': 'yt-fixture-supervisor-v1', **c.binding(), 'observedAt': utc().isoformat(),
                   'scope': 'actual local isolated fixture subset only', 'startup': startup,
                   'remoteBuildStarted': False, 'nativeExecutorAccepted': False, 'reservationReleaseAllowed': False}
        write_private(runtime / 'startup-receipt.json', receipt)
        if config.get('serve') is True:
            require(private_json(config['admissionPath'])['bootstrap'].get('servingAuthorized') is True, 'SERVING_ADMISSION_REQUIRED')
            while True:
                guard(); require(api.poll() is None and db.poll() is None, 'FIXTURE_CHILD_EXITED'); time.sleep(1)
        return receipt
    finally:
        try:
            stop_proof = stop_owned(children)
            if runtime.exists():
                write_private(runtime / 'terminal-receipt.json', {'observedAt': utc().isoformat(), **c.binding(), **stop_proof, 'ready': False})
        finally:
            for log in logs:
                log.close()
            # Local fixture lock ends only after all owned children are terminal.
            # No coordinator reservation release or remote terminal claim follows.
            if stop_proof is not None:
                os.close(fd)
            else:
                # Retain the actual flock and reservation on unconfirmed stop.
                while True:
                    time.sleep(1)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--config', required=True)
    parser.add_argument('--execute', action='store_true')
    args = parser.parse_args()
    config = private_json(args.config)
    c = contract(config)
    if not args.execute:
        print(json.dumps({'mode': 'preview', **c.binding(), 'executionAllowed': False, 'runtimeReady': False,
                          'scope': 'local Mint fixture only; no build/native executor acceptance'}))
        return
    try:
        result = start_fixture(config)
        print(json.dumps({**result, 'ready': False, 'status': 'verified-subset-and-owned-children-stopped'}))
    except (KeyboardInterrupt, Exception):
        print('{"error":"ISOLATED_FIXTURE_SUPERVISOR_FAILED","reservationReleaseAllowed":false}', file=sys.stderr)
        raise SystemExit(1)


if __name__ == '__main__':
    main()
