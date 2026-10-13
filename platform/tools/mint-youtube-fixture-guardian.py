"""Fixture-only coordination supplement; import and default CLI are inert.

This file does not relabel the OPS5a supervisor or APP70529. Execution needs a
separately reviewed config and authority/probe adapters. No such authority adapter
or shared registry adoption is claimed here. Unknown custody never clears the
durable reservation. Native build, Docker, capture and provider work are absent.
"""
import argparse
import datetime as dt
import fcntl
import hashlib
import importlib.util
import json
import os
import re
from pathlib import Path
import signal
import stat
import subprocess
import sys
import time

APP = '70529cff13b6b7f5b3e0571a229e2b61660f9df4'
OPS = '5a5be6833ee2f32d35bce021db43d3627fdd7c8f'
ADMISSION_SOURCE_SHA256 = 'adea516d2f10f2c5412902183dfb1341565a0551ec9e720e4a7178d99f995a58'
LOCK = '/run/lock/mint-global-build.lock'
REGISTRY = '/var/lib/observe-worker/global-slot/reservation.json'
GIB = 1024 ** 3
HERE = Path(__file__).resolve()
ENV = {'PATH': '/usr/bin:/bin', 'LANG': 'C.UTF-8', 'TZ': 'UTC', 'PYTHONDONTWRITEBYTECODE': '1'}


def require(condition, code):
    if not condition:
        raise ValueError(code)


def utc():
    return dt.datetime.now(dt.timezone.utc)


def digest(raw):
    return hashlib.sha256(raw).hexdigest()


def unique(pairs):
    result = {}
    for key, value in pairs:
        require(key not in result, 'DUPLICATE_JSON_FIELD')
        result[key] = value
    return result


def private_read(path, expected=None):
    """FD-bound bounded read; never follows a symlink or reads env/provider state."""
    p = Path(path)
    require(p.is_absolute() and str(p.resolve()) == str(p), 'CANONICAL_PATH_REQUIRED')
    fd = os.open(p, os.O_RDONLY | os.O_NOFOLLOW)
    try:
        s = os.fstat(fd)
        require(stat.S_ISREG(s.st_mode) and s.st_uid == os.getuid() and s.st_mode & 0o077 == 0 and s.st_size <= 1048576, 'PRIVATE_FILE_REQUIRED')
        raw = os.read(fd, 1048577)
        require(len(raw) == s.st_size and len(raw) <= 1048576, 'BOUNDED_STABLE_FILE_REQUIRED')
        if expected is not None:
            require(digest(raw) == expected, 'PINNED_FILE_MISMATCH')
        return raw
    finally:
        os.close(fd)


def json_private(path, expected=None):
    return json.loads(private_read(path, expected), object_pairs_hook=unique)


def persist(path, value, *, exclusive=False):
    """Atomic replace plus file/directory fsync; reservation is never deleted."""
    path = Path(path)
    parent = path.parent
    s = parent.lstat()
    require(stat.S_ISDIR(s.st_mode) and s.st_uid == os.getuid() and s.st_mode & 0o077 == 0 and str(parent.resolve()) == str(parent), 'PRIVATE_DIRECTORY_REQUIRED')
    raw = (json.dumps(value, sort_keys=True, separators=(',', ':')) + '\n').encode()
    require(len(raw) <= 1048576, 'RECORD_CAP')
    temp = path if exclusive else parent / (path.name + '.next-' + str(os.getpid()))
    fd = os.open(temp, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    try:
        with os.fdopen(fd, 'wb') as stream:
            stream.write(raw)
            stream.flush()
            os.fsync(stream.fileno())
        if not exclusive:
            os.replace(temp, path)
        directory = os.open(parent, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        try:
            os.fsync(directory)
        finally:
            os.close(directory)
    except BaseException:
        # Preserve uncertain bytes/state for diagnosis; no automatic deletion.
        raise


def load_pinned(path, sha256, name):
    p = Path(path)
    require(p.is_absolute() and str(p.resolve()) == str(p) and p.is_file() and not p.is_symlink() and digest(p.read_bytes()) == sha256, 'REVIEWED_ADAPTER_SOURCE_REQUIRED')
    spec = importlib.util.spec_from_file_location(name, p)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    old = sys.dont_write_bytecode
    sys.dont_write_bytecode = True
    try:
        spec.loader.exec_module(module)
    finally:
        sys.dont_write_bytecode = old
    return module


def reviewed_config(path, review_path, review_sha):
    raw = private_read(path)
    config = json.loads(raw, object_pairs_hook=unique)
    review = json_private(review_path, review_sha)
    require(review.get('schema') == 'yt-fixture-guardian-execution-review-v1' and review.get('decision') == 'accepted-fixture-only' and review.get('configSha256') == digest(raw) and review.get('guardianSha256') == digest(HERE.read_bytes()) and isinstance(review.get('reviewedBy'), str) and review['reviewedBy'] not in ('', '/root/f2_visual_sol'), 'INDEPENDENT_EXACT_CONFIG_REVIEW_REQUIRED')
    require(config.get('schema') == 'yt-fixture-guardian-config-v1' and config.get('fixture', {}).get('appSha') == APP and isinstance(config['fixture'].get('opsSha'), str) and re.fullmatch(r'[0-9a-f]{40}', config['fixture']['opsSha']) and config['fixture']['opsSha'] != APP and config['fixture'].get('serve') is False, 'EXACT_FIXTURE_ONLY_CONFIG_REQUIRED')
    require(type(config.get('estimatedSetupBytes')) is int and 0 < config['estimatedSetupBytes'] <= 2 * GIB, 'TWO_GIB_SETUP_CEILING_REQUIRED')
    require(config.get('registryPath') == REGISTRY and config.get('lockPath') == LOCK, 'COMMON_COORDINATION_PATHS_REQUIRED')
    require(all(isinstance(config.get(key), str) and len(config[key]) == 64 and all(char in '0123456789abcdef' for char in config[key]) for key in ('authorityAdapterSha256', 'probeAdapterSha256', 'fixtureSupervisorSha256', 'grantMessageSha256', 'gateAdapterSha256')), 'EXACT_SOURCE_AND_GRANT_PINS_REQUIRED')
    require(review.get('authorityAdapterSha256') == config.get('authorityAdapterSha256') and review.get('probeAdapterSha256') == config.get('probeAdapterSha256') and review.get('gateAdapterSha256') == config.get('gateAdapterSha256'), 'ADAPTER_REVIEW_BINDING_REQUIRED')
    # Config review is an explicit external trust anchor, not authenticated merely
    # by private mode. Reviewer/operator must supply its actual returned byte pin.
    return config


def observe_three_hosts(config, fixture, relay):
    """Called only inside explicitly admitted execution; never during preview.

    Preserve OPS5a original Mint/SM sample scripts and the real blog relay route.
    The relay supplement is independently pinned, not relabelled as OPS5a code.
    """
    gate = load_pinned(config['gateAdapterPath'], config['gateAdapterSha256'], 'yt_reviewed_fixture_gate')
    c = fixture.contract(config['fixture'])
    require(tuple(c.machine_ids) == (relay.SM_ID, relay.MINT_ID, relay.BLOG_ID) and c.known_hosts_sha256[0] == relay.SM_PIN and c.known_hosts_sha256[2] == relay.BLOG_PIN, 'ACTUAL_RELAY_IDENTITY_PINS_REQUIRED')
    require(relay.APP_SHA == APP and relay.OPS_TARGET == OPS, 'SEPARATE_RELAY_TARGET_REQUIRED')
    helpers = {}
    exec(relay.COMMON, helpers)  # Exact reviewed/pinned helper definitions only.
    runner = helpers['BoundedRunner']()
    def run(argv, seconds):
        code, out, err = runner.run(argv, seconds)
        require(type(code) is int and code == 0 and len(out) + len(err) <= 65536, 'ACTUAL_BOUNDED_PROBE_FAILED')
        return json.loads(out, object_pairs_hook=unique)
    rows = {}
    rows['Mint'] = run(['/usr/bin/python3', '-c', fixture.admission.readonly_script('Mint')], 15)
    known_raw = private_read(relay.SM_KNOWN_HOSTS, relay.SM_PIN)
    s = Path(relay.SM_KNOWN_HOSTS).stat()
    spec = fixture.admission.readonly_ssh_spec('SM', 'deck@100.85.214.25', relay.SM_KNOWN_HOSTS,
             {'regular': stat.S_ISREG(s.st_mode), 'symlink': False, 'ownedByController': s.st_uid == os.getuid(), 'mode': s.st_mode, 'sha256': digest(known_raw)}, c)
    rows['SM'] = run(spec['argv'], 15)
    relay_row = run(['/usr/bin/python3', '-c', relay.mint_script()], relay.MINT_SECONDS + 1)
    observations = [{'name': name, 'exitCode': 0, 'unknown': False, 'result': result}
                    for name, result in [('Mint', rows['Mint']), ('SM', rows['SM']), ('relay', relay_row)]]
    evaluated = gate.evaluate_observations(observations, utc())
    require(evaluated.get('ok') is True and evaluated.get('aggregate', {}).get('ok') is True,
            'REVIEWED_THREE_HOST_AGGREGATE_DENIED')
    checked = relay.validate_receipt(relay_row, utc())
    require(checked.get('ok') is True and checked.get('unknown') is False and checked.get('route') == ['Mint', 'SM', 'skyhong-blog'], 'ACTUAL_TWO_HOP_BLOG_PROOF_REQUIRED')
    rows['_gateObservations'] = observations
    rows['skyhong-blog'] = dict(checked['sample'])  # Preserve the actual nested receipt unchanged.
    require(relay.BLOG_SCRIPT == fixture.admission.readonly_script('skyhong-blog'), 'ORIGINAL_BLOG_SAMPLE_SCRIPT_REQUIRED')
    rows['skyhong-blog']['transport'] = {'controller': 'Mint', 'actualHopController': 'SM', 'strictPinnedSsh': True,
        'knownHostsSha256': relay.BLOG_PIN, 'scriptSha256': relay.BLOG_SCRIPT_SHA256, 'exitCode': 0,
        'route': checked['route'], 'relaySupplementSha256': config['probeAdapterSha256'], 'relayReceiptSha256': digest(json.dumps(relay_row, sort_keys=True).encode())}
    rows['SM']['transport'] = {'controller': 'Mint', 'strictPinnedSsh': True, 'knownHostsSha256': relay.SM_PIN,
                               'scriptSha256': spec['scriptSha256'], 'exitCode': 0, 'route': ['Mint', 'SM'], 'argv': spec['argv']}
    persist(Path(config['fixture']['admissionPath']).parent / 'guardian-relay-observation.json', relay_row)
    persist(Path(config['fixture']['admissionPath']).parent / 'guardian-gate-evaluation.json', evaluated)
    return rows


def verify_fd(fd):
    s = os.fstat(fd)
    lock = os.stat(LOCK, follow_symlinks=False)
    require(stat.S_ISREG(lock.st_mode) and (s.st_dev, s.st_ino) == (lock.st_dev, lock.st_ino), 'COMMON_LOCK_INODE_REQUIRED')
    key = f'{os.major(s.st_dev):02x}:{os.minor(s.st_dev):02x}:{s.st_ino}'
    lines = Path(f'/proc/self/fdinfo/{fd}').read_text().splitlines()
    # fdinfo binds FLOCK ownership to this open-file description, not just a
    # different process's lock on the same inode. Inherited child FDs retain it.
    require(any('FLOCK' in line and 'WRITE' in line and key in line.split() for line in lines if line.startswith('lock:')), 'ACTUAL_KERNEL_FD_CUSTODY_REQUIRED')
    return {'device': s.st_dev, 'inode': s.st_ino, 'kernelKey': key, 'holderPid': os.getpid()}


def acquire():
    fd = os.open(LOCK, os.O_RDWR | os.O_NOFOLLOW)
    try:
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        verify_fd(fd)
        return fd
    except BaseException:
        os.close(fd)
        raise


def identity(pid):
    raw = Path(f'/proc/{pid}/stat').read_text()
    fields = raw[raw.rfind(')') + 2:].split()
    return {'pid': pid, 'pgid': int(fields[2]), 'session': int(fields[3]), 'startTicks': fields[19]}


def authority(adapter, config, now):
    """Adapter must read the authoritative CURRENT user grant, not caller JSON."""
    row = adapter.observe_user_slot(config)
    c = config['fixture']
    require(isinstance(row, dict) and row.get('schema') == 'yt-authoritative-user-slot-observation-v1' and row.get('origin') == 'authoritative-user-session' and row.get('currentOwner') == 'YT' and row.get('previousOwner') == 'tag' and row.get('appSha') == APP and row.get('opsSha') == c['opsSha'] and row.get('owner') == c['owner'] and row.get('generation') == c['generation'] and row.get('scope') == 'mint-youtube-synthetic-fixture', 'AUTHORITATIVE_CURRENT_GRANT_REQUIRED')
    require(row.get('grantMessageSha256') == config['grantMessageSha256'] and row.get('grantMessageId') == config['grantMessageId'] and row.get('grantAt') == config['grantAt'] and row.get('coordinationMode') == 'human-slot-plus-common-flock-and-durable-registry', 'EXACT_GRANT_AND_COORDINATION_REQUIRED')
    require(isinstance(row.get('grantMessage'), str) and digest(row['grantMessage'].encode()) == row['grantMessageSha256'], 'EXACT_USER_MESSAGE_REQUIRED')
    at = dt.datetime.fromisoformat(row['observedAt'].replace('Z', '+00:00'))
    require(at.tzinfo is not None and 0 <= (now - at).total_seconds() <= 30, 'CURRENT_AUTHORITY_OBSERVATION_REQUIRED')
    return row


def validate_reservation_grant(grant,c,now):
    require(isinstance(grant,dict) and grant.get('schema')=='yt-authoritative-user-slot-observation-v1' and grant.get('origin')=='authoritative-user-session' and grant.get('currentOwner')=='YT' and grant.get('previousOwner')=='tag' and grant.get('scope')=='mint-youtube-synthetic-fixture' and grant.get('coordinationMode')=='human-slot-plus-common-flock-and-durable-registry','CURRENT_RESERVATION_AUTHORITY_REQUIRED')
    for key in ('appSha','opsSha','owner','generation'):
        require(grant.get(key)==c.binding()[key],'RESERVATION_GRANT_BINDING_CHANGED')
    require(isinstance(grant.get('grantMessage'),str) and digest(grant['grantMessage'].encode())==grant.get('grantMessageSha256'),'RESERVATION_GRANT_MESSAGE_CHANGED')
    try:
        observed=dt.datetime.fromisoformat(grant['observedAt'].replace('Z','+00:00'))
        require(observed.tzinfo is not None and 0<=(now-observed).total_seconds()<=30,'FRESH_RESERVATION_GRANT_REQUIRED')
    except (ValueError,TypeError,KeyError,AttributeError,OverflowError):
        raise ValueError('FRESH_RESERVATION_GRANT_REQUIRED') from None


def setup_bytes(config):
    """Allocated local bytes, deduplicated by device/inode; no file contents read."""
    c = config['fixture']
    roots = [Path(c['appRoot']) / 'platform/node_modules', Path(c['workspace']),
             Path('/home/sky/observe-worker/db-tools/root'), Path(c['nodeBinary'])]
    seen, total, entries = set(), 0, 0
    for root in roots:
        require(root.exists() and not root.is_symlink(), 'EXISTING_SETUP_ROOT_REQUIRED')
        paths = [root]
        if root.is_dir():
            def denied(error):
                raise error
            for parent, dirs, files in os.walk(root, followlinks=False, onerror=denied):
                paths.extend(Path(parent) / name for name in dirs + files)
                require(len(paths) <= 200000, 'SETUP_INVENTORY_ENTRY_CAP')
        for path in paths:
            s = path.lstat()
            entries += 1
            require(entries <= 200000 and (stat.S_ISDIR(s.st_mode) or stat.S_ISREG(s.st_mode) or stat.S_ISLNK(s.st_mode) or stat.S_ISSOCK(s.st_mode)), 'SETUP_INVENTORY_UNKNOWN')
            if stat.S_ISLNK(s.st_mode):
                require(path.resolve().is_relative_to(root), 'EXTERNAL_SETUP_SYMLINK_UNKNOWN')
            key = (s.st_dev, s.st_ino)
            if key not in seen:
                seen.add(key)
                total += s.st_blocks * 512
                require(total <= 2 * GIB, 'ACTUAL_SETUP_BUDGET_EXCEEDED')
    return total


def packet(fixture, c, grant, health, fd, reservation, now, estimate):
    custody = verify_fd(fd)
    validate_reservation_grant(grant,c,now)
    require(reservation.get('grantMessageSha256')==grant['grantMessageSha256'],'RESERVATION_GRANT_RECEIPT_CHANGED')
    require(reservation.get('state') in ('reserved', 'running') and reservation.get('binding') == c.binding() and reservation.get('kernelKey') == custody['kernelKey'], 'ACTUAL_DURABLE_RESERVATION_REQUIRED')
    observations = health.get('_gateObservations')
    health = {host: health[host] for host in fixture.admission.HOSTS if host in health}
    evidence = {'health': health, 'gateObservations': observations}
    require(not fixture.gate.packet_health_failures(evidence, c, now, estimate), 'ACTUAL_FRESH_THREE_HOST_GATES_REQUIRED')
    at = now.isoformat()
    binding = c.binding()
    # Legacy booleans are OUTPUT derived from actual authority, held FD, fsynced
    # registry and validated observations; none are configuration inputs.
    result = {'bootstrap': {**binding, 'schema': 'yt-fixture-bootstrap-admission-v1', 'scope': 'mint-youtube-synthetic-fixture', 'state': 'admitted', 'operatorExecutionAuthorized': True, 'servingAuthorized': False, 'observedAt': at},
              'slot': {**binding, 'schema': 'yt-global-slot-v1', 'verifiedAt': at, 'globalSingleBuildSlotGranted': True, 'remoteHostsAccounted': True, 'queueReleasedForYT': True, 'otherOwnersIdle': True, 'previousOwner': 'tag', 'operatorMessage': grant['grantMessage']},
              'reservation': {**binding, 'schema': 'yt-reservation-v1', 'durable': True, 'held': True, 'releaseRequiresRemoteTerminalProof': True, 'observedAt': at}, 'health': health, 'gateObservations': observations,
              'guardian': {'sourceSha256': digest(HERE.read_bytes()), 'targetOpsSha': c.ops_sha, 'observedAt': at, 'lock': custody, 'grantMessageSha256': grant['grantMessageSha256'], 'registryPath': REGISTRY, 'remoteExecutionStarted': False}}
    require(not fixture.binding_failures(result, c, now), 'OPS5A_PACKET_DENIED')
    return result


def reserve(c, custody, grant):
    path = Path(REGISTRY)
    if path.exists():
        # No auto-recovery or silently reused generation after a crash.
        raise ValueError('EXISTING_GLOBAL_RESERVATION_REQUIRES_REVIEWED_RECONCILIATION')
    validate_reservation_grant(grant,c,utc())
    require(isinstance(custody,dict) and type(custody.get('inode')) is int and custody['inode']>0 and type(custody.get('holderPid')) is int and custody['holderPid']==os.getpid() and isinstance(custody.get('kernelKey'),str),'ACTUAL_RESERVATION_CUSTODY_REQUIRED')
    row = {'schema': 'yt-fixture-global-reservation-v1', 'binding': c.binding(), 'state': 'reserved', 'createdAt': utc().isoformat(), 'kernelKey': custody['kernelKey'], 'guardian': identity(os.getpid()), 'grantMessageSha256': grant['grantMessageSha256'], 'supervisor': None, 'terminalReceiptSha256': None}
    persist(path, row, exclusive=True)
    return row


def terminal(fixture, config, c, child, owned, fd, started_at):
    require(owned is not None and child.poll() is not None, 'SUPERVISOR_TERMINAL_UNKNOWN')
    try:
        identity(child.pid)
    except FileNotFoundError:
        pass
    else:
        raise ValueError('SUPERVISOR_IDENTITY_STILL_PRESENT')
    runtime = Path(config['fixture']['workspace']) / ('fixture-' + c.generation)
    raw = private_read(runtime / 'terminal-receipt.json')
    row = json.loads(raw, object_pairs_hook=unique)
    require(fixture.admission.bound(row, c) and row.get('localFixtureChildrenTerminal') is True and row.get('remoteStopProof') is False and row.get('reservationReleaseAllowed') is False and row.get('ready') is False, 'EXACT_LOCAL_TERMINAL_RECEIPT_REQUIRED')
    at = dt.datetime.fromisoformat(row['observedAt'].replace('Z', '+00:00'))
    require(at.tzinfo is not None and started_at <= at <= utc() and (utc() - at).total_seconds() <= 30, 'CURRENT_RUN_TERMINAL_RECEIPT_REQUIRED')
    custody = verify_fd(fd)
    # Every other accessible FD holder must be absent. Denied proc read is
    # unknown, including unrelated users, rather than a fabricated zero.
    for proc in Path('/proc').iterdir():
        if not proc.name.isdecimal() or int(proc.name) == os.getpid():
            continue
        try:
            for info in (proc / 'fdinfo').iterdir():
                for line in info.read_text().splitlines():
                    require(not (line.startswith('lock:') and custody['kernelKey'] in line.split()), 'SURVIVING_LOCK_CUSTODY_RETAIN_RESERVATION')
        except FileNotFoundError:
            continue
    return digest(raw)


def supervise(config):
    # No arbitrary shell/argv/plugin execution. These exact source adapters must
    # have their separate reviewed byte pins in the independently reviewed config.
    authority_adapter = load_pinned(config['authorityAdapterPath'], config['authorityAdapterSha256'], 'yt_trusted_authority')
    probe_adapter = load_pinned(config['probeAdapterPath'], config['probeAdapterSha256'], 'yt_trusted_probe')
    fixture_path = Path(config['fixture']['opsRoot']) / 'platform/tools/mint-youtube-api-fixture.py'
    dependency = fixture_path.with_name('native-arm64-admission.py')
    require(dependency.is_file() and not dependency.is_symlink() and digest(dependency.read_bytes()) == ADMISSION_SOURCE_SHA256, 'OPS5A_IMPORT_DEPENDENCY_PIN_REQUIRED')
    fixture = load_pinned(fixture_path, config['fixtureSupervisorSha256'], 'yt_ops5a_fixture')
    c = fixture.contract(config['fixture'])
    fixture.verify_source(config['fixture'], c)
    require(Path('/etc/machine-id').read_text().strip() == c.machine_ids[1], 'ACTUAL_MINT_REQUIRED')
    grant = authority(authority_adapter, config, utc())
    setup_bytes(config)
    grant = authority(authority_adapter, config, utc())  # Inventory can outlive the first observation.
    fd = acquire()
    child = owned = reservation = None
    terminal_sha = None
    started_at = utc()
    runtime_config = Path(config['fixture']['admissionPath']).parent / ('guardian-fixture-' + c.generation + '.json')
    try:
        reservation = reserve(c, verify_fd(fd), grant)
        # reserve is durable BEFORE Popen: a crash in spawn/identity-registration
        # gaps leaves an unresolved global reservation even if the parent dies.
        health = observe_three_hosts(config, fixture, probe_adapter)
        persist(config['fixture']['admissionPath'], packet(fixture, c, grant, health, fd, reservation, utc(), config['estimatedSetupBytes']))
        persist(runtime_config, {**config['fixture'], 'guardFd': fd}, exclusive=True)
        child = subprocess.Popen(['/usr/bin/python3', '-B', str(fixture_path), '--config', str(runtime_config), '--execute'], env=ENV, cwd='/', stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, pass_fds=(fd,), start_new_session=True)
        owned = identity(child.pid)
        require(owned['pgid'] == child.pid and owned['session'] == child.pid, 'OWNED_SUPERVISOR_SESSION_REQUIRED')
        reservation.update(state='running', supervisor=owned)
        persist(REGISTRY, reservation)
        deadline = time.monotonic() + 120
        while child.poll() is None:
            require(time.monotonic() < deadline, 'BOUNDED_FIXTURE_DURATION_EXCEEDED')
            verify_fd(fd)  # Renew only while actual kernel FD custody is intact.
            grant = authority(authority_adapter, config, utc())
            setup_bytes(config)
            health = observe_three_hosts(config, fixture, probe_adapter)
            persist(config['fixture']['admissionPath'], packet(fixture, c, grant, health, fd, reservation, utc(), config['estimatedSetupBytes']))
            time.sleep(1)
        terminal_sha = terminal(fixture, config, c, child, owned, fd, started_at)
    finally:
        if reservation is not None:
            if terminal_sha is None:
                persist(config['fixture']['admissionPath'], {'bootstrap': {'state': 'revoked'}, 'guardian': {'status': 'stop-requested', 'targetOpsSha': c.ops_sha}})
                reservation.update(state='stop-requested')
                persist(REGISTRY, reservation)
                if child is not None and owned is not None and child.poll() is None:
                    require(identity(child.pid) == owned, 'STOP_OWNERSHIP_UNKNOWN_RETAIN_RESERVATION')
                    os.kill(child.pid, signal.SIGINT)  # OPS5a finally performs child cleanup.
                    try:
                        child.wait(timeout=20)
                        terminal_sha = terminal(fixture, config, c, child, owned, fd, started_at)
                    except Exception:
                        terminal_sha = None
            if terminal_sha is not None:
                reservation.update(state='local-terminal-confirmed', terminalReceiptSha256=terminal_sha)
                persist(REGISTRY, reservation)
                os.close(fd)  # Never unlinks/reuses reservation or declares next slot.
            else:
                reservation.update(state='unknown-retained')
                persist(REGISTRY, reservation)
                # Keep custody until externally reconciled; process death still
                # leaves inherited FDs and the durable unknown reservation.
                while True:
                    time.sleep(1)
        else:
            os.close(fd)  # No child can have spawned without a durable reservation.
    return {'status': 'local-terminal-confirmed', 'targetOpsSha': c.ops_sha, 'appSha': APP, 'guardianSha256': digest(HERE.read_bytes()), 'reservationReleased': False, 'terminalReceiptSha256': terminal_sha, 'runtimeReady': False}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--config')
    parser.add_argument('--review-receipt')
    parser.add_argument('--review-sha256')
    parser.add_argument('--execute', action='store_true')
    args = parser.parse_args()
    if not args.execute:
        print(json.dumps({'mode': 'preview', 'targetOpsSha': None, 'historicalOpsBaseSha': OPS, 'appSha': APP, 'guardianSha256': digest(HERE.read_bytes()), 'executionAllowed': False, 'runtimeReady': False, 'authorityPublisherIntegrated': False, 'sharedRegistryAdoptionVerified': False}))
        return
    require(all((args.config, args.review_receipt, args.review_sha256)), 'REVIEWED_EXECUTION_CONFIG_REQUIRED')
    print(json.dumps(supervise(reviewed_config(args.config, args.review_receipt, args.review_sha256))))


if __name__ == '__main__':
    main()
