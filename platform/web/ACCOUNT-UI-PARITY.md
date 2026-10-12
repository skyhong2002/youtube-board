# Account UI source and verification

Ported interaction/layout reference: tag.analysis.tw commit `afe0a653` (MIT),
read using git show only; the mother checkout was never changed. Sources:
`web/src/lib/session.ts`, `components/AccountMenu.tsx`, `components/Avatar.tsx`,
`components/reader/{FollowButton,SaveButton}.tsx`, `(site)/login/LoginPanel.tsx`,
`(site)/my/{ReaderGate,MyTabs,MyFeed}.tsx`, and following/saved/settings pages.
The same neutral cards, compact pills, mobile tabs, account dropdown and Google
button are used with the existing YouTube-red theme. Google SVG and avatar
structure are copied from the fixed source; avatar HTTPS is limited to Google
profile image hosts and sends no referrer.

## Contract adaptations

- Wire types import `shared/account-contracts.ts`; added only AccountUserInfo
  and AccountUsers after coordination with the auth owner.
- Client-only session and per-account follows/saves state; public SSR receives
  no cookies, account records or CSRF tokens. No personal browser storage.
- Disabled login, unauthenticated reader, unavailable service and admin-required
  states remain distinct. Login/my/manage pages are noindex.
- Same-origin private requests use no-store and x-csrf-token for writes.
  Unknown errors map to fixed human-readable text; no provider/SQL strings.
- Follow channel u_id, maintained vocabulary string, editorial event UUID;
  save YouTube video ID or editorial event UUID. AI numeric event IDs are not
  used as persistent personal targets. Missing targets remain removable.
- Saved notes are capped at500 characters. Feed shows seven-day/150-item
  bounds and missing/changed vocabulary coverage without fabricated counts.
- Private RSS GET reads only active/createdAt; a newly created URL is held only
  in component memory and shown once, with explicit copy/hide/rotate/revoke.
  It disappears on leaving the page, including subsequent GET status reads.
- Editorial defaults to Google admin; explicit service-token alternative shows
  service identity and sends Bearer only. Session writes send CSRF only.
  Mode/account changes unmount the console and invalidate cached preview.
  Existing preview/execute semantics and server write gates are preserved.
- On local HTTP, UUID4 command IDs use crypto.getRandomValues when randomUUID
  is unavailable. Math.random is never used.
- Role administration uses /auth/users; self/config-admin/disabled rows cannot
  be changed in UI, with explicit confirmation for other role changes.

## Validation

Web typecheck and59 web tests passed at this checkpoint (shared tree includes
proxy tests owned by root). Account-client tests cover CSRF/credential headers,
fixed destinations, missing session fail-closed, sanitized failures, malformed
session responses, local login return paths, SSR privacy and crypto UUID4.

Native Chromium at390px verified real auth-disabled/noindex; synthetic in-memory
private responses exercised reader feed coverage, missing follow/save removal,
CSRF writes, one-time RSS display and no URL after route return, session signout
removing private content, Google-admin default, service-mode preview reset,
session preview CSRF versus service Bearer, and no horizontal overflow.
All browser fetch overrides were restored; no real DB or production writes.
Actual Google login is not claimed. Callback/provider/cookie integration remains
owned by the parent/auth agent and requires configured credentials/real account
acceptance separately.

Mobile settings status (fixture, with one-time URL already cleared):
`/home/deck/.t3/userdata/browser-artifacts/browser-screenshot-100-85-214-25-mv4bbbpo-86f6120d.png`

Codex cross-review follows the user's reduced-Opus review policy; no additional
Opus call was made for this UI phase.

Root Codex cross-review confirmed per-account remount/generation isolation,
one-time RSS display and service-mode preview reset, without high-risk findings.
Its small follow-up is addressed: actual backend editorial error codes now map
to fixed recovery guidance (PREVIEW_CHANGED, EXECUTION_GATED, REQUEST_ID_CONFLICT,
EVENT_MERGED and source/candidate workflow errors); legacy aliases remain.
Unknown errors still never echo arbitrary server detail. Web tests:61 passed
at the follow-up checkpoint. No additional Opus or database lane was used.
