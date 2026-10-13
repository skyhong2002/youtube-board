"""Generate a documentation-only capture plan; never opens a browser or network."""
import argparse
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
TARGET = ROOT / 'docs/ui-retake-matrix.json'
VARIANTS = [{'theme': theme, 'width': width} for theme in ['light', 'dark'] for width in [1280, 390]]


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
                     'exampleStatus': 'existing example; candidate origin and data need verification' if entry.get('exampleURL') else 'missing; resolve existing sample or approved isolated mock before capture',
                     'periods': period, 'viewportVariants': VARIANTS, 'status': 'pending-thaw-and-recapture',
                     'plannedViewportPackages': len(period['variants']) * 4})
    # First permitted envelope targets the original four findings, not a sample claiming full-site completion.
    first = []
    for route, example, ps in [('/', '/', ['today', 'week']), ('/keywords', '/keywords', ['today', 'week']),
                               ('/keywords/{keyword}/videos', '/keywords/沈伯洋/videos', ['today', 'week']),
                               ('/keywords/{keyword}/videos', '/keywords/支持/videos', ['today', 'week']),
                               ('/channels', '/channels', ['existing-window'])]:
        for p in ps:
            for v in VARIANTS:
                procedure = next(x for x in periods(route)['variants'] if x['period'] == p)
                first.append({'route': route, 'candidatePath': example, 'period': p, **v, 'status': 'pending',
                              'periodProcedure': procedure,
                              'urlRule': 'Resolve D once per batch, apply procedure query to candidatePath or select actual control; record final URL and assert visible period before each fullpage/slice. Labels alone are not evidence.',
                              'batch': len(first) // 12 + 1})
    count = sum(row['plannedViewportPackages'] for row in rows)
    return {'schemaVersion': 1, 'purpose': 'Planning only; not capture or review evidence', 'operatorFreezeActive': True,
            'candidateSourceSHA': None, 'candidateSourceRule': 'Pin exact final independently reviewed committed SHA before one build; never use dirty worktree or relabel old PNGs',
            'inventorySource': 'docs/ui-review-ledger.json', 'periodDateRule': 'D = Taipei calendar date frozen at batch start; record resolved UTC bounds; crossing midnight requires re-resolution, never mix fullpage and slices',
            'summary': {'uiEntries': len(rows), 'uiRoutes': len({r['route'] for r in rows}), 'plannedViewportPackages': count,
                        'firstEnvelopeViewportPackages': len(first), 'completedCaptures': 0, 'completedReviews': 0,
                        'missingExampleEntries': sum(r['exampleURL'] is None for r in rows)},
            'diskBudget': {'unit': 'bytes', 'historicalDirectoryPngCount': 224, 'historicalDirectoryPngBytes': 49932059,
                           'manifestReferencedPngCount': 202, 'manifestReferencedPngBytes': 43225260,
                           'manifestViewportPackages': 24, 'medianViewportPackageBytes': 1309696, 'largestViewportPackageBytes': 5900530,
                           'historicalNote': '22 PNGs are not assigned to these manifest viewport lists; retained unchanged, not attributed to a new SHA or counted as reviewed.',
                           'estimatedViewportPackageBytes': 2500000, 'planningUpperViewportPackageBytes': 6000000,
                           'estimatedWholeMatrixBytes': count * 2500000, 'planningUpperWholeMatrixBytes': count * 6000000,
                           'estimatesExclude': 'Additional interaction images, refreshed tag references and network receipts; not a reservation or execution approval.',
                           'cumulativeAuthorizedCaptureCeilingBytes': 300000000, 'batchHardCeilingBytes': 90000000,
                           'firstEnvelopeBatches': 3, 'firstEnvelopeEstimatedPngBytes': len(first) * 2500000,
                           'firstEnvelopePlanningUpperPngBytes': len(first) * 6000000,
                           'firstEnvelopeAdditionalEvidenceReserveBytes': 36000000,
                           'firstEnvelopeEvidenceReservePerBatchBytes': 12000000,
                           'batchCeilingScope': 'Includes PNG and all network/reference/metadata evidence; 12 packages at 6MB + 12MB evidence = 84MB, below 90MB. Three inclusive caps total270MB, below300MB.',
                           'rule': 'Stop before either batch or cumulative cap; do not delete old files or reset cumulative accounting between batches. Rest of matrix remains pending until sufficient explicitly approved budget exists.'},
            'captureGates': ['Explicit thaw covering build/staging/capture/probes; no auto-unfreeze',
                             'Global max 2 browsers, max 1 build; pgrep plus actual process inspection before start',
                             'Before and after every batch: load<=12; blog totalSeconds<=2, all three sites known non-5xx; timeout/unknown denies',
                             'Honor 112.5GiB retained capture floor unless operator explicitly supersedes; require estimated batch space above floor',
                             'Independent Playwright DNT=1/GPC; Google/GA/GTM routes installed before first navigation; no synthetic analytics',
                             'Bounded redacted network receipt: allowlisted host/category/outcome only, no headers/cookies/query/body/IP/full UA',
                             'Record SHA, BUILD_ID, pinned digest and runtime artifact proof separately from manifest assertions',
                             'Assert window and data generation before AND after fullpage/slices; drift fails batch; immutable new directory',
                             'Existing roles only; isolated nonidentifying mocks for failures/writes; missing role or fixture stays pending',
                             'Reviewer independently sees exact images and tag references; source author may not self-review'],
            'supplementalStateChecklist': {'routes': ['/', '/keywords', '/keywords/{keyword}/videos', '/channels'],
                                          'required': ['abundant', 'sparse', 'empty', 'unavailable/error', 'loading', 'unknown views/partial coverage', 'filter/sort/pagination interaction'],
                                          'rule': 'Use corresponding ledger row where present; otherwise attach sub-state case before capture. First envelope default screenshots do not satisfy this checklist; each additional case consumes budget and needs all four viewport/theme variants.'},
            'firstEnvelope': first, 'entries': rows}


def validate(plan, ledger):
    indices = [i for i, e in enumerate(ledger['entries']) if e['kind'] == 'UI']
    assert [r['ledgerEntryIndex'] for r in plan['entries']] == indices
    assert plan['summary']['uiEntries'] == ledger['summary']['uiEntries']
    assert plan['summary']['uiRoutes'] == ledger['summary']['uiUniqueRoutes']
    assert len(plan['firstEnvelope']) == 36
    assert all(r['viewportVariants'] == VARIANTS and r['status'] == 'pending-thaw-and-recapture' for r in plan['entries'])
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
    assert disk['firstEnvelopeBatches'] * disk['batchHardCeilingBytes'] < disk['cumulativeAuthorizedCaptureCeilingBytes']


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    ledger = json.loads((ROOT / 'docs/ui-review-ledger.json').read_text())
    plan = create(ledger)
    validate(plan, ledger)
    output = json.dumps(plan, ensure_ascii=False, indent=2) + '\n'
    if args.check:
        assert TARGET.read_text() == output, 'Recapture plan stale; regenerate from ledger'
    else:
        TARGET.write_text(output)
    print(json.dumps(plan['summary'], ensure_ascii=False))
