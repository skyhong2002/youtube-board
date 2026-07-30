<?php

namespace App\Services\Notifications;

use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

class TelegramEventEnricher
{
    /**
     * @param  array<string, mixed>  $event
     * @return array<string, mixed>
     */
    public function enrich(array $event): array
    {
        $videoIds = array_values(array_unique(array_filter(
            array_map('strval', (array) ($event['video_ids'] ?? [])),
            static fn (string $id): bool => trim($id) !== '',
        )));

        if ($videoIds === [] || ! Schema::hasTable('urt_video') || ! Schema::hasColumn('urt_video', 'videoId')) {
            return $event + [
                'videos' => [],
                'channel_tag_counts' => [],
                'media_count' => (int) ($event['media_count'] ?? 0),
                'preview_url' => null,
            ];
        }

        try {
            $columns = collect(['videoId', 'title', 'u_id', 'channelTitle', 'viewCount', 'publishedAt', 'thumbnails'])
                ->filter(fn (string $column): bool => Schema::hasColumn('urt_video', $column))
                ->values()
                ->all();
            $rows = DB::table('urt_video')
                ->whereIn('videoId', array_slice($videoIds, 0, 500))
                ->get($columns)
                ->keyBy(fn (object $row): string => (string) $row->videoId);
            $uIds = $rows
                ->pluck('u_id')
                ->filter(fn (mixed $id): bool => is_numeric($id) && (int) $id > 0)
                ->map(fn (mixed $id): int => (int) $id)
                ->unique()
                ->values()
                ->all();
            $channelNames = $this->channelNames($uIds);
            $channelTags = $this->channelTags($uIds);
            $videos = [];

            foreach ($videoIds as $position => $videoId) {
                $row = $rows->get($videoId);

                if (! $row) {
                    continue;
                }

                $uId = isset($row->u_id) ? (int) $row->u_id : 0;
                $channel = trim((string) ($row->channelTitle ?? ''));
                $channel = $channel !== '' ? $channel : ($channelNames[$uId] ?? '');
                $tags = $channelTags[$uId] ?? [];

                $videos[] = [
                    'video_id' => $videoId,
                    'title' => trim((string) ($row->title ?? '')),
                    'u_id' => $uId,
                    'channel' => $channel,
                    'tags' => $tags,
                    'group' => $this->group($tags),
                    'view_count' => isset($row->viewCount) ? (int) $row->viewCount : null,
                    'published_at' => (string) ($row->publishedAt ?? ''),
                    'thumbnail' => trim((string) ($row->thumbnails ?? '')),
                    'url' => 'https://www.youtube.com/watch?v='.rawurlencode($videoId),
                    'position' => $position,
                ];
            }

            usort($videos, static fn (array $a, array $b): int => (($b['view_count'] ?? -1) <=> ($a['view_count'] ?? -1))
                ?: ($a['position'] <=> $b['position']));

            $mediaKeys = [];
            $tagChannels = [];
            foreach ($videos as $video) {
                $mediaKey = $this->channelKey($video);

                if ($mediaKey === '') {
                    continue;
                }

                $mediaKeys[$mediaKey] = true;
                foreach ($video['tags'] as $tag) {
                    if ($this->isPublicSummaryTag($tag)) {
                        $tagChannels[$tag][$mediaKey] = true;
                    }
                }
            }

            $tagCounts = collect($tagChannels)
                ->map(fn (array $channels): int => count($channels))
                ->sortDesc()
                ->all();

            return array_merge($event, [
                'videos' => $videos,
                'media_count' => max((int) ($event['media_count'] ?? 0), count($mediaKeys)),
                'channel_tag_counts' => $tagCounts,
                'preview_url' => $videos[0]['url'] ?? null,
            ]);
        } catch (QueryException) {
            return $event + [
                'videos' => [],
                'channel_tag_counts' => [],
                'media_count' => (int) ($event['media_count'] ?? 0),
                'preview_url' => null,
            ];
        }
    }

    /**
     * @param  list<int>  $uIds
     * @return array<int, string>
     */
    private function channelNames(array $uIds): array
    {
        if ($uIds === [] || ! Schema::hasTable('urt_channel')
            || ! Schema::hasColumn('urt_channel', 'u_id') || ! Schema::hasColumn('urt_channel', 'title')) {
            return [];
        }

        return DB::table('urt_channel')
            ->whereIn('u_id', $uIds)
            ->pluck('title', 'u_id')
            ->map(fn (mixed $title): string => trim((string) $title))
            ->all();
    }

    /**
     * @param  list<int>  $uIds
     * @return array<int, list<string>>
     */
    private function channelTags(array $uIds): array
    {
        if ($uIds === [] || ! Schema::hasTable('urt_count') || ! Schema::hasTable('urt_tag')
            || ! Schema::hasColumn('urt_count', 'u_id') || ! Schema::hasColumn('urt_count', 'tags')
            || ! Schema::hasColumn('urt_tag', 'tag_id') || ! Schema::hasColumn('urt_tag', 'tag_name')) {
            return [];
        }

        $names = DB::table('urt_tag')
            ->pluck('tag_name', 'tag_id')
            ->map(fn (mixed $name): string => trim((string) $name))
            ->all();
        $limit = max(1, min(8, (int) config('services.telegram.channel_tag_limit', 3)));

        return DB::table('urt_count')
            ->whereIn('u_id', $uIds)
            ->get(['u_id', 'tags'])
            ->mapWithKeys(function (object $row) use ($names, $limit): array {
                preg_match_all('/\[(\d+)\]/', (string) ($row->tags ?? ''), $matches);
                $tags = collect($matches[1] ?? [])
                    ->map(fn (string $id): string => $names[(int) $id] ?? '')
                    ->filter(fn (string $name): bool => $name !== '' && ! in_array($name, ['排除', '未分類'], true))
                    ->unique()
                    ->sortBy(fn (string $name): string => sprintf('%02d:%s', $this->tagPriority($name), $name))
                    ->take($limit)
                    ->values()
                    ->all();

                return [(int) $row->u_id => $tags];
            })
            ->all();
    }

    /**
     * @param  list<string>  $tags
     */
    private function group(array $tags): string
    {
        foreach (['泛綠', '泛藍', '泛白', '泛紅', '較無偏', '中立', '公共電視', '公共媒體'] as $group) {
            if (in_array($group, $tags, true)) {
                return $group;
            }
        }

        return '其他';
    }

    private function tagPriority(string $tag): int
    {
        return match ($tag) {
            '泛綠', '泛藍', '泛白', '泛紅' => 1,
            '較無偏', '中立', '公共電視', '公共媒體' => 2,
            '台灣立場', '中國立場' => 3,
            default => 9,
        };
    }

    private function isPublicSummaryTag(string $tag): bool
    {
        return in_array($tag, [
            '泛綠', '泛藍', '泛白', '泛紅', '較無偏', '中立', '公共電視', '公共媒體', '台灣立場', '中國立場',
        ], true);
    }

    /**
     * @param  array<string, mixed>  $video
     */
    private function channelKey(array $video): string
    {
        if ((int) ($video['u_id'] ?? 0) > 0) {
            return 'u:'.(int) $video['u_id'];
        }

        $channel = trim((string) ($video['channel'] ?? ''));

        return $channel !== '' ? 'c:'.$channel : '';
    }
}
