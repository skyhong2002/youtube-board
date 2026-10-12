# Frontend runtime hardening — 2026-10-12

Applied through the existing Dokploy TS compose service at approximately
09:55 UTC. Application code, runtime environment, database privileges, networks,
Traefik routes and Laravel scheduler ownership were unchanged.

- Persisted compose uses schema 3.9 and immutable image
  `sha256:2bc1039b1dd4038b1a557b608c1593857d56bb215c97a3d908ed066528f622b0`,
  constrained to `skyhong-blog` with `--resolve-image never`.
- Web keeps read-only root/media, a 64 MiB `/tmp`, and adds a **128 MiB tmpfs** at
  `/app/web/.next/standalone/web/.next/cache`.
- Both services drop all capabilities and limit PIDs to 256. CPU/memory limits
  remain unchanged. Entrypoint and healthcheck use the image's existing
  `/usr/bin/setpriv --no-new-privs`.
- **Engine `Privileges.NoNewPrivileges` remains false**: Docker stack ignores
  Compose `security_opt`, and this Dokploy raw-stack service has no persistent
  ServiceSpec override. The persistent entrypoint instead establishes kernel
  `NoNewPrivs: 1` for the actual application and descendants; healthcheck is
  wrapped separately. An arbitrary future `docker exec` is not covered by that
  entrypoint, so do not describe this as the Engine setting being enabled.

Actual running task `fdc33c856074` was healthy, uid 1000, read-only root,
`NoNewPrivs: 1`, effective/bounding capabilities both zero and PIDs limit 256.
Service inspection showed both tmpfs mounts with exact sizes; an in-task write
and delete proved the image cache writable.

Two public requests for the same allowed `mqdefault.jpg`, width 640/quality 75,
returned **200 MISS → 200 HIT**, both 17,818 bytes. Cloudflare remained DYNAMIC;
no Cloudflare image or HTML cache rule was added. An initial probe using
`hqdefault.jpg` correctly returned 400 because it is outside the image allowlist;
only the supported image URL is used for the cache proof.

Homepage, `/healthz`, `/auth/me`, tag.observe.tw and blog.observe.tw returned 200.
The retained scheduler stayed in original container `ac70c735fd6c` (28 hours up).
No schema operation or workflow handoff accompanied this change.

## Verification and rollback

Four offline tests exercised Docker stack's actual create/update conversion
against a fake Engine, plus a bounded local image smoke. Production inspection
and public image-cache probes above supplement, rather than replace, those tests.
The independent Opus recovery/hardening review required long-form tmpfs syntax,
actual runtime proof and pinned-node image placement; all were adopted.

The exact prior compose/command were preserved privately as
`.local/dokploy/frontend-hardening-before-<timestamp>.json`. Restore those fields
through `compose.update` and request `compose.deploy` for a runtime rollback;
it changes no data. Public routing rollback remains separately documented in
`frontend-cutover-execution-2026-10-12.md`.

## Retained Laravel deployment freeze

At **09:48:19 UTC**, Dokploy Auto Deploy for `youtube-board-web-mwafzd` and only
GitHub deployment-relay push hook `630735480` were disabled and read back false.
The unrelated Telegram integration hook was unchanged. Later pushes to main
therefore did not trigger the retained Laravel image's startup migration path.
Reviewed manual Laravel deployment remains available; scheduler image refresh
requires its own deliberate handoff step. This freeze is distinct from the new
default-off application migration/relay gates, whose production code deployment
is still pending.
