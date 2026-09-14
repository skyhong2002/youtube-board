<?php

return [
    /*
    |--------------------------------------------------------------------------
    | Blocked crawler user agents
    |--------------------------------------------------------------------------
    |
    | Requests whose User-Agent contains any of these tokens (case-insensitive)
    | receive an immediate 403 from App\Http\Middleware\BlockAiCrawlers. These
    | are AI training/search crawlers that ignore the report pages' parameter
    | space and were saturating the database. Keep public/robots.txt in sync.
    |
    */
    'blocked_user_agents' => array_values(array_filter(array_map('trim', explode(',', env(
        'BLOCKED_CRAWLER_USER_AGENTS',
        implode(',', [
            'GPTBot',
            'ChatGPT-User',
            'OAI-SearchBot',
            'ClaudeBot',
            'Claude-Web',
            'Claude-User',
            'Claude-SearchBot',
            'anthropic-ai',
            'Bytespider',
            'CCBot',
            'PerplexityBot',
            'Perplexity-User',
            'Amazonbot',
            'meta-externalagent',
            'meta-externalfetcher',
            'Applebot-Extended',
            'cohere-ai',
            'Diffbot',
            'AI2Bot',
            'ImagesiftBot',
            'Timpibot',
            'YouBot',
            'PetalBot',
        ]),
    ))))),
];
