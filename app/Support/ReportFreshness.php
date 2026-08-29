<?php

namespace App\Support;

use App\Services\Ingestion\IngestionRunHistory;
use Carbon\CarbonImmutable;
use Illuminate\Http\Request;
use Illuminate\Support\Str;

class ReportFreshness
{
    /**
     * @var array<string, array{jobs: list<string>, sources: list<string>}>
     */
    private const ROUTE_PROFILES = [
        'home' => [
            'jobs' => ['reports.counts.build', 'reports.keywords.build', 'youtube.channels.stats'],
            'sources' => ['channel_counts', 'keywords'],
        ],
        'tags.index' => [
            'jobs' => ['reports.counts.build', 'youtube.channels.stats'],
            'sources' => ['channel_counts'],
        ],
        'keywords.index' => [
            'jobs' => ['reports.keywords.build'],
            'sources' => ['keywords'],
        ],

        'tags.channels' => [
            'jobs' => ['reports.counts.build', 'youtube.channels.stats'],
            'sources' => ['channel_counts'],
        ],
        'tags.videos*' => [
            'jobs' => ['youtube.videos.stats', 'youtube.channels.videos.general', 'youtube.channels.videos.live', 'youtube.channels.videos.live_group', 'youtube.tvbs.videos'],
            'sources' => ['videos'],
        ],
        'tags.live.videos*' => [
            'jobs' => ['reports.live.build', 'reports.live.show', 'youtube.live.poll', 'youtube.tvbs.live.poll'],
            'sources' => ['live'],
        ],
        'tags.comments*' => [
            'jobs' => ['youtube.comments.fetch', 'youtube.comments.queue'],
            'sources' => ['comments'],
        ],
        'tags.cloud*' => [
            'jobs' => ['reports.people.build', 'reports.mayor.static'],
            'sources' => ['tag_date'],
        ],
        'tags.days*' => [
            'jobs' => ['reports.people.build', 'reports.mayor.static'],
            'sources' => ['tag_date'],
        ],
        'tags.trends*' => [
            'jobs' => ['reports.counts.build', 'reports.people.build'],
            'sources' => ['tag_date', 'channel_counts'],
        ],
        'tags.compare' => [
            'jobs' => ['reports.keywords.build', 'reports.groups.build'],
            'sources' => ['keywords', 'groups'],
        ],

        'keywords.videos' => [
            'jobs' => ['youtube.videos.stats', 'youtube.channels.videos.general'],
            'sources' => ['videos'],
        ],
        'keywords.cloud' => [
            'jobs' => ['reports.people.build'],
            'sources' => ['tag_date'],
        ],
        'keywords.days' => [
            'jobs' => ['reports.people.build'],
            'sources' => ['tag_date'],
        ],
        'keywords.groups.trends' => [
            'jobs' => ['reports.groups.build', 'reports.static.html'],
            'sources' => ['groups', 'tag_date'],
        ],
        'keywords.live.trends' => [
            'jobs' => ['reports.live.build', 'reports.live.show', 'youtube.live.poll'],
            'sources' => ['live'],
        ],

        'channels.show' => [
            'jobs' => ['youtube.channels.stats', 'reports.counts.build'],
            'sources' => ['channel_counts'],
        ],
        'channels.videos' => [
            'jobs' => ['youtube.channels.videos.general', 'youtube.channels.videos.live', 'youtube.channels.videos.live_group', 'youtube.videos.stats'],
            'sources' => ['videos'],
        ],
        'channels.comments' => [
            'jobs' => ['youtube.comments.fetch', 'youtube.comments.queue'],
            'sources' => ['comments'],
        ],
        'channels.cloud' => [
            'jobs' => ['reports.people.build'],
            'sources' => ['tag_date'],
        ],
        'channels.trends' => [
            'jobs' => ['youtube.channels.stats', 'reports.counts.build'],
            'sources' => ['channel_counts'],
        ],
        'channels.people' => [
            'jobs' => ['reports.people.build'],
            'sources' => ['tag_date'],
        ],
        'channels.prompt' => [
            'jobs' => ['youtube.videos.stats', 'youtube.channels.videos.general'],
            'sources' => ['videos'],
        ],
        'channels.ai*' => [
            'jobs' => ['ai.daily'],
            'sources' => ['ai_daily'],
        ],

        'live.*' => [
            'jobs' => ['reports.live.build', 'reports.live.show', 'reports.live.static', 'reports.live.clean', 'youtube.live.poll', 'youtube.tvbs.live.poll'],
            'sources' => ['live'],
        ],
        'videos.*' => [
            'jobs' => ['youtube.videos.stats', 'youtube.videos.duration', 'youtube.channels.videos.general', 'youtube.channels.videos.live', 'youtube.channels.videos.live_group', 'youtube.tvbs.videos'],
            'sources' => ['videos'],
        ],
        'comments.*' => [
            'jobs' => ['youtube.comments.fetch', 'youtube.comments.queue'],
            'sources' => ['comments'],
        ],

        'groups.index' => [
            'jobs' => ['reports.groups.build'],
            'sources' => ['groups'],
        ],
        'groups.show' => [
            'jobs' => ['reports.groups.build'],
            'sources' => ['groups'],
        ],
        'groups.live' => [
            'jobs' => ['reports.live.build', 'reports.live.show', 'youtube.live.poll'],
            'sources' => ['live'],
        ],
        'groups.ranking' => [
            'jobs' => ['reports.static.html', 'reports.people.build'],
            'sources' => ['tag_date'],
        ],
        'groups.trends' => [
            'jobs' => ['reports.static.html', 'reports.people.build'],
            'sources' => ['tag_date'],
        ],
        'mayor.*' => [
            'jobs' => ['reports.mayor.static'],
            'sources' => ['mayor_tag_date'],
        ],

        'ai.hours' => [
            'jobs' => ['ai.hourly'],
            'sources' => ['ai_hourly'],
        ],
        'ai.*' => [
            'jobs' => ['ai.daily'],
            'sources' => ['ai_daily'],
        ],
    ];

    /**
     * @var array<string, list<array{table: string, column: string}>>
     */
    private const SOURCE_GROUPS = [
        'channel_counts' => [
            ['table' => 'urt_count', 'column' => 'mtime'],
            ['table' => 'urt_channel', 'column' => 'stime'],
            ['table' => 'urt_channel', 'column' => 'mtime'],
            ['table' => 'urt_log', 'column' => 'ctime'],
        ],
        'keywords' => [
            ['table' => 'tags', 'column' => 'mtime'],
            ['table' => 'tags', 'column' => 'ctime'],
            ['table' => 'urt_show_data', 'column' => 'mtime'],
            ['table' => 'urt_show_data', 'column' => 'ctime'],
        ],
        'videos' => [
            ['table' => 'urt_video', 'column' => 'mtime'],
            ['table' => 'urt_video', 'column' => 'ctime'],
            ['table' => 'urt_video_schedule', 'column' => 'mtime'],
            ['table' => 'urt_video_schedule', 'column' => 'ctime'],
            ['table' => 'urt_video_log', 'column' => 'ctime'],
            ['table' => 'urt_video_log_history', 'column' => 'ctime'],
            ['table' => 'urt_video_duration', 'column' => 'mtime'],
        ],
        'live' => [
            ['table' => 'urt_video_live', 'column' => 'mtime'],
            ['table' => 'urt_video_live', 'column' => 'ctime'],
            ['table' => 'urt_video_live_log', 'column' => 'mtime'],
            ['table' => 'urt_video_live_log', 'column' => 'ctime'],
            ['table' => 'urt_video_live_tvbs', 'column' => 'mtime'],
            ['table' => 'urt_video_live_log_tvbs', 'column' => 'mtime'],
            ['table' => 'urt_show_video_live', 'column' => 'mtime'],
            ['table' => 'urt_show_video_live', 'column' => 'ctime'],
            ['table' => 'urt_show_live_tag_date', 'column' => 'mtime'],
            ['table' => 'urt_show_live_tag_date', 'column' => 'ctime'],
        ],
        'tag_date' => [
            ['table' => 'urt_show_tag_date', 'column' => 'mtime'],
            ['table' => 'urt_show_tag_date', 'column' => 'ctime'],
            ['table' => 'urt_show_tag_date', 'column' => 'the_date'],
        ],
        'mayor_tag_date' => [
            ['table' => 'urt_show_tag_date', 'column' => 'mtime', 'where_in' => ['tagid' => ['3', '4', '5', '6']]],
            ['table' => 'urt_show_tag_date', 'column' => 'ctime', 'where_in' => ['tagid' => ['3', '4', '5', '6']]],
            ['table' => 'urt_show_tag_date', 'column' => 'the_date', 'where_in' => ['tagid' => ['3', '4', '5', '6']]],
        ],
        'groups' => [
            ['table' => 'tag_group', 'column' => 'mtime'],
            ['table' => 'tag_group', 'column' => 'ctime'],
            ['table' => 'tag_group', 'column' => 'latest_time'],
        ],
        'comments' => [
            ['table' => 'urt_comment', 'column' => 'mtime'],
            ['table' => 'urt_comment', 'column' => 'ctime'],
            ['table' => 'urt_comment_rev', 'column' => 'ctime'],
            ['table' => 'urt_comment_author', 'column' => 'mtime'],
            ['table' => 'urt_comment_queue_done', 'column' => 'ftime'],
        ],
        'ai_daily' => [
            ['table' => 'urt_ai_date', 'column' => 'mtime'],
            ['table' => 'urt_ai_date', 'column' => 'ctime'],
            ['table' => 'urt_channel_ai', 'column' => 'mtime'],
            ['table' => 'urt_channel_ai', 'column' => 'ctime'],
        ],
        'ai_hourly' => [
            ['table' => 'urt_ai_hour', 'column' => 'mtime'],
            ['table' => 'urt_ai_hour', 'column' => 'ctime'],
        ],
    ];

    /**
     * @var array<string, CarbonImmutable|null>
     */
    private array $databaseLatest = [];

    /**
     * @var array<string, CarbonImmutable|null>
     */
    private array $jobLatest = [];

    public function __construct(
        private readonly IngestionRunHistory $history,
        private readonly ReportSourceTimestampLookup $sourceTimestamps,
    ) {}

    /**
     * @return array{display: string, updated_at: string|null, source: string, job_keys: list<string>}|null
     */
    public function forRequest(Request $request): ?array
    {
        $routeName = $request->route()?->getName();

        if (! is_string($routeName) || $routeName === '') {
            return null;
        }

        return $this->forRoute($routeName);
    }

    /**
     * @return array{display: string, updated_at: string|null, source: string, job_keys: list<string>}|null
     */
    public function forRoute(string $routeName): ?array
    {
        $profile = $this->profile($routeName);

        if ($profile === null) {
            return null;
        }

        $jobKeys = $profile['jobs'];
        $updatedAt = $this->latestDatabaseTimestamp($profile['sources']);
        $source = 'database';

        if ($updatedAt === null) {
            $updatedAt = $this->latestJobRun($jobKeys);
            $source = 'ingestion-run';
        }

        return [
            'display' => $updatedAt !== null
                ? '資料更新 '.$updatedAt->format('Y-m-d H:i:s')
                : '資料更新時間未記錄',
            'updated_at' => $updatedAt?->format('Y-m-d H:i:s'),
            'source' => $updatedAt !== null ? $source : 'missing',
            'job_keys' => $jobKeys,
        ];
    }

    /**
     * @param  array{display: string, updated_at: string|null, source: string, job_keys: list<string>}|null  $freshness
     */
    public function replaceMetaTimestamp(string $pageMeta, ?array $freshness): string
    {
        if ($freshness === null) {
            return $pageMeta;
        }

        $display = $freshness['display'];
        $pattern = '/\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?: [A-Za-z_\/]+)?/u';

        if (preg_match_all($pattern, $pageMeta, $matches, PREG_OFFSET_CAPTURE) > 0) {
            $last = end($matches[0]);

            if (is_array($last)) {
                [$match, $offset] = $last;

                return substr_replace($pageMeta, $display, (int) $offset, strlen((string) $match));
            }
        }

        if (trim($pageMeta) === '') {
            return $display;
        }

        return $pageMeta.' · '.$display;
    }

    /**
     * @return array{jobs: list<string>, sources: list<string>}|null
     */
    private function profile(string $routeName): ?array
    {
        foreach (self::ROUTE_PROFILES as $pattern => $profile) {
            if (Str::is($pattern, $routeName)) {
                return $profile;
            }
        }

        return null;
    }

    /**
     * @param  list<string>  $sourceGroups
     */
    private function latestDatabaseTimestamp(array $sourceGroups): ?CarbonImmutable
    {
        $cacheKey = implode('|', $sourceGroups);

        if (array_key_exists($cacheKey, $this->databaseLatest)) {
            return $this->databaseLatest[$cacheKey];
        }

        $sourcesByTable = [];

        foreach ($sourceGroups as $group) {
            foreach (self::SOURCE_GROUPS[$group] ?? [] as $source) {
                $scope = json_encode($source['where_in'] ?? [], JSON_THROW_ON_ERROR);
                $sourcesByTable[$source['table'].'|'.$scope]['table'] = $source['table'];
                $sourcesByTable[$source['table'].'|'.$scope]['where_in'] = $source['where_in'] ?? [];
                $sourcesByTable[$source['table'].'|'.$scope]['columns'][] = $source['column'];
            }
        }

        $latest = null;

        foreach ($sourcesByTable as $source) {
            $timestamp = $this->sourceTimestamps->latest(
                $source['table'],
                array_values(array_unique($source['columns'])),
                whereIn: $source['where_in'],
            );

            if ($timestamp !== null && ($latest === null || $timestamp->greaterThan($latest))) {
                $latest = $timestamp;
            }
        }

        return $this->databaseLatest[$cacheKey] = $latest;
    }

    /**
     * @param  list<string>  $jobKeys
     */
    private function latestJobRun(array $jobKeys): ?CarbonImmutable
    {
        $jobKeys = array_values(array_unique(array_filter($jobKeys)));
        $cacheKey = implode('|', $jobKeys);

        if (array_key_exists($cacheKey, $this->jobLatest)) {
            return $this->jobLatest[$cacheKey];
        }

        if ($jobKeys === []) {
            return $this->jobLatest[$cacheKey] = null;
        }

        return $this->jobLatest[$cacheKey] = $this->history->latestSuccessfulJobRun($jobKeys);
    }
}
