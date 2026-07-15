<?php

namespace App\Services\Ingestion;

use RuntimeException;

class YoutubeApiKeyPoolExhaustedException extends RuntimeException
{
    public const AUTHENTICATION_FAILURE = 'youtube_api_authentication_exhausted';

    public const QUOTA_FAILURE = 'youtube_api_quota_exhausted';

    public function __construct(private readonly string $failureReason)
    {
        parent::__construct('All configured YouTube API keys failed: '.$failureReason.'.');
    }

    public function failureReason(): string
    {
        return $this->failureReason;
    }
}
