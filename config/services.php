<?php

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
        'base_url' => env('OPENAI_BASE_URL', 'https://api.openai.com/v1'),
        'api_key' => env('OPENAI_API_KEY'),
        'model' => env('OPENAI_MODEL', 'gpt-5.4-mini'),
        'endpoint_style' => env('OPENAI_ENDPOINT_STYLE', 'chat'),
        'timeout' => (int) env('OPENAI_TIMEOUT', 180),
        'max_tokens' => (int) env('OPENAI_MAX_TOKENS', 4096),
        'transient_retries' => (int) env('OPENAI_TRANSIENT_RETRIES', 1),
        'retry_delay_ms' => (int) env('OPENAI_RETRY_DELAY_MS', 250),
        'retry_after_max_ms' => (int) env('OPENAI_RETRY_AFTER_MAX_MS', 2000),
        'fallback_base_url' => env('OPENAI_FALLBACK_BASE_URL', 'https://opencode.ai/zen/go/v1'),
        'fallback_api_key' => env('OPENAI_FALLBACK_API_KEY'),
        'fallback_model' => env('OPENAI_FALLBACK_MODEL', 'qwen3.6-plus'),
        'fallback_endpoint_style' => env('OPENAI_FALLBACK_ENDPOINT_STYLE', 'auto'),
        'fallback_timeout' => (int) env('OPENAI_FALLBACK_TIMEOUT', env('OPENAI_TIMEOUT', 180)),
        'fallback_max_tokens' => (int) env('OPENAI_FALLBACK_MAX_TOKENS', env('OPENAI_MAX_TOKENS', 4096)),
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
