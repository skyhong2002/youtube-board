# Production Codex inference

As of 2026-10-01, the Laravel web and scheduler services use the private
`scripts/codex_gateway.py` adapter on skyhong-blog. Both ingestion's
`OpenCodeChatClient` (channel, daily, hourly, period, event, mayor-person analyses)
and Telegram's independent `OpenAiChatClient` use the host's existing official
ChatGPT-authenticated Codex CLI with `gpt-5.6-terra`. There is no API-key provider
fallback. Google YouTube API credentials and scheduled-write allowlists are unchanged.

## Runtime configuration

The web environment is saved in Dokploy application `IUeAdI337qhCzBFvB219H`.
The separately managed `youtube-board-scheduler` Swarm service needs the same AI
environment on every recreation (its other scheduling/Telegram settings differ).

```dotenv
OPENAI_BASE_URL=http://172.19.0.1:8321/v1
OPENAI_MODEL=gpt-5.6-terra
OPENAI_ENDPOINT_STYLE=chat
OPENAI_TIMEOUT=270
OPENAI_FALLBACK_API_KEY=
TELEGRAM_OPENAI_BASE_URL=http://172.19.0.1:8321/v1
TELEGRAM_OPENAI_MODEL=gpt-5.6-terra
TELEGRAM_OPENAI_TIMEOUT=270
```

`OPENAI_API_KEY` and `TELEGRAM_OPENAI_API_KEY` now hold the **private gateway
bearer secret**, not an OpenAI Platform key. Their value must match
`CODEX_GATEWAY_KEY` in `/home/ubuntu/.config/youtube-codex-gateway.env` (mode 0600).
Never put that value or `~/.codex/auth.json` in Git, logs, or support messages.

## Host installation

Copy the Python file to `/home/ubuntu/apps/youtube-codex-gateway/codex_gateway.py`
and the user unit to `~/.config/systemd/user/youtube-codex-gateway.service`.
The private environment file configures the bearer secret, the bind address
`172.19.0.1`, port `8321`, binary `/home/ubuntu/.local/node/bin/codex`, model,
240-second inference deadline, and 60 calls per hour. Set PATH to include the
Codex binary's Node directory. Enable the user service with
`systemctl --user enable --now youtube-codex-gateway` and ensure user lingering
is enabled. Install the firewall unit in `/etc/systemd/system/` and enable it
with `sudo systemctl enable --now youtube-codex-gateway-firewall`.

The gateway binds only the Docker host bridge. The firewall rule permits only
Docker bridge ingress to this one private address/port. Do not add a public
domain, Traefik route, public bind, or published Docker port. A bearer secret is
required even from local containers. The service has no browser/API route to
arbitrary models or arbitrary Codex commands.

## Behavior and limits

Each call uses `codex exec --ignore-user-config --ignore-rules --ephemeral` in
an empty temporary directory, with read-only sandboxing, tools/plugins/hooks
disabled, and an allowlist of subprocess environment variables. App secrets
are not forwarded. A wrapper JSON schema preserves arbitrary text/JSON output.
Only a successful CLI exit **and** `turn.completed` with nonempty valid wrapper
output are accepted. Partial output after failures is rejected. Existing Laravel
business validators remain authoritative before writes; the private compatible
endpoint uses their prompt-and-validation path, rather than the official API's
strict Structured Outputs path.

Two requests may run concurrently; excess requests fail with 429, and the
rolling hourly call budget is 60 (resets on gateway restart). Timeouts kill the
whole subprocess group. No prompt or generated content is logged. Errors expose
only fixed codes. CLI token usage is mapped into the existing telemetry fields.
`max_tokens`, `max_completion_tokens`, temperature and reasoning fields from the
compatible clients do not configure Codex; the gateway pins low reasoning and
uses call/time/concurrency limits. ChatGPT/Codex plan limits still apply, and this
does not recover the deactivated Platform account or its credits.

## Verification and operation

Run `python3 -B scripts/test_codex_gateway.py` before updating the gateway.
`/readyz` verifies the gateway process only. In **both** production containers,
run `php artisan ai:provider:probe --provider=primary --json` for actual inference.
Also exercise `App\Services\Notifications\OpenAiChatClient::complete` with a
small synthetic JSON request; this generates text without sending Telegram.
Watch normal scheduler run history for subsequent successful data generation.
Do not enable extra jobs or send test broadcasts as a provider probe.

When updating gateway code, copy the reviewed file and restart its user unit.
When updating Laravel, follow the ordinary main-branch Dokploy deployment and
force-update the scheduler to the same image. Preserve the AI environment above.
If Codex stops authenticating, run the official CLI login on the host and repeat
an inference probe; `codex login status` alone is not an access check.

Before cutover, private backups of Dokploy env and both Swarm service specs were
retained under `~/.config/youtube-codex-backup-*` / `youtube-codex-dokploy-before.env`.
They contain credentials and must remain mode 0600. Restore only the necessary
configuration through Dokploy/service updates, never copy these backups to Git.
Restoring a deactivated OpenAI key will not restore inference.
