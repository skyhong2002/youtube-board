"""Pure validation of actual independent source-review transcripts; never grants execution."""
import datetime as dt
import re

SCOPE = 'mint-youtube-fixture-source-only'
MODELS = {'gpt-6.1-sol', 'claude-opus-5-5'}
REVIEWER = '/root/capture_source_review'


def validate_transcript(row, ops_sha, app_sha, source_pins, now):
    def require(value):
        if not value:
            raise ValueError('AFFIRMATIVE_EXACT_INDEPENDENT_SOURCE_REVIEW_REQUIRED')
    require(isinstance(row, dict) and row.get('schema') == 'yt-independent-source-review-v1')
    require(row.get('scope') == SCOPE and row.get('verdict') == 'pass' and row.get('findings') == [])
    require(row.get('range', {}).get('head') == ops_sha and row.get('appSha') == app_sha)
    reviewer = row.get('reviewer')
    require(isinstance(reviewer, dict) and reviewer.get('agent') == REVIEWER and reviewer.get('model') in MODELS)
    at = row.get('observedAt')
    require(isinstance(at, str) and re.fullmatch(r'\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,6})?(?:Z|\+00:00)', at))
    try:
        observed = dt.datetime.fromisoformat(at.replace('Z', '+00:00'))
    except ValueError:
        raise ValueError('AFFIRMATIVE_EXACT_INDEPENDENT_SOURCE_REVIEW_REQUIRED') from None
    require(observed <= now and observed.utcoffset() == dt.timedelta(0))
    require(isinstance(source_pins, dict) and bool(source_pins))
    reviewed = row.get('sourceSha256')
    require(isinstance(reviewed, dict) and all(isinstance(value, str) and re.fullmatch(r'[0-9a-f]{64}', value) and reviewed.get(name) == value for name, value in source_pins.items()))
    boundary = row.get('boundaries')
    require(isinstance(boundary, dict) and boundary.get('sourceOnly') is True and boundary.get('runtimeAccepted') is False and boundary.get('admissionGranted') is False)
