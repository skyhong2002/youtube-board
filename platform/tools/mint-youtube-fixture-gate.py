"""Inert fixture gate adapter using reviewed799 collector/relay source.

Only evaluates supplied observations. No authority publication, lock, probe,
service startup or CLI execution exists; success never grants admission.
"""
import hashlib
import importlib.util
from pathlib import Path

SOURCE_PINS = {'native-arm64-probe-collector.py': 'ebdac97a65d431f073735f3349efb2c6a9e6c343010095d8b6dc81222ad87155', 'native-arm64-readonly-relay.py': '89dee2922d3cee7ef6be5f4e829cae30d9393afd66e8dbd0562e3c1bb4601d08'}

# SHA256 of reviewed799 admission.readonly_script('SM'); never caller supplied.
SM_PROBE_SHA256 = '52268ff9b47d3e90ced2697bd24cbe977ec032f0646dfcb4fde78125cf7dffb3'

def load_reviewed(name):
    path=Path(__file__).resolve().with_name(name)
    if path.is_symlink() or not path.is_file() or hashlib.sha256(path.read_bytes()).hexdigest()!=SOURCE_PINS[name]:
        raise ValueError('REVIEWED_GATE_DEPENDENCY_MISMATCH')
    spec=importlib.util.spec_from_file_location('fixture_gate_'+name.replace('-','_'),path)
    module=importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def evaluate_observations(rows,now):
    """Recompute both validators; do not trust supplied ok/aggregate flags."""
    collector=load_reviewed('native-arm64-probe-collector.py')
    relay=load_reviewed('native-arm64-readonly-relay.py')
    candidates=[row.get('result') for row in rows if isinstance(row,dict) and row.get('name')=='relay'] if isinstance(rows,list) else []
    validation=relay.validate_receipt(candidates[0] if len(candidates)==1 else None,now)
    aggregate=collector.aggregate(rows,now,validation)
    return {'schema':'yt-fixture-gate-evaluation-v1','ok':aggregate['ok'],
            'aggregate':aggregate,'relayValidation':validation,
            'authorityVerified':False,'executionAllowed':False,'runtimeReady':False}


def packet_health_failures(packet,contract,now,estimate_bytes=0):
    """Replace legacy time/transport verdicts with actual reviewed observations."""
    if not isinstance(packet,dict):return ['GATE_PACKET_REQUIRED']
    rows=packet.get('gateObservations')
    result=evaluate_observations(rows,now)
    if result['ok'] is not True:return ['REVIEWED_AGGREGATE_DENIED']
    health=packet.get('health')
    if not isinstance(health,dict) or set(health)!={'SM','Mint','skyhong-blog'}:return ['EXACT_HEALTH_HOSTS_REQUIRED']
    byname={r['name']:r['result'] for r in rows}
    samples={'SM':byname['SM'],'Mint':byname['Mint'],'skyhong-blog':byname['relay']['sample']}
    relay=load_reviewed('native-arm64-readonly-relay.py')
    collector=load_reviewed('native-arm64-probe-collector.py')
    if tuple(contract.machine_ids)!=(relay.SM_ID,relay.MINT_ID,relay.BLOG_ID) or contract.known_hosts_sha256[0]!=relay.SM_PIN or contract.known_hosts_sha256[2]!=relay.BLOG_PIN:return ['CONTRACT_HOST_PINS_MISMATCH']
    if type(estimate_bytes) is not int or estimate_bytes<0:return ['SETUP_ESTIMATE_UNKNOWN']
    for host,sample in samples.items():
        row=health.get(host)
        if not isinstance(row,dict):return ['HEALTH_SAMPLE_UNKNOWN']
        actual={k:v for k,v in row.items() if k!='transport'}
        if not collector.health_valid(actual,host) or actual!=sample:return ['HEALTH_OBSERVATION_MISMATCH']
        if sample['freeBytes']-estimate_bytes<30*1024**3:return ['SETUP_RESERVE_DENIED']
        if host!='Mint':
            transport=row.get('transport')
            if not isinstance(transport,dict) or transport.get('controller')!='Mint' or transport.get('strictPinnedSsh') is not True or type(transport.get('exitCode')) is not int or transport['exitCode']!=0:return ['VERIFIED_TRANSPORT_REQUIRED']
            if host=='skyhong-blog' and (transport.get('actualHopController')!='SM' or transport.get('knownHostsSha256')!=relay.BLOG_PIN or transport.get('scriptSha256')!=relay.BLOG_SCRIPT_SHA256):return ['ACTUAL_BLOG_RELAY_REQUIRED']
            if host=='SM' and transport.get('knownHostsSha256')!=relay.SM_PIN:return ['SM_HOST_PIN_REQUIRED']
            if host=='SM' and transport.get('scriptSha256')!=SM_PROBE_SHA256:return ['SM_PROBE_SOURCE_PIN_REQUIRED']
    return []
