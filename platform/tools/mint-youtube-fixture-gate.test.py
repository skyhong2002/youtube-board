"""Offline fixed-gate adapter mocks only; no process/network/lock operations."""
import copy,datetime,importlib.util
from pathlib import Path
import unittest
from unittest.mock import patch

def module(name,file):
    spec=importlib.util.spec_from_file_location(name,Path(__file__).with_name(file))
    result=importlib.util.module_from_spec(spec);spec.loader.exec_module(result);return result

gate=module('gate','mint-youtube-fixture-gate.py')
cases=module('collector_cases','native-arm64-probe-collector.test.py')

class GateTests(unittest.TestCase):
    def test_reviewed_SM_time_gate_without_authority(self):
        result=gate.evaluate_observations(cases.rows(),cases.NOW)
        self.assertTrue(result['ok'])
        self.assertFalse(result['executionAllowed'])
        self.assertFalse(result['authorityVerified'])
        self.assertGreater(cases.SAMPLES['Mint']['sites']['youtube']['totalSeconds'],2)
    def test_SM_slow_denies(self):
        rows=cases.rows();rows[0]['result']['sites']['youtube']['totalSeconds']=2.001
        self.assertFalse(gate.evaluate_observations(rows,cases.NOW)['ok'])
    def test_any_host_HTTP_error_denies(self):
        for index in range(3):
            rows=cases.rows();sample=rows[index]['result']
            if index==2:
                sample=sample['sample']
                rows[index]['result']['childReceipt']['sample']=copy.deepcopy(sample)
                rows[index]['result']['childReceipt']['sample']['sites']['tag']['status']=503
            sample['sites']['tag']['status']=503
            self.assertFalse(gate.evaluate_observations(rows,cases.NOW)['ok'])
    def test_tampered_relay_and_stale_receipt_deny(self):
        rows=cases.rows();rows[2]['result']['childReceipt']['argv']=['tampered']
        self.assertFalse(gate.evaluate_observations(rows,cases.NOW)['ok'])
        self.assertFalse(gate.evaluate_observations(cases.rows(),cases.NOW+datetime.timedelta(seconds=31))['ok'])
    def test_hash_mismatch_never_loads_unreviewed_source(self):
        with patch.dict(gate.SOURCE_PINS,{'native-arm64-probe-collector.py':'0'*64}):
            with self.assertRaises(ValueError):gate.evaluate_observations(cases.rows(),cases.NOW)
    def test_malformed_or_missing_rows_deny(self):
        for rows in (None,[],cases.rows()[:2]):
            self.assertFalse(gate.evaluate_observations(rows,cases.NOW)['ok'])

class BridgeTests(unittest.TestCase):
    def evidence(self):
        from types import SimpleNamespace
        rows=cases.rows();relay=cases.relay_cases.relay
        health={r['name']:copy.deepcopy(r['result']) for r in rows if r['name']!='relay'}
        health['skyhong-blog']=copy.deepcopy(rows[2]['result']['sample'])
        for host,pin in [('SM',relay.SM_PIN),('skyhong-blog',relay.BLOG_PIN)]:
            health[host]['transport']={'controller':'Mint','strictPinnedSsh':True,'exitCode':0,'knownHostsSha256':pin,'actualHopController':'SM','scriptSha256':gate.SM_PROBE_SHA256 if host=='SM' else relay.BLOG_SCRIPT_SHA256}
        c=SimpleNamespace(machine_ids=(relay.SM_ID,relay.MINT_ID,relay.BLOG_ID),known_hosts_sha256=(relay.SM_PIN,'0'*64,relay.BLOG_PIN))
        return {'health':health,'gateObservations':rows},c
    def test_legacy_remote_slow_is_reference_but_new_gate_is_required(self):
        packet,c=self.evidence()
        self.assertGreater(packet['health']['Mint']['sites']['youtube']['totalSeconds'],2)
        self.assertEqual(gate.packet_health_failures(packet,c,cases.NOW),[])
        packet.pop('gateObservations')
        self.assertTrue(gate.packet_health_failures(packet,c,cases.NOW))
    def test_new_gate_cannot_be_overridden_by_legacy_healthy_flags(self):
        packet,c=self.evidence();packet['gateObservations'][0]['result']['sites']['youtube']['totalSeconds']=2.001
        self.assertTrue(gate.packet_health_failures(packet,c,cases.NOW))
    def test_health_mismatch_or_fake_direct_blog_transport_denies(self):
        packet,c=self.evidence();packet['health']['Mint']['buildCount']=1
        self.assertTrue(gate.packet_health_failures(packet,c,cases.NOW))
        packet,c=self.evidence();packet['health']['skyhong-blog']['transport'].pop('actualHopController')
        self.assertTrue(gate.packet_health_failures(packet,c,cases.NOW))

if __name__=='__main__':unittest.main()
