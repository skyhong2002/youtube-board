"""Fixed native compiler/image command plan; never executes commands on import.

Start/commit are separate guarded stages. The adapter must prove owned compiler
pause/terminal state and obtain babysit approval before dispatching either.
No production service, existing image or retained release is mutated here.
"""
import re

APP = '073985b8bc4bbcc9ffb5d43c1e1a26060bb8ac4a'
BASE = 'sha256:5b7d9171d9633c132766c65abd934c791787693a72b7f016bcd1408097dedadd'
WORKDIR = '/home/node/yt-build-073985b8/platform'
COMPILER = '''set -eu
test "$(node -p 'process.arch')" = arm64
test "$(node -p 'process.version.split(".")[0]')" = v24
test "$(node -p 'process.versions.modules')" = 137
test -x /usr/bin/nice
test -x /usr/bin/ionice
cd /home/node/yt-build-073985b8/platform
npm ci --include=dev --cache=/tmp/npm-cache --no-audit --no-fund
npm run typecheck
./node_modules/.bin/tsc -p runtime/tsconfig.json
npm run build --workspace=@youtube-board/web
test -s web/.next/BUILD_ID
test -f web/.next/standalone/web/server.js
mkdir -p web/.next/standalone/web/.next/static web/.next/standalone/web/public
cp -a web/.next/static/. web/.next/standalone/web/.next/static/
if test -d web/public; then cp -a web/public/. web/.next/standalone/web/public/; fi
node -e 'const s=require("sharp");console.log(JSON.stringify({node:process.version,abi:process.versions.modules,arch:process.arch,glibcRuntime:process.report.getReport().header.glibcVersionRuntime,sharp:s.versions.sharp}));'
cat web/.next/BUILD_ID
'''


def plan(generation, ops_sha):
    if not isinstance(generation, str) or not re.fullmatch(r'yt-f2-[a-z0-9-]{1,48}', generation):
        raise ValueError('Fixed safe job generation required')
    if not isinstance(ops_sha, str) or not re.fullmatch(r'[0-9a-f]{40}', ops_sha):
        raise ValueError('Exact reviewed OPS required')
    container = generation + '-compiler'
    source = '/home/ubuntu/' + generation + '/source'
    tag = 'youtube-board-ts:f2-073985b8-' + generation
    create = ['/usr/bin/nice', '-n', '19', '/usr/bin/ionice', '-c', '3', '/usr/bin/docker', 'create',
              '--pull=never', '--platform=linux/arm64', '--name=' + container,
              '--network=bridge', '--cap-drop=ALL', '--security-opt=no-new-privileges',
              '--cgroupns=private', '--restart=no', '--pids-limit=256', '--cpus=2',
              '--memory=2g', '--memory-swap=2g', '--user=1000:1000',
              '--tmpfs=/tmp:rw,nosuid,size=536870912', '--workdir=' + WORKDIR,
              '--env=NEXT_TELEMETRY_DISABLED=1', '--env=NODE_OPTIONS=--max-old-space-size=768',
              '--env=UV_THREADPOOL_SIZE=2', '--env=RAYON_NUM_THREADS=2',
              '--label=tw.observe.job.owner=d7967e77', '--label=tw.observe.job.app-sha=' + APP,
              '--label=tw.observe.job.ops-sha=' + ops_sha, '--label=tw.observe.job.generation=' + generation,
              '--entrypoint=/usr/bin/nice', BASE, '-n', '19', '/usr/bin/ionice', '-c', '3',
              '/bin/sh', '-ec', COMPILER]
    commit = ['/usr/bin/nice', '-n', '19', '/usr/bin/ionice', '-c', '3', '/usr/bin/docker', 'commit',
              '--change=WORKDIR ' + WORKDIR, '--change=USER node',
              '--change=ENTRYPOINT ["/usr/bin/tini","--"]',
              '--change=CMD ["node","runtime/launcher.mjs","web"]',
              '--change=ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 RUNTIME_ROLE=web PORT=8000',
              '--change=LABEL org.opencontainers.image.revision=' + APP, container, tag]
    return {'schema': 'yt-native-arm64-command-plan-v1', 'appSha': APP, 'opsSha': ops_sha,
            'baseImage': BASE, 'containerName': container, 'imageTag': tag, 'sourcePath': source,
            'createArgv': create,
            'copyArgv': ['/usr/bin/docker', 'cp', '--archive', source + '/.', container + ':/home/node/yt-build-073985b8'],
            'startArgv': ['/usr/bin/docker', 'start', container], 'commitArgv': commit,
            'estimatedAdditionalDiskGiB': 6, 'estimatedBuildMinutes': [8, 20],
            'compilerMemoryLimitGiB': 2, 'compilerTmpfsMiB': 512,
            'executionAllowed': False, 'runtimeGuardAdapterRequired': True,
            'packageOnlyAfterCompilerTerminalSuccess': True,
            'pauseScope': 'only full owned compiler container ID; verify frozen cgroup before reporting STOP',
            'oldImagesRetained': True, 'newRuntimeWorkdir': WORKDIR}
