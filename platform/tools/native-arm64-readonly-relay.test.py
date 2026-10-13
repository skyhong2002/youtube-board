"""Mocked relay only: no SSH, pin-file IO, processes, signals or network."""
import copy
import datetime
import hashlib
import importlib.util
import json
from pathlib import Path
import stat
from types import SimpleNamespace
import unittest

spec = importlib.util.spec_from_file_location('relay', Path(__file__).with_name('native-arm64-readonly-relay.py'))
relay = importlib.util.module_from_spec(spec)
spec.loader.exec_module(relay)
NOW = datetime.datetime(2026, 10, 13, 12, 0, tzinfo=datetime.timezone.utc)


class FixedDate(datetime.datetime):
    @classmethod
    def now(cls, tz=None):
        return NOW


def helpers():
    ns = {}
    exec(compile(relay.COMMON + '\n' + relay._bindings(), '<relay helpers>', 'exec'), ns)
    ns['datetime'] = SimpleNamespace(datetime=FixedDate, timezone=datetime.timezone)
    return ns


def healthy():
    return dict(schema='yt-host-health-v1', observedHost='skyhong-blog', machineId=relay.BLOG_ID,
                measuredFromMachineId=relay.BLOG_ID, observedAt=NOW.isoformat(),
                freeBytes=50 * 1024**3, load1=1, buildCount=0, browserCount=0,
                sites={name: dict(exitCode=0, status=200, totalSeconds=.5)
                       for name in ('tag', 'blog', 'youtube')})


def child_argv():
    return relay.ssh_argv('ubuntu@100.81.220.33', relay.BLOG_KNOWN_HOSTS, relay.BLOG_SCRIPT,
                          identity='/home/deck/.ssh/id_ed25519_t3code')


def fake_controller(ns, code=0, out=None, stderr=b''):
    ns['machine'] = lambda expected: expected
    ns['pin'] = lambda path, digest: dict(path=path, sha256=digest, device=1, inode=2,
                                         mode=0o600, uid=1000)
    ns['BoundedRunner'] = lambda: SimpleNamespace(run=lambda argv, seconds:
         (code, json.dumps(healthy()).encode() if out is None else out, stderr))


def inner(ns):
    return ns['execute_hop'](relay.SM_ID, relay.BLOG_ID, child_argv(), relay.BLOG_SCRIPT_SHA256,
                             relay.BLOG_KNOWN_HOSTS, relay.BLOG_PIN, relay.BLOG_SECONDS)


class RelayTests(unittest.TestCase):
    def test_inert_preparation_and_fixed_scripts(self):
        packet = relay.preparation()
        self.assertFalse(packet['admissionGranted'])
        self.assertFalse(packet['executionAllowed'])
        self.assertIsNone(packet['opsRuntimeSha'])
        self.assertEqual(packet['opsTargetSha'], '5a5be6833ee2f32d35bce021db43d3627fdd7c8f')
        self.assertEqual(hashlib.sha256(relay.BLOG_SCRIPT.encode()).hexdigest(), relay.BLOG_SCRIPT_SHA256)
        for script in (relay.mint_script(), relay.sm_script()):
            compile(script, '<in-memory only>', 'exec')
        argv = child_argv()
        self.assertIn('-a', argv)
        self.assertIn('IdentityAgent=none', argv)
        self.assertIn('StrictHostKeyChecking=yes', argv)
        self.assertIn('ubuntu@100.81.220.33', argv)
        self.assertNotIn('ProxyCommand', ' '.join(argv[:argv.index('ubuntu@100.81.220.33')]))

    def test_complete_nested_receipt_is_health_only(self):
        ns = helpers(); fake_controller(ns)
        receipt = inner(ns)
        self.assertTrue(receipt['ok'])
        fake_controller(ns, out=json.dumps(receipt).encode())
        outer = ns['execute_hop'](relay.MINT_ID, relay.SM_ID, ['fixed-mock-argv'], 'a'*64,
                                 relay.SM_KNOWN_HOSTS, relay.SM_PIN, relay.MINT_SECONDS, True)
        self.assertTrue(outer['ok'])
        self.assertEqual(outer['childReceipt'], receipt)
        self.assertFalse(outer['admissionGranted'])

    def test_exit_failure_and_raw_stderr_are_unknown(self):
        ns = helpers(); fake_controller(ns, code=255, out=b'', stderr=b'secret-value')
        receipt = inner(ns)
        self.assertEqual(receipt['exitCode'], 255)
        self.assertFalse(receipt['ok'])
        self.assertTrue(receipt['unknown'])
        self.assertNotIn('secret-value', json.dumps(receipt))

    def test_duplicate_or_nonjson_output_unknown(self):
        for output in (b'{"x":1,"x":2}', b'secret-nonjson', b'null'):
            ns = helpers(); fake_controller(ns, out=output)
            self.assertTrue(inner(ns)['unknown'])

    def test_controller_or_pin_failure_never_dispatches(self):
        for boundary in ('machine', 'pin'):
            ns = helpers(); fake_controller(ns)
            ns[boundary] = lambda *args: (_ for _ in ()).throw(ValueError('secret error'))
            ns['BoundedRunner'] = lambda: self.fail('must not dispatch')
            result = inner(ns)
            self.assertTrue(result['unknown'])
            self.assertIsNone(result['exitCode'])
            self.assertNotIn('secret error', json.dumps(result))

    def test_health_gates_and_identity_fail_closed(self):
        changes = [('machineId', '0'*32), ('load1', 13), ('load1', float('nan')),
                   ('freeBytes', 39*1024**3), ('buildCount', 1), ('browserCount', 3),
                   ('browserCount', True), ('observedAt', (NOW-datetime.timedelta(seconds=31)).isoformat()),
                   ('observedAt', (NOW+datetime.timedelta(seconds=1)).isoformat())]
        for key, value in changes:
            sample = healthy(); sample[key] = value
            ns = helpers(); fake_controller(ns, out=json.dumps(sample).encode())
            self.assertTrue(inner(ns)['unknown'], key)
        for name, limit in [('tag',2),('blog',6.17),('youtube',2)]:
            sample = healthy(); sample['sites'][name]['totalSeconds'] = limit + .001
            ns = helpers(); fake_controller(ns, out=json.dumps(sample).encode())
            self.assertTrue(inner(ns)['unknown'])
        sample = healthy();sample['sites']['blog']['status']=500
        ns=helpers();fake_controller(ns,out=json.dumps(sample).encode());self.assertTrue(inner(ns)['unknown'])

    def test_child_true_cannot_replace_bindings(self):
        ns = helpers();fake_controller(ns); receipt=inner(ns)
        changes = [('controllerMachineId',relay.MINT_ID), ('expectedChildMachineId','0'*32),
                   ('argv', ['arbitrary']), ('scriptSha256','0'*64), ('timeoutSeconds',999),
                   ('exitCode',255), ('admissionGranted',True), ('stdoutBytes',65537),
                   ('startedAt',(NOW-datetime.timedelta(seconds=31)).isoformat()),
                   ('unknown',True), ('extra',True)]
        for key,value in changes:
            changed=copy.deepcopy(receipt);changed[key]=value
            fake_controller(ns,out=json.dumps(changed).encode())
            result=ns['execute_hop'](relay.MINT_ID,relay.SM_ID,['fixed'],'a'*64,relay.SM_KNOWN_HOSTS,relay.SM_PIN,22,True)
            self.assertTrue(result['unknown'],key)

    def test_rejected_nested_payload_is_never_retained(self):
        ns=helpers();fake_controller(ns);receipt=inner(ns)
        receipt['sample']['unexpected']='secret-value-that-must-not-return'
        fake_controller(ns,out=json.dumps(receipt).encode())
        result=ns['execute_hop'](relay.MINT_ID,relay.SM_ID,['fixed'],'a'*64,relay.SM_KNOWN_HOSTS,relay.SM_PIN,22,True)
        self.assertTrue(result['unknown'])
        self.assertIsNone(result['childReceipt'])
        self.assertIsNone(result['sample'])
        self.assertNotIn('secret-value-that-must-not-return',json.dumps(result))

    def test_pin_requires_exact_owner_mode_hash_stable_file(self):
        ns=helpers(); data=b'public host only\n'; digest=hashlib.sha256(data).hexdigest()
        info=SimpleNamespace(st_mode=stat.S_IFREG|0o600,st_uid=1000,st_size=len(data),
                             st_dev=1,st_ino=2,st_mtime_ns=3,st_ctime_ns=4)
        closes=[]; opens=[]
        def opened(path,flags):opens.append((path,flags));return 7
        ns['os']=SimpleNamespace(open=opened,read=lambda fd,n:data,fstat=lambda fd:info,
                                 getuid=lambda:1000,close=lambda fd:closes.append(fd),
                                 O_RDONLY=0,O_NOFOLLOW=16,O_CLOEXEC=32)
        self.assertEqual(ns['pin']('/fixed',digest)['sha256'],digest)
        self.assertEqual(opens,[('/fixed',48)])
        for attr,value in [('st_uid',0),('st_mode',stat.S_IFREG|0o644),('st_size',8193)]:
            old=getattr(info,attr);setattr(info,attr,value)
            with self.assertRaises(ValueError):ns['pin']('/fixed',digest)
            setattr(info,attr,old)
        with self.assertRaises(ValueError):ns['pin']('/fixed','0'*64)
        self.assertEqual(closes,[7]*5)

    def test_pure_outer_validator_requires_real_fixed_route_not_true_flags(self):
        ns=helpers();fake_controller(ns);child=inner(ns)
        fake_controller(ns,out=json.dumps(child).encode())
        sm=relay.sm_script();argv=relay.ssh_argv('deck@100.85.214.25',relay.SM_KNOWN_HOSTS,sm)
        raw=ns['execute_hop'](relay.MINT_ID,relay.SM_ID,argv,hashlib.sha256(sm.encode()).hexdigest(),
                               relay.SM_KNOWN_HOSTS,relay.SM_PIN,22,True)
        validated=relay.validate_receipt(json.dumps(raw),NOW)
        self.assertTrue(validated['ok'])
        self.assertEqual(validated['actualBlogController'],'SM')
        self.assertFalse(validated['admissionGranted'])
        for key,value in [('argv',['arbitrary']),('controllerMachineId',relay.SM_ID),('ok',False),('admissionGranted',True)]:
            changed=copy.deepcopy(raw);changed[key]=value
            self.assertTrue(relay.validate_receipt(changed,NOW)['unknown'],key)
        self.assertTrue(relay.validate_receipt(raw,NOW+datetime.timedelta(seconds=31))['unknown'])
        self.assertTrue(relay.validate_receipt('{"ok":true,"ok":true}',NOW)['unknown'])

    def test_public_parser_rejects_oversize_deep_cyclic_and_exotic_input(self):
        cyclic={};cyclic['self']=cyclic
        deep={};current=deep
        for _ in range(40):
            current['next']={};current=current['next']
        for value in ('{}'+' '*65535,b'{}'+b' '*65535,{'x':'x'*65537},
                      {'x':[None]*4097},cyclic,deep,{'x':object()},'['*1100+'0'+']'*1100):
            self.assertTrue(relay.validate_receipt(value,NOW)['unknown'])


class Pipe:
    def __init__(self,fd):self.fd=fd;self.closed=False
    def fileno(self):return self.fd
    def close(self):self.closed=True


class Child:
    def __init__(self,code=0):self.stdout=Pipe(1);self.stderr=Pipe(2);self.code=code;self.killed=False;self.waits=[]
    def wait(self,timeout):self.waits.append(timeout);return self.code
    def poll(self):return None
    def kill(self):self.killed=True


class Selector:
    def __init__(self):self.keys={};self.closed=False
    def register(self,stream,event,data):self.keys[stream.fd]=SimpleNamespace(fileobj=stream,data=data)
    def unregister(self,stream):del self.keys[stream.fd]
    def get_map(self):return self.keys
    def select(self,timeout):return [(k,1) for k in list(self.keys.values())]
    def close(self):self.closed=True


class RunnerTests(unittest.TestCase):
    def run_case(self,chunks,clock=lambda:0,code=0):
        ns=helpers();child=Child(code);selector=Selector();calls=[]
        def popen(argv,**kwargs):calls.append((argv,kwargs));return child
        def read(fd,n):
            queue=chunks.setdefault(fd,[])
            part=queue.pop(0) if queue else b''
            self.assertLessEqual(len(part),n)
            return part
        runner=ns['BoundedRunner'](popen=popen,selector=lambda:selector,read=read,clock=clock)
        return runner,child,selector,calls

    def test_success_fixed_env_and_pipe_cleanup(self):
        runner,child,selector,calls=self.run_case({1:[b'{}'],2:[b'error']})
        self.assertEqual(runner.run(['fixed'],15),(0,b'{}',b'error'))
        self.assertEqual(calls[0][1]['env'],{'PATH':'/usr/bin:/bin','LANG':'C'})
        self.assertEqual(calls[0][1]['cwd'],'/')
        self.assertNotIn('shell',calls[0][1])
        self.assertFalse(child.killed);self.assertTrue(selector.closed)
        self.assertTrue(child.stdout.closed and child.stderr.closed)

    def test_combined_output_cap_closes_only_own_child(self):
        chunks={1:[b'x'*4096]*16+[b'x'],2:[]}
        runner,child,selector,calls=self.run_case(chunks)
        with self.assertRaises(ValueError):runner.run(['fixed'],15)
        self.assertTrue(child.killed);self.assertEqual(child.waits[-1],.5)
        self.assertTrue(selector.closed and child.stdout.closed and child.stderr.closed)

    def test_deadline_and_backwards_clock_fail_closed(self):
        for values in ([0,0,16],[0,0,-1]):
            ticks=iter(values);runner,child,selector,calls=self.run_case({},lambda:next(ticks))
            with self.assertRaises(ValueError):runner.run(['fixed'],15)
            self.assertTrue(child.killed)

    def test_noninteger_exit_unknown(self):
        runner,child,selector,calls=self.run_case({},code=True)
        with self.assertRaises(ValueError):runner.run(['fixed'],15)
        self.assertTrue(child.killed)


if __name__ == '__main__':
    unittest.main()
