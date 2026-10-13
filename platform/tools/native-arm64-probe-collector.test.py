"""Offline collector regression mocks; no probes, SSH, locks or builds."""
import copy,datetime,importlib.util,json,hashlib,io
from contextlib import redirect_stdout
from types import SimpleNamespace
from pathlib import Path
import unittest
spec=importlib.util.spec_from_file_location('collector',Path(__file__).with_name('native-arm64-probe-collector.py'))
collector=importlib.util.module_from_spec(spec);spec.loader.exec_module(collector)
SAMPLES = {'SM': {'schema': 'yt-host-health-v1', 'observedHost': 'SM', 'machineId': '302c2528bd464ad0953cf5fa743b6171', 'measuredFromMachineId': '302c2528bd464ad0953cf5fa743b6171', 'observedAt': '2026-10-13T14:27:47.433076+00:00', 'freeBytes': 66043949056, 'load1': 2.69775390625, 'buildCount': 0, 'buildProcesses': [], 'browserCount': 0, 'sites': {'tag': {'exitCode': 0, 'status': 200, 'totalSeconds': 1.645525}, 'blog': {'exitCode': 0, 'status': 200, 'totalSeconds': 3.849565}, 'youtube': {'exitCode': 0, 'status': 200, 'totalSeconds': 0.951278}}}, 'Mint': {'schema': 'yt-host-health-v1', 'observedHost': 'Mint', 'machineId': 'f80413057e6d4a179e248e5f8c08cac6', 'measuredFromMachineId': 'f80413057e6d4a179e248e5f8c08cac6', 'observedAt': '2026-10-13T14:27:49.158970+00:00', 'freeBytes': 153930539008, 'load1': 0.43359375, 'buildCount': 0, 'buildProcesses': [], 'browserCount': 0, 'sites': {'tag': {'exitCode': 0, 'status': 200, 'totalSeconds': 1.017652}, 'blog': {'exitCode': 0, 'status': 200, 'totalSeconds': 5.03065}, 'youtube': {'exitCode': 0, 'status': 200, 'totalSeconds': 2.210364}}}, 'skyhong-blog': {'schema': 'yt-host-health-v1', 'observedHost': 'skyhong-blog', 'machineId': '35ead342bacc44dea3633ccd2cc3f309', 'measuredFromMachineId': '35ead342bacc44dea3633ccd2cc3f309', 'observedAt': '2026-10-13T14:27:46.497556+00:00', 'freeBytes': 98894413824, 'load1': 1.76513671875, 'buildCount': 0, 'buildProcesses': [], 'browserCount': 0, 'sites': {'tag': {'exitCode': 0, 'status': 200, 'totalSeconds': 0.506305}, 'blog': {'exitCode': 0, 'status': 200, 'totalSeconds': 4.171554}, 'youtube': {'exitCode': 0, 'status': 200, 'totalSeconds': 0.115472}}}}
for sample in SAMPLES.values():sample['browserProcesses']=[]
NOW=datetime.datetime.fromisoformat(SAMPLES['Mint']['observedAt'])+datetime.timedelta(seconds=1)
relay_spec=importlib.util.spec_from_file_location('relay_cases',Path(__file__).with_name('native-arm64-readonly-relay.test.py'))
relay_cases=importlib.util.module_from_spec(relay_spec);relay_spec.loader.exec_module(relay_cases)
relay_cases.NOW=NOW

def rows():
    samples=copy.deepcopy(SAMPLES)
    ns=relay_cases.helpers()
    relay_cases.fake_controller(ns,out=json.dumps(samples['skyhong-blog']).encode())
    child=relay_cases.inner(ns)
    relay_cases.fake_controller(ns,out=json.dumps(child).encode())
    relay=relay_cases.relay;sm=relay.sm_script()
    nested=ns['execute_hop'](relay.MINT_ID,relay.SM_ID,
        relay.ssh_argv('deck@100.85.214.25',relay.SM_KNOWN_HOSTS,sm),
        hashlib.sha256(sm.encode()).hexdigest(),relay.SM_KNOWN_HOSTS,relay.SM_PIN,22,True)
    nested=json.loads(json.dumps(nested))
    return [dict(name='SM',exitCode=0,unknown=False,result=samples['SM']),dict(name='Mint',exitCode=0,unknown=False,result=samples['Mint']),dict(name='relay',exitCode=0,unknown=False,result=nested)]

def evaluate(data):
    nested=next((r['result'] for r in data if r['name']=='relay'),None)
    validation=relay_cases.relay.validate_receipt(json.dumps(nested),NOW)
    return collector.aggregate(data,NOW,validation)

class CollectorTests(unittest.TestCase):
    def test_receipt_5964142a_uses_SM_time(self):
        result=evaluate(rows())
        self.assertTrue(result['ok'])
        self.assertEqual(result['timeMeasurementHost'],'SM')
        self.assertGreater(SAMPLES['Mint']['sites']['youtube']['totalSeconds'],2)
        script=collector.collector_script('/var/lib/observe-worker/youtube/sources/test','a'*64,'b'*64)
        compile(script,'<inert-collector>','exec')
        self.assertIn("'aggregate':aggregate_result",script)
    def test_tampered_leaf_bindings_fail_strict_and_aggregate(self):
        for field,value in (('argv',['tampered']),('scriptSha256','0'*64),
                            ('controllerMachineId','0'*32),('extra','unexpected')):
            with self.subTest(field=field):
                data=rows()
                self.assertTrue(evaluate(data)['ok'])
                data[2]['result']['childReceipt'][field]=value
                validation=relay_cases.relay.validate_receipt(json.dumps(data[2]['result']),NOW)
                self.assertFalse(validation['ok'])
                result=collector.aggregate(data,NOW,validation)
                self.assertFalse(result['ok'])
                self.assertTrue(any(c['key']=='relay.strict-validation' and not c['ok'] for c in result['checks']))

    def test_strict_health_counts_and_sensitive_fields(self):
        for index in range(3):
            for field,value in (('buildProcesses',[dict(pid=9,name='docker',etimes=1)]),
                                ('browserProcesses',[dict(pid=9,name='chrome',etimes=1)]),
                                ('sensitive','secret-sentinel')):
                data=rows();sample=data[index]['result']
                if index==2:sample=sample['sample']
                sample[field]=value
                result=evaluate(data)
                self.assertFalse(result['ok'])
                self.assertNotIn('secret-sentinel',json.dumps(result))

    def test_process_entry_extra_fields_are_rejected(self):
        for key,count_key,name in (('buildProcesses','buildCount','docker'),('browserProcesses','browserCount','chrome')):
            sample=copy.deepcopy(SAMPLES['Mint'])
            sample[count_key]=1
            sample[key]=[dict(pid=9,name=name,etimes=1)]
            self.assertTrue(collector.health_valid(sample))
            sample[key][0]['argv']='secret-sentinel'
            self.assertFalse(collector.health_valid(sample))

    def test_decode_boundary_discards_unexpected_sensitive_fields(self):
        ns={'helpers':{'utc':lambda:NOW.isoformat(),'decode':json.loads,
            'BoundedRunner':lambda:type('Runner',(),{'run':lambda self,*args:(0,json.dumps(dict(SAMPLES['Mint'],sensitive='secret-sentinel')).encode(),b'')})()},
            'av':{'Mint':['fixed']},'scripts':{'Mint':'fixed'},'hashlib':hashlib,
            'health_valid':collector.health_valid}
        template=collector.COLLECTOR_TEMPLATE
        start=template.index('def collect(name):');end=template.index('with concurrent.futures',start)
        exec(compile(template[start:end],'<mock-collect>','exec'),ns)
        result=ns['collect']('Mint')
        self.assertTrue(result['unknown'])
        self.assertIsNone(result['result'])
        self.assertNotIn('secret-sentinel',json.dumps(result))

    def test_identity_sentinel_is_discarded_before_final_output(self):
        script=collector.collector_script('/var/lib/observe-worker/youtube/sources/test','a'*64,'b'*64)
        collect_text=script[script.index('def collect(name):'):script.index('with concurrent.futures')]
        final_print=script[script.rindex('print(json.dumps('):]
        for host in ('SM','Mint'):
            for field in ('schema','observedHost','machineId','measuredFromMachineId','observedAt'):
                with self.subTest(host=host,field=field):
                    payload=copy.deepcopy(SAMPLES[host]);payload[field]='review-sentinel-secret'
                    self.assertFalse(collector.health_valid(payload,host))
                    runner=SimpleNamespace(run=lambda *args:(0,json.dumps(payload).encode(),b''))
                    ns={'helpers':{'utc':lambda:NOW.isoformat(),'decode':json.loads,'BoundedRunner':lambda:runner},
                        'av':{host:['fixed']},'scripts':{host:'fixed'},'hashlib':hashlib,
                        'health_valid':collector.health_valid,'json':json}
                    exec(compile(collect_text,'<mock-collect>','exec'),ns)
                    row=ns['collect'](host)
                    self.assertTrue(row['unknown']);self.assertIsNone(row['result'])
                    ns.update(rows=[row],relay=SimpleNamespace(MINT_ID=relay_cases.relay.MINT_ID),root='/private/test',
                              actual_pin={},validation={'ok':False},aggregate_result={'ok':False})
                    out=io.StringIO()
                    with redirect_stdout(out):exec(compile(final_print,'<mock-final-print>','exec'),ns)
                    self.assertNotIn('review-sentinel-secret',out.getvalue())

    def test_health_identity_pins_and_UTC_format(self):
        for host in SAMPLES:
            sample=copy.deepcopy(SAMPLES[host])
            self.assertTrue(collector.health_valid(sample,host))
            other='SM' if host!='SM' else 'Mint'
            self.assertFalse(collector.health_valid(sample,other))
            for key,value in (('machineId','0'*32),('measuredFromMachineId','A'*32),
                              ('observedAt','2026-10-13T14:27:47+01:00'),
                              ('observedAt','2026-10-13T14:27:47'),
                              ('observedAt','2026-02-30T14:27:47Z')):
                bad=copy.deepcopy(sample);bad[key]=value
                self.assertFalse(collector.health_valid(bad,host))
            sample['observedAt']='2026-10-13T14:27:47Z'
            self.assertTrue(collector.health_valid(sample,host))

    def test_any_host_curl_56_denies(self):
        for index in range(3):
            data=rows();sample=data[index]['result']
            if index==2:sample=sample['sample']
            sample['sites']['youtube']['exitCode']=56
            result=evaluate(data)
            self.assertFalse(result['ok'])
            self.assertTrue(any(not c['ok'] and c['key'].endswith('.http') for c in result['checks']))
    def test_leaf_existing_build_denies(self):
        data=rows();data[2]['result']['sample']['buildCount']=1
        self.assertFalse(evaluate(data)['ok'])
    def test_SM_slow_or_any_non200_denies(self):
        data=rows();data[0]['result']['sites']['youtube']['totalSeconds']=2.001
        self.assertFalse(evaluate(data)['ok'])
        for status in (404,503):
            data=rows();data[1]['result']['sites']['tag']['status']=status
            self.assertFalse(evaluate(data)['ok'])
    def test_shared_browser_sum_and_missing_host_deny(self):
        data=rows();data[0]['result']['browserCount']=2;data[1]['result']['browserCount']=1
        data[0]['result']['browserProcesses']=[dict(pid=9,name='chrome',etimes=1),dict(pid=10,name='chrome',etimes=1)]
        data[1]['result']['browserProcesses']=[dict(pid=11,name='chrome',etimes=1)]
        self.assertFalse(evaluate(data)['ok'])
        self.assertFalse(evaluate(rows()[:2])['ok'])
if __name__=='__main__':unittest.main()
