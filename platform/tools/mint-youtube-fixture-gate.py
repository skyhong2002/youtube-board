"""Inert fixture gate adapter using reviewed799 collector/relay source.

Only evaluates supplied observations. No authority publication, lock, probe,
service startup or CLI execution exists; success never grants admission.
"""
import hashlib
import importlib.util
from pathlib import Path

SOURCE_PINS = {'native-arm64-probe-collector.py': 'ebdac97a65d431f073735f3349efb2c6a9e6c343010095d8b6dc81222ad87155', 'native-arm64-readonly-relay.py': '89dee2922d3cee7ef6be5f4e829cae30d9393afd66e8dbd0562e3c1bb4601d08'}

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
