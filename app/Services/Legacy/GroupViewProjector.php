<?php

namespace App\Services\Legacy;

use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Rebuilds the legacy api/group_view.php result payload from local
 * urt_show_tag_date cache rows instead of shelling out to tag_period.php.
 */
final class GroupViewProjector
{
    /**
     * Per-tag work is a map lookup against rows already loaded once per group
     * filter, so the cap only bounds payload size. Production tag_group
     * memberships such as 政治人物 exceed 500 keywords.
     */
    public const MAX_TAGS = 600;

    public const MAX_DAYS = 90;

    /**
     * @param  list<string>  $explicitTags
     * @return array{
     *     complete: bool,
     *     blocked_reason: string|null,
     *     result: array<string, mixed>,
     *     tag_count: int,
     *     group_count: int,
     *     source_rows: int,
     *     dates: int
     * }
     */
    public function project(
        string $group,
        string $view,
        int $days = 30,
        array $explicitTags = [],
        int $tagLimit = self::MAX_TAGS,
        ?CarbonImmutable $now = null,
    ): array {
        $timezone = (string) config('ingestion.timezone', config('app.timezone', 'Asia/Taipei'));
        $now ??= CarbonImmutable::now($timezone);
        $days = max(1, min(self::MAX_DAYS, $days));
        $tagLimit = max(1, min(self::MAX_TAGS, $tagLimit));
        $views = LegacyGroupViewConfig::views();

        if (! array_key_exists($view, $views)) {
            return $this->blocked('unknown_view');
        }

        if ($schemaBlock = $this->schemaBlock()) {
            return $this->blocked($schemaBlock);
        }

        $tagArray = $this->tagArray($group, $explicitTags);

        if ($tagArray === []) {
            return $this->blocked('missing_group_tags');
        }

        if (count($tagArray) > $tagLimit) {
            return $this->blocked('tag_list_limit_exceeded');
        }

        $groupArray = $views[$view];
        $theseDays = $days + 7;
        $dates = [];

        for ($i = 0; $i <= $theseDays; $i++) {
            $dates[] = $now->subDays($i)->toDateString();
        }

        $sourceRows = 0;
        $metricsByGroup = [];

        foreach ($groupArray as $groupIndex => $groupRow) {
            $filters = LegacyGroupViewConfig::parseTagPara((string) $groupRow['tag_para']);
            $rows = $this->tagDateRows($filters, $dates);
            $sourceRows += count($rows);
            $metricsByGroup[$groupIndex] = $rows;
        }

        if ($sourceRows === 0) {
            return $this->blocked('missing_tag_date_source');
        }

        $groupData = [];

        foreach ($groupArray as $groupIndex => $groupRow) {
            $groupData[$groupIndex] = ['total_views' => 0, 'count_videos' => 0];

            for ($i = 0; $i <= $days; $i++) {
                $date = $dates[$i];
                $row = $metricsByGroup[$groupIndex][$date] ?? null;
                $totalViews = (int) ($row['total_views'] ?? 0);
                $countVideos = (int) ($row['count_videos'] ?? 0);
                $groupData[$groupIndex]['total_views'] += $totalViews;
                $groupData[$groupIndex]['count_videos'] += $countVideos;
                $groupData[$groupIndex][$date] = [
                    'count_videos' => $countVideos,
                    'total_views' => $totalViews,
                ];
            }
        }

        $dataArray = [];

        foreach ($tagArray as $tagIndex => $tag) {
            foreach ($groupArray as $groupIndex => $groupRow) {
                foreach ($dates as $date) {
                    $row = $metricsByGroup[$groupIndex][$date] ?? null;

                    if ($row === null) {
                        continue;
                    }

                    $tagViews = (int) ($row['tags_views'][$tag] ?? 0);
                    $tagVideos = (int) ($row['tags_video'][$tag] ?? 0);

                    if ($tagViews > 0) {
                        $dataArray[$tagIndex][$groupIndex][$date]['tags_views'] = $tagViews;
                    }

                    if ($tagVideos > 0) {
                        $dataArray[$tagIndex][$groupIndex][$date]['tags_video'] = $tagVideos;
                    }
                }
            }
        }

        return [
            'complete' => true,
            'blocked_reason' => null,
            'result' => [
                'tag_array' => array_values($tagArray),
                'group_array' => $groupArray,
                'group_data' => $groupData,
                'data_array' => $dataArray,
            ],
            'tag_count' => count($tagArray),
            'group_count' => count($groupArray),
            'source_rows' => $sourceRows,
            'dates' => count($dates),
        ];
    }

    /**
     * @param  list<string>  $explicitTags
     * @return list<string>
     */
    private function tagArray(string $group, array $explicitTags): array
    {
        $explicitTags = collect($explicitTags)
            ->map(fn (mixed $tag): string => trim((string) $tag))
            ->filter()
            ->values()
            ->all();

        if ($explicitTags !== []) {
            return $explicitTags;
        }

        if (str_starts_with($group, 'tags_')) {
            return LegacyGroupViewConfig::tagSets()[$group] ?? [];
        }

        return DB::table('tag_group')
            ->where('group_name', $group)
            ->where(function ($query): void {
                $query->whereNull('del_flag')->orWhere('del_flag', '<', '1');
            })
            ->orderByDesc('latest_time')
            ->orderBy('tag')
            ->pluck('tag')
            ->map(fn (mixed $tag): string => (string) $tag)
            ->filter()
            ->values()
            ->all();
    }

    /**
     * Latest cache row per date for one legacy filter combination.
     *
     * @param  array{tagid_string: string, or_string: string, not_string: string}  $filters
     * @param  list<string>  $dates
     * @return array<string, array{total_views: int, count_videos: int, tags_views: array<string, int>, tags_video: array<string, int>}>
     */
    private function tagDateRows(array $filters, array $dates): array
    {
        $query = DB::table('urt_show_tag_date')
            ->whereIn('the_date', $dates)
            ->orderByDesc('pk');

        foreach (['tagid' => 'tagid_string', 'tag_or' => 'or_string', 'tag_not' => 'not_string'] as $column => $key) {
            $value = $filters[$key];

            if ($value !== '') {
                $query->where($column, $value);
            } else {
                $query->where(function ($inner) use ($column): void {
                    $inner->where($column, '')->orWhereNull($column);
                });
            }
        }

        return $query
            ->get(['the_date', 'total_views', 'count_videos', 'tags_views', 'tags_video'])
            ->unique(fn (object $row): string => (string) $row->the_date)
            ->mapWithKeys(fn (object $row): array => [(string) $row->the_date => [
                'total_views' => (int) ($row->total_views ?? 0),
                'count_videos' => (int) ($row->count_videos ?? 0),
                'tags_views' => $this->weightedMap($row->tags_views ?? null),
                'tags_video' => $this->weightedMap($row->tags_video ?? null),
            ]])
            ->all();
    }

    /**
     * @return array<string, int>
     */
    private function weightedMap(mixed $json): array
    {
        if (! is_string($json) || trim($json) === '') {
            return [];
        }

        $decoded = json_decode($json, true);

        if (! is_array($decoded)) {
            return [];
        }

        foreach (['result', 'data', 'tags'] as $wrapper) {
            if (! array_is_list($decoded) && isset($decoded[$wrapper]) && is_array($decoded[$wrapper])) {
                $decoded = $decoded[$wrapper];
                break;
            }
        }

        return collect($decoded)
            ->filter(fn (mixed $weight, mixed $keyword): bool => is_string($keyword) && trim($keyword) !== '' && is_numeric($weight))
            ->mapWithKeys(fn (mixed $weight, string $keyword): array => [trim($keyword) => (int) $weight])
            ->all();
    }

    private function schemaBlock(): ?string
    {
        if (! Schema::hasTable('urt_show_tag_date')) {
            return 'missing_tag_date_table';
        }

        foreach (['the_date', 'pk', 'tagid', 'tag_or', 'tag_not', 'total_views', 'count_videos', 'tags_views', 'tags_video'] as $column) {
            if (! Schema::hasColumn('urt_show_tag_date', $column)) {
                return 'missing_tag_date_column';
            }
        }

        if (! Schema::hasTable('tag_group')) {
            return 'missing_tag_group_table';
        }

        return null;
    }

    /**
     * @return array{complete: false, blocked_reason: string, result: array{}, tag_count: int, group_count: int, source_rows: int, dates: int}
     */
    private function blocked(string $reason): array
    {
        return [
            'complete' => false,
            'blocked_reason' => $reason,
            'result' => [],
            'tag_count' => 0,
            'group_count' => 0,
            'source_rows' => 0,
            'dates' => 0,
        ];
    }
}
