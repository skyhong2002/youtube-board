"""Inert preparation for fixed Mint -> SM -> skyhong-blog read-only health.

Import and script construction perform no IO. No CLI or launcher exists. The
caller must separately review and execute mint_script() on the actual Mint host.
This supplement never attests OPS runtime identity or grants admission.
"""
import hashlib
import json
import shlex
import datetime
import math

APP_SHA = '70529cff13b6b7f5b3e0571a229e2b61660f9df4'
OPS_TARGET = '5a5be6833ee2f32d35bce021db43d3627fdd7c8f'
ADMISSION_SOURCE_SHA256 = 'bc099570fbd22c5efeba8f2465fcba21ff0cb101ba6e4b741399cade981715ae'
MINT_ID = 'f80413057e6d4a179e248e5f8c08cac6'
SM_ID = '302c2528bd464ad0953cf5fa743b6171'
BLOG_ID = '35ead342bacc44dea3633ccd2cc3f309'
SM_KNOWN_HOSTS = '/var/lib/observe-worker/sm-known-hosts-20261013'
SM_PIN = '2ba9836fac4b4ee050765b6df4131adf0b0c0a349d82d9bb8a65af4504d56ef3'
BLOG_KNOWN_HOSTS = '/home/deck/.cache/youtube-ui-review/relay-pins/blog-known-hosts-bcffee599f754cf7'
BLOG_PIN = 'bcffee599f754cf7b423dfe1517c6dce9ced8dc64da95f497d2cc1caab7152b9'
BLOG_FINGERPRINT = 'SHA256:BG/VrIOoTclF4+830uXsRYiyeqECkEWeDVLNwy1kRO4'
ENV = {'PATH': '/usr/bin:/bin', 'LANG': 'C'}
OUTPUT_CAP = 65536
BLOG_SECONDS = 15
MINT_SECONDS = 22
BLOG_SCRIPT = "import datetime,json,os,shutil,subprocess\nfrom pathlib import Path\nsites={'tag': 'https://tag.observe.tw/', 'blog': 'https://blog.observe.tw/', 'youtube': 'https://youtube.observe.tw/'}\nlimits={'tag': 2.0, 'blog': 6.17, 'youtube': 2.0}\nrows={}\nbuilds=0\nbrowsers=0\nprocesses={}\nbuild_processes=[]\nuptime=float(Path('/proc/uptime').read_text().split()[0])\nticks=os.sysconf('SC_CLK_TCK')\ndef skip_options(command,value_options,flag_options):\n while command and command[0].startswith('-'):\n  option=command[0]\n  if option in value_options:\n   if len(command)<2 or command[1].startswith('-'): raise ValueError('Missing build-client option value')\n   command=command[2:]\n  elif option in flag_options or '=' in option and option.split('=',1)[0] in value_options+flag_options:\n   command=command[1:]\n  else: raise ValueError('Unknown build-client global option')\n return command\nfor p in Path('/proc').iterdir():\n if not p.name.isdecimal(): continue\n try:\n  a=[x.decode(errors='replace') for x in (p/'cmdline').read_bytes().split(b'\\0') if x]\n  stat=(p/'stat').read_text().rsplit(')',1)[1].split()\n  parent=int(stat[1])\n  elapsed=max(0,int(uptime-int(stat[19])/ticks))\n except (FileNotFoundError,ProcessLookupError): continue\n names=[os.path.basename(x) for x in a]\n executable=names[0] if names else ''\n processes[int(p.name)]=(parent,executable,a,elapsed)\n command=a[1:]\n is_buildx=executable in ('buildx','docker-buildx')\n if executable in ('docker','buildctl'):\n  value_options=('--host','-H','--context','-c','--config','--log-level','-l','--tlscacert','--tlscert','--tlskey','--addr','--timeout','--tlsservername')\n  flag_options=('--debug','-D','--tls','--tlsverify','--help','-h','--version','-v')\n  command=skip_options(command,value_options,flag_options)\n  if executable=='docker' and command[:1]==['buildx']:\n   is_buildx=True\n   command=command[1:]\n if is_buildx:\n  command=skip_options(command,('--builder',),('--debug','-D','--help','-h','--version'))\n client=(is_buildx and command[:1] in (['build'],['bake']) or executable=='docker' and not is_buildx and (command[:1]==['build'] or command[:2]==['image','build']) or executable=='buildctl' and command[:1]==['build'] or 'next-build' in names or any(x in names for x in ('next','next.js')) and 'build' in a or executable in ('npm','pnpm','yarn') and 'build' in a[1:])\n if client:\n  build_processes.append({'pid':int(p.name),'name':executable if executable in ('docker','buildx','docker-buildx','buildctl','node','npm','pnpm','yarn','next','next.js','next-build') else 'build-client','etimes':elapsed})\n if names and names[0] in ('chrome','chromium','chromium-browser','chrome-headless-shell','google-chrome','google-chrome-stable') and not any(x.startswith('--type=') for x in a): browsers+=1\nfor pid,(parent,name,a,elapsed) in processes.items():\n if name not in ('runc','buildkit-runc'): continue\n seen=set()\n while parent in processes and parent not in seen:\n  seen.add(parent)\n  ancestor=processes[parent]\n  if ancestor[1]=='buildkitd':\n   build_processes.append({'pid':pid,'name':name,'etimes':elapsed})\n   break\n  parent=ancestor[0]\nbuilds=len(build_processes)\nfor name,url in sites.items():\n try:\n  r=subprocess.run(['/usr/bin/curl','--disable','--silent','--show-error','--max-time',str(limits[name]+1),'--output','/dev/null','--user-agent','youtube-board-verify/1.0','--header','DNT: 1','--header','Accept: text/html','--write-out','%{http_code} %{time_total}',url],capture_output=True,text=True,timeout=limits[name]+2,env={'PATH':'/usr/bin:/bin','LANG':'C'})\n  status,total=r.stdout.split()\n  rows[name]={'exitCode':r.returncode,'status':int(status),'totalSeconds':float(total)}\n except (OSError,ValueError,subprocess.TimeoutExpired): rows[name]={'exitCode':-1,'status':None,'totalSeconds':None}\nprint(json.dumps({'schema':'yt-host-health-v1','observedHost':'skyhong-blog','machineId':Path('/etc/machine-id').read_text().strip(),'measuredFromMachineId':Path('/etc/machine-id').read_text().strip(),'observedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'freeBytes':shutil.disk_usage('/home').free,'load1':os.getloadavg()[0],'buildCount':builds,'buildProcesses':build_processes,'browserCount':browsers,'sites':rows}))\n"
BLOG_SCRIPT_SHA256 = 'a5591076ade60760262ec4093fb318b9a3ad668924e7cd6f232e1925c5a614da'

def build_processes_valid(sample):
 details=sample.get('buildProcesses')
 count=sample.get('buildCount')
 allowed={'docker','buildx','docker-buildx','buildctl','node','npm','pnpm','yarn','next','next.js','next-build','build-client','runc','buildkit-runc'}
 if type(count) is not int or count<0 or not isinstance(details,list) or len(details)!=count:return False
 seen=set()
 for row in details:
  if not isinstance(row,dict) or set(row)!={'pid','name','etimes'}:return False
  if type(row['pid']) is not int or row['pid']<=0 or row['pid'] in seen:return False
  if not isinstance(row['name'],str) or row['name'] not in allowed or type(row['etimes']) is not int or row['etimes']<0:return False
  seen.add(row['pid'])
 return True

# This fixed helper is emitted into each controller script. Its only child is
# its own fixed ssh client. Timeout cleanup never signals a remote host/job.
COMMON = r'''import datetime,hashlib,json,math,os,pathlib,selectors,stat,subprocess,time

def unique(pairs):
 result={}
 for key,value in pairs:
  if key in result: raise ValueError('Duplicate JSON field')
  result[key]=value
 return result

def decode(raw):
 return json.loads(raw,object_pairs_hook=unique)

def utc():
 return datetime.datetime.now(datetime.timezone.utc).isoformat()

class BoundedRunner:
 def __init__(self,popen=None,selector=None,read=None,clock=None):
  self.popen=subprocess.Popen if popen is None else popen
  self.selector=selectors.DefaultSelector if selector is None else selector
  self.read=os.read if read is None else read
  self.clock=time.monotonic if clock is None else clock
 def run(self,argv,seconds):
  child=None; poller=None; outputs={'stdout':bytearray(),'stderr':bytearray()}
  start=self.clock(); previous=start
  if type(start) not in (int,float) or not math.isfinite(start): raise ValueError('Clock unknown')
  deadline=start+seconds
  def remaining():
   nonlocal previous
   now=self.clock()
   if type(now) not in (int,float) or not math.isfinite(now) or not previous<=now<deadline: raise ValueError('Deadline/clock unknown')
   previous=now
   return deadline-now
  try:
   remaining()
   child=self.popen(argv,stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.PIPE,cwd='/',env={'PATH':'/usr/bin:/bin','LANG':'C'},start_new_session=True)
   poller=self.selector()
   poller.register(child.stdout,selectors.EVENT_READ,'stdout');poller.register(child.stderr,selectors.EVENT_READ,'stderr')
   total=0
   while poller.get_map():
    for key,_ in poller.select(min(.1,remaining())):
     remaining();part=self.read(key.fileobj.fileno(),min(4096,65537-total))
     if not isinstance(part,bytes):raise ValueError('Pipe unknown')
     if not part:poller.unregister(key.fileobj);continue
     total+=len(part)
     if total>65536:raise ValueError('Output over cap')
     outputs[key.data].extend(part)
   code=child.wait(timeout=remaining());remaining()
   if type(code) is not int:raise ValueError('Exit unknown')
   return code,bytes(outputs['stdout']),bytes(outputs['stderr'])
  except Exception:
   if child is not None:
    try:
     if child.poll() is None:child.kill()
     child.wait(timeout=.5)
    except Exception:pass
   raise ValueError('Fixed SSH client response unknown') from None
  finally:
   if poller is not None:poller.close()
   if child is not None:
    for stream in (child.stdout,child.stderr):
     if stream is not None:stream.close()

def pin(path,expected):
 # Only small public known-host material. Parent directories and private keys
 # remain existing trusted host prerequisites; this creates/writes nothing.
 fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW|os.O_CLOEXEC)
 try:
  before=os.fstat(fd)
  if not stat.S_ISREG(before.st_mode) or before.st_uid!=os.getuid() or stat.S_IMODE(before.st_mode)!=0o600 or not 0<before.st_size<=8192:raise ValueError('Public pin metadata unknown')
  data=os.read(fd,8193);after=os.fstat(fd)
  if len(data)!=before.st_size or (before.st_dev,before.st_ino,before.st_size,before.st_mtime_ns,before.st_ctime_ns)!=(after.st_dev,after.st_ino,after.st_size,after.st_mtime_ns,after.st_ctime_ns) or hashlib.sha256(data).hexdigest()!=expected:raise ValueError('Public pin bytes unknown')
  return {'path':path,'sha256':expected,'device':after.st_dev,'inode':after.st_ino,'mode':stat.S_IMODE(after.st_mode),'uid':after.st_uid}
 finally:os.close(fd)

def machine(expected):
 actual=pathlib.Path('/etc/machine-id').read_text().strip()
 if actual!=expected:raise ValueError('Controller identity mismatch')
 return actual

def age(value):
 parsed=datetime.datetime.fromisoformat(value.replace('Z','+00:00'))
 delta=(datetime.datetime.now(datetime.timezone.utc)-parsed).total_seconds()
 if parsed.tzinfo is None or not math.isfinite(delta) or not 0<=delta<=30:raise ValueError('Health stale/unknown')

def build_processes_valid(sample):
 details=sample.get('buildProcesses')
 count=sample.get('buildCount')
 allowed={'docker','buildx','docker-buildx','buildctl','node','npm','pnpm','yarn','next','next.js','next-build','build-client','runc','buildkit-runc'}
 if type(count) is not int or count<0 or not isinstance(details,list) or len(details)!=count:return False
 seen=set()
 for row in details:
  if not isinstance(row,dict) or set(row)!={'pid','name','etimes'}:return False
  if type(row['pid']) is not int or row['pid']<=0 or row['pid'] in seen:return False
  if not isinstance(row['name'],str) or row['name'] not in allowed or type(row['etimes']) is not int or row['etimes']<0:return False
  seen.add(row['pid'])
 return True

def health(sample):
 if not isinstance(sample,dict) or set(sample)!={'schema','observedHost','machineId','measuredFromMachineId','observedAt','freeBytes','load1','buildCount','buildProcesses','browserCount','sites'}:raise ValueError('Health fields unknown')
 if not build_processes_valid(sample):raise ValueError('Build process fields unknown')
 if sample['schema']!='yt-host-health-v1' or sample['observedHost']!='skyhong-blog' or sample['machineId']!=BLOG_ID or sample['measuredFromMachineId']!=BLOG_ID:raise ValueError('Blog identity unknown')
 age(sample['observedAt'])
 def number(x):return type(x) in (int,float) and math.isfinite(x)
 if not number(sample['freeBytes']) or sample['freeBytes']<40*1024**3 or not number(sample['load1']) or not 0<=sample['load1']<=12 or type(sample['buildCount']) is not int or sample['buildCount']!=0 or type(sample['browserCount']) is not int or not 0<=sample['browserCount']<=2:raise ValueError('Host gate unknown/failed')
 # Complete-time upper limits belong to the collector's SM observation.
 rows=sample['sites'];limits={'tag':2.0,'blog':6.17,'youtube':2.0}
 if not isinstance(rows,dict) or set(rows)!=set(limits):raise ValueError('Sites unknown')
 for name,limit in limits.items():
  row=rows[name]
  if not isinstance(row,dict) or set(row)!={'exitCode','status','totalSeconds'} or type(row['exitCode']) is not int or row['exitCode']!=0 or type(row['status']) is not int or row['status']!=200 or not number(row['totalSeconds']) or not 0<=row['totalSeconds']:raise ValueError('Complete HTML unknown/slow')
 return sample

def execute_hop(expected_controller,child_controller,argv,script_hash,known_path,known_hash,seconds,child_receipt=False):
 start=utc();row={'schema':'yt-readonly-relay-hop-v1','controllerMachineId':None,'expectedChildMachineId':child_controller,'startedAt':start,'finishedAt':None,'argv':argv,'scriptSha256':script_hash,'knownHosts':None,'timeoutSeconds':seconds,'outputCapBytes':65536,'exitCode':None,'stdoutBytes':None,'stderrBytes':None,'sample':None,'childReceipt':None,'ok':False,'unknown':True,'error':None,'admissionGranted':False}
 try:
  row['controllerMachineId']=machine(expected_controller)
  row['knownHosts']=pin(known_path,known_hash)
  code,out,err=BoundedRunner().run(argv,seconds)
  row.update(exitCode=code,stdoutBytes=len(out),stderrBytes=len(err))
  if code!=0:raise ValueError('SSH/probe failed')
  raw=decode(out)
  if child_receipt:
   # Reconstruct exact expected child argv and all bindings, never trust ok alone.
   if not isinstance(raw,dict) or set(raw)!=set(row):raise ValueError('Child receipt fields unknown')
   if raw['schema']!='yt-readonly-relay-hop-v1' or raw['controllerMachineId']!=child_controller or raw['expectedChildMachineId']!=BLOG_ID or raw['argv']!=BLOG_ARGV or raw['scriptSha256']!=BLOG_HASH or raw['knownHosts'] is None or raw['knownHosts'].get('path')!=BLOG_PATH or raw['knownHosts'].get('sha256')!=BLOG_PIN or raw['timeoutSeconds']!=15 or raw['outputCapBytes']!=65536 or type(raw['exitCode']) is not int or raw['exitCode']!=0 or raw['ok'] is not True or raw['unknown'] is not False or raw['error'] is not None or raw['admissionGranted'] is not False or raw['childReceipt'] is not None:raise ValueError('Child receipt binding unknown')
   known=raw['knownHosts']
   if set(known)!={'path','sha256','device','inode','mode','uid'} or known['mode']!=0o600 or any(type(known[k]) is not int or known[k]<0 for k in ('device','inode','uid')) or known['inode']==0:raise ValueError('Child public pin metadata unknown')
   if any(type(raw[k]) is not int or not 0<=raw[k]<=65536 for k in ('stdoutBytes','stderrBytes')) or raw['stdoutBytes']+raw['stderrBytes']>65536:raise ValueError('Child output bounds unknown')
   age(raw['startedAt']);age(raw['finishedAt'])
   if datetime.datetime.fromisoformat(raw['startedAt'])>datetime.datetime.fromisoformat(raw['finishedAt']):raise ValueError('Child times reversed')
   checked_sample=health(raw['sample'])
   row['childReceipt']=raw;row['sample']=checked_sample
  else:row['sample']=health(raw)
  row.update(ok=True,unknown=False)
 except Exception:
  row['error']='readonly-hop-unavailable-or-gate-failed'
 row['finishedAt']=utc()
 return row
'''


def ssh_argv(destination, known_hosts, script, *, identity=None):
    # -F /dev/null disables config-based proxying. No forwarding of any agent,
    # ports or X11; no new key/config, shell expansion or caller command exists.
    argv = ['/usr/bin/ssh', '-F', '/dev/null', '-a', '-x', '-o', 'BatchMode=yes',
            '-o', 'StrictHostKeyChecking=yes', '-o', 'UserKnownHostsFile=' + known_hosts,
            '-o', 'GlobalKnownHostsFile=/dev/null', '-o', 'ConnectTimeout=5',
            '-o', 'ConnectionAttempts=1', '-o', 'ClearAllForwardings=yes',
            '-o', 'RequestTTY=no', '-p', '22']
    if identity is not None:
        argv += ['-o', 'IdentitiesOnly=yes', '-o', 'IdentityAgent=none', '-i', identity]
    return argv + [destination, 'python3 -c ' + shlex.quote(script)]


def _bindings():
    return '\n'.join(name + '=' + repr(value) for name, value in {
        'BLOG_ID': BLOG_ID, 'BLOG_PATH': BLOG_KNOWN_HOSTS, 'BLOG_PIN': BLOG_PIN,
        'BLOG_HASH': BLOG_SCRIPT_SHA256,
        'BLOG_ARGV': ssh_argv('ubuntu@100.81.220.33', BLOG_KNOWN_HOSTS, BLOG_SCRIPT,
                              identity='/home/deck/.ssh/id_ed25519_t3code')}.items()) + '\n'


def sm_script():
    argv = ssh_argv('ubuntu@100.81.220.33', BLOG_KNOWN_HOSTS, BLOG_SCRIPT,
                    identity='/home/deck/.ssh/id_ed25519_t3code')
    return (COMMON + '\n' + _bindings() +
            'print(json.dumps(execute_hop(' + ','.join(repr(x) for x in
            (SM_ID, BLOG_ID, argv, BLOG_SCRIPT_SHA256, BLOG_KNOWN_HOSTS, BLOG_PIN, BLOG_SECONDS)) + ')))\n')


def mint_script():
    inner = sm_script()
    argv = ssh_argv('deck@100.85.214.25', SM_KNOWN_HOSTS, inner)
    return (COMMON + '\n' + _bindings() +
            'print(json.dumps(execute_hop(' + ','.join(repr(x) for x in
            (MINT_ID, SM_ID, argv, hashlib.sha256(inner.encode()).hexdigest(),
             SM_KNOWN_HOSTS, SM_PIN, MINT_SECONDS)) + ',child_receipt=True)))\n')


def preparation():
    """Inert source-only packet. Caller must not infer runtime/execution identity."""
    script = mint_script()
    return {'schema': 'yt-readonly-relay-preparation-v1', 'appSha': APP_SHA,
            'opsTargetSha': OPS_TARGET, 'opsRuntimeSha': None,
            'admissionDependencySha256': ADMISSION_SOURCE_SHA256,
            'blogScriptSha256': BLOG_SCRIPT_SHA256,
            'smScriptSha256': hashlib.sha256(sm_script().encode()).hexdigest(),
            'mintScriptSha256': hashlib.sha256(script.encode()).hexdigest(),
            'mintScript': script, 'runtimeReady': False, 'admissionGranted': False,
            'executionAllowed': False, 'globalSlotOwnerByUser': 'YT'}


def validate_receipt(raw, now):
    """Pure validation for an authenticated outer collector, never admission.

    The collector must independently bind actual Mint invocation/source. This
    parser cannot authenticate caller JSON. It keeps both transport controllers
    explicit and does not manufacture legacy direct-Mint transport flags.
    """
    def require(condition):
        if not condition:
            raise ValueError('Relay receipt unknown')

    def unique(pairs):
        result = {}
        for key, value in pairs:
            require(key not in result)
            result[key] = value
        return result

    def number(value):
        return type(value) in (int, float) and math.isfinite(value)

    def bounded_packet(value):
        # Bound existing caller objects before serialization. Reject cycles,
        # exotic objects, excessive depth/items and large primitive strings.
        stack = [(value, 0)]
        seen = set()
        items = 0
        strings = 0
        while stack:
            item, depth = stack.pop()
            items += 1
            require(items <= 4096 and depth <= 32)
            if isinstance(item, str):
                require(len(item) <= OUTPUT_CAP)
                strings += len(item.encode('utf-8'))
                require(strings <= OUTPUT_CAP)
            elif type(item) in (dict, list):
                require(id(item) not in seen and len(item) <= 4096)
                seen.add(id(item))
                if type(item) is dict:
                    require(all(isinstance(key, str) for key in item))
                    stack.extend((child, depth + 1) for pair in item.items() for child in pair)
                else:
                    stack.extend((child, depth + 1) for child in item)
                require(len(stack) <= 8192)
            else:
                require(item is None or type(item) is bool or number(item))
        chunks = []
        total = 0
        for chunk in json.JSONEncoder(allow_nan=False).iterencode(value):
            total += len(chunk.encode('utf-8'))
            require(total <= OUTPUT_CAP)
            chunks.append(chunk)
        return ''.join(chunks)

    def fresh(value):
        at = datetime.datetime.fromisoformat(value.replace('Z', '+00:00'))
        require(at.tzinfo is not None and 0 <= (now - at).total_seconds() <= 30)
        return at

    def hop(row, controller, child, argv, script_hash, path, digest, seconds, nested):
        keys = {'schema','controllerMachineId','expectedChildMachineId','startedAt','finishedAt',
                'argv','scriptSha256','knownHosts','timeoutSeconds','outputCapBytes','exitCode',
                'stdoutBytes','stderrBytes','sample','childReceipt','ok','unknown','error','admissionGranted'}
        require(isinstance(row, dict) and set(row) == keys)
        require(row['schema'] == 'yt-readonly-relay-hop-v1' and
                row['controllerMachineId'] == controller and row['expectedChildMachineId'] == child and
                row['argv'] == argv and row['scriptSha256'] == script_hash and
                type(row['timeoutSeconds']) is int and row['timeoutSeconds'] == seconds and
                type(row['outputCapBytes']) is int and row['outputCapBytes'] == OUTPUT_CAP and
                type(row['exitCode']) is int and row['exitCode'] == 0 and row['ok'] is True and
                row['unknown'] is False and row['error'] is None and row['admissionGranted'] is False)
        require(fresh(row['startedAt']) <= fresh(row['finishedAt']))
        require(all(type(row[k]) is int and 0 <= row[k] <= OUTPUT_CAP for k in ('stdoutBytes','stderrBytes'))
                and row['stdoutBytes'] + row['stderrBytes'] <= OUTPUT_CAP)
        pin = row['knownHosts']
        require(isinstance(pin, dict) and set(pin) == {'path','sha256','device','inode','mode','uid'} and
                pin['path'] == path and pin['sha256'] == digest and type(pin['mode']) is int and
                pin['mode'] == 0o600 and all(type(pin[k]) is int and pin[k] >= 0 for k in ('device','inode','uid'))
                and pin['inode'] > 0)
        require(isinstance(row['childReceipt'], dict) if nested else row['childReceipt'] is None)

    result = {'schema': 'yt-readonly-relay-validation-v1', 'ok': False, 'unknown': True,
              'originController': 'Mint', 'actualBlogController': 'SM',
              'route': ['Mint', 'SM', 'skyhong-blog'], 'sample': None,
              'admissionGranted': False, 'runtimeReady': False}
    try:
        require(isinstance(now, datetime.datetime) and now.tzinfo is not None)
        if isinstance(raw, (str, bytes)):
            require(len(raw) <= OUTPUT_CAP)
            require(len(raw.encode('utf-8')) <= OUTPUT_CAP if isinstance(raw, str) else True)
            packet = json.loads(raw, object_pairs_hook=unique)
            # Also bound depth/items on parsed input before traversing it.
            bounded_packet(packet)
        else:
            packet = json.loads(bounded_packet(raw), object_pairs_hook=unique)
        inner = sm_script()
        hop(packet, MINT_ID, SM_ID, ssh_argv('deck@100.85.214.25', SM_KNOWN_HOSTS, inner),
            hashlib.sha256(inner.encode()).hexdigest(), SM_KNOWN_HOSTS, SM_PIN, MINT_SECONDS, True)
        child = packet['childReceipt']
        hop(child, SM_ID, BLOG_ID, ssh_argv('ubuntu@100.81.220.33', BLOG_KNOWN_HOSTS, BLOG_SCRIPT,
                                          identity='/home/deck/.ssh/id_ed25519_t3code'),
            BLOG_SCRIPT_SHA256, BLOG_KNOWN_HOSTS, BLOG_PIN, BLOG_SECONDS, False)
        require(packet['sample'] == child['sample'])
        sample = child['sample']
        require(isinstance(sample, dict) and set(sample) == {'schema','observedHost','machineId',
                'measuredFromMachineId','observedAt','freeBytes','load1','buildCount','buildProcesses','browserCount','sites'})
        require(build_processes_valid(sample))
        require(sample['schema'] == 'yt-host-health-v1' and sample['observedHost'] == 'skyhong-blog' and
                sample['machineId'] == BLOG_ID and sample['measuredFromMachineId'] == BLOG_ID)
        fresh(sample['observedAt'])
        require(number(sample['freeBytes']) and sample['freeBytes'] >= 40*1024**3 and
                number(sample['load1']) and 0 <= sample['load1'] <= 12 and
                type(sample['buildCount']) is int and sample['buildCount'] == 0 and
                type(sample['browserCount']) is int and 0 <= sample['browserCount'] <= 2)
        limits = {'tag': 2.0, 'blog': 6.17, 'youtube': 2.0}
        require(isinstance(sample['sites'], dict) and set(sample['sites']) == set(limits))
        for site, limit in limits.items():
            row = sample['sites'][site]
            require(isinstance(row, dict) and set(row) == {'exitCode','status','totalSeconds'} and
                    type(row['exitCode']) is int and row['exitCode'] == 0 and
                    type(row['status']) is int and row['status'] == 200 and
                    number(row['totalSeconds']) and 0 <= row['totalSeconds'])
        result.update(ok=True, unknown=False, sample=sample)
    except (ValueError, TypeError, KeyError, AttributeError, OverflowError, RecursionError):
        pass
    return result
