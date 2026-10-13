// Pure policy: use actual reported versions; never rewrite runtime identity.
export function compatibleRuntime(runtime) {
  return runtime?.platform === 'linux' && runtime.arch === 'arm64'
    && typeof runtime.node === 'string' && /^v24\.\d+\.\d+$/.test(runtime.node)
    && runtime.abi === '137';
}
