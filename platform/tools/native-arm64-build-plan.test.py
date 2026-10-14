import importlib.util
from pathlib import Path
import unittest
import subprocess
import tempfile

spec = importlib.util.spec_from_file_location('build_plan', Path(__file__).with_name('native-arm64-build-plan.py'))
module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)


class PlanTests(unittest.TestCase):
    def test_fixed_native_source_base_and_caps(self):
        p = module.plan('yt-f2-20261014a', 'a' * 40)
        self.assertEqual(p['appSha'], '073985b8bc4bbcc9ffb5d43c1e1a26060bb8ac4a')
        argv = p['createArgv']
        for token in [module.BASE, '--platform=linux/arm64', '--pull=never', '--cpus=2', '--memory=2g',
                      '--memory-swap=2g', '--user=1000:1000', '--cap-drop=ALL', '--security-opt=no-new-privileges']:
            self.assertIn(token, argv)
        self.assertIn('npm ci --include=dev', module.COMPILER)
        self.assertIn('web/.next/BUILD_ID', module.COMPILER)
        self.assertFalse(p['executionAllowed'])

    def test_no_service_or_existing_image_mutation(self):
        p = module.plan('yt-f2-20261014a', 'a' * 40)
        for key in ('createArgv', 'copyArgv', 'startArgv', 'commitArgv'):
            argv = p[key]
            self.assertNotIn('service', argv)
            self.assertNotIn('pull', argv)
            self.assertNotIn('rm', argv)
            self.assertNotIn('rmi', argv)
            self.assertNotIn('--mount', argv)
        self.assertTrue(p['packageOnlyAfterCompilerTerminalSuccess'])

    def test_runtime_tree_isolated_from_old_base_app(self):
        p = module.plan('yt-f2-20261014a', 'a' * 40)
        self.assertIn('--change=WORKDIR ' + module.WORKDIR, p['commitArgv'])
        self.assertIn('--change=LABEL org.opencontainers.image.revision=' + module.APP, p['commitArgv'])
        self.assertNotEqual(module.WORKDIR, '/app')

    def test_start_cannot_compile_before_fresh_guardian_admission(self):
        with tempfile.TemporaryDirectory() as directory:
            marker = str(Path(directory) / 'admitted')
            built = str(Path(directory) / 'compiled')
            # Override sleep only for the test's bounded local shell. The actual
            # compiler uses the fixed 180-second barrier and real sleep.
            script = 'set -eu\nsleep(){ :; }\n' + module.admission_barrier(marker, 1) + f'touch {built}\n'
            result = subprocess.run(['/bin/sh','-ec',script],timeout=2)
            self.assertEqual(result.returncode,77)
            self.assertFalse(Path(built).exists())
            Path(marker).touch()
            result = subprocess.run(['/bin/sh','-ec',script],timeout=2)
            self.assertEqual(result.returncode,0)
            self.assertTrue(Path(built).exists())
            self.assertLess(module.COMPILER.index('remaining=180'),module.COMPILER.index('npm ci'))

    def test_symlink_is_not_an_admission_marker(self):
        with tempfile.TemporaryDirectory() as directory:
            source=Path(directory)/'source';source.touch()
            marker=Path(directory)/'admitted';marker.symlink_to(source)
            script='set -eu\nsleep(){ :; }\n'+module.admission_barrier(str(marker),1)
            self.assertEqual(subprocess.run(['/bin/sh','-ec',script],timeout=2).returncode,77)

    def test_generation_and_ops_injection_rejected(self):
        for value in ['../prod', 'yt-f2-a;touch-secret', 'other-thread']:
            with self.assertRaises(ValueError): module.plan(value, 'a' * 40)
        with self.assertRaises(ValueError): module.plan('yt-f2-20261014a', 'main')


if __name__ == '__main__': unittest.main()
