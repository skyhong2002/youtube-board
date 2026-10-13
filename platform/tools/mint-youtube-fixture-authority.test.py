"""Mock record reads only; no authorization files are created."""
import copy,hashlib,importlib.util,json
from pathlib import Path
import unittest
from unittest.mock import patch
spec=importlib.util.spec_from_file_location('authority',Path(__file__).with_name('mint-youtube-fixture-authority.py'))
authority=importlib.util.module_from_spec(spec);spec.loader.exec_module(authority)

def record():
    return dict(schema='yt-babysit-slot-handoff-v1',origin='babysit-user-message',status='granted',currentOwner='YT',previousOwner='tag',appSha=authority.APP,opsSha='a'*40,owner='synthetic-owner',generation='mock-only',scope='mint-youtube-synthetic-fixture',grantAt='2026-10-13T11:27:00Z',grantMessageId='synthetic-test-message',grantMessage='Synthetic unit-test handoff; not a real authorization.',grantMessageSha256=hashlib.sha256(b'Synthetic unit-test handoff; not a real authorization.').hexdigest(),coordinationMode='human-slot-plus-common-flock-and-durable-registry')

def run(record_value,change_config=None,queue=None):
    raw=json.dumps(record_value).encode()
    c={'fixture':{key:record_value[key] for key in ('appSha','opsSha','owner','generation')},'authorityRecordSha256':hashlib.sha256(raw).hexdigest(),**{key:record_value[key] for key in ('grantAt','grantMessageId','grantMessageSha256')}}
    if change_config:change_config(c)
    def read(path,limit):
        if path==authority.HANDOFF:return raw
        if path==authority.QUEUE:return queue or ('OPS_SHA = `'+record_value['opsSha']+'`').encode()
        raise AssertionError('Unexpected read path')
    with patch.object(authority,'read_fixed',side_effect=read):return authority.observe_user_slot(c)

class AuthorityTests(unittest.TestCase):
    def test_existing_pinned_handoff_only(self):
        r=record();out=run(r)
        self.assertEqual(out['grantAt'],r['grantAt'])
        self.assertEqual(out['grantMessage'],r['grantMessage'])
        self.assertEqual(out['schema'],'yt-authoritative-user-slot-observation-v1')
    def test_missing_record_never_invents_grant(self):
        with patch.object(authority,'read_fixed',side_effect=FileNotFoundError):
            with self.assertRaises(FileNotFoundError):authority.observe_user_slot({})
    def test_revoked_wrong_owner_scope_origin_extra_fields_deny(self):
        for key,value in (('status','revoked'),('currentOwner','tag'),('scope','build'),('origin','self-generated'),('extra','secret')):
            r=record();r[key]=value
            with self.subTest(key=key),self.assertRaises(ValueError):run(r)
    def test_changed_record_pin_or_config_binding_deny(self):
        for change in (lambda c:c.update(authorityRecordSha256='0'*64),lambda c:c['fixture'].update(opsSha='b'*40),lambda c:c.update(grantMessageId='other')):
            with self.assertRaises(ValueError):run(record(),change)
    def test_queue_is_context_not_a_grant_and_latest_pin_is_required(self):
        with self.assertRaises(ValueError):run(record(),queue=b'OPS_SHA = `'+b'b'*40+b'`')
        with self.assertRaises(ValueError):run(record(),queue=b'YT may start; no pinned source')
    def test_message_hash_future_or_nonUTC_grant_deny(self):
        for key,value in (('grantMessage','altered'),('grantAt','2999-01-01T00:00:00Z'),('grantAt','2026-10-13T11:27:00+01:00')):
            r=record();r[key]=value
            with self.assertRaises(ValueError):run(r)
    def test_duplicate_JSON_fields_deny(self):
        with self.assertRaises(ValueError):json.loads('{"status":"granted","status":"revoked"}',object_pairs_hook=authority.unique)

if __name__=='__main__':unittest.main()
