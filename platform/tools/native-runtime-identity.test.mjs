import assert from 'node:assert/strict';
import test from 'node:test';
import { compatibleRuntime } from './native-runtime-identity.mjs';

const runtime = { platform: 'linux', arch: 'arm64', node: 'v24.21.0', abi: '137' };
test('actual Node24.21 / ABI137 accepted without changing version', () => {
  assert.equal(compatibleRuntime(runtime), true);
  assert.equal(runtime.node, 'v24.21.0');
});
test('Node24.15 also accepted', () => {
  assert.equal(compatibleRuntime({ ...runtime, node: 'v24.15.0' }), true);
});
test('other major versions rejected', () => {
  for (const node of ['v22.13.1', 'v25.0.0', '24.21.0', 'v24.bad.0'])
    assert.equal(compatibleRuntime({ ...runtime, node }), false);
});
test('wrong ABI, arch, platform or missing identity rejected', () => {
  for (const changed of [{ abi: '136' }, { abi: 137 }, { arch: 'x64' }, { platform: 'darwin' }])
    assert.equal(compatibleRuntime({ ...runtime, ...changed }), false);
  assert.equal(compatibleRuntime(null), false);
});
