"""Pure SM/direct-arm64 preflight. No probe, lock, build or admission on import.

The execution adapter must authenticate local SM and pinned direct SSH samples
before calling this function. A passing health gate does not grant the build slot.
Mint and historical relay receipts are deliberately outside this contract.
"""
import datetime
import hashlib
import math
from pathlib import Path
import re
import statistics
import types

_path = Path(__file__).with_name('native-arm64-probe-collector.py')
_bytes = _path.read_bytes()
if hashlib.sha256(_bytes).hexdigest() != 'ebdac97a65d431f073735f3349efb2c6a9e6c343010095d8b6dc81222ad87155':
    raise ValueError('Reviewed health validator pin mismatch')
_validator = types.ModuleType('pinned_health_validator')
exec(compile(_bytes, str(_path), 'exec'), _validator.__dict__)

HOSTS = ('SM', 'skyhong-blog')
LIMITS = {'tag': 2.0, 'blog': 6.17, 'youtube': 2.0}
CACHE_STATUSES = {'HIT', 'MISS', 'DYNAMIC', 'BYPASS', 'EXPIRED', 'STALE', 'REVALIDATED', 'UPDATING', 'NONE', 'UNKNOWN'}


def utc_timestamp(value):
    if not isinstance(value, str) or not re.fullmatch(
            r'[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]{1,6})?(?:Z|\+00:00)', value):
        raise ValueError('UTC timestamp required')
    return datetime.datetime.fromisoformat(value.replace('Z', '+00:00'))


def normalized_sample(sample, host):
    """Validate all raw attempts before adapting to the pinned resource schema."""
    if not isinstance(sample, dict) or sample.get('schema') != 'yt-host-health-median-v2':
        return None
    sites = sample.get('sites')
    if not isinstance(sites, dict) or set(sites) != set(LIMITS):
        return None
    normalized = dict(sample, schema='yt-host-health-v1', sites={})
    try:
        observed = utc_timestamp(sample.get('observedAt'))
        for site, attempts in sites.items():
            if not isinstance(attempts, list) or len(attempts) != 3:
                return None
            for row in attempts:
                if not isinstance(row, dict) or set(row) != {'startedAt', 'finishedAt', 'exitCode', 'status', 'totalSeconds', 'bytes', 'cfCacheStatus'}:
                    return None
                if not utc_timestamp(row['startedAt']) <= utc_timestamp(row['finishedAt']) <= observed:
                    return None
                if type(row['exitCode']) is not int or not 0 <= row['exitCode'] <= 255:
                    return None
                for key in ('status', 'bytes'):
                    value = row[key]
                    if value is None:
                        if row['exitCode'] == 0:
                            return None
                    elif type(value) is not int or value < 0 or key == 'status' and value > 599:
                        return None
                if row['cfCacheStatus'] is not None and row['cfCacheStatus'] not in CACHE_STATUSES:
                    return None
                time = row['totalSeconds']
                if time is None:
                    if row['exitCode'] == 0:
                        return None
                elif type(time) not in (int, float) or not math.isfinite(time) or time < 0:
                    return None
            times = [r['totalSeconds'] for r in attempts]
            known = all(t is not None for t in times)
            normalized['sites'][site] = {'exitCode': 0, 'status': 200,
                                         'totalSeconds': statistics.median(times) if known else 0}
    except (ValueError, TypeError, OverflowError):
        return None
    return normalized if _validator.health_valid(normalized, host) else None


def evaluate(samples, now):
    """Only emit fixed reasons, never unvalidated sample values or secrets."""
    checks = []

    def check(key, ok, reason):
        checks.append({'key': key, 'ok': bool(ok), 'reason': reason})

    complete = isinstance(samples, dict) and set(samples) == set(HOSTS)
    check('hosts', complete, 'exactly-SM-and-skyhong-blog-required')
    valid = {}
    for host in HOSTS:
        sample = samples.get(host) if isinstance(samples, dict) else None
        normalized = normalized_sample(sample, host)
        strict = normalized is not None
        check(host + '.schema', strict, 'strict-pinned-host-health-required')
        if not strict:
            continue
        valid[host] = sample
        try:
            timestamps = [sample['observedAt']] + [row[key] for attempts in sample['sites'].values()
                                                   for row in attempts for key in ('startedAt', 'finishedAt')]
            fresh = all(0 <= (now - utc_timestamp(t)).total_seconds() <= 30 for t in timestamps)
        except (ValueError, TypeError, OverflowError):
            fresh = False
        check(host + '.fresh', fresh, 'sample-age-zero-to-30-seconds')
        check(host + '.disk', sample['freeBytes'] >= 40 * 1024 ** 3, 'start-floor-40-GiB')
        check(host + '.load', sample['load1'] <= 12, 'maximum-load-12')
        check(host + '.builds', sample['buildCount'] == 0, 'no-existing-build')
        for site, limit in LIMITS.items():
            attempts = sample['sites'][site]
            check(host + '.' + site + '.http', all(row['exitCode'] == 0 and row['status'] == 200 for row in attempts),
                  'every-attempt-curl-zero-and-HTTP-200-required')
            check(host + '.' + site + '.time-known', all(row['totalSeconds'] is not None for row in attempts),
                  'every-attempt-complete-HTML-time-required')
            if host == 'SM':
                check(host + '.' + site + '.time', normalized['sites'][site]['totalSeconds'] <= limit,
                      'SM-three-attempt-median-within-baseline-gate')
    check('global.browsers', len(valid) == 2 and sum(s['browserCount'] for s in valid.values()) <= 2,
          'all-participating-host-browser-sum-at-most-two')
    return {'schema': 'yt-sm-direct-arm64-health-gate-v2',
            'ok': all(row['ok'] for row in checks), 'checks': checks,
            'timeMeasurementHost': 'SM', 'timeLimitsSeconds': dict(LIMITS),
            'samplesPerSite': 3,
            'medianSeconds': {host: {site: statistics.median([r['totalSeconds'] for r in attempts])
                                     if all(r['totalSeconds'] is not None for r in attempts) else None
                                     for site, attempts in sample['sites'].items()}
                              for host, sample in valid.items()},
            'admissionGranted': False, 'runtimeReady': False}
