# Preserve serving quality policy during source refresh

This source-only fix belongs to OPS preparation, not the pinned APP70529cff.
TAG still owns the global slot. No DB/API, sync, scheduling, build, capture or
production changes were executed. It does not complete F2-04's continuous
quality-generation workflow.

`MysqlVocabularyStore.publish` previously compared only coverage and window end.
A later observed-article snapshot with default `exact-text-v1` could therefore
replace a serving `youtube-quality-v2` observed window. `importSnapshot` compared
coverage/upstream generation time only and could perform the same downgrade with
a complete export. This is a reproduced source-path risk, not evidence that such
a downgrade has occurred in production.

Both publication paths now inspect the current immutable snapshot under their
existing publication transaction/`FOR UPDATE` lock and use
`matchingRuleForSnapshot`. Automatic promotion is permitted only when the current
policy is absent (legacy `exact-text-v1`) or explicitly `exact-text-v1`. A current
`youtube-quality-v2` pointer stays unchanged. Unknown rules and nonobject/null/array
metadata reject publication rather than guessing a compatible policy. JSON parse
failure also retains the existing rollback path.

The newly fetched raw source pool is still retained and published with
`becameCurrent: false` when v2 is serving. Full-pool pages/checksums/active membership
and article-window terms retain their current contracts. No raw terms are deleted,
no quality evidence is fabricated, and the source snapshot is not relabelled v2.
Retrying an already-published import does not activate it. Existing legacy
newer-window/export promotion and full-export protection against window fallback
remain in place. Explicit quality activation/rollback CAS is unchanged.

Validation uses only mocked mysql connections: a newer observed window and newer
complete exports cannot downgrade v2, including both observed-window and full-pool
v2 metadata; imports retain terms and active keys without pointer writes; published
retry leaves v2 current; legacy rule absence/explicit v1 continue promotion; invalid
and future-rule metadata cause rollback without publication/pointer writes. Existing
publication checksum, ownership-loss and commit-failure regressions also pass.

Commands:

```sh
node platform/node_modules/vitest/vitest.mjs run --root platform/jobs \
  test/vocabulary-quality.test.ts test/snapshot-import-bounded.test.ts --maxWorkers 1
node platform/node_modules/typescript/bin/tsc -p platform/jobs/tsconfig.json --noEmit
```

This fix intentionally prevents silent downgrade. It does **not** refresh the
serving v2 pool: a controlled successor still needs retained source lineage,
matching/template profiles, recent-video backmatch, coverage proof and activation
CAS. Without that workflow the current quality pool remains older while backup
source refreshes continue. Enabling production refresh/matching or changing writer
ownership remains outside this source batch and requires reviewed runtime evidence.
