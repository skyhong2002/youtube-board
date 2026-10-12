# MIT publication audit — 2026-10-12

Before changing GitHub visibility, all remote branches and tags were fetched and
the non-shallow repository was inspected across all 205 reachable refs and
462 commits, including local/checkpoint refs. Gitleaks 8.30.1 scanned full history,
all 4,589 unique text blobs, and commit metadata with zero credential findings.
All 4,709 unique blobs were inventoried; 120 binary objects were brand assets
or the existing public product tour. No size exclusion was used.

Manual checks covered environment templates, deployment documentation, agent
notes, fixtures, redaction examples, licenses, binary assets, exports, and
credential URL/email candidates. Remaining literal values are disposable local
or test examples. No confirmed production secret, private meeting transcript,
account export, database dump, review packet, or private third-party personal
data was found. The author identity is the owner’s existing public Git identity.
This is a scoped audit, not a guarantee against every possible undiscovered leak.

Private reports remain ignored under `platform/.local/security-audit/`.
Production env files and review packets remain ignored. No history rewrite or
credential rotation was required by the audited findings.

The root MIT license uses Copyright (c) 2026 Sky Hong. Original MIT notices for
新文易數 at source commit `afe0a653` remain intact in the web upstream and brand
license directories; the font retains its separate OFL notice.

Laravel autodeploy remains intentionally disabled during the TS handoff.
Publishing the repository must preserve its read-only Dokploy deploy key, the
disabled deployment relay webhook, and the unrelated existing notification
webhook. Publication does not authorize or activate a Laravel deployment.
