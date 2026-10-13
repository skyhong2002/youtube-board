import importlib.util
from pathlib import Path
import unittest

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

    def test_generation_and_ops_injection_rejected(self):
        for value in ['../prod', 'yt-f2-a;touch-secret', 'other-thread']:
            with self.assertRaises(ValueError): module.plan(value, 'a' * 40)
        with self.assertRaises(ValueError): module.plan('yt-f2-20261014a', 'main')


if __name__ == '__main__': unittest.main()
