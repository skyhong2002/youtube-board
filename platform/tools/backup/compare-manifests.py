#!/usr/bin/env python3
"""Compare private backup manifests without printing schema/data or credentials."""
import argparse
import hashlib
import re
from pathlib import Path

FILES = ('runtime.tsv', 'database.tsv', 'tables.tsv', 'rows.tsv', 'ddl.tsv',
         'checksums.tsv', 'triggers.tsv', 'routines.tsv', 'routine-ddl.tsv',
         'events.tsv', 'event-ddl.tsv')
parser = argparse.ArgumentParser()
parser.add_argument('source', type=Path)
parser.add_argument('restored', type=Path)
args = parser.parse_args()
def linked_path(path):
    # Inspect every path component before any read (including a symlink root).
    return any(part.is_symlink() for part in (path, *path.parents))

def schemas(root):
    inventory = root / 'schemas.tsv'
    if linked_path(inventory):
        raise ValueError('symlink-schema-inventory')
    if not inventory.is_file():
        return None  # Backward compatibility with pre-multi-schema artifacts.
    names = inventory.read_text().splitlines()
    if not 1 <= len(names) <= 8 or len(set(names)) != len(names):
        raise ValueError('invalid-schema-inventory')
    if any(not re.fullmatch(r'[A-Za-z0-9_]{1,64}', name) for name in names):
        raise ValueError('invalid-schema-inventory')
    return names

try:
    source_names, restored_names = schemas(args.source), schemas(args.restored)
except (ValueError, UnicodeError):
    print('manifest-mismatch schema-inventory:invalid')
    raise SystemExit(1)
if source_names != restored_names and not (
    source_names is None and restored_names is not None and len(restored_names) == 1
    or restored_names is None and source_names is not None and len(source_names) == 1
):
    print('manifest-mismatch schema-inventory:different')
    raise SystemExit(1)
names = source_names or restored_names
paths = [Path('manifests') / name for name in names] if names and len(names) > 1 else [Path('.')]
failed = []
for path in paths:
    for name in FILES:
        left, right = args.source / path / name, args.restored / path / name
        # Do not follow links from a retrieved artifact into other host files.
        if linked_path(left) or linked_path(right) or not left.is_file() or not right.is_file():
            failed.append(str(path / name) + ':missing')
        elif hashlib.sha256(left.read_bytes()).digest() != hashlib.sha256(right.read_bytes()).digest():
            failed.append(str(path / name) + ':different')
if failed:
    print('manifest-mismatch ' + ','.join(failed))
    raise SystemExit(1)
print('manifest-match files=' + str(len(FILES) * len(paths)) + ' schemas=' + str(len(paths)))
