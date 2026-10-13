"""Pure SM/direct-arm64 preflight. No probe, lock, build or admission on import.

The execution adapter must authenticate local SM and pinned direct SSH samples
before calling this function. A passing health gate does not grant the build slot.
Mint and historical relay receipts are deliberately outside this contract.
"""
import datetime
import hashlib
from pathlib import Path
import types

_path = Path(__file__).with_name('native-arm64-probe-collector.py')
_bytes = _path.read_bytes()
if hashlib.sha256(_bytes).hexdigest() != 'ebdac97a65d431f073735f3349efb2c6a9e6c343010095d8b6dc81222ad87155':
    raise ValueError('Reviewed health validator pin mismatch')
_validator = types.ModuleType('pinned_health_validator')
exec(compile(_bytes, str(_path), 'exec'), _validator.__dict__)

HOSTS = ('SM', 'skyhong-blog')
LIMITS = {'tag': 2.0, 'blog': 6.17, 'youtube': 2.0}


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
        strict = _validator.health_valid(sample, host)
        check(host + '.schema', strict, 'strict-pinned-host-health-required')
        if not strict:
            continue
        valid[host] = sample
        try:
            at = datetime.datetime.fromisoformat(sample['observedAt'].replace('Z', '+00:00'))
            age = (now - at).total_seconds()
            fresh = 0 <= age <= 30
        except (ValueError, TypeError, OverflowError):
            fresh = False
        check(host + '.fresh', fresh, 'sample-age-zero-to-30-seconds')
        check(host + '.disk', sample['freeBytes'] >= 40 * 1024 ** 3, 'start-floor-40-GiB')
        check(host + '.load', sample['load1'] <= 12, 'maximum-load-12')
        check(host + '.builds', sample['buildCount'] == 0, 'no-existing-build')
        for site, limit in LIMITS.items():
            row = sample['sites'][site]
            check(host + '.' + site + '.http', row['exitCode'] == 0 and row['status'] == 200,
                  'curl-zero-and-HTTP-200-required')
            if host == 'SM':
                check(host + '.' + site + '.time', row['totalSeconds'] <= limit,
                      'SM-complete-HTML-time-within-baseline-gate')
    check('global.browsers', len(valid) == 2 and sum(s['browserCount'] for s in valid.values()) <= 2,
          'all-participating-host-browser-sum-at-most-two')
    return {'schema': 'yt-sm-direct-arm64-health-gate-v1',
            'ok': all(row['ok'] for row in checks), 'checks': checks,
            'timeMeasurementHost': 'SM', 'timeLimitsSeconds': dict(LIMITS),
            'admissionGranted': False, 'runtimeReady': False}
