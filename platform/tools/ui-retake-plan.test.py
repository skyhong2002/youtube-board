"""Offline accounting/planning checks only; no browser, daemon, build or network."""
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('retake', Path(__file__).with_name('ui-retake-plan.py'))
retake = importlib.util.module_from_spec(spec)
spec.loader.exec_module(retake)


class RetakeTests(unittest.TestCase):
    def group(self, n):
        return {'id': str(n), 'viewportVariants': retake.VARIANTS}

    def test_retained_aliases_and_hardlinks_count_once(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d); (root / 'original').write_bytes(b'evidence')
            os.link(root / 'original', root / 'hardlink')
            self.assertEqual(retake.retained_identities([root, root]), {'fileIdentityCount': 1, 'bytes': 8})
            self.assertEqual((root / 'original').read_bytes(), b'evidence')

    def test_separate_identical_copies_still_consume_budget(self):
        with tempfile.TemporaryDirectory() as d:
            roots = [Path(d) / n for n in ['old', 'stopped']]
            for root in roots:
                root.mkdir(); (root / 'capture').write_bytes(b'same bytes')
            self.assertEqual(retake.retained_identities(roots), {'fileIdentityCount': 2, 'bytes': 20})

    def test_nested_roots_do_not_double_count(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d); child = root / 'child'; child.mkdir()
            (child / 'receipt.json').write_bytes(b'{}')
            self.assertEqual(retake.retained_identities([root, child])['bytes'], 2)

    def test_symlink_denies_incomplete_inventory(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d); (root / 'original').write_bytes(b'evidence')
            (root / 'alias').symlink_to(root / 'original')
            with self.assertRaisesRegex(AssertionError, 'symlink'):
                retake.retained_identities([root])

    def test_exact_cumulative_boundary_includes_evidence(self):
        groups = [self.group(1)]
        exact = retake.CAPTURE_CEILING - 4 * retake.PACKAGE_UPPER - retake.BATCH_EVIDENCE_RESERVE
        at_cap = retake.budget_groups(groups, exact)
        self.assertEqual(at_cap['retainedPlusNewPlanningUpperBytes'], 300000000)
        self.assertEqual(len(at_cap['initialReviewGroups']), 1)
        over = retake.budget_groups(groups, exact + 1)
        self.assertEqual(over['initialReviewGroups'], [])
        self.assertEqual(len(over['budgetPostponedReviewGroups']), 1)

    def test_complete_group_packing_stays_within_both_caps(self):
        for retained in [0, 49932059, 55154950, 56717030, 180000000, 266000001, 300000000]:
            plan = retake.budget_groups([self.group(n) for n in range(20)], retained)
            self.assertLessEqual(plan['retainedPlusNewPlanningUpperBytes'], 300000000)
            self.assertTrue(all(b['planningUpperBytes'] <= 90000000 for b in plan['batches']))
            self.assertEqual(sum(b['planningUpperBytes'] for b in plan['batches']), plan['newPlanningUpperBytes'])
            self.assertTrue(all(g['viewportPackages'] == 4 and not g['executionAllowed'] for g in plan['initialReviewGroups']))
            self.assertEqual(len(plan['initialReviewGroups']) + len(plan['budgetPostponedReviewGroups']), 20)

    def test_more_retained_bytes_postpones_whole_groups(self):
        groups = [self.group(n) for n in range(7)]
        old = retake.budget_groups(groups, 56717030)
        measured = retake.budget_groups(groups, 130000000)
        self.assertEqual(len(old['initialReviewGroups']), 7)
        self.assertLess(len(measured['initialReviewGroups']), 7)
        self.assertTrue(all(g['viewportVariants'] == retake.VARIANTS for g in measured['budgetPostponedReviewGroups']))

    def test_partial_viewport_group_rejected(self):
        with self.assertRaisesRegex(AssertionError, 'complete'):
            retake.budget_groups([{'id': 'partial', 'viewportVariants': retake.VARIANTS[:3]}], 0)

    def test_full_ledger_is_unresolved_and_initial_real_examples_postponed(self):
        ledger = json.loads((retake.ROOT / 'docs/ui-review-ledger.json').read_text())
        plan = retake.create(ledger); retake.validate(plan, ledger)
        self.assertEqual(plan['summary']['firstEnvelopeViewportPackages'], 28)
        self.assertEqual(plan['diskBudget']['firstEnvelopeInclusivePlanningUpperBytes'], 198000000)
        self.assertEqual(plan['diskBudget']['knownRetainedPlusEnvelopePlanningUpperBytes'], 254717030)
        self.assertEqual([b['viewportPackages'] for b in plan['initialReviewBatches']], [12, 12, 4])
        self.assertEqual({g['candidatePath'] for g in plan['postponedReviewGroups']}, {'/keywords/沈伯洋/videos', '/keywords/支持/videos'})
        self.assertTrue(all(g['sourceFixture']['actualFixtureManifest'] is None for g in plan['initialReviewGroups']))
        self.assertIsNone(plan['diskBudget']['existingEvidenceBytes'])
        manifest = retake.mint_manifest(plan, '70529cff13b6b7f5b3e0571a229e2b61660f9df4')
        self.assertEqual(len(manifest['packages']), 2060)
        self.assertFalse(any(p['executionAllowed'] for p in manifest['packages']))
        self.assertFalse(manifest['unresolvedMatrix']['executionAllowed'])
        self.assertIsNone(plan['candidateSourceSHA'])


if __name__ == '__main__':
    unittest.main()
