"""Inert three-host collector and aggregate preflight; never grants admission."""
import datetime
import math

AGGREGATE_SOURCE = r'''def health_valid(sample):
 keys={'schema','observedHost','machineId','measuredFromMachineId','observedAt','freeBytes','load1','buildCount','buildProcesses','browserCount','browserProcesses','sites'}
 if not isinstance(sample,dict) or set(sample)!=keys:return False
 for key in ('schema','observedHost','machineId','measuredFromMachineId','observedAt'):
  if not isinstance(sample[key],str):return False
 for key in ('freeBytes','load1'):
  if type(sample[key]) not in (int,float) or not math.isfinite(sample[key]) or sample[key]<0:return False
 build_names={'docker','buildx','docker-buildx','buildctl','node','npm','pnpm','yarn','next','next.js','next-build','build-client','runc','buildkit-runc'}
 browser_names={'chrome','chromium','chromium-browser','chrome-headless-shell','google-chrome','google-chrome-stable'}
 for count_key,details_key,names in (('buildCount','buildProcesses',build_names),('browserCount','browserProcesses',browser_names)):
  count=sample[count_key];details=sample[details_key];seen=set()
  if type(count) is not int or count<0 or not isinstance(details,list) or len(details)!=count:return False
  for row in details:
   if not isinstance(row,dict) or set(row)!={'pid','name','etimes'}:return False
   if type(row['pid']) is not int or row['pid']<=0 or row['pid'] in seen or not isinstance(row['name'],str) or row['name'] not in names or type(row['etimes']) is not int or row['etimes']<0:return False
   seen.add(row['pid'])
 sites=sample['sites']
 if not isinstance(sites,dict) or set(sites)!={'tag','blog','youtube'}:return False
 for row in sites.values():
  if not isinstance(row,dict) or set(row)!={'exitCode','status','totalSeconds'}:return False
  if type(row['exitCode']) is not int or type(row['status']) is not int:return False
  if type(row['totalSeconds']) not in (int,float) or not math.isfinite(row['totalSeconds']) or row['totalSeconds']<0:return False
 return True

def aggregate(rows, now, relay_validation):
 limits={'tag':2.0,'blog':6.17,'youtube':2.0}
 ids={'SM':'302c2528bd464ad0953cf5fa743b6171','Mint':'f80413057e6d4a179e248e5f8c08cac6','skyhong-blog':'35ead342bacc44dea3633ccd2cc3f309'}
 checks=[]
 def check(key,ok,reason):checks.append({'key':key,'ok':bool(ok),'reason':reason})
 check('relay.strict-validation',isinstance(relay_validation,dict) and relay_validation.get('schema')=='yt-readonly-relay-validation-v1' and relay_validation.get('ok') is True and relay_validation.get('unknown') is False and relay_validation.get('admissionGranted') is False and relay_validation.get('runtimeReady') is False,'strict-relay-validation-must-pass')
 def number(x):return type(x) in (int,float) and math.isfinite(x)
 def fresh(value):
  try:
   at=datetime.datetime.fromisoformat(value.replace('Z','+00:00'))
   age=(now-at).total_seconds()
   return at.tzinfo is not None and math.isfinite(age) and 0<=age<=30
  except (ValueError,TypeError,AttributeError,OverflowError):return False
 if not isinstance(rows,list):rows=[]
 index={}
 for row in rows:
  if not isinstance(row,dict) or row.get('name') not in ('SM','Mint','relay') or row['name'] in index:
   check('collector.rows',False,'unknown-or-duplicate-row');continue
  index[row['name']]=row
 check('collector.rows-complete',set(index)=={'SM','Mint','relay'},'exactly-SM-Mint-relay-required')
 samples={}
 for host in ids:
  row=index.get('relay' if host=='skyhong-blog' else host,{})
  check(host+'.collector-exit',type(row.get('exitCode')) is int and row['exitCode']==0 and row.get('unknown') is False,'collector-exit-must-be-zero-and-known')
  sample=row.get('result')
  if host=='skyhong-blog':
   relay=sample if isinstance(sample,dict) else {}
   check(host+'.relay',relay.get('ok') is True and relay.get('unknown') is False,'pinned-relay-must-pass')
   child=relay.get('childReceipt')
   check(host+'.ssh-exit',isinstance(child,dict) and type(child.get('exitCode')) is int and child['exitCode']==0,'leaf-ssh-exit-must-be-zero')
   sample=relay.get('sample')
  if not health_valid(sample):
   check(host+'.sample',False,'missing-or-nonstrict-health-sample');continue
  samples[host]=sample
  check(host+'.identity',sample.get('schema')=='yt-host-health-v1' and sample.get('observedHost')==host and sample.get('machineId')==ids[host] and sample.get('measuredFromMachineId')==ids[host] and fresh(sample.get('observedAt')),'matching-host-and-fresh-30s-health-required')
  check(host+'.disk',number(sample.get('freeBytes')) and sample['freeBytes']>=40*1024**3,'start-floor-40-GiB')
  check(host+'.load',number(sample.get('load1')) and 0<=sample['load1']<=12,'load-must-be-between-zero-and-12')
  check(host+'.builds',type(sample.get('buildCount')) is int and sample['buildCount']==0,'new-build-requires-no-existing-build')
  check(host+'.browsers',type(sample.get('browserCount')) is int and 0<=sample['browserCount']<=2,'per-host-browser-count-zero-to-two')
  sites=sample.get('sites');sites=sites if isinstance(sites,dict) else {}
  check(host+'.sites',set(sites)==set(limits),'all-three-site-observations-required')
  for site,limit in limits.items():
   value=sites.get(site);value=value if isinstance(value,dict) else {}
   check(host+'.'+site+'.http',type(value.get('exitCode')) is int and value['exitCode']==0 and type(value.get('status')) is int and value['status']==200,'curl-zero-and-HTTP-200-required-at-every-host')
   duration=value.get('totalSeconds')
   check(host+'.'+site+'.time-known',number(duration) and duration>=0,'finite-nonnegative-complete-HTML-time-required')
   if host=='SM':check(host+'.'+site+'.time-gate',number(duration) and 0<=duration<=limit,'SM-time-limit-'+str(limit)+'s')
 valid_counts=len(samples)==3 and all(type(s.get('browserCount')) is int and s['browserCount']>=0 for s in samples.values())
 check('global.browsers',valid_counts and sum(s['browserCount'] for s in samples.values())<=2,'all-host-browser-sum-at-most-two')
 return {'schema':'yt-three-host-aggregate-v1','ok':all(c['ok'] for c in checks),'timeMeasurementHost':'SM','timeLimitsSeconds':limits,'diskFloorsBytes':{h:40*1024**3 for h in ids},'checks':checks,'admissionGranted':False}
'''
exec(compile(AGGREGATE_SOURCE, '<fixed-aggregate>', 'exec'))

COLLECTOR_TEMPLATE = "import pathlib,hashlib,types,sys,json,datetime,concurrent.futures,stat,os\nroot=pathlib.Path('__SOURCE_ROOT__')\nmodules={}\nfor name,pin in [('native-arm64-readonly-relay.py','__RELAY_HASH__'),('native-arm64-admission.py','__ADMISSION_HASH__')]:\n p=root/name;s=p.lstat();data=p.read_bytes()\n if not stat.S_ISREG(s.st_mode) or s.st_uid!=os.getuid() or s.st_mode&0o777!=0o600 or hashlib.sha256(data).hexdigest()!=pin:raise ValueError('Source materialization identity unknown')\n mod=types.ModuleType(name);sys.modules[name]=mod;exec(compile(data,str(p),'exec'),mod.__dict__);modules[name]=mod\nrelay=modules['native-arm64-readonly-relay.py'];native=modules['native-arm64-admission.py']\nhelpers={};exec(compile(relay.COMMON+chr(10)+relay._bindings(),'<reviewedrelayhelpers>','exec'),helpers)\nif helpers['machine'](relay.MINT_ID)!=relay.MINT_ID:raise ValueError('Mint identity mismatch')\nactual_pin=helpers['pin'](relay.SM_KNOWN_HOSTS,relay.SM_PIN)\nscripts={'Mint':native.readonly_script('Mint'),'SM':native.readonly_script('SM'),'relay':relay.mint_script()}\ncontract=types.SimpleNamespace(known_hosts_sha256=(relay.SM_PIN,'',''))\npinevidence={'regular':True,'symlink':False,'ownedByController':True,'mode':actual_pin['mode'],'sha256':actual_pin['sha256']}\nsm_spec=native.readonly_ssh_spec('SM','deck@100.85.214.25',relay.SM_KNOWN_HOSTS,pinevidence,contract)\nav={'SM':sm_spec['argv'],'Mint':['/usr/bin/python3','-c',scripts['Mint']],'relay':['/usr/bin/python3','-c',scripts['relay']]}\ndef collect(name):\n start=helpers['utc']();seconds=30 if name=='relay' else 20\n row={'name':name,'startedAt':start,'finishedAt':None,'argv':av[name],'scriptSha256':hashlib.sha256(scripts[name].encode()).hexdigest(),'timeoutSeconds':seconds,'outputCapBytes':65536,'exitCode':None,'stdoutBytes':None,'stderrBytes':None,'result':None,'unknown':True}\n try:\n  code,stdout,stderr=helpers['BoundedRunner']().run(av[name],seconds)\n  row.update(exitCode=code,stdoutBytes=len(stdout),stderrBytes=len(stderr))\n  if code==0:\n   candidate=helpers['decode'](stdout)\n   valid=relay.validate_receipt(candidate,datetime.datetime.now(datetime.timezone.utc))['ok'] if name=='relay' else health_valid(candidate)\n   if valid:row['result']=candidate;row['unknown']=False\n except Exception:pass\n row['finishedAt']=helpers['utc']()\n return row\nwith concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:\n rows=[f.result() for f in [pool.submit(collect,name) for name in ('SM','Mint','relay')]]\nbyname={row['name']:row for row in rows};validation=relay.validate_receipt(byname['relay']['result'],datetime.datetime.now(datetime.timezone.utc))\nprint(json.dumps({'schema':'yt-actual-mint-three-host-probe-v1','controllerMachineId':relay.MINT_ID,'sourceRoot':str(root),'sourceHashes':{'relay':'__RELAY_HASH__','admission':'__ADMISSION_HASH__'},'mintSmPin':actual_pin,'rows':rows,'relayValidation':validation,'observedAt':helpers['utc'](),'admissionGranted':False,'runtimeReady':False}))\n"

def collector_script(source_root, relay_hash, admission_hash):
    import re
    if not isinstance(source_root,str) or not re.fullmatch(r'/var/lib/observe-worker/youtube/sources/[A-Za-z0-9_-]+',source_root):
        raise ValueError('Private fixed source path required')
    for digest in (relay_hash,admission_hash):
        if not isinstance(digest,str) or not re.fullmatch(r'[0-9a-f]{64}',digest):raise ValueError('Source hash required')
    script=COLLECTOR_TEMPLATE.replace('__SOURCE_ROOT__',source_root).replace('__RELAY_HASH__',relay_hash).replace('__ADMISSION_HASH__',admission_hash)
    script=script.replace("print(json.dumps({'schema':'yt-actual-mint-three-host-probe-v1'", "aggregate_result=aggregate(rows,datetime.datetime.now(datetime.timezone.utc),validation)\nprint(json.dumps({'aggregate':aggregate_result,'schema':'yt-actual-mint-three-host-probe-v1'")
    return 'import math,datetime\n'+AGGREGATE_SOURCE+'\n'+script
