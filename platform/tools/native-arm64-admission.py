"""Offline preparation for YT's Mint-controlled native ARM64 build admission.

No import/CLI path runs SSH, probes, builds, signals, acquires/releases a lock or
changes a coordinator reservation. Supplied evidence is not authenticated here.
The read-only SSH argv is for independent review before an operator-owned adapter
uses it. Passing validation NEVER grants admission or marks runtime ready.

Missing execution work: a Mint-held flock for the entire remote job, durable
coordinator reservation, verified live transport, isolated readiness, and an
executor/packaging containment adapter with bounded physical STOP readback. The
local guarded-next-build STOP acknowledgement cannot satisfy that adapter.
"""
from dataclasses import dataclass
import datetime
import hashlib
import math
from pathlib import PurePosixPath
import re
import shlex

APP_SHA = '70529cff13b6b7f5b3e0571a229e2b61660f9df4'
LOCK_PATH = '/run/lock/mint-global-build.lock'
GIB = 1024 ** 3
SITE_LIMITS = {'tag': 2.0, 'blog': 6.17, 'youtube': 2.0}
SITES = {name: f'https://{name}.observe.tw/' for name in SITE_LIMITS}
HOSTS = ('SM', 'Mint', 'skyhong-blog')
SHA40 = re.compile(r'[0-9a-f]{40}\Z')
SHA64 = re.compile(r'[0-9a-f]{64}\Z')
TOKEN = re.compile(r'[A-Za-z0-9][A-Za-z0-9._-]{0,127}\Z')


def require(condition, message):
    if not condition:
        raise ValueError(message)


def number(value):
    return type(value) in (int, float) and math.isfinite(value)


def absolute_path(value):
    return (isinstance(value, str) and value.startswith('/') and
            re.fullmatch(r'/[A-Za-z0-9/._-]+', value) is not None and
            '..' not in PurePosixPath(value).parts and
            str(PurePosixPath(value)) == value and value != '/')


def fresh(value, now, max_age):
    try:
        at = datetime.datetime.fromisoformat(value.replace('Z', '+00:00'))
        age = (now - at).total_seconds()
        return at.tzinfo is not None and number(age) and 0 <= age <= max_age
    except (AttributeError, TypeError, ValueError, OverflowError):
        return False


@dataclass(frozen=True)
class Contract:
    # No default OPS pin: preparation HEAD is never an implicit runtime identity.
    ops_sha: str
    owner: str
    generation: str
    lockfile_sha256: str
    base_digest: str
    source_root: str
    machine_ids: tuple
    known_hosts_sha256: tuple

    def __post_init__(self):
        require(isinstance(self.ops_sha, str) and SHA40.fullmatch(self.ops_sha) and
                self.ops_sha != APP_SHA, 'Independent full OPS pin required')
        require(all(isinstance(x, str) and TOKEN.fullmatch(x)
                    for x in (self.owner, self.generation)), 'Owner/generation required')
        require(isinstance(self.lockfile_sha256, str) and SHA64.fullmatch(self.lockfile_sha256),
                'Lockfile SHA256 required')
        require(isinstance(self.base_digest, str) and
                re.fullmatch(r'sha256:[0-9a-f]{64}', self.base_digest), 'Pinned ARM64 base required')
        require(absolute_path(self.source_root), 'Canonical isolated source path required')
        require(type(self.machine_ids) is tuple and len(self.machine_ids) == 3 and
                len(set(self.machine_ids)) == 3 and
                all(isinstance(x, str) and re.fullmatch(r'[0-9a-f]{32}', x)
                    for x in self.machine_ids), 'Distinct participating machine IDs required')
        require(type(self.known_hosts_sha256) is tuple and len(self.known_hosts_sha256) == 3 and
                all(isinstance(x, str) and SHA64.fullmatch(x) for x in self.known_hosts_sha256),
                'Per-host known-hosts pins required')

    def binding(self):
        return {'appSha': APP_SHA, 'opsSha': self.ops_sha, 'owner': self.owner,
                'generation': self.generation, 'lockfileSha256': self.lockfile_sha256,
                'baseDigest': self.base_digest}


def bound(receipt, contract):
    return isinstance(receipt, dict) and all(receipt.get(k) == v for k, v in contract.binding().items())


def readonly_script(host):
    """Fixed bounded probe text; no caller-provided shell/script or arbitrary URL."""
    require(host in HOSTS, 'Unknown probe host')
    # DNT complete HTML only; no redirect following, JS, cookies, Google or DB.
    # Scan denial is unknown, never silently a count of zero. Idle BuildKit
    # daemons are not jobs; clients and daemon-descendant runc processes are.
    # Matched details contain only PID, controlled name and elapsed seconds.
    return f'''import datetime,json,os,shutil,subprocess
from pathlib import Path
sites={SITES!r}
limits={SITE_LIMITS!r}
rows={{}}
builds=0
browsers=0
processes={{}}
build_processes=[]
uptime=float(Path('/proc/uptime').read_text().split()[0])
ticks=os.sysconf('SC_CLK_TCK')
for p in Path('/proc').iterdir():
 if not p.name.isdecimal(): continue
 try:
  a=[x.decode(errors='replace') for x in (p/'cmdline').read_bytes().split(b'\\0') if x]
  stat=(p/'stat').read_text().rsplit(')',1)[1].split()
  parent=int(stat[1])
  elapsed=max(0,int(uptime-int(stat[19])/ticks))
 except (FileNotFoundError,ProcessLookupError): continue
 names=[os.path.basename(x) for x in a]
 executable=names[0] if names else ''
 processes[int(p.name)]=(parent,executable,a,elapsed)
 client=(executable=='docker' and ('build' in a[1:] or 'buildx' in a[1:] and 'bake' in a[1:]) or executable in ('buildx','docker-buildx') and any(x in a[1:] for x in ('build','bake')) or executable=='buildctl' and 'build' in a[1:] or 'next-build' in names or any(x in names for x in ('next','next.js')) and 'build' in a or executable in ('npm','pnpm','yarn') and 'build' in a[1:])
 if client:
  build_processes.append({{'pid':int(p.name),'name':executable if executable in ('docker','buildx','docker-buildx','buildctl','node','npm','pnpm','yarn','next','next.js','next-build') else 'build-client','etimes':elapsed}})
 if names and names[0] in ('chrome','chromium','chromium-browser','chrome-headless-shell','google-chrome','google-chrome-stable') and not any(x.startswith('--type=') for x in a): browsers+=1
for pid,(parent,name,a,elapsed) in processes.items():
 if name!='runc': continue
 seen=set()
 while parent in processes and parent not in seen:
  seen.add(parent)
  ancestor=processes[parent]
  if ancestor[1]=='buildkitd':
   build_processes.append({{'pid':pid,'name':'runc','etimes':elapsed}})
   break
  parent=ancestor[0]
builds=len(build_processes)
for name,url in sites.items():
 try:
  r=subprocess.run(['/usr/bin/curl','--disable','--silent','--show-error','--max-time',str(limits[name]+1),'--output','/dev/null','--user-agent','youtube-board-verify/1.0','--header','DNT: 1','--header','Accept: text/html','--write-out','%{{http_code}} %{{time_total}}',url],capture_output=True,text=True,timeout=limits[name]+2,env={{'PATH':'/usr/bin:/bin','LANG':'C'}})
  status,total=r.stdout.split()
  rows[name]={{'exitCode':r.returncode,'status':int(status),'totalSeconds':float(total)}}
 except (OSError,ValueError,subprocess.TimeoutExpired): rows[name]={{'exitCode':-1,'status':None,'totalSeconds':None}}
print(json.dumps({{'schema':'yt-host-health-v1','observedHost':{host!r},'machineId':Path('/etc/machine-id').read_text().strip(),'measuredFromMachineId':Path('/etc/machine-id').read_text().strip(),'observedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'freeBytes':shutil.disk_usage('/home').free,'load1':os.getloadavg()[0],'buildCount':builds,'buildProcesses':build_processes,'browserCount':browsers,'sites':rows}}))
'''


def readonly_ssh_spec(host, destination, known_hosts_path, pin_evidence, contract):
    """Prepare argv only; caller's evidence must later be verified on Mint itself.

    Adapted from tag-cross-host-probe.mjs: ignores user/global SSH config, pins
    known-hosts bytes, disables proxy/TTY/forwarding and bounds connect attempts.
    Outer 40s timeout/output cap are requirements for a future live adapter.
    """
    require(host in HOSTS and host != 'Mint', 'Only cross-host readonly SSH preparation')
    require(isinstance(destination, str) and re.fullmatch(
        r'[a-z_][a-z0-9_-]*@(?:[0-9]{1,3}\.){3}[0-9]{1,3}', destination), 'Pinned literal user/IP required')
    require(all(0 <= int(x) <= 255 for x in destination.split('@')[1].split('.')), 'Invalid address')
    require(absolute_path(known_hosts_path), 'Canonical known-hosts path required')
    require(isinstance(pin_evidence, dict) and pin_evidence.get('regular') is True and
            pin_evidence.get('symlink') is False and pin_evidence.get('ownedByController') is True and
            type(pin_evidence.get('mode')) is int and pin_evidence['mode'] & 0o077 == 0 and
            pin_evidence.get('sha256') == contract.known_hosts_sha256[HOSTS.index(host)],
            'Known-hosts evidence unavailable/mismatched')
    script = readonly_script(host)
    argv = ['/usr/bin/ssh', '-F', '/dev/null', '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes',
            '-o', 'UserKnownHostsFile=' + known_hosts_path, '-o', 'GlobalKnownHostsFile=/dev/null',
            '-o', 'ConnectTimeout=5', '-o', 'ConnectionAttempts=1', '-o', 'ProxyCommand=none',
            '-o', 'ClearAllForwardings=yes', '-o', 'RequestTTY=no', '-p', '22', destination,
            'python3 -c ' + shlex.quote(script)]
    return {'argv': argv, 'scriptSha256': hashlib.sha256(script.encode()).hexdigest(),
            'timeoutSeconds': 40, 'maxOutputBytes': 65536,
            'env': {'PATH': '/usr/bin:/bin', 'LANG': 'C'},
            'executionAllowed': False, 'purpose': 'readonly-probe-preparation'}


def health_failures(receipt, host, contract, now, starting=True, estimate_bytes=0):
    failures = []
    if not isinstance(receipt, dict):
        return [host + '-health-unknown']
    machine = contract.machine_ids[HOSTS.index(host)]
    if (receipt.get('schema') != 'yt-host-health-v1' or receipt.get('observedHost') != host or
            receipt.get('machineId') != machine or receipt.get('measuredFromMachineId') != machine or
            not fresh(receipt.get('observedAt'), now, 30)):
        failures.append(host + '-identity-or-health-stale-unknown')
    if host != 'Mint':
        transport = receipt.get('transport', {})
        if not isinstance(transport, dict) or not (
                transport.get('controller') == 'Mint' and transport.get('strictPinnedSsh') is True and
                transport.get('knownHostsSha256') == contract.known_hosts_sha256[HOSTS.index(host)] and
                transport.get('scriptSha256') == hashlib.sha256(readonly_script(host).encode()).hexdigest() and
                type(transport.get('exitCode')) is int and transport['exitCode'] == 0):
            failures.append(host + '-pinned-cross-host-transport-unverified')
    free, load = receipt.get('freeBytes'), receipt.get('load1')
    if not number(free) or free < (40 if starting else 30) * GIB:
        failures.append(host + '-disk-floor-or-unknown')
    if not number(estimate_bytes) or estimate_bytes < 0 or starting and number(free) and free - estimate_bytes < 30 * GIB:
        failures.append(host + '-artifact-estimate-or-reserve-unknown')
    if not number(load) or not 0 <= load <= 12:
        failures.append(host + '-load-or-unknown')
    # Runtime monitoring needs owned-job exclusion in a real adapter; this
    # preparation validator only admits observations with no existing builds.
    if type(receipt.get('buildCount')) is not int or receipt['buildCount'] != 0:
        failures.append(host + '-competing-or-unknown-builds')
    if type(receipt.get('browserCount')) is not int or not 0 <= receipt['browserCount'] <= 2:
        failures.append(host + '-browser-count-or-unknown')
    sites = receipt.get('sites', {})
    for site, limit in SITE_LIMITS.items():
        row = sites.get(site, {}) if isinstance(sites, dict) else {}
        if not isinstance(row, dict) or not (
                type(row.get('exitCode')) is int and row['exitCode'] == 0 and
                type(row.get('status')) is int and row['status'] == 200 and
                number(row.get('totalSeconds')) and 0 <= row['totalSeconds'] <= limit):
            failures.append(host + '-' + site + '-complete-html-unavailable-or-slow')
    return failures


def preparation_failures(packet, contract, now):
    """Validate bounded supplied observations; no boolean here is live proof."""
    if not isinstance(packet, dict):
        return ['packet-unknown']
    failures = []
    slot = packet.get('slot', {})
    if not (bound(slot, contract) and slot.get('schema') == 'yt-global-slot-v1' and
            fresh(slot.get('verifiedAt'), now, 120) and slot.get('globalSingleBuildSlotGranted') is True and
            slot.get('remoteHostsAccounted') is True and slot.get('queueReleasedForYT') is True and
            slot.get('otherOwnersIdle') is True and slot.get('previousOwner') == 'tag' and
            isinstance(slot.get('operatorMessage'), str) and slot['operatorMessage'].strip()):
        failures.append('fresh-explicit-global-YT-slot-required')
    reserve = packet.get('reservation', {})
    if not (bound(reserve, contract) and reserve.get('schema') == 'yt-reservation-v1' and
            reserve.get('durable') is True and reserve.get('held') is True and
            reserve.get('releaseRequiresRemoteTerminalProof') is True and
            fresh(reserve.get('observedAt'), now, 30)):
        failures.append('durable-current-reservation-required')
    lock = packet.get('mintLock', {})
    if not (bound(lock, contract) and lock.get('path') == LOCK_PATH and lock.get('held') is True and
            lock.get('controller') == 'Mint' and lock.get('machineId') == contract.machine_ids[1] and
            lock.get('custodyUntilRemoteTerminalProof') is True and
            type(lock.get('holderPid')) is int and lock['holderPid'] > 0 and
            type(lock.get('inode')) is int and lock['inode'] > 0 and
            isinstance(lock.get('leaseId'), str) and TOKEN.fullmatch(lock['leaseId']) and
            fresh(lock.get('observedAt'), now, 30)):
        failures.append('Mint-whole-job-lock-custody-required')
    identity = packet.get('identity', {})
    if not (bound(identity, contract) and identity.get('sourceClean') is True and
            identity.get('sourceRoot') == contract.source_root and identity.get('opsReviewed') is True and
            identity.get('platform') == 'linux' and identity.get('arch') == 'arm64' and
            identity.get('nodeVersion') == '24.15.0' and identity.get('nodeModulesAbi') == '137' and
            identity.get('libc') == 'glibc' and identity.get('nextWorkers') == 2 and
            fresh(identity.get('observedAt'), now, 30)):
        failures.append('exact-clean-reviewed-OPS-APP-native-arm64-identity-required')
    readiness = packet.get('readiness', {})
    if not (bound(readiness, contract) and readiness.get('schema') == 'yt-isolated-readiness-v1' and
            readiness.get('isolated') is True and readiness.get('ready') is True and
            readiness.get('sourceWritesDisabled') is True and readiness.get('productionApi') is False and
            isinstance(readiness.get('fixtureSha256'), str) and SHA64.fullmatch(readiness['fixtureSha256']) and
            fresh(readiness.get('observedAt'), now, 30)):
        failures.append('matching-isolated-readiness-required')
    estimates = packet.get('estimatedBytes', {})
    health = packet.get('health', {})
    for host in HOSTS:
        estimate = estimates.get(host) if isinstance(estimates, dict) else None
        if not number(estimate) or estimate <= 0:
            failures.append(host + '-positive-byte-estimate-required')
        failures.extend(health_failures(health.get(host) if isinstance(health, dict) else None,
                                       host, contract, now, estimate_bytes=estimate))
    if isinstance(health, dict) and all(isinstance(health.get(x), dict) and
                                      type(health[x].get('browserCount')) is int for x in HOSTS):
        if sum(health[x]['browserCount'] for x in HOSTS) > 2:
            failures.append('global-two-browser-limit')
    return failures


STAGES = {
    # Required compiler/dev tools must be installed despite production build env.
    'dependencies': ('/usr/local/bin/npm', 'ci', '--include=dev'),
    'typecheck': ('/usr/local/bin/npm', 'run', 'typecheck'),
    'runtime-compile': ('/usr/local/bin/node', 'node_modules/typescript/bin/tsc', '-p', 'runtime/tsconfig.json'),
    'web-build': ('/usr/local/bin/npm', 'run', 'build', '--workspace=@youtube-board/web', '--', '--webpack'),
}
BUILD_ENV = {'NODE_ENV': 'production', 'NEXT_TELEMETRY_DISABLED': '1',
             'NEXT_PUBLIC_GA_ID': 'G-X2G1PLNP7K', 'NODE_OPTIONS': '--max-old-space-size=2048'}


def command_spec(stage, contract):
    require(stage in STAGES, 'Unknown stage; packaging requires a separate containment adapter')
    return {**contract.binding(), 'stage': stage, 'host': 'skyhong-blog',
            'cwd': contract.source_root + '/platform', 'platform': 'linux/arm64',
            'argv': ['nice', '-n', '19', 'ionice', '-c3', *STAGES[stage]],
            'env': dict(BUILD_ENV), 'nextWorkers': 2, 'executionAllowed': False}


def validate_command(spec, contract):
    require(isinstance(spec, dict) and spec.get('stage') in STAGES, 'Unknown command stage')
    require(spec == command_spec(spec['stage'], contract), 'Altered command, identity, environment or execution permission')
    return True


class ReservationPreparation:
    """Sticky offline custody model, with no release or launch operation.

    A loss/unknown observation invalidates the preparation permanently. Even
    later healthy samples do not recover it; operator recovery belongs to the
    future durable coordinator + remote adapter. No local STOP evidence accepted.
    """
    def __init__(self, contract):
        self.contract = contract
        self.state = 'preparation'
        self.custody = None
        self.failures = []

    def observe(self, packet, now):
        try:
            failures = preparation_failures(packet, self.contract, now)
            lock = packet.get('mintLock', {}) if isinstance(packet, dict) else {}
            custody = tuple(lock.get(k) for k in ('machineId', 'holderPid', 'inode', 'leaseId'))
            if self.custody is not None and custody != self.custody:
                failures.append('lock-custody-changed')
        except (TypeError, ValueError, KeyError, AttributeError, OverflowError):
            failures, custody = ['observation-unknown'], None
        if failures or self.state == 'STOP-unconfirmed-reservation-retained':
            self.state = 'STOP-unconfirmed-reservation-retained'
            self.failures = list(dict.fromkeys([*self.failures, *failures]))
        else:
            self.custody = custody
            self.state = 'preparation-observations-consistent'
        return self.result()

    def result(self):
        return {'state': self.state, 'failures': list(self.failures), 'runtimeReady': False,
                'executionAllowed': False, 'reservationReleaseAllowed': False,
                'remoteStopConfirmed': False, 'localStopCountsAsRemoteProof': False,
                'requiredAdapters': ['live-Mint-lock-and-durable-coordinator',
                                     'authenticated-pinned-health-and-isolated-readiness',
                                     'native-arm64-executor-and-packaging-physical-STOP']}
