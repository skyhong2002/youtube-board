#!/usr/bin/env python3
"""Export scoped MariaDB recovery principals through a local Docker service.

Credentials are read only inside the selected DB container. Recovery SQL is
written to a new private directory; stdout contains counts and a checksum only.
Restore create-users.sql before schemas, and grants.sql after schema restoration.
This export does not freeze writers or make a mixed-engine snapshot consistent.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys


class ExportError(Exception):
    pass


def run_private(command, timeout=15):
    try:
        result = subprocess.run(command, capture_output=True, text=True, timeout=timeout)
    except (OSError, subprocess.TimeoutExpired):
        raise ExportError('Principal export command failed; raw diagnostics withheld') from None
    if result.returncode:
        raise ExportError('Principal export failed; raw diagnostics withheld')
    return result.stdout


def export_principals(output, service='youtube-board-db-qcja1i', prefix='youtube_ts_'):
    if not re.fullmatch(r'[a-zA-Z0-9_-]{1,128}', service):
        raise ExportError('Invalid database service name')
    if not re.fullmatch(r'[a-z][a-z0-9_]{1,60}_', prefix):
        raise ExportError('Invalid principal prefix')
    output = Path(output)
    output.mkdir(mode=0o700, parents=False, exist_ok=False)
    os.chmod(output, 0o700)
    container = run_private([
        'docker', 'ps', '-q', '--filter', 'label=com.docker.swarm.service.name=' + service,
        '--filter', 'status=running',
    ]).strip()
    if not re.fullmatch(r'[a-f0-9]{12}|[a-f0-9]{64}', container):
        raise ExportError('Expected exactly one running database container')

    def sql(query):
        return run_private([
            'docker', 'exec', container, 'bash', '-c',
            'export MYSQL_PWD="${MARIADB_ROOT_PASSWORD:-${MYSQL_ROOT_PASSWORD:-}}"; '
            'test -n "$MYSQL_PWD" || exit 1; '
            'exec mariadb --user=root --batch --raw --skip-column-names -e "$1"',
            'export', query,
        ])

    rows = sql("SELECT User,Host FROM mysql.user WHERE User REGEXP '^" + prefix
               + "[a-z0-9_]+$' ORDER BY BINARY User,BINARY Host").splitlines()
    if not 0 < len(rows) < 100:
        raise ExportError('Expected a bounded nonempty principal inventory')
    create, grants, inventory, seen = [], [], [], set()
    for line in rows:
        fields = line.split('\t')
        if len(fields) != 2:
            raise ExportError('Invalid principal inventory shape')
        user, host = fields
        if (not re.fullmatch(re.escape(prefix) + r'[a-z0-9_]+', user)
                or not re.fullmatch(r'[a-zA-Z0-9.%_:/-]+', host)
                or (user, host) in seen):
            raise ExportError('Invalid or duplicate principal identity')
        seen.add((user, host))
        principal = "'" + user + "'@'" + host + "'"
        definitions = sql('SHOW CREATE USER ' + principal).splitlines()
        if len(definitions) != 1 or not definitions[0].startswith('CREATE USER '):
            raise ExportError('Invalid principal definition shape')
        create.append(definitions[0] + ';\n')
        permissions = sql('SHOW GRANTS FOR ' + principal).splitlines()
        if not permissions or not all(item.startswith('GRANT ') for item in permissions):
            raise ExportError('Invalid principal grants shape')
        grants.extend(item + ';\n' for item in permissions)
        inventory.append({'user': user, 'host': host, 'grantCount': len(permissions)})

    artifacts = {
        'create-users.sql': ''.join(create),
        'grants.sql': ''.join(grants),
        'inventory.json': json.dumps(inventory, indent=2) + '\n',
    }
    seal = ''.join(hashlib.sha256(body.encode()).hexdigest() + '  ' + name + '\n'
                   for name, body in artifacts.items())
    artifacts['principals.sha256'] = seal
    # The seal is created last; failure before that cannot look like a complete export.
    for name, body in artifacts.items():
        descriptor = os.open(output / name, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(descriptor, 'w') as handle:
            os.fchmod(handle.fileno(), 0o600)
            handle.write(body)
            handle.flush()
            os.fsync(handle.fileno())
    descriptor = os.open(output, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)
    return {'principalCount': len(rows), 'grantCount': len(grants),
            'artifactSha256': hashlib.sha256(seal.encode()).hexdigest()}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('output', help='new private recovery artifact directory')
    parser.add_argument('--service', default='youtube-board-db-qcja1i')
    parser.add_argument('--user-prefix', default='youtube_ts_')
    args = parser.parse_args()
    try:
        result = export_principals(args.output, args.service, args.user_prefix)
    except (ExportError, OSError):
        print('Principal export failed; raw diagnostics withheld', file=sys.stderr)
        return 1
    print(json.dumps(result))
    return 0


if __name__ == '__main__':
    sys.exit(main())
