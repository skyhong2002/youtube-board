# Fixture execution pin contract (source preparation only)

This change grants no execution, serving, build or deployment authority. No real
config, source approval or independent review receipt is created by this document.

`mint-youtube-fixture-guardian.py` now requires `executionPins` in the private
config, with exactly these keys:

- `sourcePins`: map of every relative file in `EXECUTION_SOURCES` to its actual
  lowercase SHA-256, including the guardian, all imported OPS modules, worker,
  keyword policy, tag no-equal/noise, folding helper and public reason labels.
- `toolPins`: exactly `nodeBinary`, `mariadbd`, `installDb`, mapped to actual
  binary/script SHA-256. Config paths must be canonical regular files.
- `keywordPolicyCommit`: `7b4321f85ab6f7e8f541dcacd8f4975f0b8cd8de`.
- `sourceReceiptSha256`: SHA-256 of the actual private fixture source receipt.
- `dependencyTreeSha256`: actual `dependency_tree(APP_root)` result for the
  installed `platform/node_modules`; byte changes or internal-link changes
  invalidate it. External links, empty trees, excessive file counts/bytes fail.

The independently returned execution review must contain the exact same
`executionPins`, alongside the existing exact `configSha256`, `guardianSha256`
and adapter pins. Its actual receipt hash is supplied by the operator as the CLI
review pin. Never manufacture `accepted-fixture-only` or a reviewer transcript.

The fixture config repeats `sourceReceiptSha256` and `dependencyTreeSha256`.
The source receipt binds the exact APP/OPS identity, full tracked source-tree
hashes, installed dependency-tree hash, runtime tool hashes and the actual
independent transcript path/hash. Source-tree, receipt, dependency and runtime
hash checks happen before fixture lock acquisition/startup. Guardian execution
pins are checked before importing the pinned adapters or acquiring its lock.

APP remains `70529cff13b6b7f5b3e0571a229e2b61660f9df4`. Keyword filtering in
`7b4321f8` is successor source evidence only: the frozen fixture APP does not
acquire this behavior merely by pinning OPS source. The final application
successor must independently include and test that change before ranking/UI
acceptance. Exact final OPS SHA and clean tree hashes must be materialized after
commit/review; do not reuse old OPS receipts.

Before real execution, collect actual runtime tool/dependency hashes on the
isolated target, verify Node ABI and native modules/shared-library compatibility,
obtain independent source and exact-config receipts, update the real handoff
identity, and submit exact commands plus a fresh three-host probe to babysit.
No lock or service is acquired during this preparation. Native ABI compatibility,
runtime stability and UI acceptance remain pending; hashes alone prove none of
those outcomes.
