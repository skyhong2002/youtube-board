"""Synthetic transcript validation only; no real review or execution grant."""
import copy
import datetime as dt
import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('review_contract', Path(__file__).with_name('mint-youtube-source-review.py'))
review = importlib.util.module_from_spec(spec)
spec.loader.exec_module(review)
NOW = dt.datetime(2026,10,14,tzinfo=dt.timezone.utc)
OPS, APP, PINS = 'a'*40, 'b'*40, {'platform/tools/mock.py':'c'*64}


def transcript():
    return {'schema':'yt-independent-source-review-v1','scope':review.SCOPE,'verdict':'pass','findings':[],
            'range':{'head':OPS},'appSha':APP,'reviewer':{'agent':review.REVIEWER,'model':'gpt-6.1-sol'},
            'observedAt':NOW.isoformat(),'sourceSha256':dict(PINS),
            'boundaries':{'sourceOnly':True,'runtimeAccepted':False,'admissionGranted':False}}


class TranscriptTests(unittest.TestCase):
    def test_exact_returned_source_pass_is_valid_without_runtime_authority(self):
        review.validate_transcript(transcript(),OPS,APP,PINS,NOW)

    def test_changes_required_and_unresolved_findings_reject(self):
        for update in ({'verdict':'changes-required'}, {'findings':[{'severity':'P1'}]}, {'verdict':True}):
            row=transcript();row.update(update)
            with self.subTest(update=update),self.assertRaises(ValueError):review.validate_transcript(row,OPS,APP,PINS,NOW)

    def test_wrong_head_app_and_source_pin_reject(self):
        for change in (lambda r:r['range'].update(head='d'*40),lambda r:r.update(appSha='d'*40),lambda r:r['sourceSha256'].update({'platform/tools/mock.py':'d'*64})):
            row=transcript();change(row)
            with self.assertRaises(ValueError):review.validate_transcript(row,OPS,APP,PINS,NOW)

    def test_missing_source_pin_or_empty_pin_set_reject(self):
        row=transcript();row['sourceSha256']={}
        with self.assertRaises(ValueError):review.validate_transcript(row,OPS,APP,PINS,NOW)
        with self.assertRaises(ValueError):review.validate_transcript(transcript(),OPS,APP,{},NOW)

    def test_nonindependent_reviewer_or_wrong_model_reject(self):
        for reviewer in ({'agent':'/root','model':'gpt-6.1-sol'},{'agent':review.REVIEWER,'model':'unknown'}):
            row=transcript();row['reviewer']=reviewer
            with self.assertRaises(ValueError):review.validate_transcript(row,OPS,APP,PINS,NOW)

    def test_invalid_nonutc_and_future_time_reject(self):
        for at in ('2026-99-99T12:00:00Z','2026-10-14T08:00:00+08:00','unknown','2026-10-15T00:00:00Z'):
            row=transcript();row['observedAt']=at
            with self.subTest(at=at),self.assertRaises(ValueError):review.validate_transcript(row,OPS,APP,PINS,NOW)

    def test_unrelated_scope_or_malformed_transcript_reject(self):
        for row in ({'syntheticReviewOnly':True},{**transcript(),'scope':'deployment-approval'},None):
            with self.assertRaises(ValueError):review.validate_transcript(row,OPS,APP,PINS,NOW)

    def test_source_pass_cannot_claim_admission_or_runtime_acceptance(self):
        for field,value in (('sourceOnly',False),('admissionGranted',True),('runtimeAccepted',True)):
            row=transcript();row['boundaries'][field]=value
            with self.assertRaises(ValueError):review.validate_transcript(row,OPS,APP,PINS,NOW)


if __name__ == '__main__':
    unittest.main()
