# Production AI gateway

As of 2026-10-02, the Laravel web and scheduler services send all AI calls to the
central AI gateway on sky-mini (CLIProxyAPI, policy repo `~/Projects/ai-gateway`
on that Mac). Both ingestion's `OpenCodeChatClient` (channel, daily, hourly,
period, event, mayor-person analyses) and Telegram's independent
`OpenAiChatClient` request the semantic alias `sky-quality`; the gateway decides
which upstream model answers (`gpt-6.1-sol` at revision 2026-10-02, the same
model the previous private gateway pinned). The project never names a concrete
model. Google YouTube API credentials and scheduled-write allowlists are unchanged.

`sky-quality` is used for every call because every output is a summary or brief
that people read. `sky-fast` (bulk classification/extraction) is not used.

## Runtime configuration

The web environment is saved in Dokploy application `IUeAdI337qhCzBFvB219H`.
The separately managed `youtube-board-scheduler` Swarm service needs the same AI
environment on every recreation (`docker service update --env-add ...`).

```dotenv
OPENAI_BASE_URL=http://100.71.224.62:8318/v1
OPENAI_MODEL=sky-quality
OPENAI_ENDPOINT_STYLE=chat
OPENAI_TOKEN_LIMIT_PARAM=max_completion_tokens
OPENAI_STRUCTURED_OUTPUT=true
OPENAI_REASONING_EFFORT=low
OPENAI_TIMEOUT=270
OPENAI_FALLBACK_API_KEY=
TELEGRAM_OPENAI_BASE_URL=http://100.71.224.62:8318/v1
TELEGRAM_OPENAI_MODEL=sky-quality
TELEGRAM_OPENAI_TIMEOUT=270
```

`100.71.224.62:8318` is sky-mini's Tailscale-only forwarder to the gateway and is
reachable from skyhong-blog containers. `OPENAI_API_KEY` and
`TELEGRAM_OPENAI_API_KEY` hold the `youtube-board` client key from
`~/.config/ai-gateway/clients.env` on sky-mini. Never put that value in Git, logs,
or support messages. When unset, the Telegram base URL and key fall back to the
ingestion values.

## Capabilities are explicit

Request fields are chosen from per-provider config, not inferred from the host
or a model-name prefix:

| Setting | Primary default | Fallback default |
|---|---|---|
| Token limit field (`*_TOKEN_LIMIT_PARAM`) | `max_completion_tokens` | `max_tokens` |
| Strict `json_schema` (`*_STRUCTURED_OUTPUT`) | `true` | `false` |
| `reasoning_effort` (`*_REASONING_EFFORT`, empty omits) | `low` | omitted |

Fallback settings use the `OPENAI_FALLBACK_` prefix. Messages-style endpoints
always use `max_tokens` and never receive `response_format` or
`reasoning_effort`. Validated channel/daily/hourly event lists now get strict
Structured Outputs through the gateway; the Laravel validators still run before
every write. `temperature` is still sent (0.2) and is tolerated by the gateway.

## Model provenance

Telemetry keeps both the configured alias (`model`) and the resolved upstream
model (`response_model`). Cache `ai_type` columns record the resolved model
(for example `gpt-6.1-sol`) when it fits the narrowest adopted legacy column
(`varchar(16)`), otherwise the configured alias. Rows written before the cutover
keep their old value; `ai_type` is display provenance only and does not drive
cache reuse, so no cache was invalidated or rebuilt. If the gateway policy ever
resolves to a longer model name, rows record `sky-quality` until the columns
are widened.

## OpenCode fallback

The OpenCode Go fallback path (`OPENAI_FALLBACK_*`, `qwen3.6-plus`) remains in
code and is covered by tests. Production keeps `OPENAI_FALLBACK_API_KEY` empty,
as it has since the 2026-10-01 cutover; set it in Dokploy and the scheduler to
re-enable the fallback.

## Verification and operation

In **both** production containers, run
`php artisan ai:provider:probe --provider=primary --json`; a healthy result
reports `configured_model` `sky-quality` and `model` set to the resolved upstream
model. Also exercise `App\Services\Notifications\OpenAiChatClient::complete`
with a small synthetic JSON request; this generates text without sending
Telegram. Watch the next `ai.hourly` scheduler run (minute 10) and confirm new
`urt_ai_hour` rows record the resolved model. Do not enable extra jobs or send
test broadcasts as a provider probe.

Model changes happen in the ai-gateway repo (`model-policy.json` +
`apply.py`), not here. When updating Laravel, follow the ordinary main-branch
Dokploy deployment and force-update the scheduler to the same image, preserving
the environment above. Gateway outages, quota, and upstream login are managed on
sky-mini (see the ai-gateway README).

## Retired private Codex gateway

From 2026-10-01 to 2026-10-02 production used `scripts/codex_gateway.py`, a
private adapter on skyhong-blog that ran the Codex CLI per request at
`http://172.19.0.1:8321/v1`. Its user unit `youtube-codex-gateway` is now stopped
and disabled; the script, units (`deploy/youtube-codex-gateway*.service`),
`/home/ubuntu/apps/youtube-codex-gateway/`, and
`~/.config/youtube-codex-gateway.env` were left in place for rollback. The
`youtube-codex-gateway-firewall` system unit was left as is (it only permits
Docker bridge ingress to that unused address/port). To roll back, re-enable the
user unit and restore the previous AI env from the private mode-0600 backups
`~/.config/ai-gateway-migration-dokploy-before-*.env` and
`~/.config/ai-gateway-migration-scheduler-before-*.json` on skyhong-blog. Never
copy those backups to Git.
