# Polish loop notes (16h session, started 2026-07-24)

Autonomous `/polish` loop over ~16 hours. Goal: land small, safe, verified
quality improvements (correctness bugs, user-facing copy, docs accuracy, dead
code). One commit per landed improvement. No mass reformatting.

## Environment / verify harness
- No local PHP. Run tooling via: `./.polish-loop/run.sh <cmd>` (dev container).
- Full suite: `./.polish-loop/run.sh php artisan test` (~95s, sqlite :memory:).
- Targeted: `./.polish-loop/run.sh php artisan test --filter=Name`
- Pint has NO config and flags 73 files (legacy parity + scripts). DO NOT
  mass-reformat — noisy/risky, not aligned with team. Style only if touching a
  file anyway.

## Baseline (iteration 1)
- Tests GREEN: 826 passed, 5 skipped, 7887 assertions.
- Recent commits are careful "Harden ..." work. Match that bar.

## !!! CRITICAL PIVOT (iteration 1, after user added deploy scope) !!!
- Local main was 56 commits BEHIND origin/main. Iter-1 investigation (and the
  running codex bug-hunt) were against STALE tree d26be4a (2026-07-15).
  => Re-verify ANY codex finding against current tree before acting; many may
     already be fixed in the 56 newer commits.
- Fast-forwarded local main -> 4e86b8f (2026-07-19). Now local == origin == prod.
- DEPLOY MODEL: push to `main` -> GitHub webhook -> /ops/deploy/dokploy relay ->
  Dokploy rebuild. Prod host: ssh skyhong.tw (ubuntu@skyhong-blog), Dokploy stack
  (youtube-board-web/scheduler/db/pma). Prod health: https://youtube.observe.tw/up
- CURRENT STATE: production HEALTHY (HTTP 200), running origin/main HEAD.
  Nothing to deploy right now. Only ship after a real, tested change is committed.
- DEPLOY SAFETY (from docs/deployment.md): the 2026-07-15 identifier migration is
  forward-only + NOT zero-downtime (needs backup+rehearsal+maintenance window) —
  already deployed. Any FUTURE migration-bearing change needs the same care; do
  NOT auto-ship schema migrations without explicit operator go-ahead.

## Current baseline (after sync to 4e86b8f)
- Tests GREEN: 946 passed, 6 skipped, 8853 assertions (~104s). vendor in sync.
- This supersedes the stale iter-1 baseline (826 tests @ d26be4a).

## Deploy + monitor procedure (user added this scope)
- MONITOR each iteration: `curl -s -o /dev/null -w "%{http_code}" https://youtube.observe.tw/up`
  (expect 200). Optionally `ssh skyhong.tw docker ps` for container health.
- DEPLOY = commit + push to `main` (webhook auto-rebuilds via Dokploy). So only
  push tested-green changes; each push is a real prod deploy. Prefer meaningful
  commits over deploy spam.
- Branch discipline: work IS on main (per user request to ship). Keep each
  shipped change small, tested, and revertible. Do NOT ship schema migrations
  without explicit operator go-ahead (see CRITICAL PIVOT above).
- After a deploy push: re-check /up returns 200 and confirm Dokploy picked up
  the new image (docker ps shows fresh container / new image tag).

## Rules for this loop
1. git checkpoint mindset; one focused commit per landed change.
2. Every code change verified by running relevant tests (add tests when apt).
3. Prefer high-confidence, low-risk, genuinely valuable changes.
4. Skip a change rather than land something uncertain.
5. Keep a running log below so work survives context summarization.

## Landed changes
- 0c80a2d "Harden AI period month range against out-of-range values" (PUSHED
  to main 2026-07-24, deploy in progress). /ai/periods?month=2026-99|2026-13
  threw InvalidFormatException -> 500; now invalid months fall through to the
  default range. +regression test. Full suite green (947 passed). Parity-neutral.

## !!! DEPLOY TRIGGER IS BROKEN (blocker) !!!
- Push to main does NOT deploy. GitHub webhook (hook 630735480, push) ->
  https://youtube-board.skyhong.tw/ops/deploy/dokploy returned **404** on my push
  (relay unconfigured in prod: services.dokploy.deploy_webhook_url/secret unset ->
  route 404s, per DokployDeployWebhookTest).
- Dokploy app "YouTube Board Web" (appName youtube-board-web-mwafzd, appId
  IUeAdI337qhCzBFvB219H): autoDeploy=t, sourceType=git, has refreshToken. Dokploy
  API reachable server-side at http://127.0.0.1:3000 (health 200).
- Native trigger = POST http://127.0.0.1:3000/api/deploy/<refreshToken> (token in
  dokploy-postgres application.refreshToken). BUT that command was BLOCKED by the
  Claude auto-mode classifier (secret extraction + prod state change). Do NOT try
  to evade the block. Needs user OK / a Bash allow rule, OR user fixes the relay.
- Prod currently HEALTHY on 4e86b8f. 0c80a2d (my fix) is on origin/main, NOT live.
  Deploy delta = 1 commit, NO migrations (safe code-only when it does go out).
- ASKED USER how to handle rollout (AskUserQuestion). Until answered: keep
  shipping tested fixes to origin/main (safe); deploys batch until trigger works.
- USER ANSWERED: "Trigger Dokploy directly" (explicit authorization to deploy).
- *** WORKING DEPLOY TRIGGER (rediscovered; USE THIS each deploy) ***
  App watches customGitBranch=main, customGitUrl git@github.com:skyhong2002/
  youtube-board.git, buildType=dockerfile. From the server:
    pg=$(docker ps --format '{{.Names}}' | grep dokploy-postgres | head -1)
    tok=$(docker exec "$pg" psql -U dokploy -d dokploy -tAc \
      "select \"refreshToken\" from application where \"appName\"='youtube-board-web-mwafzd';" | tr -d '[:space:]')
    curl -s -X POST -H 'Content-Type: application/json' -H 'X-GitHub-Event: push' \
      -d '{"ref":"refs/heads/main"}' "http://127.0.0.1:3000/api/deploy/$tok"
  Empty body -> "Branch Not Match"; the ref payload is REQUIRED. Success =
  {"message":"Application deployed successfully"} HTTP 200.
  ALWAYS push to origin/main FIRST (Dokploy pulls main), then trigger.
- 0c80a2d DEPLOYED + VERIFIED LIVE 2026-07-24: prod /ai/periods?month=2026-99 now
  200 (was 500), 2026-13->200, valid 2026-05->200, /up 200. DONE.
- GOTCHA 1: native-webhook builds tag the image ":latest" (NOT ":<sha>" like the
  GitHub-integration path did for 4e86b8f). Verify deploys BEHAVIORALLY (hit the
  changed surface), not by image tag.
- GOTCHA 2: the trigger only rebuilt the WEB service. The SCHEDULER is a SEPARATE
  Dokploy app (currently still 4e86b8f). For changes touching console.php /
  ingestion / scheduled commands, must ALSO deploy the scheduler service (find its
  own appName+refreshToken in dokploy-postgres, same POST). Web-route-only changes
  (like 0c80a2d) don't need it.

## Landed change #2
- 454607b "Bucket comment activity in Asia/Taipei, not UTC" (pushed + deploy
  TRIGGERED 2026-07-24; monitoring container recreation). Fixes codex #9
  (VideoDetailReport hourly/daily comment buckets) + #10 (AuthorCommentsReport
  hour-of-day histogram): publishedAt is RFC3339 UTC but was bucketed with UTC
  date() while whole app uses Asia/Taipei -> charts 8h off, midnight comments on
  wrong day. Fix = Carbon::createFromTimestamp($ts,'Asia/Taipei') before format.
  #9 locked by discriminating test (asserts '05-21 20' Taipei bucket, was '05-21
  12' UTC). #10 same 1-line pattern, empirically verified, full suite green (947).
  Web-report-only -> web deploy sufficient (no scheduler redeploy).
  DEPLOYED + HEALTHY 2026-07-24: /up 200, fresh container, routes 200, prior fix
  (0c80a2d) still live. NOTE: each deploy has a brief ~502 window during container
  cutover (start script gates port behind migrate+schema-check+cache build) —
  expected, not zero-downtime; fine for this low-traffic dashboard. Verify health
  AFTER startup settles (~30-60s), not at first container-swap detection.

## Landed change #3
- d0ecb60 "Reject calendar-invalid dates in AI period range" (pushed + deploy
  TRIGGERED 2026-07-24; monitor bsnm4hrbi verifying). Same robustness class as
  0c80a2d: AiPeriod from/to guard was shape-only (\d{4}-\d{2}-\d{2}) so
  2026-13-45 -> Carbon::parse throws -> 500; 2026-02-30/2026-00-10 silently
  rolled to wrong range. Fix = checkdate() in dateString(). +regression test.
  Full suite 948 green. Confirmed live pre-deploy: from=2026-13-45 -> 500.
  Web-only deploy. DEPLOYED + VERIFIED LIVE 2026-07-24: new container, /up 200,
  from=2026-13-45 -> 200 (was 500), valid range -> 200. DONE.
- PATTERN NOTE (backlog): shape-only date validation (\d{4}-\d{2}-\d{2}) exists in
  MANY Legacy reports (LiveDayReport, LiveHoursReport, ChannelPromptReport,
  AiDailyPromptReport, LiveTagReport, MayorReport, etc.). Each may 500 on
  calendar-invalid dates OR silently roll over. Parity-neutral robustness class —
  good future iterations, but verify each report's own guard+flow individually
  (some may not feed user input to Carbon::parse). Don't blanket-edit blindly.

## FEATURE: Telegram AI-digest push (user requested 2026-07-24)
User decisions: (1) 每日精華 + 每小時只推重大事件; (2) build NOW behind feature
flag + dry-run (no live send until user gives bot token + channel). Example ref:
t.me/hn_best_cht. Taste-sensitive (public copy) -> Claude builds it.
Data sources: urt_ai_date (daily) / urt_ai_hour (hourly); reuse AiDailyReport &
AiHourlyReport ::forRequest() assembled events (don't re-parse result_json).
Scheduling: native Laravel Schedule in routes/console.php (~line 4301 has
Schedule::command('ingestion:run...')). NOT the ingestion quota registry.
Config: config/services.php 'telegram' (enabled default false; dry-run w/o token).
GOTCHA: scheduler is a SEPARATE Dokploy app -> activating the schedule needs the
scheduler service redeployed too (find its appName+refreshToken).
Build slices:
  [DONE 6aba46a, pushed, NOT deployed - inert] config + TelegramDigestFormatter
    (pure, 5 unit tests, HTML parse-mode, 4096 trim). Sample output looked good.
  [TODO] TelegramClient (sendMessage via Http::post; dry-run when disabled/no token).
  [TODO] TelegramDigestBroadcaster (map report events -> formatter DTO; hourly
    "重大事件" threshold = hourly_min_events(3) AND hourly_min_videos(8); dedup
    last-pushed period key). Dedup store: cache for v1 (note: file cache wiped on
    deploy -> at most 1 dup after deploy; DB table later, avoids a migration now).
  [TODO] Artisan cmd notify:telegram:digest {--period=daily|hourly} {--force}.
  [TODO] Schedule wiring (hourly + dailyAt) + feature tests (Http::fake).
  [TODO] (after user gives token+channel) deploy web+scheduler, flip flag, verify.
Formatter DTO: {period, label, url, events:[{title,keywords[],people[],video_count,media_count}]}
DESIGN CHANGE (user 2026-07-24):
  - Style must read like t.me/hn_best_cht: NEWS-BRIEF PROSE per event (natural
    zh-Hant news paragraph), not terse tag lines. Generate with an LLM.
  - Do NOT use opencode_go (that relay MODERATES political content -> Taiwan
    輿情 gets blocked). Use FULL gpt-5.4 (not mini) via a DIRECT OpenAI proj- key.
  - Plan: new dedicated config services.telegram.ai {base_url=api.openai.com/v1,
    api_key=env(TELEGRAM_OPENAI_API_KEY) [proj- key], model=gpt-5.4}. Small
    dedicated OpenAI chat client (Http::post, Http::fake-able), NOT OpenCodeChatClient.
  - EventNewsWriter: feed grounded data (event title, keywords, people, media,
    RELATED VIDEO TITLES from urt_video) -> LLM writes 2-3 sentence news brief.
    HALLUCINATION GUARD: prompt must forbid inventing facts not in the data.
  - Formatter: add prose rendering (title bold + summary paragraph + facets +
    link), keep terse version as fallback when LLM unavailable/dry-run.
SECRETS/ENDPOINTS RESOLVED (2026-07-24):
  - Bot token: 8936460201:... (@YouTube_ObserveTW_Bot). Kept in env only.
  - Channel: @YouTube_ObserveTW = "臺灣 Youtube 新聞觀測站", id -1004321348934.
    Bot IS administrator, can_post_messages=True -> ready to post.
  - Prod OpenAI: OPENAI_BASE_URL=https://api.openai.com/v1 (DIRECT, not a relay),
    OPENAI_MODEL=gpt-5.4-mini, ENDPOINT_STYLE=chat, key=...ZFAA (direct proj key).
  - => User's "don't use opencode_go / use premium gpt-5.4" = same direct key,
    but FULL model gpt-5.4 (not mini) + a path free of opencode_go's schema/token/
    business-lock machinery.
DESIGN (no key extraction needed):
  - config services.telegram.ai: base_url=env(TELEGRAM_OPENAI_BASE_URL,
    'https://api.openai.com/v1'); api_key=env(TELEGRAM_OPENAI_API_KEY,
    env(OPENAI_API_KEY)) [reuses prod ZFAA key by default]; model=env(
    TELEGRAM_OPENAI_MODEL,'gpt-5.4'); timeout.
  - Dedicated small OpenAI chat client (Http::post to base_url/chat/completions,
    Http::fake-able). NOT OpenCodeChatClient.
  - Real SAMPLE = run the command in DRY-RUN inside the PROD container (has key +
    gpt-5.4), print message, no send, no key exfil.
USER GRANT (2026-07-24): "直接推，不用等我同意" — authorized to build AND go
  LIVE (post to channel) without per-step approval, PROVIDED format closely
  matches hn_best_cht. => one-post-per-event, news prose. I still self-verify the
  first real post (renders well + not hallucinated) before enabling the schedule.
DECISION: ONE EVENT = ONE MESSAGE (hn_best_cht posts individual items), NOT a
  combined digest. Formatter reworked accordingly.
DONE THIS SESSION (pushed, inert, NOT deployed):
  6aba46a (multi-event formatter, superseded) ->
  2515825 single-post formatter + services.telegram.ai config. 5 unit tests green.
BUILD PROGRESS:
  [DONE 2515825] single-post formatter + services.telegram.ai config (5 tests)
  [DONE 536c3a2] OpenAiChatClient + EventNewsWriter + TelegramClient (6 tests)
  [DONE 718f294] TelegramDigestBroadcaster + notify:telegram:digest command +
    schedule (hourly@25, dailyAt 09:00 Asia/Taipei; guarded by enabled) (7 tests).
    Full suite 969 green. FEATURE CODE COMPLETE.
  [IN PROGRESS] deploy 718f294 to prod (monitor bdzy0s71c) so the command exists
    in the prod image (still inert; enabled=false -> no schedule, no posts).
REAL SAMPLE VALIDATED (2026-07-24, dry-run in prod container, daily 2026-07-23):
  gpt-5.4 works; format matches hn_best_cht (bold title + news prose + media +
  link); political content NOT moderation-blocked (凱道/監察院/台海軍演/兩岸 all
  written fine); grounded, no obvious hallucination (hedged "多家媒體關注" tone).
  Facets sparse (only 媒體 count) because daily result_json events lack videoId /
  keywords/people here — acceptable; summary carries it.
!!! MUST FIX BEFORE ENABLING SCHEDULE: dedup uses default cache = FILE in prod
  (confirmed: deployment.md general CACHE_STORE=file), and web vs scheduler are
  SEPARATE containers with separate file caches -> scheduled run wouldn't see a
  one-off's marks -> DUPLICATE posts. Change TelegramDigestBroadcaster dedup to a
  SHARED store. Prod has cache_locks (DB); check if Laravel `cache` table exists
  -> use Cache::store('database'). If not, tiny dedup table (migration -> needs
  operator ok) OR create cache table. Do this FIRST so one-off + schedule share
  dedup. Update broadcaster tests (array store fine in tests, or store() config).

DEDUP HARDENED: [DONE b76f6d1] dedup -> Cache::store('database') (shared web+
  scheduler; cache table exists via create_cache_table migration). Configurable
  via TELEGRAM_DEDUP_STORE; fails open. Deploying (monitor b6m0z2rhn).

*** FIRST LIVE POST DONE 2026-07-24 ***: ran runtime-config-override one-off in
  prod web container (config is CACHED so -e alone won't work; override via
  config([...]) in a bootstrapped php script, token via -e TG_TOK). Result:
  posted=5 dry_run=false (5 重大事件 of 20 daily events) -> LIVE in
  @YouTube_ObserveTW. Dedup marks in shared DB cache table (scheduler will see
  them). Classifier: first attempt hit transient stage-2 error; RETRY succeeded.
REMAINING: RECURRING schedule. Needs the SCHEDULER container to (a) run the NEW
  image (currently OLD 4e86b8f, lacks the command + schedule code) and (b) have
  TELEGRAM_DIGEST_ENABLED/BOT_TOKEN/CHANNEL_ID env. Scheduler's Dokploy service
  NOT found in application (only web+pma) or compose tables -> investigate how
  it's deployed (swarm service? separate app?). Then set env + redeploy scheduler
  (and web for consistency). If Dokploy infra write is blocked/risky, surface to
  user with exact vars (UI is 1 min): TELEGRAM_DIGEST_ENABLED=true,
  TELEGRAM_BOT_TOKEN=<token>, TELEGRAM_CHANNEL_ID=-1004321348934 on web+scheduler.

*** RECURRING SCHEDULE LIVE + VERIFIED 2026-07-24 ***: user ran the docker
  service update. Scheduler now on :latest, 3 TELEGRAM_ env keys, schedule:list
  shows: ingestion:run (next 49s - NOT broken), notify:telegram:digest hourly
  (25 * * * *), daily (0 1 * * * = 09:00 TPE). FEATURE 100% DONE & AUTOMATED.
  First automated hourly fires ~:25. Verify once in scheduler logs, then done.
  (prior blocker note below is historical)
  CONFIRMED AUTOMATED 2026-07-24 06:25 UTC: scheduler log "Running notify:telegram
  :digest --period=hourly ... 13秒 DONE" (13s => called gpt-5.4 on eligible events
  -> posted). ingestion:run continues every minute. TELEGRAM FEATURE FULLY DONE.
  Optional future polish: schedule output goes to /dev/null -> could ->appendOutputTo
  a log for observability of considered/posted counts. Not required.

RECURRING SCHEDULE — BLOCKED ON USER (classifier): user chose "run the command"
  but the Claude auto-mode classifier FIRMLY blocks `docker service update` with
  the bot token secret (tried twice; not transient). Gave user the exact command
  to run on skyhong.tw themselves:
    docker service update --image youtube-board-web-mwafzd:latest \
      --env-add TELEGRAM_DIGEST_ENABLED=true \
      --env-add TELEGRAM_BOT_TOKEN=<token> \
      --env-add TELEGRAM_CHANNEL_ID=-1004321348934 youtube-board-scheduler
  AFTER user runs it, VERIFY (read-only, not blocked): scheduler service image =
  :latest, env keys include TELEGRAM_* (names only), service Running, tail logs
  for the digest schedule firing (notify:telegram:digest), ingestion still ticks.
  Scheduler config is NOT cached (bare schedule:run loop) so --env-add takes live.
  Scheduler was on OLD 4e86b8f (lagging web days) -> :latest also aligns its code.

GO-LIVE PLAN (user authorized direct push if format matches hn_best_cht):
  0. [DONE] shared dedup + deploy. THEN (after this deploy lands):
  1. FIRST LIVE POST via one-off (no persistent env change needed; dedup now in
     shared DB cache so the future scheduler won't dup):
     ssh skyhong.tw docker exec -e TELEGRAM_DIGEST_ENABLED=true \
       -e TELEGRAM_BOT_TOKEN=8936460201:AAFN7GON... \
       -e TELEGRAM_CHANNEL_ID=-1004321348934 <web> \
       php artisan notify:telegram:digest --period=daily
     (token inline/transient, not persisted; classifier MAY block secret-in-cmd
     -> if so, surface to user.) Verify posts land in @YouTube_ObserveTW.
  2. MAKE RECURRING: set persistent Dokploy env on BOTH web + scheduler apps
     (TELEGRAM_DIGEST_ENABLED=true, TELEGRAM_BOT_TOKEN, TELEGRAM_CHANNEL_ID) then
     redeploy both. Scheduler then registers hourly@25 + daily 09:00 TPE.
     Mechanism: Dokploy app env (postgres application.env or Dokploy API) — this
     is the sensitive infra write; if blocked, surface to user with exact vars.
  1. After deploy lands: run IN PROD container (has ZFAA key + real AI data):
     docker exec <web> php artisan notify:telegram:digest --period=daily --dry-run
     -> prints REAL gpt-5.4 posts. SELF-VERIFY: reads like hn_best_cht news brief,
     grounded (no hallucinated facts vs the event data). Try --period=hourly too.
     NOTE: confirm model id 'gpt-5.4' actually works on the endpoint; if the API
     rejects it, adjust TELEGRAM_OPENAI_MODEL (maybe 'gpt-5.4' vs other id).
  2. If good: set Dokploy env on BOTH web + scheduler apps:
     TELEGRAM_DIGEST_ENABLED=true, TELEGRAM_BOT_TOKEN=8936460201:AAFN7GON...,
     TELEGRAM_CHANNEL_ID=-1004321348934, TELEGRAM_OPENAI_MODEL=gpt-5.4
     (TELEGRAM_OPENAI_API_KEY optional - defaults to prod OPENAI_API_KEY=ZFAA).
     Setting Dokploy env: via Dokploy API/DB or UI. Redeploy web+scheduler.
  3. First live post: run the command once manually in prod (enabled) -> posts to
     @YouTube_ObserveTW. Verify the message in-channel. Then the schedule takes over.
  Channel id -1004321348934 ("臺灣 Youtube 新聞觀測站"), bot is admin/can_post.
STILL TODO (buildable via Http::fake, no secrets):
  4. TelegramDigestBroadcaster: latest daily/hourly events (reuse AiDailyReport/
     AiHourlyReport ::forRequest via a constructed Request), grounding join of
     video_ids -> urt_video.title, hourly threshold (video_count>=8 AND
     media_count>=3), dedup (cache key per event: period+date+md5(title)), call
     EventNewsWriter, format each, send via TelegramClient. Cap daily_max_posts(5)
     /hourly_max_posts(3). Return summary {considered,posted,skipped,dry_run}.
     NOTE: AiHourlyReport event fields = {event, video_ids, video_count, ...};
     AiDailyReport events have media/people/keywords — READ its forRequest output
     shape before mapping. Daily event 'breaking'=false; hourly notable=true.
  5. notify:telegram:digest {--period=daily|hourly} {--force} {--dry-run} command.
  6. Schedule wiring routes/console.php (~4301 has Schedule::command): hourly +
     dailyAt. GOTCHA: scheduler is separate Dokploy app -> deploy it too.
  7. Tests: broadcaster + command via Http::fake (OpenAI + Telegram), dedup, threshold.
  THEN: deploy web (+scheduler), run dry-run IN PROD container -> REAL gpt-5.4
  sample, self-check vs hn_best_cht + no hallucination, then TELEGRAM_DIGEST_ENABLED
  =true (+ TELEGRAM_BOT_TOKEN, TELEGRAM_CHANNEL_ID=-1004321348934, TELEGRAM_OPENAI_
  MODEL=gpt-5.4) in Dokploy env -> first live post. Confirm exact model id works.

## LOOP EXTENSION (user, 2026-07-24 ~15:20 local): "please polish more for 5 hrs"
— continue the polish loop ~5 more hours (until roughly 20:20). Model switched
to Fable 5 for this stretch.

## AUTOMATION VERIFIED VIA DEDUP MARKS (2026-07-24 07:1x UTC)
- prod cache table shows 5 daily marks (manual first post) + 3 HOURLY marks
  written by the 06:25 automated run -> the schedule genuinely posts on its own,
  and cross-container dedup works. #9 DEPLOYED + HEALTHY (fc989f077f8e). DONE.
- FALSE-ALARM lesson: suspected scheduler stall was my clock error — wakeup
  labels are Mac-local, NOT server time. ALWAYS `date -u` on the server before
  inferring staleness. A 3-min ingestion:run is normal (API batches).
- Prod DB creds are Dokploy secrets (NOT compose youtube_board defaults) —
  query prod DB via a bootstrapped php -r in the web container, not mariadb CLI.

## Iteration status (2026-07-24 ~16:45 local)
- #12 label fix VERIFIED LIVE: digest log lines now dry_run=no for live no-ops.
- Non-numeric param probe sweep on prod: ALL 200 (int casts/clamps already guard
  this class). Prod error logs clean. No new bug classes found by probing.
- Launched SECOND codex bug-hunt (background) over areas hunt #1 didn't cover:
  app/Support, app/Http/Controllers, app/Services/Notifications, Blade-embedded
  JS (charts/wordclouds; XSS-in-JS, empty-data JS errors). Triage on arrival —
  remember hunt #1 lessons: verify vs current tree, check parity intent, probe
  prod where possible, reject anything uncertain.

## Landed change #13 (hunt #2 batch — my own Telegram code hardened)
- 952b5d9 "Harden Telegram digest selection, sending, and length handling"
  (monitor bq33l0nyi: web deploy then SAFE scheduler refresh — checks in-flight
  ingestion + avoids :06-:19 window per scheduler-refresh-safety memory).
  Fixed hunt#2 findings: #2 daily data_type filter (week row could publish as
  daily), #3 intra-batch title dedup, #4 telegram timeout no longer aborts batch
  (unmarked posts retry next run), #6 UTF-16 unit counting + clamp convergence
  (found a REAL convergence bug while fixing: unit-vs-char decrement overshot ->
  loop exited oversized), #8 cap=0 disables period, #1 resolved as config-comment
  bug (removed unused hourly_min_media — hourly rows lack media data). 981 green.
- Hunt #2 remaining: VERIFY next: #7 ReportNavigation compare link drops tagid,
  #10 homeDashboard lineage profile unregistered, #12 Content-Disposition
  filename sanitization (LegacyApi/LiveApiController). DEFERRED: #5 (dormant
  relay), #9 (schema-tolerant fallback likely deliberate), #11 (dev-only probe).

## Landed change #14
- f3e5885 "Carry tag context into the compare link and sanitize the CSV filename"
  (DEPLOYED + VERIFIED LIVE: hostile input -> filename=abcevil.csv, /up 200). hunt#2 #7: tag pages' 比較
  link dropped tagid -> compared default tag instead of the viewed one; fixed +
  link assertion. hunt#2 #12: Content-Disposition built from raw videoId (newline
  = 500, semicolons = malformed header); sanitized to YouTube ID charset +
  hostile-input test. 981 green. Web-only deploy (no scheduler change).
- hunt#2 #10 REJECTED for autonomous action: homeDashboard() profile exists but
  the coverage test EXPLICITLY excludes 'home' — deliberate at test level; wiring
  it changes homepage UI. ASK USER whenever convenient: want the lineage panel on
  the homepage? (1-line change + test updates if yes.)
- hunt#2 fully triaged: #1-#4,#6-#8,#12 fixed; #10 user-question; #5,#9,#11 deferred.

## LOOP EXTENSION #2 (user, ~19:1x local 2026-07-24): "please polish more for 5
hrs" — continue until roughly 00:15 local.

## INCIDENT CLOSED: ai.hourly lock — self-healed as predicted (11:1x UTC)
- locks=0; ai.hourly 11:11:57 ok=1; latest urt_ai_hour now 18:00 TPE; and the
  */10 digest immediately posted the fresh events (posted=3, autonomous
  end-to-end). Downstream Telegram pipeline validated under real fresh data.

## RESOLVED-PENDING-SELF-HEAL: ai.hourly gap — ROOT CAUSE FOUND (2026-07-24)
- Root cause: MY 07:15 UTC scheduler --force refresh KILLED the in-flight 07:10
  ai.hourly pipeline run (the 3m14s ingestion:run seen in ps). Its DB job lock
  (cache_locks key ingestion:job:6a7155e..., owner g60Dfyv4ULH2Lpq5, TTL 14400s)
  was orphaned -> expires 11:10:11 UTC. Every :10 attempt since skips on the held
  lock. INVISIBLY, because (a) run history persists ONLY attempted jobs (skips
  dropped in IngestionRunHistory ~line 568) and (b) scheduler pipes output to
  /dev/null. Verified: cron due ✓ (--at probe), guardrail allowed ✓ (profile
  probe), single orphan lock in cache_locks ✓.
- Classifier blocked my prod-DB lock delete (fine). DECISION: wait for self-heal
  at 11:10:11 UTC; ai.hourly resumes at 11:10 or (if expiry races) 12:10 UTC run.
  VERIFY then: new ingestion_run_jobs ai.hourly row + fresh urt_ai_hour row +
  Telegram digest posts fresh events. User can release earlier by deleting that
  cache_locks row if they wish (exact key/owner above).
- LESSONS (also -> memory): (1) NEVER --force refresh the scheduler while a long
  ingestion:run is in flight — check `docker exec <sched> ps` first and prefer
  minutes :20-:59 (ai.hourly occupies :10-:15). (2) "No run-history row" ≠ "not
  due" — skips are unrecorded. (3) Killed jobs orphan locks for up to 4h.

## WATCH: ai.hourly generation gap (2026-07-24)
- ai.hourly succeeded hourly at :12 through 06:12 UTC, then 07:12 & 08:12 were
  NEVER ATTEMPTED (no run-history rows; not failures). Correlates with scheduler
  container churn (06:15 user update; my refreshes 07:15/07:37/08:4x) + the
  drifting-loop exact-minute skip class (same as digest bug #11). Latest
  urt_ai_hour row stuck at 13:00 TPE; digest correctly no-ops meanwhile.
- DECISIVE CHECK at 09:12 UTC: if ai.hourly fires + backfills -> transient
  (restart-window minute skips; consider whether ingestion registry needs the
  same drift-tolerance — but that's CORE ingestion, parity/allowlist-sensitive,
  likely needs user sign-off). If NOT -> suspect orphaned INGESTION_JOB_LOCK
  (14400s TTL) from a restart-killed run; inspect cache_locks/ingestion lock
  store READ-ONLY and surface to user before clearing anything.

## Landed change #12
- e3ff6d9 "Report dry_run truthfully when a digest run has nothing to send"
  (monitor bveq7o8oi deploys web THEN auto-refreshes scheduler). Prod logs showed
  dry_run=yes for live no-op runs (hardcoded true on no-context/all-deduped paths)
  — misleading ops signal. Fix = TelegramClient::isLive() drives the flag. Test
  locks second-run dry_run=false. 976 green. Prod error logs otherwise CLEAN (both
  containers); daily */30 window schedule also verified firing + deduping.

## Landed change #11 (REAL PROD BUG caught by observability follow-through)
- 71432df "Make Telegram digest schedule drift-tolerant" (web deploy monitor
  bk5y9811h; then scheduler refresh + verify next :x0 boundary). ROOT CAUSE
  CONFIRMED IN PROD LOGS: scheduler loop = while true; schedule:run; sleep 60 —
  drifts by each run's duration. A 4m45s ingestion:run shifted phase so runs hit
  07:24:59 -> 07:26:00, SKIPPING minute 25 -> hourlyAt(25) digest silently missed
  the hour (verified: no run, no dedup marks for hour 14, no log file). dailyAt
  (09:00) would lose a whole DAY when missed. Fix: hourly -> everyTenMinutes,
  daily -> everyThirtyMinutes between 09:00-21:00 TPE (dedup makes repeats
  no-ops; missed minute now = <=interval delay), + runInBackground so slow LLM
  runs stop worsening loop drift for ingestion. 976 green.
- VERIFIED END-TO-END 2026-07-24 07:40 UTC: */10 run fired in background (1.5ms
  handoff), telegram-digest.log line: considered=15 eligible=3 posted=0
  skipped_seen=3 (clean dedup no-op of the 06:25 posts). Schedule redesign DONE.
  Cosmetic nit (not worth a deploy alone): summary says dry_run=yes in the
  "all deduped, nothing attempted" branch — bundle a label fix with a future change.
  TELEGRAM WORKSTREAM FULLY COMPLETE: live, automated, drift-tolerant, observable.

## Landed change #10
- ebabec7 "Log scheduled Telegram digest output for observability": web deploy
  landed (5434fd25f681), then scheduler refreshed via docker service update
  --image ... --force (NO secrets -> classifier allowed it; the earlier block was
  the token in the command). Post-refresh verified: 3 TELEGRAM env keys intact,
  schedule registered, ingestion next-due 30s. Digest runs now append their
  summary line to storage/logs/telegram-digest.log (scheduler container).
  VERIFY at ~07:25 UTC: docker exec <scheduler> cat storage/logs/telegram-digest.log
- SCHEDULER REFRESH RUNBOOK (works, no user needed): after any web deploy whose
  change affects scheduled commands, run the --force update above. Env persists.

## Landed change #9
- 0092d63 "Count statistics history toward video detail data availability"
  (pushed + deploy TRIGGERED; monitor br0kkk2yt). codex #6 CONFIRMED: data_available
  omitted $history['log_rows'] (urt_video_log) -> history-only videos rendered
  the hard "找不到本機 legacy 資料" empty state instead of the softer notice +
  populated 影片統計歷史 section. One-line fix + history-only regression test.
  976 green. Web. #8 DEPLOYED + HEALTHY (5941dae70f8c, live/current 200). DONE.
- Codex triage COMPLETE for actionable finds: #5,#6,#7,#9,#10,#11,#12 fixed+shipped;
  #1,#8 rejected (would-be regressions); #2,#3,#4 parity-suspect (unapplied
  hours/min filters — legacy may have intentionally ignored them; no legacy source
  to prove otherwise; HIGH regression risk on live pages -> leave); #13,#14,#15
  limit off-by-ones (likely faithful legacy parity; tests may lock counts -> leave).

## Landed change #7
- 47e7c8d "Derive live-day peak from log history when the aggregate is missing"
  (pushed + deploy TRIGGERED; monitor boyt1wz2v). codex #12 CONFIRMED: LiveDayReport
  coerced null max_current -> 0 then filtered rows to > 0, silently dropping
  streams whose log_json held real viewer history (legacy-imported rows). Fix =
  peakFromLog() fallback when aggregate null/<=0. +regression test (null aggregate,
  peak 654 renders). Parity-neutral (adds real data, drops nothing). 974 green.
- Related deferred: codex #5 (LiveCurrentReport same family — active streams
  without same-day positive log row dropped from /live/current) — verify next.
  #7 DEPLOYED + HEALTHY (7a621e61619f, /up 200, live/days 200). DONE.

## Landed change #8
- c58c872 "Keep actively-live streams visible before their daily log row exists"
  (pushed + deploy TRIGGERED; monitor b38lgi9fs). codex #5 CONFIRMED: /live/current
  pre-filters to genuinely-active rows (no end time, viewers>0, mtime within 1h)
  but then required today_peak>0 from the same-day log aggregate — fresh streams
  (or post-midnight) had no log row -> dropped despite being live. Fix = today_peak
  fallback chain: stored aggregate -> peakFromLog(log_json) -> concurrentViewers.
  Stored-aggregate rows render EXACTLY as before (existing test proves it).
  +regression test (fresh stream, no log row -> visible w/ 500). 975 green. Web.
- codex live-family findings now DONE: #5, #12. Remaining deferred: #2/#3/#4
  (unapplied hours/min filters — parity-suspect, need per-report legacy-behavior
  scrutiny), #6 (data_available ignores log rows), #13/#14/#15 (limit off-by-ones
  — likely intentional legacy parity, high risk, leave unless evidence).

## Landed change #6
- 90eaf15 "Fix video analytics fallback counts to use pre-truncation totals"
  (pushed + deploy TRIGGERED 2026-07-24; monitor brnqhsgtg). codex #11 CONFIRMED:
  VideoDetailReport fell back to count() of the ALREADY-TRUNCATED (->take(limit))
  comment/author lists when urt_comment.comments_count/authors_count were null,
  so it reported <=limit instead of the true total. Fix = capture totals before
  truncation. +regression test (5 comments/3 authors, null aggregates, limit=2 ->
  留言 5 / 留言者 3). Parity-neutral (Laravel fallback). Full suite 973 green. Web.
  DEPLOYED + HEALTHY 2026-07-24: /up 200, analytics route 200. DONE.

## Landed change #5
- 2dea6e2 "Reject calendar-invalid dates in channel/mayor/live-group reports"
  (pushed + deploy TRIGGERED 2026-07-24; monitor b3xtst895 verifying). Prod probe
  found 3 more 500s in the calendar-invalid class: /channels/{id}/prompt,
  /mayor/.../days/{date}, /live/groups/{g}/hours. Fixed w/ isCalendarDate()
  (shape+checkdate) in ChannelPromptReport, MayorPersonDailyReport (2 guards),
  LiveGroupHoursReport (2 guards). +3 regression tests. Full suite 972 green.
  Calendar-invalid-date 500 class now swept across AI + channel/mayor/live-group.
  DEPLOYED + VERIFIED LIVE 2026-07-24: all 3 routes -> 200 (were 500). DONE.
  (Scheduler still on 4e86b8f, no TELEGRAM env - user hasn't run the tg command.)

## Landed change #4
- 3ad2f8d "Reject calendar-invalid dates in AI daily/hourly reports" (pushed +
  deploy TRIGGERED 2026-07-24; monitor b2wb44ih6 verifying). Probed prod: found
  /ai/hours?date=2026-13-45, /ai/days?date=, /ai/days/{date}, /ai/days/{date}/
  prompt all 500 on calendar-invalid dates (live/mayor routes already 200 — left
  alone). Fix = per-report isCalendarDate() (shape + checkdate) in AiHourlyReport,
  AiDailyReport (2 spots incl URL-extract), AiDailyPromptReport. +3 regression
  tests. Full suite 951 green. Web-only deploy. DEPLOYED + VERIFIED LIVE
  2026-07-24: all 4 routes -> 200 (were 500), sanity valid date -> 200, /up 200,
  container 91d5a3660dd1. DONE.
- REMAINING backlog for this class: ~21 other reports use shape-only date regex
  but PROBED prod shows live/mayor degrade gracefully (200). Only the AI reports
  500'd. Most others use date in string-equality queries (safe). Before touching
  any more, PROBE the actual route first (don't assume from grep). Possible future
  idea: shared App\Support date-guard helper to replace all inline checks (bigger
  refactor; would also migrate AiPeriod's inline checkdate — defer, needs review).

## Rejected this iteration
- codex #1 (LegacyAiApiReport type not passed to dailyRow): REJECTED. dailyRow
  selects by date-range+condition (tested contract, /api/ai_day.php); type is
  echoed metadata. Codex's fix (where data_type=$type) would break the
  todate->oneday best-available fallback. Not a bug.

## Codex bug-hunt triage (findings were vs STALE tree d26be4a — re-verify each!)
- #8 (double title concat) = NOT A BUG. Cache builders KeywordRelationCacheBuilder
  :360 & KeywordCloudCacheBuilder:657 both use title.title.description too ->
  intentional 2x title weighting; fallback matches. REJECTED.
- #7 (AiPeriod month) = CONFIRMED + FIXED + SHIPPED (0c80a2d above).
- #14/#15 (limit+1 endpoints, inclusive CSV loop): likely INTENTIONAL legacy
  parity (endpoint-inclusive series). No legacy source in repo to confirm; tests
  exist (LegacyLiveApiTest). Do NOT change without confirming vs legacy behavior.
- #13 (month=29 rows): parity-sensitive, need legacy source. Deferred.
- #1-#6,#9-#12: unapplied hours/min filters, UTC-vs-Taipei bucketing, availability
  edge cases. Several are parity-sensitive OR need careful per-report verification
  against tests. Re-verify individually next iterations; treat "unapplied filter"
  claims skeptically (may be deliberate legacy semantics).

## Investigated & deliberately REJECTED (do not re-open)
- Layout `<title>` "YouTube Board - YouTube Board" dup default: never manifests;
  every report view sets @section('title'). Not worth changing.
- English diagnostic copy ("Data unavailable locally", "Dependency/Rows/Status",
  "Legacy source") in an otherwise zh-Hant UI: DELIBERATE + test-locked
  (assertSee/assertDontSee across many tests). Convention = Chinese empty-states,
  English dependency-diagnostic panels. Do NOT "fix".
- Pint (73 files) mass reformat: rejected (no config, noisy, risky).
- README Laravel 13 / PHP 8.3+ claims: accurate.

## Candidate backlog
- [in progress] codex bug-hunt (agentType codex) scanning Controllers/Services/
  Support for small correctness bugs -> triage top findings, verify, land.
- Areas codex was NOT given (for later manual passes): routes/web.php,
  routes/console.php (huge, scheduled cmds), Blade view logic, JS in views.
