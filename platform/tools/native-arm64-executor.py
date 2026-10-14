"""One owned compiler-container lifecycle; backend integration remains pending.

No Docker/SSH/OS calls on import and no CLI/default live backend. Injected inspect,
dispatch and cgroup readback must be independently reviewed/authenticated before
runtime use. This source can prepare fixed Docker lifecycle argv; it cannot create
containers, execute arbitrary commands, build images or control BuildKit jobs.

Physical pause requires two stable complete cgroup-v2 snapshots with frozen=1,
bound to full container ID, Linux PID starttime and pinned cgroup path. A successful
Docker pause/inspect alone is insufficient. Synchronous backend IO is NOT hard
preempted by the bounded polling deadline: a future adapter must bound each call.
Terminal proof requests a coordinator decision; this module never releases job
custody or the global slot, grants admission, or claims runtime readiness.
"""
from dataclasses import dataclass
import datetime
import math
import re

# This native compiler executor targets the reviewed deploy successor. The
# separate Mint fixture contract remains frozen at APP705; its source receipts
# and historical executor bytes are retained in Git and are not relabeled.
APP_SHA = '073985b8bc4bbcc9ffb5d43c1e1a26060bb8ac4a'
LABELS = {'owner': 'tw.observe.job.owner', 'generation': 'tw.observe.job.generation',
          'ops_sha': 'tw.observe.job.ops-sha', 'app_sha': 'tw.observe.job.app-sha'}


def require(condition, message):
    if not condition:
        raise ValueError(message)


def timestamp(value):
    try:
        at = datetime.datetime.fromisoformat(value.replace('Z', '+00:00'))
        require(at.tzinfo is not None, 'Timestamp zone missing')
        return at
    except (AttributeError, TypeError, ValueError, OverflowError) as error:
        raise ValueError('Invalid timestamp') from error


@dataclass(frozen=True)
class Identity:
    container_id: str
    image_id: str
    owner: str
    generation: str
    ops_sha: str
    started_at: str
    leader_pid: int
    leader_starttime: int
    cgroup_path: str
    cgroup_device: int
    cgroup_inode: int

    def __post_init__(self):
        require(isinstance(self.container_id, str) and re.fullmatch(r'[0-9a-f]{64}', self.container_id),
                'Full immutable container ID required')
        require(isinstance(self.image_id, str) and re.fullmatch(r'sha256:[0-9a-f]{64}', self.image_id),
                'Pinned native image ID required')
        require(all(isinstance(x, str) and re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._-]{0,127}', x)
                    for x in (self.owner, self.generation)), 'Owner/generation required')
        require(isinstance(self.ops_sha, str) and re.fullmatch(r'[0-9a-f]{40}', self.ops_sha) and
                self.ops_sha != APP_SHA, 'Separate exact OPS pin required')
        timestamp(self.started_at)
        require(type(self.leader_pid) is int and self.leader_pid > 0 and
                type(self.leader_starttime) is int and self.leader_starttime >= 0,
                'Pinned Linux process identity required')
        require(isinstance(self.cgroup_path, str) and self.cgroup_path.startswith('/sys/fs/cgroup/') and
                re.fullmatch(r'/[A-Za-z0-9/._-]+', self.cgroup_path) and
                '..' not in self.cgroup_path.split('/') and '//' not in self.cgroup_path and
                self.cgroup_path.split('/')[-1] in (self.container_id, 'docker-' + self.container_id + '.scope'),
                'Pinned container cgroup required')
        require(type(self.cgroup_device) is int and self.cgroup_device >= 0 and
                type(self.cgroup_inode) is int and self.cgroup_inode > 0,
                'Pinned cgroup device/inode required')

    def binding(self):
        return {'containerId': self.container_id, 'imageId': self.image_id,
                'owner': self.owner, 'generation': self.generation,
                'opsSha': self.ops_sha, 'appSha': APP_SHA}


def docker_spec(operation, identity):
    require(operation in ('inspect', 'pause', 'unpause'), 'Unsupported Docker operation')
    argv = ['/usr/bin/docker', operation]
    argv += [identity.container_id]
    return {'argv': argv, 'timeoutSeconds': 5,
            'maxOutputBytes': 65536,
            'env': {'PATH': '/usr/bin:/bin', 'LANG': 'C',
                    'DOCKER_HOST': 'unix:///var/run/docker.sock',
                    'DOCKER_CONFIG': '/nonexistent/observe-owned-compiler'},
            'purpose': 'owned-container-lifecycle', 'runtimeReady': False}


def shutdown_spec(identity):
    """Backend must verify owned directory FD/inode before this kernel write.

    Docker stop/kill may unpause frozen work internally. Kernel cgroup-v2 kill
    terminates the whole pinned subtree without a resume stage. No filesystem
    writer is provided here; absent cgroup.kill support/permissions fails closed.
    """
    return {'kind': 'owned-cgroup-v2-kill', 'containerId': identity.container_id,
            'cgroupPath': identity.cgroup_path, 'cgroupDevice': identity.cgroup_device,
            'cgroupInode': identity.cgroup_inode, 'file': 'cgroup.kill', 'value': '1',
            'requiresVerifiedDirectoryFd': True, 'timeoutSeconds': 1,
            'runtimeReady': False}


def inspect_state(value, identity):
    """Validate native docker inspect JSON; discard all secret-bearing fields."""
    require(isinstance(value, list) and len(value) == 1 and isinstance(value[0], dict),
            'Container inspection unavailable/ambiguous')
    row = value[0]
    require(row.get('Id') == identity.container_id and row.get('Image') == identity.image_id,
            'Container/image identity changed')
    labels = row.get('Config', {}).get('Labels', {})
    expected = {'owner': identity.owner, 'generation': identity.generation,
                'ops_sha': identity.ops_sha, 'app_sha': APP_SHA}
    require(isinstance(labels, dict) and all(labels.get(LABELS[k]) == v for k, v in expected.items()),
            'Owned job labels changed')
    host = row.get('HostConfig', {})
    require(isinstance(host, dict) and host.get('Privileged') is False and
            host.get('PidMode') == '' and host.get('NetworkMode') in ('none', 'bridge') and
            host.get('CgroupnsMode') == 'private' and host.get('CapAdd') in (None, []) and
            isinstance(host.get('CapDrop'), list) and 'ALL' in host['CapDrop'] and
            host.get('Devices') in (None, []) and
            host.get('Binds') in (None, []) and row.get('Mounts') == [] and
            isinstance(host.get('SecurityOpt'), list) and
            'no-new-privileges:true' in host['SecurityOpt'] and
            not any('unconfined' in x for x in host['SecurityOpt']) and
            host.get('AutoRemove') is False and host.get('RestartPolicy') == {'Name': 'no', 'MaximumRetryCount': 0},
            'Dedicated non-restarting container required')
    state = row.get('State', {})
    require(isinstance(state, dict) and state.get('StartedAt') == identity.started_at and
            state.get('Restarting') is False and state.get('Dead') is False and
            type(row.get('RestartCount')) is int and row['RestartCount'] == 0 and
            type(state.get('Running')) is bool and type(state.get('Paused')) is bool,
            'Container lifecycle identity unknown/restarted')
    if state['Running']:
        require(type(state.get('Pid')) is int and state['Pid'] == identity.leader_pid and
                state.get('Status') in ('running', 'paused'),
                'Leader identity/state changed')
        require((state['Status'] == 'paused') == state['Paused'], 'Inconsistent Docker pause state')
    else:
        require(type(state.get('Pid')) is int and state['Pid'] == 0 and state.get('Status') == 'exited' and
                state['Paused'] is False and type(state.get('ExitCode')) is int and
                timestamp(state.get('FinishedAt')) >= timestamp(identity.started_at),
                'Terminal container proof unavailable')
    return {'running': state['Running'], 'paused': state['Paused']}


def cgroup_members(value, identity):
    """Backend must read pinned path (not symlink) plus all descendant cgroups.

    frozen is kernel cgroup.events frozen, not Docker's Paused boolean. Complete
    enumeration and process starttimes prevent a partial scan or PID reuse from
    being interpreted as a stop. Unknown escaped jobs remain unsupported: the
    independently reviewed isolated container must disallow cgroup escape.
    Missing/deleted cgroup paths are unknown here, not an empty-membership proof;
    a future terminal backend needs independently verified cleanup evidence.
    """
    require(isinstance(value, dict) and value.get('containerId') == identity.container_id and
            value.get('cgroupPath') == identity.cgroup_path and value.get('pathIdentityVerified') is True and
            type(value.get('cgroupDevice')) is int and value['cgroupDevice'] == identity.cgroup_device and
            type(value.get('cgroupInode')) is int and value['cgroupInode'] == identity.cgroup_inode and
            value.get('descendantsComplete') is True and type(value.get('frozen')) is bool,
            'Complete pinned cgroup observation required')
    members = value.get('members')
    require(isinstance(members, dict) and all(type(pid) is int and pid > 0 and
            type(start) is int and start >= 0 for pid, start in members.items()),
            'Unknown cgroup membership/starttime')
    if identity.leader_pid in members:
        require(members[identity.leader_pid] == identity.leader_starttime, 'Leader PID reused')
    return dict(members), value['frozen']


class Executor:
    def __init__(self, identity, inspect, dispatch, cgroup, authenticate_gate, utcnow, clock, sleep):
        # No default backend: source tests inject every IO boundary.
        self.identity = identity
        self.inspect, self.dispatch, self.cgroup = inspect, dispatch, cgroup
        self.authenticate_gate, self.utcnow, self.clock, self.sleep = authenticate_gate, utcnow, clock, sleep
        self.state = 'identity-unverified'
        self.failures = []
        self.tracked = {}
        self.used_resume_authorizations = set()

    def result(self):
        return {'state': self.state, 'failures': list(self.failures),
                'remoteStopConfirmed': self.state == 'stop-confirmed',
                'terminalConfirmed': self.state == 'terminal-confirmed',
                'coordinatorReleaseMayBeRequested': self.state == 'terminal-confirmed',
                'reservationReleaseAllowed': False, 'runtimeReady': False}

    def fail(self, reason):
        self.state = 'STOP-unconfirmed-reservation-retained'
        if reason not in self.failures:
            self.failures.append(reason)
        return self.result()

    def read(self):
        state = inspect_state(self.inspect(docker_spec('inspect', self.identity)), self.identity)
        members, frozen = cgroup_members(self.cgroup(self.identity), self.identity)
        for pid, start in members.items():
            require(pid not in self.tracked or start == self.tracked[pid], 'Owned PID reused')
        self.tracked.update(members)
        if state['running']:
            require(members.get(self.identity.leader_pid) == self.identity.leader_starttime,
                    'Owned leader missing from cgroup')
        return state, members, frozen

    def confirm(self, mode, timeout=1.0, interval=0.05):
        require(mode in ('paused', 'running', 'terminal') and type(timeout) in (int, float) and
                math.isfinite(timeout) and 0 < timeout <= 2 and type(interval) in (int, float) and
                math.isfinite(interval) and 0.01 <= interval <= timeout, 'Invalid confirmation bounds')
        start = self.clock()
        require(type(start) in (int, float) and math.isfinite(start), 'Unknown clock')
        deadline, previous, last = start + timeout, None, start
        for _ in range(math.ceil(timeout / interval) + 2):
            state, members, frozen = self.read()
            now = self.clock()
            require(type(now) in (int, float) and math.isfinite(now) and last <= now <= deadline,
                    'Confirmation deadline/clock unavailable')
            last = now
            matched = ((mode == 'paused' and state['running'] and state['paused'] and frozen and bool(members)) or
                       (mode == 'running' and state['running'] and not state['paused'] and not frozen and bool(members)) or
                       (mode == 'terminal' and not state['running'] and not members))
            if matched and previous == members:
                return True
            previous = members if matched else None
            if now == deadline:
                return False
            self.sleep(min(interval, deadline - now))
        return False

    def pause(self):
        self.state = 'stop-requested-reservation-retained'
        try:
            state, _, _ = self.read()
            require(state['running'], 'Pause requires owned live container')
            if not state['paused']:
                require(self.dispatch(docker_spec('pause', self.identity)) is True, 'Pause dispatch unconfirmed')
            require(self.confirm('paused'), 'Physical cgroup freeze unconfirmed')
            self.state = 'stop-confirmed'
            return self.result()
        except Exception:
            return self.fail('physical-owned-container-STOP-unconfirmed')

    def admitted(self, gate):
        keys = set(self.identity.binding()) | {'schema', 'verifiedAt', 'controllerHost', 'executorHost',
                'jobCustodyHeldForWholeJob', 'globalSlotAcknowledged', 'hostHealthCurrent',
                'operatorResumeAuthorized', 'resumeAuthorizationId'}
        require(isinstance(gate, dict) and set(gate) == keys and
                gate.get('schema') == 'yt-sm-native-executor-admitted-gate-v2' and
                all(gate.get(k) == v for k, v in self.identity.binding().items()) and
                gate.get('controllerHost') == 'SM' and gate.get('executorHost') == 'skyhong-blog' and
                gate.get('jobCustodyHeldForWholeJob') is True and
                gate.get('globalSlotAcknowledged') is True and gate.get('hostHealthCurrent') is True and
                gate.get('operatorResumeAuthorized') is True and
                isinstance(gate.get('resumeAuthorizationId'), str) and
                re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._-]{0,127}', gate['resumeAuthorizationId']) and
                gate['resumeAuthorizationId'] not in self.used_resume_authorizations,
                'Fresh exact admitted gate required')
        age = (self.utcnow() - timestamp(gate.get('verifiedAt'))).total_seconds()
        require(math.isfinite(age) and 0 <= age <= 30 and self.authenticate_gate(gate) is True,
                'Admission stale/unauthenticated')

    def resume(self, gate):
        try:
            require(self.state == 'stop-confirmed', 'Resume requires known physical pause')
            self.admitted(gate)
            require(self.confirm('paused'), 'Physical pause no longer confirmed')
            self.admitted(gate)  # Recheck after bounded readback before dispatch.
            self.used_resume_authorizations.add(gate['resumeAuthorizationId'])
            require(self.dispatch(docker_spec('unpause', self.identity)) is True, 'Resume dispatch unconfirmed')
            require(self.confirm('running'), 'Resume readback unconfirmed')
            self.state = 'running-observed'
            return self.result()
        except Exception:
            # Unpause may have dispatched: try to freeze again, never merely mark
            # it paused or release custody after unknown/failure.
            self.pause()
            return self.fail('resume-denied-or-unconfirmed-operator-recovery-required')

    def shutdown(self):
        try:
            state, _, _ = self.read()
            if state['running']:
                require(self.dispatch(shutdown_spec(self.identity)) is True, 'Shutdown dispatch unconfirmed')
            require(self.confirm('terminal'), 'Owned container terminal/empty proof unconfirmed')
            self.state = 'terminal-confirmed'
            return self.result()
        except Exception:
            # Container absence, SSH loss and CLI exit alone never prove terminal.
            self.pause()
            return self.fail('shutdown-terminal-proof-unconfirmed')
