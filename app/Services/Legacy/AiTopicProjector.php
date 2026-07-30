<?php

namespace App\Services\Legacy;

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use stdClass;

final class AiTopicProjector
{
    public const MAX_TOPICS = 200;

    public const MAX_CHANNELS = 200;

    public const MAX_VIDEOS = 10000;

    /**
     * @return array{
     *     complete: bool,
     *     blocked_reason: string|null,
     *     source_truncated: bool,
     *     topic: array<string, array<string, mixed>>,
     *     video: array<string, array<string, mixed>>,
     *     channel_id: array<int, string>,
     *     raw: mixed,
     *     topic_count: int,
     *     channel_count: int,
     *     video_count: int
     * }
     */
    public function project(
        object $row,
        int $topicLimit = 100,
        int $channelLimit = 100,
        int $videoLimit = 5000,
    ): array {
        $topicLimit = max(1, min(self::MAX_TOPICS, $topicLimit));
        $channelLimit = max(1, min(self::MAX_CHANNELS, $channelLimit));
        $videoLimit = max(1, min(self::MAX_VIDEOS, $videoLimit));
        $raw = $this->decodeObject($row->result_json ?? null);
        $topics = $this->topicList($raw);
        $channelMap = $this->channelMap($row->channel_id ?? null);

        if ($topics === []) {
            return $this->blocked($raw, $channelMap, 'invalid_daily_result_json');
        }

        if (count($topics) > $topicLimit) {
            return $this->blocked($raw, $channelMap, 'topic_source_limit_exceeded', true, count($topics));
        }

        if ($channelMap === []) {
            return $this->blocked($raw, $channelMap, 'missing_channel_map', false, count($topics));
        }

        if (count($channelMap) > $channelLimit) {
            return $this->blocked($raw, $channelMap, 'channel_source_limit_exceeded', true, count($topics));
        }

        $schemaBlock = $this->schemaBlock();

        if ($schemaBlock !== null) {
            return $this->blocked($raw, $channelMap, $schemaBlock, false, count($topics));
        }

        $dateFrom = (string) ($row->date_from ?? '');
        $dateTo = (string) ($row->date_to ?? '');
        $channelAi = $this->channelAi($channelMap, $dateFrom, $dateTo);
        $channelTags = $this->channelTags(array_keys($channelMap));
        $titleToUId = $this->titleToUId($channelMap);
        $topicData = [];
        $videoIds = [];

        foreach ($topics as $topic) {
            if (! is_array($topic)) {
                return $this->blocked($raw, $channelMap, 'invalid_daily_topic', false, count($topics));
            }

            $title = $this->text($topic, ['標題', '議題', '事件', 'title', 'topic', 'event']);
            $mediaEvents = $this->mediaEvents($topic['媒體事件'] ?? $topic['media_events'] ?? $topic['mediaEvents'] ?? null);

            if ($title === '' || $mediaEvents === []) {
                return $this->blocked($raw, $channelMap, 'invalid_daily_topic', false, count($topics));
            }

            $topicData[$title] ??= [
                '媒體數' => 0,
                '影片數' => 0,
                'videos' => [],
                '角度' => [],
                '陣營' => [],
                '關鍵字' => [],
                '關鍵字次數' => [],
                '人物' => [],
                '地名' => [],
                '標籤' => [],
                '媒體明細' => [],
            ];

            foreach ($mediaEvents as $channelTitle => $eventNames) {
                $uId = $titleToUId[$channelTitle] ?? null;

                if ($uId === null || ! isset($channelAi[$uId]) || ! array_key_exists($uId, $channelTags)) {
                    return $this->blocked($raw, $channelMap, 'incomplete_channel_source', false, count($topics));
                }

                $matchedChannel = false;

                foreach ($eventNames as $eventName) {
                    $matches = $this->matchingEvents($channelAi[$uId], $eventName);

                    if ($matches === []) {
                        continue;
                    }

                    foreach ($matches as $event) {
                        $eventVideoIds = $this->stringList($event, ['videoId', 'video_id', 'video_ids', 'videos']);

                        if ($eventVideoIds === []) {
                            return $this->blocked($raw, $channelMap, 'missing_event_videos', false, count($topics));
                        }

                        $matchedChannel = true;
                        $videoCount = count($eventVideoIds);
                        $topicData[$title]['videos'][$uId] = array_values(array_unique(array_merge(
                            $topicData[$title]['videos'][$uId] ?? [],
                            $eventVideoIds,
                        )));
                        $topicData[$title]['影片數'] += $videoCount;
                        array_push($videoIds, ...$eventVideoIds);
                        $this->weightedText($topicData[$title]['角度'], $this->text($event, ['角度', 'angle']), ['台灣', '中國'], $videoCount);
                        $this->weightedText($topicData[$title]['陣營'], $this->text($event, ['陣營', 'camp', 'stance']), ['民進黨', '國民黨'], $videoCount);

                        foreach ($this->stringList($event, ['關鍵字', 'keywords']) as $keyword) {
                            $topicData[$title]['關鍵字'][$keyword] = ($topicData[$title]['關鍵字'][$keyword] ?? 0) + 1;
                            $topicData[$title]['關鍵字次數'][$keyword] = ($topicData[$title]['關鍵字次數'][$keyword] ?? 0) + $videoCount;
                        }

                        foreach ($this->stringList($event, ['人物', 'people']) as $person) {
                            $topicData[$title]['人物'][$person] = ($topicData[$title]['人物'][$person] ?? 0) + 1;
                        }

                        foreach ($this->stringList($event, ['地名', 'places']) as $place) {
                            $topicData[$title]['地名'][$place] = ($topicData[$title]['地名'][$place] ?? 0) + 1;
                        }

                        foreach ($channelTags[$uId] as $tag) {
                            $topicData[$title]['標籤'][$tag] = ($topicData[$title]['標籤'][$tag] ?? 0) + $videoCount;
                        }

                        $topicData[$title]['媒體明細'][] = [
                            'u_id' => $uId,
                            '媒體' => $channelTitle,
                            '事件' => $this->text($event, ['事件', '議題', '標題', 'event', 'topic', 'title']) ?: $eventName,
                            '描述' => $this->text($event, ['描述', '說明', 'description', 'content']),
                            '分類' => $this->text($event, ['分類', 'category', 'type'])
                                ?: implode('、', $this->stringList($event, ['類型', 'types'])),
                            '角度' => $this->text($event, ['角度', 'angle']),
                            '陣營' => $this->text($event, ['陣營', 'camp', 'stance']),
                            '關鍵字' => $this->stringList($event, ['關鍵字', 'keywords']),
                            '人物' => $this->stringList($event, ['人物', 'people']),
                            '地名' => $this->stringList($event, ['地名', 'places']),
                            'videoId' => $eventVideoIds,
                        ];
                    }
                }

                if ($matchedChannel) {
                    $topicData[$title]['媒體數']++;
                }
            }

            if ($topicData[$title]['媒體數'] === 0) {
                unset($topicData[$title]);
            }
        }

        if ($topicData === []) {
            return $this->blocked($raw, $channelMap, 'missing_channel_event', false, count($topics));
        }

        $videoIds = array_values(array_unique($videoIds));

        if (count($videoIds) > $videoLimit) {
            return $this->blocked($raw, $channelMap, 'video_source_limit_exceeded', true, count($topics), count($videoIds));
        }

        $videos = $this->videos($videoIds);

        foreach ($topicData as $title => $topic) {
            $topicVideoIds = collect($topic['videos'])
                ->flatten()
                ->unique()
                ->values()
                ->all();

            if (array_diff($topicVideoIds, array_keys($videos)) !== []) {
                unset($topicData[$title]);
            }
        }

        if ($topicData === []) {
            return $this->blocked($raw, $channelMap, 'missing_video_source', false, count($topics), count($videoIds));
        }

        $videoIds = collect($topicData)
            ->pluck('videos')
            ->flatten()
            ->unique()
            ->values()
            ->all();
        $videos = array_intersect_key($videos, array_flip($videoIds));

        return [
            'complete' => true,
            'blocked_reason' => null,
            'source_truncated' => false,
            'topic' => $topicData,
            'video' => $videos,
            'channel_id' => $channelMap,
            'raw' => $raw,
            'topic_count' => count($topics),
            'channel_count' => count($channelMap),
            'video_count' => count($videoIds),
        ];
    }

    /**
     * @return array{topic: array<string, mixed>, video: array<string, mixed>}|null
     */
    public function cached(object $row): ?array
    {
        $topic = $this->decodeObject($row->data_json ?? null);
        $video = $this->decodeObject($row->video_json ?? null);

        return $topic !== [] && $video !== [] ? ['topic' => $topic, 'video' => $video] : null;
    }

    /**
     * @return array<string, list<array<string, mixed>>>
     */
    private function channelAi(array $channelMap, string $dateFrom, string $dateTo): array
    {
        $query = DB::table('urt_channel_ai')
            ->whereIn('u_id', array_keys($channelMap))
            ->where('date_from', $dateFrom)
            ->where('date_to', $dateTo)
            ->whereNull('del_flag')
            ->orderByDesc('pk');

        return $query->get(['u_id', 'result_json'])
            ->unique('u_id')
            ->mapWithKeys(fn (object $source): array => [
                (int) $source->u_id => collect($this->topicList($this->decodeObject($source->result_json ?? null)))
                    ->filter(fn (mixed $event): bool => is_array($event))
                    ->values()
                    ->all(),
            ])
            ->all();
    }

    /**
     * @param  list<int>  $uIds
     * @return array<int, list<string>>
     */
    private function channelTags(array $uIds): array
    {
        return DB::table('urt_count')
            ->whereIn('u_id', $uIds)
            ->get(['u_id', 'tags'])
            ->mapWithKeys(fn (object $row): array => [(int) $row->u_id => $this->tagIds((string) ($row->tags ?? ''))])
            ->all();
    }

    /**
     * @param  list<string>  $videoIds
     * @return array<string, array<string, mixed>>
     */
    private function videos(array $videoIds): array
    {
        if ($videoIds === []) {
            return [];
        }

        $columns = ['videoId', 'title', 'u_id', 'publishedAt', 'thumbnails', 'viewCount', 'likeCount', 'commentCount'];
        $rows = DB::table('urt_video')
            ->whereIn('videoId', $videoIds)
            ->get($columns)
            ->keyBy(fn (object $row): string => (string) $row->videoId);
        $durations = Schema::hasTable('urt_video_duration')
            ? DB::table('urt_video_duration')
                ->whereIn('videoId', $videoIds)
                ->orderByDesc('pk_video')
                ->get(['videoId', 'duration'])
                ->unique('videoId')
                ->mapWithKeys(fn (object $row): array => [(string) $row->videoId => max(0, (int) ($row->duration ?? 0))])
                ->all()
            : [];
        $videos = [];

        foreach ($videoIds as $videoId) {
            $row = $rows->get($videoId);

            if (! $row) {
                continue;
            }

            $videos[$videoId] = [
                'title' => (string) ($row->title ?? ''),
                'u_id' => (int) ($row->u_id ?? 0),
                'publishedAt' => (string) ($row->publishedAt ?? ''),
                'thumbnails' => (string) ($row->thumbnails ?? ''),
                'viewCount' => $row->viewCount === null ? null : (int) $row->viewCount,
                'likeCount' => $row->likeCount === null ? null : (int) $row->likeCount,
                'commentCount' => $row->commentCount === null ? null : (int) $row->commentCount,
                'duration' => $durations[$videoId] ?? 0,
            ];
        }

        return $videos;
    }

    private function schemaBlock(): ?string
    {
        $required = [
            'urt_channel_ai' => ['pk', 'u_id', 'date_from', 'date_to', 'del_flag', 'result_json'],
            'urt_count' => ['u_id', 'tags'],
            'urt_video' => ['videoId', 'title', 'u_id', 'publishedAt', 'thumbnails', 'viewCount', 'likeCount', 'commentCount'],
        ];

        foreach ($required as $table => $columns) {
            if (! Schema::hasTable($table)) {
                return 'missing_source_table';
            }

            foreach ($columns as $column) {
                if (! Schema::hasColumn($table, $column)) {
                    return 'missing_source_column';
                }
            }
        }

        return null;
    }

    /**
     * @param  list<array<string, mixed>>  $events
     * @return list<array<string, mixed>>
     */
    private function matchingEvents(array $events, string $name): array
    {
        return collect($events)
            ->filter(fn (array $event): bool => $this->text($event, ['事件', '議題', '標題', 'event', 'topic', 'title']) === $name)
            ->values()
            ->all();
    }

    /**
     * @return array<string, list<string>>
     */
    private function mediaEvents(mixed $value): array
    {
        if (! is_array($value)) {
            return [];
        }

        return collect($value)
            ->filter(fn (mixed $events, mixed $channel): bool => is_string($channel) && trim($channel) !== '' && is_array($events))
            ->mapWithKeys(fn (array $events, string $channel): array => [trim($channel) => collect($events)
                ->filter(fn (mixed $event): bool => is_scalar($event) && trim((string) $event) !== '')
                ->map(fn (mixed $event): string => trim((string) $event))
                ->values()
                ->all()])
            ->filter(fn (array $events): bool => $events !== [])
            ->all();
    }

    /**
     * @param  array<string, int>  $counts
     * @param  list<string>  $needles
     */
    private function weightedText(array &$counts, string $text, array $needles, int $weight): void
    {
        foreach ($needles as $needle) {
            if (str_contains($text, $needle)) {
                $counts[$needle] = ($counts[$needle] ?? 0) + $weight;
            }
        }
    }

    /**
     * @return array<int, string>
     */
    private function channelMap(mixed $json): array
    {
        return collect($this->decodeObject($json))
            ->filter(fn (mixed $title, mixed $uId): bool => is_numeric($uId) && is_scalar($title) && trim((string) $title) !== '')
            ->mapWithKeys(fn (mixed $title, mixed $uId): array => [(int) $uId => trim((string) $title)])
            ->all();
    }

    /**
     * Legacy array_search() selected the first channel when titles collided.
     *
     * @param  array<int, string>  $channelMap
     * @return array<string, int>
     */
    private function titleToUId(array $channelMap): array
    {
        $result = [];

        foreach ($channelMap as $uId => $title) {
            $result[$title] ??= $uId;
        }

        return $result;
    }

    /**
     * @return list<string>
     */
    private function tagIds(string $tags): array
    {
        preg_match_all('/\[(\d+)\]/', $tags, $matches);

        return array_values(array_map('strval', $matches[1] ?? []));
    }

    /**
     * @return list<mixed>
     */
    private function topicList(array $decoded): array
    {
        foreach (['events', '事件', 'topics', '議題', 'result', 'data'] as $key) {
            if (! array_is_list($decoded) && isset($decoded[$key]) && is_array($decoded[$key])) {
                $decoded = $decoded[$key];
                break;
            }
        }

        return array_is_list($decoded) ? $decoded : array_values($decoded);
    }

    /**
     * @param  list<string>  $keys
     */
    private function text(array $item, array $keys): string
    {
        foreach ($keys as $key) {
            if (isset($item[$key]) && is_scalar($item[$key]) && trim((string) $item[$key]) !== '') {
                return trim((string) $item[$key]);
            }
        }

        return '';
    }

    /**
     * @param  list<string>  $keys
     * @return list<string>
     */
    private function stringList(array $item, array $keys): array
    {
        foreach ($keys as $key) {
            if (! array_key_exists($key, $item)) {
                continue;
            }

            $value = $item[$key];

            if (is_array($value)) {
                return collect($value)
                    ->flatten()
                    ->filter(fn (mixed $entry): bool => is_scalar($entry) && trim((string) $entry) !== '')
                    ->map(fn (mixed $entry): string => trim((string) $entry))
                    ->values()
                    ->all();
            }

            return is_scalar($value) && trim((string) $value) !== '' ? [trim((string) $value)] : [];
        }

        return [];
    }

    /**
     * @return array<string, mixed>
     */
    private function decodeObject(mixed $json): array
    {
        if (! is_string($json) || trim($json) === '') {
            return [];
        }

        $decoded = json_decode($json, true);

        return json_last_error() === JSON_ERROR_NONE && is_array($decoded) ? $decoded : [];
    }

    /**
     * @return array{complete: false, blocked_reason: string, source_truncated: bool, topic: array{}, video: array{}, channel_id: array<int, string>, raw: mixed, topic_count: int, channel_count: int, video_count: int}
     */
    private function blocked(
        mixed $raw,
        array $channelMap,
        string $reason,
        bool $truncated = false,
        int $topicCount = 0,
        int $videoCount = 0,
    ): array {
        return [
            'complete' => false,
            'blocked_reason' => $reason,
            'source_truncated' => $truncated,
            'topic' => [],
            'video' => [],
            'channel_id' => $channelMap,
            'raw' => $raw === [] ? new stdClass : $raw,
            'topic_count' => $topicCount,
            'channel_count' => count($channelMap),
            'video_count' => $videoCount,
        ];
    }
}
