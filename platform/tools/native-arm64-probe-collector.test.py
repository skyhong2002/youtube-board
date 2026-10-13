"""Offline collector regression mocks; no probes, SSH, locks or builds."""
import copy,datetime,importlib.util
from pathlib import Path
import unittest
spec=importlib.util.spec_from_file_location('collector',Path(__file__).with_name('native-arm64-probe-collector.py'))
collector=importlib.util.module_from_spec(spec);spec.loader.exec_module(collector)
SAMPLES = {'SM': {'schema': 'yt-host-health-v1', 'observedHost': 'SM', 'machineId': '302c2528bd464ad0953cf5fa743b6171', 'measuredFromMachineId': '302c2528bd464ad0953cf5fa743b6171', 'observedAt': '2026-10-13T14:27:47.433076+00:00', 'freeBytes': 66043949056, 'load1': 2.69775390625, 'buildCount': 0, 'buildProcesses': [], 'browserCount': 0, 'sites': {'tag': {'exitCode': 0, 'status': 200, 'totalSeconds': 1.645525}, 'blog': {'exitCode': 0, 'status': 200, 'totalSeconds': 3.849565}, 'youtube': {'exitCode': 0, 'status': 200, 'totalSeconds': 0.951278}}}, 'Mint': {'schema': 'yt-host-health-v1', 'observedHost': 'Mint', 'machineId': 'f80413057e6d4a179e248e5f8c08cac6', 'measuredFromMachineId': 'f80413057e6d4a179e248e5f8c08cac6', 'observedAt': '2026-10-13T14:27:49.158970+00:00', 'freeBytes': 153930539008, 'load1': 0.43359375, 'buildCount': 0, 'buildProcesses': [], 'browserCount': 0, 'sites': {'tag': {'exitCode': 0, 'status': 200, 'totalSeconds': 1.017652}, 'blog': {'exitCode': 0, 'status': 200, 'totalSeconds': 5.03065}, 'youtube': {'exitCode': 0, 'status': 200, 'totalSeconds': 2.210364}}}, 'skyhong-blog': {'schema': 'yt-host-health-v1', 'observedHost': 'skyhong-blog', 'machineId': '35ead342bacc44dea3633ccd2cc3f309', 'measuredFromMachineId': '35ead342bacc44dea3633ccd2cc3f309', 'observedAt': '2026-10-13T14:27:46.497556+00:00', 'freeBytes': 98894413824, 'load1': 1.76513671875, 'buildCount': 0, 'buildProcesses': [], 'browserCount': 0, 'sites': {'tag': {'exitCode': 0, 'status': 200, 'totalSeconds': 0.506305}, 'blog': {'exitCode': 0, 'status': 200, 'totalSeconds': 4.171554}, 'youtube': {'exitCode': 0, 'status': 200, 'totalSeconds': 0.115472}}}}
NOW=datetime.datetime.fromisoformat(SAMPLES['Mint']['observedAt'])+datetime.timedelta(seconds=1)
def rows():
    samples=copy.deepcopy(SAMPLES)
    return [dict(name='SM',exitCode=0,unknown=False,result=samples['SM']),dict(name='Mint',exitCode=0,unknown=False,result=samples['Mint']),dict(name='relay',exitCode=0,unknown=False,result=dict(ok=True,unknown=False,sample=samples['skyhong-blog'],childReceipt=dict(exitCode=0)))]
class CollectorTests(unittest.TestCase):
    def test_receipt_5964142a_uses_SM_time(self):
        result=collector.aggregate(rows(),NOW)
        self.assertTrue(result['ok'])
        self.assertEqual(result['timeMeasurementHost'],'SM')
        self.assertGreater(SAMPLES['Mint']['sites']['youtube']['totalSeconds'],2)
        script=collector.collector_script('/var/lib/observe-worker/youtube/sources/test','a'*64,'b'*64)
        compile(script,'<inert-collector>','exec')
        self.assertIn("'aggregate':aggregate_result",script)
    def test_any_host_curl_56_denies(self):
        for index in range(3):
            data=rows();sample=data[index]['result']
            if index==2:sample=sample['sample']
            sample['sites']['youtube']['exitCode']=56
            result=collector.aggregate(data,NOW)
            self.assertFalse(result['ok'])
            self.assertTrue(any(not c['ok'] and c['key'].endswith('.http') for c in result['checks']))
    def test_leaf_existing_build_denies(self):
        data=rows();data[2]['result']['sample']['buildCount']=1
        self.assertFalse(collector.aggregate(data,NOW)['ok'])
    def test_SM_slow_or_any_non200_denies(self):
        data=rows();data[0]['result']['sites']['youtube']['totalSeconds']=2.001
        self.assertFalse(collector.aggregate(data,NOW)['ok'])
        for status in (404,503):
            data=rows();data[1]['result']['sites']['tag']['status']=status
            self.assertFalse(collector.aggregate(data,NOW)['ok'])
    def test_shared_browser_sum_and_missing_host_deny(self):
        data=rows();data[0]['result']['browserCount']=2;data[1]['result']['browserCount']=1
        self.assertFalse(collector.aggregate(data,NOW)['ok'])
        self.assertFalse(collector.aggregate(rows()[:2],NOW)['ok'])
if __name__=='__main__':unittest.main()
