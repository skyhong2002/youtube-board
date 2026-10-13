"""Generate a documentation-only capture plan; never opens a browser or network."""
import argparse
import json
import stat
import re
from pathlib import Path
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[2]
TARGET = ROOT / 'docs/ui-retake-matrix.json'
VARIANTS = [{'theme': theme, 'width': width} for theme in ['light', 'dark'] for width in [1280, 390]]

CAPTURE_CEILING = 300000000
BATCH_CEILING = 90000000
PACKAGE_UPPER = 6000000
BATCH_EVIDENCE_RESERVE = 10000000
RETAINED = {
    'scope': 'Local retained historical and stopped capture directories, all regular files; global retained scope incomplete',
    'receipt': '/home/deck/.cache/youtube-ui-review/f2_visual_sol-2026-10-13/retake-retained-identity-inventory.json',
    'receiptSha256': '171101d802b62ea3d79bb87ef32d5f97e0b65086507ff568763d9885601dedb6',
    'roots': [
        {'name': 'candidate-retest-654cdf5', 'fileCount': 228, 'bytes': 51494139, 'pngCount': 224, 'pngBytes': 49932059},
        {'name': 'candidate-thaw-envelope-2026-10-13', 'fileCount': 19, 'bytes': 5222891, 'pngCount': 12, 'pngBytes': 4979607}],
    'overlappingFileIdentityCount': 0, 'identityDeduplicatedBytes': 56717030,
    'deduplication': 'device+inode; separately retained content-identical copies count separately',
    'completeCumulativeScope': False, 'preservedOriginals': True}


def retained_identities(roots):
    """Read-only accounting helper; aliases/hardlinks count once, copies count twice.

    This does not declare roots a complete cumulative scope or authorize capture.
    Symlinks and special files deny accounting rather than conceal retained bytes.
    """
    identities = {}
    for root in roots:
        root = Path(root)
        assert root.is_dir() and not root.is_symlink(), 'regular evidence root required'
        for p in root.rglob('*'):
            mode = p.lstat().st_mode
            assert not stat.S_ISLNK(mode), 'symlink evidence unresolved'
            if stat.S_ISDIR(mode):
                continue
            assert stat.S_ISREG(mode), 'special evidence unresolved'
            value = p.stat()
            key = (value.st_dev, value.st_ino)
            assert key not in identities or identities[key] == value.st_size, 'changing evidence identity'
            identities[key] = value.st_size
    return {'fileIdentityCount': len(identities), 'bytes': sum(identities.values())}


def budget_groups(groups, retained_bytes):
    """Reserve only complete four-variant groups, including evidence per batch.

    Returned selection is a budget proposal, never execution approval. Caller must
    resolve the complete retained scope, fixture and all runtime/capture gates.
    """
    assert isinstance(retained_bytes, int) and retained_bytes >= 0
    selected, postponed, batches = [], [], []
    added = 0
    for group in groups:
        packages = len(group['viewportVariants'])
        assert group['viewportVariants'] == VARIANTS, 'complete theme/width group required'
        png_upper = packages * PACKAGE_UPPER
        new_batch = not batches or batches[-1]['planningUpperBytes'] + png_upper > BATCH_CEILING
        increment = png_upper + (BATCH_EVIDENCE_RESERVE if new_batch else 0)
        if retained_bytes + added + increment > CAPTURE_CEILING:
            postponed.append({**group, 'postponedReasons': ['inclusive retained+new planning upper exceeds300000000 bytes'], 'executionAllowed': False})
            continue
        if new_batch:
            assert increment <= BATCH_CEILING
            batches.append({'batch': len(batches) + 1, 'groupIds': [], 'viewportPackages': 0,
                            'additionalEvidenceReserveBytes': BATCH_EVIDENCE_RESERVE, 'planningUpperBytes': BATCH_EVIDENCE_RESERVE})
        batch = batches[-1]
        batch['groupIds'].append(group['id']); batch['viewportPackages'] += packages
        batch['planningUpperBytes'] += png_upper
        added += increment
        selected.append({**group, 'batch': batch['batch'], 'viewportPackages': packages,
                         'estimatedPngBytes': packages * 2500000, 'planningUpperPngBytes': png_upper,
                         'executionAllowed': False, 'status': 'budget-selected-pending-fixture-inventory-and-runtime-gates'})
    return {'initialReviewGroups': selected, 'budgetPostponedReviewGroups': postponed, 'batches': batches,
            'newPlanningUpperBytes': added, 'retainedPlusNewPlanningUpperBytes': retained_bytes + added}


def review_group(route, example, period, source_fixture=None):
    state = 'synthetic-fixture' if source_fixture else ('real-example' if '{keyword}' in route else 'default')
    return {'id': f"{example}:{period}", 'route': route, 'candidatePath': example, 'state': state,
            'period': period, 'periodProcedure': next(x for x in periods(route)['variants'] if x['period'] == period),
            'viewportVariants': VARIANTS, 'stateSetup': state_setup({'state': state}),
            'sourceFixture': source_fixture, 'executionAllowed': False,
            'unresolvedReasons': ['actual isolated fixture receipt and exact candidate URL/period verification missing',
                                  'complete cumulative retained evidence inventory missing',
                                  'tag-to-YT handoff, source/artifact/readiness and capture gates pending']}



def example_path(url):
    if not url:
        return None
    parts = urlsplit(url)
    return parts.path + ('?' + parts.query if parts.query else '')


def state_setup(entry):
    state = entry['state']
    anonymous = state in ['anonymous-denied', '404']
    role = 'anonymous' if anonymous else 'existing-reader' if state == 'reader-denied' else None
    return {'status': 'unresolved', 'fixtureManifest': None, 'existingAccountRole': role,
            'rule': 'Verify this exact state on isolated candidate API/data. Resolve existing authorized role or nonidentifying isolated fixture where required; never create accounts, induce production failures or perform writes for capture.'}


def periods(route):
    # Templates, not invented live URLs. D is resolved once per batch in Asia/Taipei.
    if route in ['/boards', '/boards/view']:
        return {'control': 'local-board-configuration', 'source': 'board editor/view configuration',
                'variants': [{'period': 'existing-window'}],
                'note': 'Editor has local from/to configuration; view uses saved/query configuration, not today/week tabs. Record resolved board window; additional configured-range cases need existing authorized nonidentifying fixture, no production save.'}
    if route in ['/', '/keywords']:
        return {'control': 'keyword-window-selector', 'source': 'KeywordWindow.tsx / KeywordRanking.tsx',
                'variants': [{'period': p, 'action': 'select ' + p + '; verify cloud AND ranking before every image'} for p in ['today', 'week']],
                'note': 'Home window applies to keyword panels, not every dashboard metric.'}
    if re.fullmatch(r'/groups/[^/]+/(ranking|trends)', route):
        return {'control': 'from-to', 'source': 'api/src/reports/metric-period.ts',
                'variants': [{'period': 'today', 'query': {'from': 'D', 'to': 'D'}}, {'period': 'week', 'query': {'from': 'D-7', 'to': 'D'}}],
                'note': 'Group start is exclusive except same-day special case; seven plotted dates, rolling values retain prior six days.'}
    range_patterns = [r'/videos', r'/channels/[^/]+/videos', r'/tags(?:/[^/]+)?/videos', r'/keywords/[^/]+/videos',
                      r'/channels/[^/]+/trends', r'/tags(?:/[^/]+)?/(days|trends)', r'/keywords/[^/]+/days',
                      r'/tags/compare', r'/live/(days|periods|channels|hours|trends/daily|tags|continuous)',
                      r'/tags(?:/[^/]+)?/live/videos', r'/keywords/[^/]+/live/trends', r'/groups/[^/]+/live',
                      r'/ai/periods', r'/mayor(?:/cities/[^/]+)?']
    if any(re.fullmatch(p, route) for p in range_patterns):
        extra = {'today': '1'} if route == '/live/trends/daily' else {}
        return {'control': 'from-to', 'source': 'Filters.tsx / ExpandedReport.tsx / corresponding API report filters',
                'variants': [{'period': 'today', 'query': {'from': 'D', 'to': 'D', **extra}}, {'period': 'week', 'query': {'from': 'D-6', 'to': 'D', **extra}}],
                'note': 'Clear conflicting month/date/days/hours before setting range. Seven inclusive Taipei dates, not days=7; preserve rolling/current-selection metric meaning.'}
    single = [r'/live/days/[^/]+', r'/ai/days(?:/\{date\}(?:/\{condition\})?)?', r'/ai/hours',
              r'/live/groups/[^/]+/hours', r'/mayor/cities/[^/]+/people/[^/]+(?:/days/[^/]+)?']
    if any(re.fullmatch(p, route) for p in single):
        return {'control': 'single-date', 'source': 'routes.reportFilterPath / API date filters',
                'variants': [{'period': 'today', 'date': 'D'}, {'period': 'historical-day', 'date': 'existing verified sample date'}],
                'note': 'No seven-day selector; preserve original historical URL then submit actual date form. Never relabel historical data as today.'}
    special = (route.endswith('/cloud') or re.fullmatch(r'/channels/[^/]+/(ai(?:/days(?:/[^/]+)?)?|people)', route)
               or re.fullmatch(r'/keywords/[^/]+/groups/trends', route))
    return {'control': 'n/a-visible-period', 'source': 'route template and report-navigation scope',
            'variants': [{'period': 'existing-window'}],
            'note': ('No visible selector; backend direct-query period variants require separate source-backed cases, not fabricated controls.' if special
                     else 'No today/week history selector for this surface; keep actual configured/current/detail/auth/error state.')}


def create(ledger):
    rows = []
    for index, entry in enumerate(ledger['entries']):
        if entry['kind'] != 'UI':
            continue
        period = periods(entry['route'])
        rows.append({'id': f'ledger-{index:03}', 'ledgerEntryIndex': index, 'route': entry['route'], 'state': entry['state'],
                     'priority': entry['priority'], 'exampleURL': entry.get('exampleURL'),
                     'exampleURLs': list(dict.fromkeys(([entry['exampleURL']] if entry.get('exampleURL') else []) + entry.get('coveredURLs', []))),
                     'candidatePath': example_path(entry.get('exampleURL')), 'stateSetup': state_setup(entry),
                     'exampleStatus': 'existing example; candidate origin and data need verification' if entry.get('exampleURL') else 'missing; resolve existing sample or approved isolated mock before capture',
                     'reviewGroup': {'template': entry['route'], 'state': entry['state'],
                                     'rule': 'Same template and same state may share review discussion; each exact URL/period/theme/width still requires its own screenshots and receipts.'},
                     'periods': period, 'viewportVariants': VARIANTS, 'status': 'pending-candidate-and-recapture',
                     'plannedViewportPackages': len(period['variants']) * 4})
    # Initial source-backed synthetic groups do not stand in for real keyword cases.
    proposed = []
    fixture = {'dataset': 'fixture', 'vocabularyVersion': 'mint-synthetic-v1',
               'source': 'platform/tools/mint-youtube-api-worker.mjs + frozen APP fixture helpers',
               'actualFixtureManifest': None, 'status': 'source-backed-only; no DB/API execution evidence'}
    for route, example, ps in [('/', '/', ['today', 'week']), ('/keywords', '/keywords', ['today', 'week']),
                               ('/keywords/{keyword}/videos', '/keywords/合成焦點甲/videos', ['today', 'week']),
                               ('/channels', '/channels', ['existing-window'])]:
        for period in ps:
            proposed.append(review_group(route, example, period, fixture))
    selection = budget_groups(proposed, RETAINED['identityDeduplicatedBytes'])
    postponed = []
    for example in ['/keywords/沈伯洋/videos', '/keywords/支持/videos']:
        for period in ['today', 'week']:
            group = review_group('/keywords/{keyword}/videos', example, period)
            group['postponedReasons'] = ['real keyword example has no corresponding approved isolated fixture; synthetic term is not parity evidence']
            postponed.append(group)
    postponed.extend(selection['budgetPostponedReviewGroups'])
    first = []
    for group in selection['initialReviewGroups']:
        for viewport in group['viewportVariants']:
            first.append({k: v for k, v in group.items() if k != 'viewportVariants'} | viewport |
                         {'status': 'pending', 'urlRule': 'Resolve D once per batch; assert exact visible period and data generation before and after fullpage/slices.'})
    count = sum(row['plannedViewportPackages'] for row in rows)
    return {'schemaVersion': 2, 'purpose': 'Planning only; not capture or review evidence',
            'smWorkloadFreezeActive': True, 'mintReadinessStatus': 'pending-all-gates',
            'buildSlot': 'Queue: tag first, YouTube second, blog third. No new SM build/capture. Native ARM build/package runs ON skyhong-blog; Mint ONLY captures, after isolated API and verified readiness.',
            'mintQueue': {'host': 'Mint', 'order': ['tag', 'youtube', 'blog'], 'youtubeSlot': 2,
                          'status': 'strategy-only-pending-gates', 'smNewBuildAllowed': False, 'smCaptureAllowed': False,
                          'target': {'platform': 'linux/arm64', 'host': 'skyhong-blog',
                                     'buildAndPackageHost': 'skyhong-blog', 'captureOnlyHost': 'Mint', 'finalImageDigest': None},
                          'paths': {'mintRoot': '/var/lib/observe-worker', 'mintRootProvenance': 'coordinator-reported; not inspected by this planning tool',
                                    'youtubeWorkdir': None, 'captureRoot': None,
                                    'rule': 'Operator resolves Mint-local paths; never reuse an SM absolute path or mixed-source worktree.'},
                          'runtime': {'candidateOrigin': None, 'isolatedApiOrigin': None, 'buildID': None,
                                      'readinessReceipt': None, 'artifactProofReceipt': None},
                          'executionScope': 'Only budget-selected complete review groups after all gates; all Cartesian ledger slots remain unresolved planning, never executable by this tool.'},
            'candidateSourceSHA': None, 'candidateSourceRule': 'Pin exact final independently reviewed committed SHA before one build; never use dirty worktree or relabel old PNGs',
            'inventorySource': 'docs/ui-review-ledger.json', 'periodDateRule': 'D = Taipei calendar date frozen at batch start; record resolved UTC bounds; crossing midnight requires re-resolution, never mix fullpage and slices',
            'summary': {'uiEntries': len(rows), 'uiRoutes': len({r['route'] for r in rows}), 'plannedViewportPackages': count,
                        'firstEnvelopeViewportPackages': len(first), 'initialCompleteReviewGroups': len(selection['initialReviewGroups']),
                        'postponedExactExampleGroups': len(postponed), 'executionAllowedPackages': 0, 'completedCaptures': 0, 'completedReviews': 0,
                        'missingExampleEntries': sum(r['exampleURL'] is None for r in rows)},
            'diskBudget': {'unit': 'bytes', 'historicalDirectoryPngCount': 224, 'historicalDirectoryPngBytes': 49932059,
                           'manifestReferencedPngCount': 202, 'manifestReferencedPngBytes': 43225260,
                           'manifestViewportPackages': 24, 'medianViewportPackageBytes': 1309696, 'largestViewportPackageBytes': 5900530,
                           'historicalNote': 'All originals preserved;22 PNGs outside manifest remain retained, not attributed to a new SHA/review.',
                           'estimatedViewportPackageBytes': 2500000, 'planningUpperViewportPackageBytes': PACKAGE_UPPER,
                           'estimatedWholeMatrixBytes': count * 2500000, 'planningUpperWholeMatrixBytes': count * PACKAGE_UPPER,
                           'estimatesExclude': 'Additional interactions beyond selected groups; full Cartesian inventory is neither executable nor a reservation.',
                           'cumulativeAuthorizedCaptureCeilingBytes': CAPTURE_CEILING, 'batchHardCeilingBytes': BATCH_CEILING,
                           'existingEvidenceBytes': None, 'existingEvidenceInventoryReceipt': None,
                           'knownRetainedIdentityInventory': RETAINED,
                           'knownRetainedIdentitySubtotalBytes': RETAINED['identityDeduplicatedBytes'],
                           'retainedStoppedA77EnvelopeBytes': 5222891,
                           'existingEvidenceRule': 'Two local roots are disjoint by device+inode and include metadata. Other retained references/receipts and destination copies remain unresolved. Complete current cumulative inventory is required before execution; no content-hash dedup of separately retained copies, deletion or reset.',
                           'firstEnvelopeBatches': len(selection['batches']), 'firstEnvelopeEstimatedPngBytes': len(first) * 2500000,
                           'firstEnvelopePlanningUpperPngBytes': len(first) * PACKAGE_UPPER,
                           'firstEnvelopeAdditionalEvidenceReserveBytes': len(selection['batches']) * BATCH_EVIDENCE_RESERVE,
                           'firstEnvelopeEvidenceReservePerBatchBytes': BATCH_EVIDENCE_RESERVE,
                           'firstEnvelopeInclusivePlanningUpperBytes': selection['newPlanningUpperBytes'],
                           'knownRetainedPlusEnvelopePlanningUpperBytes': selection['retainedPlusNewPlanningUpperBytes'],
                           'remainingBytesAfterKnownRetainedAndEnvelope': CAPTURE_CEILING - selection['retainedPlusNewPlanningUpperBytes'],
                           'firstEnvelopeBudgetStatus': 'blocked-pending-complete-current-cumulative-inventory-and-fixture-runtime-gates',
                           'batchCeilingScope': 'Every retained/new PNG, reference, network and metadata file counts; each complete four-variant group reserves24MB PNG upper, each batch adds10MB other evidence; selected batches stay<=90MB.',
                           'rule': 'Budget-select only complete groups. If full measured retained bytes exceed this subtotal, rerun allocation and postpone whole groups. Stop before batch or cumulative cap; preserve originals and never reset accounting.'},
            'initialReviewGroups': selection['initialReviewGroups'], 'initialReviewBatches': selection['batches'],
            'postponedReviewGroups': postponed,
            'unresolvedMatrix': {'cartesianViewportSlots': count, 'executionAllowed': False,
                                 'reasons': ['all376 ledger states lack verified candidate fixture setup',
                                             '240 entries lack an exact example URL; remaining examples still need isolated candidate verification',
                                             'multiple examples, interaction and supplemental states require additional complete groups and bytes',
                                             'whole-matrix estimate exceeds inclusive300MB; complete evidence inventory and runtime gates pending']},
            'captureGates': ['Strategy only: Mint tag slot must complete before YT; no new SM builds or captures; blog follows YT',
                             'Pin independently reviewed clean committed successor SHA, arm64 final image digest, exact BUILD_ID and all-files artifact proof; candidate identity is currently unresolved',
                             'Use isolated API with matching resolved period/data generation; verified readiness and origin mappings required before Mint-only capture',
                             'Measure inclusive deduplicated retained-evidence bytes first; existing + planned/actual batch must stay <=300MB, each batch <=90MB. Unknown inventory denies execution; reduce complete variant groups rather than reset budget',
                             'Global max2 browsers; global1 build INCLUDING remote/native ARM build on skyhong-blog; actual process inspection and queue/resource readiness before start',
                             'Before and after every batch: load<=12; homepage totalSeconds tag<=2/blog<=6.17/youtube<=2 and known non-5xx; timeout/unknown denies',
                             'New operator build/image start floor40GiB, build pause floor30GiB supersede historical112.5GiB capture floor. Prepared capture policy conservatively reserves40GiB plus estimated batch; this extra margin is implementation choice.',
                             'Independent Playwright DNT=1/GPC; Google/GA/GTM routes installed before first navigation; no synthetic analytics',
                             'Bounded redacted network receipt: allowlisted host/category/outcome only, no headers/cookies/query/body/IP/full UA',
                             'Record SHA, BUILD_ID, pinned digest and runtime artifact proof separately from manifest assertions',
                             'Assert window and data generation before AND after fullpage/slices; drift fails batch; immutable new directory',
                             'Existing roles only; isolated nonidentifying mocks for failures/writes; missing role or fixture stays pending',
                             'Reviewer independently sees exact images and tag references; source author may not self-review'],
            'requiredManifestFields': ['candidateSourceSHA', 'buildID', 'imageDigest', 'artifactProofReceipt',
                                       'route', 'state', 'exactCandidateURL', 'resolvedPeriod', 'resolvedUtcBounds',
                                       'theme', 'width', 'dataGenerationBefore', 'dataGenerationAfter',
                                       'fullpageAndSlicePaths', 'imageHashes', 'tagReferencePathsAndHashes',
                                       'dntGpcBeforeNavigationReceipt', 'preNavigationGoogleBlockReceipt',
                                       'completeBoundedNetworkReceipt', 'existingEvidenceInventoryReceipt',
                                       'batchActualBytes', 'cumulativeActualBytes', 'readinessBeforeAfterReceipts'],
            'supplementalStateChecklist': {'routes': ['/', '/keywords', '/keywords/{keyword}/videos', '/channels'],
                                          'required': ['abundant', 'sparse', 'empty', 'unavailable/error', 'loading', 'unknown views/partial coverage', 'filter/sort/pagination interaction'],
                                          'rule': 'Use corresponding ledger row where present; otherwise attach sub-state case before capture. First envelope default screenshots do not satisfy this checklist; each additional case consumes budget and needs all four viewport/theme variants.'},
            'firstEnvelope': first, 'entries': rows}


def mint_manifest(plan, candidate_sha=None):
    """Expand the Cartesian plan into small JSON records, not images or capture work."""
    packages = []
    for entry in plan['entries']:
        for period in entry['periods']['variants']:
            for viewport in entry['viewportVariants']:
                packages.append({'id': f"{entry['id']}-{period['period']}-{viewport['theme']}-{viewport['width']}",
                                 'ledgerEntryId': entry['id'], 'route': entry['route'], 'state': entry['state'],
                                 'exampleURLs': entry['exampleURLs'],
                                 'candidatePaths': [example_path(url) for url in entry['exampleURLs']] or [None],
                                 'stateSetup': entry['stateSetup'], 'periodProcedure': period, **viewport,
                                 'executionAllowed': False, 'status': 'pending-gates-and-evidence'})
    return {'schemaVersion': 1, 'purpose': 'Offline Mint planning manifest; no capture evidence or execution approval',
            'candidateSourceSHA': candidate_sha if candidate_sha is not None else plan['candidateSourceSHA'],
            'candidateShaBinding': 'explicit CLI planning-output binding; not build/runtime/source approval' if candidate_sha else 'unresolved; all execution blocked',
            'queue': plan['mintQueue'],
            'requiredManifestFields': plan['requiredManifestFields'], 'captureGates': plan['captureGates'],
            'diskBudget': plan['diskBudget'], 'firstEnvelope': plan['firstEnvelope'],
            'initialReviewGroups': plan['initialReviewGroups'], 'initialReviewBatches': plan['initialReviewBatches'],
            'postponedReviewGroups': plan['postponedReviewGroups'], 'unresolvedMatrix': plan['unresolvedMatrix'],
            'summary': plan['summary'], 'packages': packages,
            'packageCountBasis': '2060 unresolved Cartesian ledger-state/period/theme/width planning slots, zero executable packages. Multiple example URLs, interactions and supplemental states require separate screenshots and may add packages/bytes beyond this estimate.',
            'reviewRule': 'Group discussion only for same template and same state; independently inspect screenshots for each exact URL. No source mixing or historical evidence promotion.'}


def validate(plan, ledger):
    indices = [i for i, e in enumerate(ledger['entries']) if e['kind'] == 'UI']
    assert [r['ledgerEntryIndex'] for r in plan['entries']] == indices
    assert plan['summary']['uiEntries'] == ledger['summary']['uiEntries']
    assert plan['summary']['uiRoutes'] == ledger['summary']['uiUniqueRoutes']
    assert len(plan['firstEnvelope']) == 28
    assert len(plan['initialReviewGroups']) == 7 and len(plan['postponedReviewGroups']) == 4
    assert all(not group['executionAllowed'] for group in plan['initialReviewGroups'] + plan['postponedReviewGroups'])
    assert all(r['viewportVariants'] == VARIANTS and r['status'] == 'pending-candidate-and-recapture' for r in plan['entries'])
    assert plan['candidateSourceSHA'] is None
    assert plan['mintQueue']['order'] == ['tag', 'youtube', 'blog']
    assert plan['mintQueue']['target']['platform'] == 'linux/arm64'
    assert plan['mintQueue']['paths']['mintRoot'] == '/var/lib/observe-worker'
    assert plan['mintQueue']['paths']['youtubeWorkdir'] is None and plan['mintQueue']['paths']['captureRoot'] is None
    assert plan['smWorkloadFreezeActive'] and plan['mintReadinessStatus'] == 'pending-all-gates'
    assert not plan['mintQueue']['smNewBuildAllowed'] and not plan['mintQueue']['smCaptureAllowed']
    assert all(r['stateSetup']['fixtureManifest'] is None and r['stateSetup']['status'] == 'unresolved' for r in plan['entries'])
    assert all(r['candidatePath'] == example_path(r['exampleURL']) for r in plan['entries'])
    assert periods('/groups/{groupName}/ranking')['variants'][1]['query']['from'] == 'D-7'
    assert periods('/keywords/{keyword}/videos')['variants'][1]['query']['from'] == 'D-6'
    assert periods('/live/current')['control'] == 'n/a-visible-period'
    assert periods('/channels')['control'] == 'n/a-visible-period'
    assert periods('/live/groups/{group}/hours')['control'] == 'single-date'
    assert periods('/keywords/{keyword}/groups/trends')['control'] == 'n/a-visible-period'
    disk = plan['diskBudget']
    for batch in range(1, disk['firstEnvelopeBatches'] + 1):
        packages = sum(x['batch'] == batch for x in plan['firstEnvelope'])
        assert packages * disk['planningUpperViewportPackageBytes'] + disk['firstEnvelopeEvidenceReservePerBatchBytes'] <= disk['batchHardCeilingBytes']
    assert disk['firstEnvelopeInclusivePlanningUpperBytes'] == sum(
        sum(x['batch'] == batch for x in plan['firstEnvelope']) * disk['planningUpperViewportPackageBytes']
        + disk['firstEnvelopeEvidenceReservePerBatchBytes'] for batch in range(1, disk['firstEnvelopeBatches'] + 1))
    assert disk['knownRetainedPlusEnvelopePlanningUpperBytes'] == 254717030 <= CAPTURE_CEILING
    assert all(batch['planningUpperBytes'] <= BATCH_CEILING for batch in plan['initialReviewBatches'])
    assert disk['existingEvidenceBytes'] is None
    assert disk['firstEnvelopeBudgetStatus'].startswith('blocked-')
    assert disk['estimatedWholeMatrixBytes'] > disk['cumulativeAuthorizedCaptureCeilingBytes']
    manifest = mint_manifest(plan)
    assert len(manifest['packages']) == plan['summary']['plannedViewportPackages'] == 2060
    assert len({p['id'] for p in manifest['packages']}) == 2060
    assert all(not p['executionAllowed'] and p['width'] in [1280, 390] and p['theme'] in ['light', 'dark'] for p in manifest['packages'])


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true')
    parser.add_argument('--mint-manifest', action='store_true', help='Print expanded portable Mint planning JSON only; never builds or captures')
    parser.add_argument('--candidate-sha', help='Explicit lowercase 40-hex committed successor SHA for --mint-manifest output only; stored matrix remains unbound')
    args = parser.parse_args()
    if args.candidate_sha is not None:
        if not args.mint_manifest:
            parser.error('--candidate-sha requires --mint-manifest; stored matrix must remain unbound')
        if not re.fullmatch(r'[0-9a-f]{40}', args.candidate_sha):
            parser.error('--candidate-sha must be exactly 40 lowercase hexadecimal characters')
    ledger = json.loads((ROOT / 'docs/ui-review-ledger.json').read_text())
    plan = create(ledger)
    validate(plan, ledger)
    output = json.dumps(plan, ensure_ascii=False, indent=2) + '\n'
    if args.check:
        assert TARGET.read_text() == output, 'Recapture plan stale; regenerate from ledger'
    elif not args.mint_manifest:
        TARGET.write_text(output)
    print(json.dumps(mint_manifest(plan, args.candidate_sha) if args.mint_manifest else plan['summary'], ensure_ascii=False))
