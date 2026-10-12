#!/usr/bin/env python3
"""Defense-in-depth credential redaction for explicitly prepared review text.

Not a secret detector: callers must still select and inspect their packets.
"""
import re

_KEY = r'(?:[A-Za-z_][A-Za-z0-9_]*)?(?:TOKEN|SECRET|PASSWORD|API_KEY|CLIENT_ID|PRIVATE_KEY|CREDENTIAL|CREDENTIALS|COOKIE)'
_PREFIX = r'''(?P<prefix>(?<![A-Za-z0-9_])["']?(?P<key>''' + _KEY + r''')["']?[ \t]*[:=][ \t]*)'''
# Whole quoted scalar, including escaped quotes, multiline PEMs and triple quotes.
_QUOTED = re.compile(_PREFIX + r'''(?P<quote>"""|\'\'\'|["'`])(?:\\[\s\S]|(?!(?P=quote))[^\\])*(?P=quote)''', re.IGNORECASE)
_UNQUOTED = re.compile(r'''(?m)^(?P<prefix>[ \t]*(?:export[ \t]+)?(?:[A-Z_][A-Z0-9_]*)?(?:TOKEN|SECRET|PASSWORD|API_KEY|CLIENT_ID|PRIVATE_KEY|CREDENTIAL|COOKIE)[ \t]*[:=][ \t]*)(?!["'`\s])[^\s]+''', re.IGNORECASE)

def redact(text):
    text = re.sub(r'-----BEGIN (?:[A-Z ]*PRIVATE KEY)-----[\s\S]*?-----END (?:[A-Z ]*PRIVATE KEY)-----', '[REDACTED PRIVATE KEY]', text)
    # URL userinfo, including percent-encoded passwords, never belongs in review.
    text = re.sub(r'([a-zA-Z][a-zA-Z0-9+.-]*://[^\s/@:]+:)[^\s/@]+(@)', r'\1[REDACTED]\2', text)
    text = re.sub(r'(?i)(\bBearer\s+)[A-Za-z0-9._~+/=-]+', r'\1[REDACTED]', text)
    text = _QUOTED.sub(lambda m: m['prefix'] + m['quote'] + '[REDACTED]' + m['quote'], text)
    text = _UNQUOTED.sub(lambda m: m['prefix'] + '[REDACTED]', text)
    return text

if __name__ == '__main__':
    import sys
    sys.stdout.write(redact(sys.stdin.read()))
