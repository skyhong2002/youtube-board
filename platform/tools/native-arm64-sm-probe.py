"""Generate a fixed read-only probe; import never executes curl or SSH."""
import hashlib
from pathlib import Path
import types

_path = Path(__file__).with_name('native-arm64-admission.py')
_bytes = _path.read_bytes()
if hashlib.sha256(_bytes).hexdigest() != 'adea516d2f10f2c5412902183dfb1341565a0551ec9e720e4a7178d99f995a58':
    raise ValueError('Reviewed process probe pin mismatch')
_admission = types.ModuleType('pinned_process_probe')
exec(compile(_bytes, str(_path), 'exec'), _admission.__dict__)

SITE_SOURCE = r'''
import math
def collect_sites(runner=subprocess.run, clock=lambda:datetime.datetime.now(datetime.timezone.utc).isoformat()):
 result={}
 cache_values={'HIT','MISS','DYNAMIC','BYPASS','EXPIRED','STALE','REVALIDATED','UPDATING','NONE','UNKNOWN'}
 for name,url in sites.items():
  attempts=[]
  for index in range(3):
   row={'startedAt':clock(),'finishedAt':None,'exitCode':125,'status':None,'totalSeconds':None,'bytes':None,'cfCacheStatus':None}
   try:
    r=runner(['/usr/bin/curl','--disable','--silent','--show-error','--max-time','15','--output','/dev/null','--dump-header','-','--user-agent','youtube-board-verify/1.0','--header','DNT: 1','--header','Accept: text/html','--write-out','\nYT_PROBE_METRICS %{http_code} %{time_total} %{size_download}',url],capture_output=True,text=True,timeout=17,env={'PATH':'/usr/bin:/bin','LANG':'C'})
    row['exitCode']=r.returncode
    if len(r.stdout.encode())+len(r.stderr.encode())>65536:raise ValueError('Probe output exceeds cap')
    headers,metrics=r.stdout.rsplit('\nYT_PROBE_METRICS ',1)
    status,total,size=metrics.split()
    duration=float(total);size_number=float(size)
    if not math.isfinite(duration) or duration<0 or not math.isfinite(size_number) or size_number<0 or not size_number.is_integer():raise ValueError('Invalid curl metrics')
    row.update(status=int(status),totalSeconds=duration,bytes=int(size_number))
    for line in headers.splitlines():
     key,sep,value=line.partition(':')
     if sep and key.lower()=='cf-cache-status':
      value=value.strip().upper()
      row['cfCacheStatus']=value if value in cache_values else 'UNKNOWN'
   except subprocess.TimeoutExpired:row['exitCode']=28
   except (OSError,ValueError,TypeError,AttributeError,OverflowError):pass
   row['finishedAt']=clock();attempts.append(row)
  result[name]=attempts
 return result
rows=collect_sites()
'''


def readonly_script(host):
    if host not in ('SM', 'skyhong-blog'):
        raise ValueError('Only direct participating hosts allowed')
    script = _admission.readonly_script(host)
    start = script.index('for name,url in sites.items():')
    end = script.index('print(json.dumps(', start)
    return (script[:start] + SITE_SOURCE + '\n' + script[end:]).replace(
        "'schema':'yt-host-health-v1'", "'schema':'yt-host-health-median-v2'")
