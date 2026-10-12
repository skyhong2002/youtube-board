#!/usr/bin/env python3
"""Send an explicitly prepared, secret-free review packet on stdin to Opus.

No repo files, environment blocks, or credentials are automatically attached.
The credential is only used in the Authorization header, never printed.
"""
import importlib.util
from pathlib import Path
import json
import os
import sys
import urllib.error
import urllib.request

def main():
    spec = importlib.util.spec_from_file_location('review_redact', Path(__file__).with_name('review-redact.py'))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    packet = module.redact(sys.stdin.read())
    if not packet.strip() or len(packet) > 240_000:
        sys.exit('Provide a non-empty, reviewed packet of at most 240000 characters on stdin.')
    key = os.environ.get('CLI_PROXY_API_KEY')
    if not key:
        sys.exit('CLI_PROXY_API_KEY is required.')
    try:
        max_tokens = int(os.environ.get('OPUS_REVIEW_MAX_TOKENS', '4096'))
        if not 1024 <= max_tokens <= 12000:
            raise ValueError()
    except ValueError:
        sys.exit('OPUS_REVIEW_MAX_TOKENS must be between 1024 and 12000.')
    payload = {
        'model': 'claude-opus-5-5',
        'messages': [
            {'role': 'system', 'content': 'You are a code reviewer for a Laravel-to-TypeScript dashboard rewrite. Review only the supplied evidence. Identify concrete correctness defects, severity, affected locations, fixes and missing tests. Distinguish verified defects from assumptions. Do not claim to run code. Preserve production write gates and data provenance. Reply in Traditional Chinese.'},
            {'role': 'user', 'content': packet},
        ],
        'max_tokens': max_tokens,
        'reasoning_effort': 'low',
        'stream': False,
    }
    request = urllib.request.Request(
        'http://127.0.0.1:8317/v1/chat/completions',
        data=json.dumps(payload).encode(),
        headers={'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json'},
    )
    try:
        with urllib.request.urlopen(request, timeout=240) as response:
            data = json.load(response)
        if data.get('model') != 'claude-opus-5-5':
            sys.exit('CLI Proxy returned a different model; this does not count as the requested review.')
        choices = data.get('choices', [])
        if not choices or any(c.get('finish_reason') != 'stop' or not isinstance(c.get('message', {}).get('content'), str) or not c['message']['content'].strip() for c in choices):
            sys.exit('CLI Proxy returned an incomplete or truncated review; this does not count as completed review.')
        print(json.dumps({
            'requested_model': payload['model'], 'response_model': data.get('model'),
            'reviews': [{'text': c.get('message', {}).get('content'), 'finish_reason': c.get('finish_reason')} for c in data.get('choices', [])],
            'usage': data.get('usage'),
        }, ensure_ascii=False, indent=2))
    except urllib.error.HTTPError as error:
        sys.exit(f'CLI Proxy returned HTTP {error.code}; response body withheld.')
    except (OSError, ValueError):
        sys.exit('CLI Proxy review failed (connection, timeout or invalid response).')

if __name__ == '__main__':
    main()
