<?php

namespace App\Support;

final class YoutubeIdentifierSchema
{
    public const CHARACTER_SET = 'utf8mb4';

    public const COLLATION = 'utf8mb4_bin';

    /**
     * Normalized opaque YouTube identifiers must use byte-exact comparisons.
     * Length and nullability are the only accepted deployed shape. The adoption
     * migration rejects drift before issuing any irreversible table alteration.
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

    /**
     * @param  array{length: int, nullable: bool}  $definition
     * @param  array{
     *     data_type: string,
     *     column_type: string,
     *     character_maximum_length: int,
     *     nullable: bool,
     *     character_set: string|null,
     *     collation: string|null,
     *     default_is_null: bool,
     *     extra: string,
     *     comment: string,
     *     generation_expression: string
     * }|null  $metadata
     * @return list<string>
     */
    public static function metadataIssues(
        array $definition,
        ?array $metadata,
        bool $requireBinaryCollation,
    ): array {
        if ($metadata === null) {
            return ['missing_column'];
        }

        $issues = [];
        $expectedColumnType = sprintf('varchar(%d)', $definition['length']);

        if ($metadata['data_type'] !== 'varchar' || $metadata['column_type'] !== $expectedColumnType) {
            $issues[] = 'not_plain_'.$expectedColumnType;
        }

        if ($metadata['character_maximum_length'] !== $definition['length']) {
            $issues[] = 'length_mismatch';
        }

        if ($metadata['nullable'] !== $definition['nullable']) {
            $issues[] = 'nullability_mismatch';
        }

        if ($metadata['character_set'] !== self::CHARACTER_SET) {
            $issues[] = 'character_set_mismatch';
        }

        if (! $metadata['default_is_null']) {
            $issues[] = 'unexpected_default';
        }

        if ($metadata['extra'] !== '') {
            $issues[] = 'unexpected_extra';
        }

        if ($metadata['comment'] !== '') {
            $issues[] = 'unexpected_comment';
        }

        if ($metadata['generation_expression'] !== '') {
            $issues[] = 'unexpected_generation_expression';
        }

        if ($metadata['collation'] === null) {
            $issues[] = 'missing_collation';
        } elseif ($requireBinaryCollation && $metadata['collation'] !== self::COLLATION) {
            $issues[] = 'collation_mismatch';
        }

        return $issues;
    }

    /**
     * @return array{
     *     data_type: string,
     *     column_type: string,
     *     character_maximum_length: int,
     *     nullable: bool,
     *     character_set: string|null,
     *     collation: string|null,
     *     default_is_null: bool,
     *     extra: string,
     *     comment: string,
     *     generation_expression: string
     * }
     */
    public static function normalizeMetadata(object $row): array
    {
        $characterSet = $row->character_set_name ?? null;
        $collation = $row->collation_name ?? null;

        return [
            'data_type' => strtolower((string) ($row->data_type ?? '')),
            'column_type' => strtolower((string) ($row->column_type ?? '')),
            'character_maximum_length' => (int) ($row->character_maximum_length ?? 0),
            'nullable' => strtoupper((string) ($row->is_nullable ?? 'NO')) === 'YES',
            'character_set' => is_string($characterSet) ? strtolower($characterSet) : null,
            'collation' => is_string($collation) ? strtolower($collation) : null,
            'default_is_null' => (bool) ($row->default_is_null ?? false),
            'extra' => (string) ($row->extra ?? ''),
            'comment' => (string) ($row->column_comment ?? ''),
            'generation_expression' => (string) ($row->generation_expression ?? ''),
        ];
    }
}
