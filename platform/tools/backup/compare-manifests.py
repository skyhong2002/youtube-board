#!/usr/bin/env python3
"""Compare private backup manifests without printing schema/data or credentials."""
import argparse
import hashlib
from pathlib import Path

FILES = ('runtime.tsv', 'database.tsv', 'tables.tsv', 'rows.tsv', 'ddl.tsv',
         'checksums.tsv', 'triggers.tsv', 'routines.tsv', 'routine-ddl.tsv',
         'events.tsv', 'event-ddl.tsv')
parser = argparse.ArgumentParser()
parser.add_argument('source', type=Path)
parser.add_argument('restored', type=Path)
args = parser.parse_args()
failed = []
for name in FILES:
    left, right = args.source / name, args.restored / name
    if not left.is_file() or not right.is_file():
        failed.append(name + ':missing')
    elif hashlib.sha256(left.read_bytes()).digest() != hashlib.sha256(right.read_bytes()).digest():
        failed.append(name + ':different')
if failed:
    print('manifest-mismatch ' + ','.join(failed))
    raise SystemExit(1)
print('manifest-match files=' + str(len(FILES)))
