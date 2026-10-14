# F4 first batch — 2026-10-15 Taipei

Status: deployed; candidate24 and production32 views have separate scoped independent actual-image PASS. Separate babysit browser acceptance has not yet been received. Full F4 and all-route/state acceptance remain pending.

- APP: `fe7987945611328aabaa8bb8f4495ecd75168792`; native recipe OPS: `868b396636adf7dba14e640eee55d0e6c06c4ad0`.
- Image: `sha256:5816d4eec144c5c162ad3954aef4298fa36a5ecfc9476315e1ad9d0a59ecfb91`; BUILD_ID: `vet9FIruVMu5cIc9qIVeo`.
- Both TS services healthy/converged at `2026-10-14T21:09:39.288349193Z`. Single owner `d7967e77`; Dokploy compose synced; same built artifact, no rebuild or migration.
- Reference: tag T-ref `ff511870`, SHA256 `3d8e72036aab6cc73b3061f1b1d94afb1292d39b4bf86f1a65fc83945632eb91`; git blob/working-file binding `/tmp/babysit/mint-queue/youtube-t-ref-binding-ff511870.json`.

## Behavior

`/live/current` uses full-title mobile cards preserving channel, observed counts, missing/sampling state, timestamp, categories and source links. Desktop retains shared sticky table with visible overflow guidance; actual right-edge captures prove complete update/source columns.

`/groups` distinguishes two-category vs broader seven-category scope, uses 項目數 with vocabulary/subcategory definitions, removes schema terminology from public copy and clarifies that source current-office names do not verify current appointments. Source data date remains2023; data freshness was not fixed.

Authorized YouTube red branding and YT-specific metrics remain deliberate differences from tag. APP `docs/cross-site-consistency.md` lists remaining method-footer,44px-control, reference visual and unavailable/loading/empty/auth/interaction work.

## Checks and evidence

Frontend319tests, APIgroups7pass/1DBintegration skip, web/API typecheck pass. Native arm64 Node24.21.0/ABI137/glibc2.36/sharp0.35.5 produces44byteWebP; source/traced BUILD_ID and Next/React dependency versions agree. Six formal route HTTP200 checks contain exact new BUILD_ID. Twelve anonymous/cookie/RSC privacy checks pass; fresh three-site medians pass.

Candidate24 views: source and nonauthor actual-image review separately recorded. Reviewer hashed158PNG, opened78; hash-only images are not counted as visually reviewed. Accepted retake network has DNT1/GPCtrue/Google0; initial homepage RSC503 capture remains rejected, root cause unconfirmed.

Production32 views captured: home8,keywords8,keywordprofile+mayor8,groups+live8;1280/390,light/dark, both keyword windows. All32 accepted raw/network receipts have Google0. First production feature capture stopped at memory gate; excluded and preserved. Retake ran only after memory recovered, without lowering thresholds. Candidate PASS is not production PASS.

Deployment: `/tmp/babysit/mint-queue/youtube-f4-fe79879-production-deployment.json`.
Candidate manifest/review index: `/tmp/babysit/mint-queue/youtube-f4-fe79879-candidate-acceptance.json`.
Production manifest index: `/tmp/babysit/mint-queue/youtube-f4-fe79879-production-capture-index.json`.
Production final acceptance: `/tmp/babysit/mint-queue/youtube-f4-fe79879-production-acceptance.json`. Independent production reviewer hashed246PNG and personally opened130 (116 hash-only). Four keyword-detail image404s/placeholders, ERR_ABORTED/null statuses, sparse keyword coverage and differing mayor coverage snapshots remain recorded. Data freshness and uncaptured interactions are unverified.

Exact receipt paths/hashes are in `docs/ui-review-ledger.json` → `f4FirstBatch20261015`.

## Immediate rollback

```bash
python3 /tmp/babysit/mint-queue/youtube-f4-fe79879-deploy.py --execute --rollback
```

Restores `sha256:cabe15587df1d7dd80c561abe0629ba71a80a0188f402202858b7b60722b69f6` (APP335c8db) and Dokploy compose. Read-only rollback dry-run passed. Emergency fallback on skyhong-blog: `docker service rollback youtube-board-ts-6oukfq_web` and `docker service rollback youtube-board-ts-6oukfq_account-maintenance`. Database, writers, backups, Cloudflare/WAF and tag-backup untouched. Own candidate/tunnel removed and18168closed.
