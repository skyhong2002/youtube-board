<?php

namespace App\Support;

final class YoutubeIdentifierSchema
{
    /**
     * Normalized opaque YouTube identifiers must use byte-exact comparisons.
     * Length and nullability document the fresh baseline; the adoption migration
     * reads deployed metadata and preserves its existing shape.
     *
     * @var array<string, array<string, array{length: int, nullable: bool}>>
     */
    public const COLUMNS = [
        'urt_channel' => [
            'youtube_id' => ['length' => 32, 'nullable' => false],
            'uploads' => ['length' => 32, 'nullable' => true],
        ],
        'urt_channel_history' => [
            'youtube_id' => ['length' => 32, 'nullable' => false],
        ],
        'urt_comment' => [
            'videoId' => ['length' => 32, 'nullable' => false],
            'channelId' => ['length' => 32, 'nullable' => true],
        ],
        'urt_comment_author' => [
            'ChannelId' => ['length' => 32, 'nullable' => false],
        ],
        'urt_comment_queue' => [
            'videoId' => ['length' => 32, 'nullable' => false],
        ],
        'urt_comment_queue_done' => [
            'videoId' => ['length' => 32, 'nullable' => false],
        ],
        'urt_show_video_live' => [
            'videoId' => ['length' => 32, 'nullable' => false],
            'channelId' => ['length' => 32, 'nullable' => false],
        ],
        'urt_show_video_tag' => [
            'videoId' => ['length' => 32, 'nullable' => false],
        ],
        'urt_show_video_tag_title' => [
            'videoId' => ['length' => 32, 'nullable' => false],
        ],
        'urt_show_video_time' => [
            'videoId' => ['length' => 32, 'nullable' => false],
        ],
        'urt_user_channel' => [
            'channel' => ['length' => 24, 'nullable' => false],
        ],
        'urt_user_video' => [
            'videoId' => ['length' => 15, 'nullable' => false],
            'channel' => ['length' => 24, 'nullable' => false],
        ],
        'urt_video' => [
            'id' => ['length' => 64, 'nullable' => false],
            'channelId' => ['length' => 32, 'nullable' => false],
            'playlistId' => ['length' => 40, 'nullable' => false],
            'videoId' => ['length' => 32, 'nullable' => false],
        ],
        'urt_video_details' => [
            'videoId' => ['length' => 32, 'nullable' => false],
        ],
        'urt_video_duration' => [
            'videoId' => ['length' => 32, 'nullable' => false],
        ],
        'urt_video_live' => [
            'videoId' => ['length' => 32, 'nullable' => false],
            'activeLiveChatId' => ['length' => 128, 'nullable' => true],
        ],
        'urt_video_live_log' => [
            'videoId' => ['length' => 32, 'nullable' => false],
        ],
        'urt_video_live_log_tvbs' => [
            'videoId' => ['length' => 32, 'nullable' => false],
        ],
        'urt_video_live_tvbs' => [
            'videoId' => ['length' => 32, 'nullable' => false],
            'activeLiveChatId' => ['length' => 128, 'nullable' => true],
        ],
        'urt_video_log' => [
            'videoId' => ['length' => 32, 'nullable' => false],
        ],
        'urt_video_log_history' => [
            'videoId' => ['length' => 32, 'nullable' => false],
        ],
        'urt_video_schedule' => [
            'videoId' => ['length' => 32, 'nullable' => false],
        ],
        'urt_video_schedule_myisam' => [
            'videoId' => ['length' => 32, 'nullable' => false],
        ],
    ];
}
