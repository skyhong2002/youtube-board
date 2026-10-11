<?php

use App\Support\AiDailyContract;

return [

    /*
    |--------------------------------------------------------------------------
    | Third Party Services
    |--------------------------------------------------------------------------
    |
    | This file is for storing the credentials for third party services such
    | as Mailgun, Postmark, AWS and more. This file provides the de facto
    | location for this type of information, allowing packages to have
    | a conventional file to locate the various service credentials.
    |
    */

    'postmark' => [
        'key' => env('POSTMARK_API_KEY'),
    ],

    'resend' => [
        'key' => env('RESEND_API_KEY'),
    ],

    'ses' => [
        'key' => env('AWS_ACCESS_KEY_ID'),
        'secret' => env('AWS_SECRET_ACCESS_KEY'),
        'region' => env('AWS_DEFAULT_REGION', 'us-east-1'),
    ],

    'telegram' => [
        // Live pushes require enabled=true AND a bot token; otherwise the
        // broadcaster stays in dry-run (formats + logs, sends nothing).
        'enabled' => (bool) env('TELEGRAM_DIGEST_ENABLED', false),
        'bot_token' => env('TELEGRAM_BOT_TOKEN'),
        'channel_id' => env('TELEGRAM_CHANNEL_ID'),
        'api_base_url' => rtrim((string) env('TELEGRAM_API_BASE_URL', 'https://api.telegram.org'), '/'),
        'dashboard_url' => rtrim((string) env('TELEGRAM_DASHBOARD_URL', env('APP_URL', 'https://youtube.observe.tw')), '/'),
        'timeout' => (int) env('TELEGRAM_TIMEOUT', 15),
        // Daily fills at most one previously unreported story for the date.
        'daily_max_posts' => (int) env('TELEGRAM_DAILY_MAX_POSTS', 1),
        'hourly_max_posts' => (int) env('TELEGRAM_HOURLY_MAX_POSTS', 3),
        // Hourly posts fire only for events clearing the video floor ("重大事件").
        // First reports use the source event size. Follow-ups use newly observed
        // videos and resolved channels from the durable story tracker below.
        'hourly_min_videos' => (int) env('TELEGRAM_HOURLY_MIN_VIDEOS', 8),
        'story_match_hours' => (int) env('TELEGRAM_STORY_MATCH_HOURS', 72),
        'update_cooldown_hours' => (int) env('TELEGRAM_UPDATE_COOLDOWN_HOURS', 24),
        'resurface_hours' => (int) env('TELEGRAM_RESURFACE_HOURS', 72),
        'update_min_videos' => (int) env('TELEGRAM_UPDATE_MIN_VIDEOS', 5),
        'update_min_media' => (int) env('TELEGRAM_UPDATE_MIN_MEDIA', 2),
        'burst_cooldown_hours' => (int) env('TELEGRAM_BURST_COOLDOWN_HOURS', 3),
        'burst_min_videos' => (int) env('TELEGRAM_BURST_MIN_VIDEOS', 8),
        'burst_min_media' => (int) env('TELEGRAM_BURST_MIN_MEDIA', 3),
        'burst_min_new_videos' => (int) env('TELEGRAM_BURST_MIN_NEW_VIDEOS', 4),
        'burst_baseline_hours' => (int) env('TELEGRAM_BURST_BASELINE_HOURS', 3),
        'burst_ratio' => (float) env('TELEGRAM_BURST_RATIO', 2.5),
        'channel_tag_limit' => (int) env('TELEGRAM_CHANNEL_TAG_LIMIT', 3),
        // Dedup store must be SHARED across the web + scheduler containers (which
        // have separate file caches), so it defaults to the database cache store.
        'dedup_store' => env('TELEGRAM_DEDUP_STORE', 'database'),
        // News-brief writer: reuses the ingestion gateway URL and key by default,
        // via a path independent of the ingestion client. The `sky-quality` alias
        // resolves to a reasoning model on the central AI gateway (see
        // docs/codex-gateway.md): reasoning tokens count against max_completion_tokens, so the cap
        // must leave room for ~250 output tokens per event (a 13-event hourly batch
        // needs ~3k) or the response is empty and every brief falls back to
        // extractive copy. Reasoning effort is pinned low to keep that overhead
        // and latency small; set it to an empty string to omit the field.
        'ai' => [
            'base_url' => rtrim((string) env('TELEGRAM_OPENAI_BASE_URL', env('OPENAI_BASE_URL', 'http://172.17.0.1:8317/v1')), '/'),
            'api_key' => env('TELEGRAM_OPENAI_API_KEY', env('OPENAI_API_KEY')),
            'model' => env('TELEGRAM_OPENAI_MODEL', 'sky-quality'),
            'reasoning_effort' => env('TELEGRAM_OPENAI_REASONING_EFFORT', 'low'),
            'timeout' => (int) env('TELEGRAM_OPENAI_TIMEOUT', 120),
            'max_output_tokens' => (int) env('TELEGRAM_OPENAI_MAX_TOKENS', 8000),
        ],
    ],

    'youtube' => [
        'api_key' => env('YOUTUBE_API_KEY'),
        'api_keys' => env('YOUTUBE_API_KEYS'),
        'transient_retries' => (int) env('YOUTUBE_API_TRANSIENT_RETRIES', 1),
        'retry_delay_ms' => (int) env('YOUTUBE_API_RETRY_DELAY_MS', 250),
        'quota' => [
            'daily_limit' => (int) env('YOUTUBE_DATA_API_DAILY_QUOTA_UNITS', 10000),
            'warning_percent' => (float) env('YOUTUBE_DATA_API_QUOTA_WARNING_PERCENT', 80),
        ],
    ],

    'google_cloud' => [
        'project_id' => env('GOOGLE_CLOUD_PROJECT_ID'),
        'monitoring_service_account_json' => env('GOOGLE_CLOUD_MONITORING_SERVICE_ACCOUNT_JSON'),
        'monitoring_service_account_json_base64' => env('GOOGLE_CLOUD_MONITORING_SERVICE_ACCOUNT_JSON_BASE64'),
        'monitoring_service_account_path' => env('GOOGLE_CLOUD_MONITORING_SERVICE_ACCOUNT_PATH'),
    ],

    'opencode_go' => [
        // AI gateway (CLIProxyAPI) local to the Dokploy host; request semantic aliases
        // (`sky-quality`, `sky-fast`), never concrete models. Capabilities are
        // explicit per provider rather than inferred from the host or model name.
        'base_url' => env('OPENAI_BASE_URL', 'http://172.17.0.1:8317/v1'),
        'api_key' => env('OPENAI_API_KEY'),
        'model' => env('OPENAI_MODEL', 'sky-quality'),
        'endpoint_style' => env('OPENAI_ENDPOINT_STYLE', 'chat'),
        'token_limit_param' => env('OPENAI_TOKEN_LIMIT_PARAM', 'max_completion_tokens'),
        'structured_output' => (bool) env('OPENAI_STRUCTURED_OUTPUT', true),
        'reasoning_effort' => env('OPENAI_REASONING_EFFORT', 'low'),
        'timeout' => (int) env('OPENAI_TIMEOUT', 180),
        'max_tokens' => (int) env('OPENAI_MAX_TOKENS', 4096),
        'daily_max_tokens' => max(128, min(
            AiDailyContract::OFFICIAL_DAILY_MAX_TOKENS,
            (int) env('OPENAI_DAILY_MAX_TOKENS', AiDailyContract::OFFICIAL_DAILY_MAX_TOKENS),
        )),
        'transient_retries' => (int) env('OPENAI_TRANSIENT_RETRIES', 1),
        'retry_delay_ms' => (int) env('OPENAI_RETRY_DELAY_MS', 250),
        'retry_after_max_ms' => (int) env('OPENAI_RETRY_AFTER_MAX_MS', 2000),
        'fallback_base_url' => env('OPENAI_FALLBACK_BASE_URL', 'https://opencode.ai/zen/go/v1'),
        'fallback_api_key' => env('OPENAI_FALLBACK_API_KEY'),
        'fallback_model' => env('OPENAI_FALLBACK_MODEL', 'qwen3.6-plus'),
        'fallback_endpoint_style' => env('OPENAI_FALLBACK_ENDPOINT_STYLE', 'auto'),
        'fallback_token_limit_param' => env('OPENAI_FALLBACK_TOKEN_LIMIT_PARAM', 'max_tokens'),
        'fallback_structured_output' => (bool) env('OPENAI_FALLBACK_STRUCTURED_OUTPUT', false),
        'fallback_reasoning_effort' => env('OPENAI_FALLBACK_REASONING_EFFORT', ''),
        'fallback_timeout' => (int) env('OPENAI_FALLBACK_TIMEOUT', env('OPENAI_TIMEOUT', 180)),
        'fallback_max_tokens' => (int) env('OPENAI_FALLBACK_MAX_TOKENS', env('OPENAI_MAX_TOKENS', 4096)),
    ],

    'ops' => [
        'basic_auth_user' => env('OPS_BASIC_AUTH_USER'),
        'basic_auth_password_hash' => env('OPS_BASIC_AUTH_PASSWORD_HASH'),
    ],

    'dokploy' => [
        'deploy_webhook_url' => env('DOKPLOY_DEPLOY_WEBHOOK_URL'),
        'deploy_relay_secret' => env('DOKPLOY_DEPLOY_RELAY_SECRET'),
    ],

    'slack' => [
        'notifications' => [
            'bot_user_oauth_token' => env('SLACK_BOT_USER_OAUTH_TOKEN'),
            'channel' => env('SLACK_BOT_USER_DEFAULT_CHANNEL'),
        ],
    ],

];
