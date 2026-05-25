<?php

namespace App\Services\Legacy;

use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;

class ChannelProfileReport
{
    public function __construct(private readonly LegacyTagFilter $tagFilter)
    {
    }

    /**
     * @return array{available: bool, channel: array<string, mixed>|null, count: array<string, mixed>|null, tags: array<int, array{id: int, name: string}>, ai: array<string, mixed>, trend_available: bool, generated_at: string}
     */
    public function forChannel(int $uId): array
    {
        try {
            $channel = DB::table('urt_channel')->where('u_id', $uId)->first();
            $count = DB::table('urt_count')->where('u_id', $uId)->first();

            if (! $channel) {
                return $this->empty(true);
            }

            $tagNames = $this->tagFilter->tagNames();

            return [
                'available' => true,
                'channel' => [
                    'u_id' => (int) $channel->u_id,
                    'youtube_id' => $channel->youtube_id,
                    'title' => $channel->title ?? 'Unknown channel',
                    'thumbnail' => $channel->thumbnails,
                    'published_at' => $channel->publishedAt ?? null,
                    'description' => $channel->description ?? null,
                    'youtube_url' => 'https://www.youtube.com/channel/'.$channel->youtube_id,
                ],
                'count' => $count ? $this->countRow($count) : null,
                'tags' => $this->tagFilter->tagsFromString($count->tags ?? '', $tagNames),
                'ai' => $this->ai($uId),
                'trend_available' => $this->hasTrendData($uId),
                'generated_at' => now('Asia/Taipei')->format('Y-m-d H:i:s'),
            ];
        } catch (QueryException) {
            return $this->empty(false);
        }
    }

    /**
     * @return array<string, mixed>
     */
    private function countRow(object $count): array
    {
        $viewMonth = (int) ($count->view_month ?? 0);
        $viewWeek = (int) ($count->view_week ?? 0);

        return [
            'view_count' => (int) ($count->viewCount ?? 0),
            'subscriber_count' => (int) ($count->subscriberCount ?? 0),
            'video_count' => (int) ($count->videoCount ?? 0),
            'view_week' => $viewWeek,
            'view_month' => $viewMonth,
            'sub_week' => (int) ($count->sub_week ?? 0),
            'sub_month' => (int) ($count->sub_month ?? 0),
            'video_week' => (int) ($count->video_week ?? 0),
            'video_month' => (int) ($count->video_month ?? 0),
            'growth_percent' => $viewMonth > 0 ? (($viewWeek - $viewMonth / 4) / $viewMonth * 25) : null,
            'tv_rating_base' => (int) ($count->video_week ?? 0) > 0 ? (int) floor($viewWeek / max(1, (int) $count->video_week)) : null,
        ];
    }

    private function hasTrendData(int $uId): bool
    {
        try {
            return DB::table('urt_log')->where('u_id', $uId)->exists();
        } catch (QueryException) {
            return false;
        }
    }

    /**
     * @return array<string, mixed>
     */
    private function ai(int $uId): array
    {
        return [
            'daily' => $this->dailyAi($uId),
            'topic' => $this->typedAi($uId, 'topic'),
            'people' => $this->typedAi($uId, 'people'),
            'aspect' => $this->aspectAi($uId),
        ];
    }

    /**
     * @return array<string, mixed>|null
     */
    private function dailyAi(int $uId): ?array
    {
        $row = DB::table('urt_channel_ai')
            ->where('u_id', $uId)
            ->whereIn('data_type', ['todate', 'oneday'])
            ->whereNull('del_flag')
            ->orderByDesc('pk')
            ->first();

        if (! $row) {
            return null;
        }

        $decoded = $this->decode($row->result_json ?? null);
        $topics = $this->topicItems($decoded);
        $dateFrom = substr((string) $row->date_from, 0, 10);
        $dateTo = substr((string) $row->date_to, 0, 10);

        return [
            'date_from' => $dateFrom,
            'date_to' => $dateTo,
            'data_type' => $row->data_type,
            'video_count' => $this->videoCount($uId, $row->date_from, $row->date_to, $row->data_type),
            'topics' => collect($topics)
                ->map(fn ($item): array => $this->normalizedTopic($item))
                ->filter(fn (array $item): bool => $item['title'] !== '')
                ->values()
                ->all(),
        ];
    }

    private function videoCount(int $uId, ?string $from, ?string $to, ?string $dataType): ?int
    {
        if ($dataType !== 'oneday' || ! $from || ! $to) {
            return null;
        }

        try {
            return DB::table('urt_video')
                ->where('u_id', $uId)
                ->where('publishedAt', '>=', $from)
                ->where('publishedAt', '<=', $to)
                ->count();
        } catch (QueryException) {
            return null;
        }
    }

    /**
     * @return array<string, mixed>|null
     */
    private function typedAi(int $uId, string $type): ?array
    {
        $row = DB::table('urt_channel_ai')
            ->where('u_id', $uId)
            ->where('data_type', $type)
            ->orderByDesc('pk')
            ->first();

        if (! $row || strlen((string) $row->result_json) <= 10) {
            return null;
        }

        $decoded = $this->decode($row->result_json);
        $items = $type === 'people'
            ? $this->itemsByKeys($decoded, ['persons', 'figures', 'people', 'personalities', '人物'])
            : $this->itemsByKeys($decoded, ['topics', 'discussion_topics', '討論主題', 'events', '事件']);

        return [
            'date_from' => $row->date_from,
            'date_to' => $row->date_to,
            'items' => collect($items)
                ->map(fn ($item): array => $type === 'people' ? $this->normalizedPerson($item) : $this->normalizedTopic($item))
                ->filter(fn (array $item): bool => ($item['name'] ?? $item['title'] ?? '') !== '')
                ->values()
                ->all(),
        ];
    }

    /**
     * @return array<int, array{item: string, preference: string, description: string}>|null
     */
    private function aspectAi(int $uId): ?array
    {
        $row = DB::table('urt_channel_ai')
            ->where('u_id', $uId)
            ->where('data_type', 'aspect')
            ->orderByDesc('pk')
            ->first();

        if (! $row || strlen((string) $row->result_json) <= 10) {
            return null;
        }

        return collect($this->flattenItems($this->decode($row->result_json)))
            ->map(fn ($item): array => [
                'item' => $this->text($item, ['項目', 'item', 'name']),
                'preference' => $this->text($item, ['偏好度', 'preference', 'stance']),
                'description' => $this->text($item, ['描述', 'description', 'content']),
            ])
            ->filter(fn (array $item): bool => $item['item'] !== '')
            ->values()
            ->all();
    }

    /**
     * @return array<int, mixed>
     */
    private function topicItems(array $decoded): array
    {
        return $this->itemsByKeys($decoded, ['topics', 'discussion_topics', '討論主題', 'events', '事件']);
    }

    /**
     * @return array<int, mixed>
     */
    private function itemsByKeys(array $decoded, array $keys): array
    {
        if (array_is_list($decoded)) {
            return $decoded;
        }

        foreach ($keys as $key) {
            if (isset($decoded[$key]) && is_array($decoded[$key])) {
                return array_is_list($decoded[$key]) ? $decoded[$key] : array_values($decoded[$key]);
            }
        }

        return array_values($decoded);
    }

    /**
     * @return array<string, mixed>
     */
    private function normalizedTopic(mixed $item): array
    {
        $item = is_array($item) ? $item : [];

        return [
            'title' => $this->text($item, ['事件', '議題', 'topic', '標題', 'title']),
            'description' => $this->text($item, ['描述', 'description', '內容', 'content']),
            'keywords' => $this->stringList($item, ['關鍵字', 'keywords']),
            'people' => $this->stringList($item, ['人物', 'people', 'persons']),
            'video_ids' => $this->stringList($item, ['videoId', 'videoIds', 'videos']),
        ];
    }

    /**
     * @return array{name: string, evaluation: string, content: string, score: int|null}
     */
    private function normalizedPerson(mixed $item): array
    {
        $item = is_array($item) ? $item : [];

        return [
            'name' => $this->text($item, ['name', '人名']),
            'evaluation' => $this->text($item, ['sentiment', '正負面評價', 'evaluation', '評價']),
            'content' => $this->text($item, ['內容', 'content']),
            'score' => $this->nullableInt($item, ['分數', 'score']),
        ];
    }

    private function text(array $item, array $keys): string
    {
        foreach ($keys as $key) {
            if (isset($item[$key]) && ! is_array($item[$key])) {
                return trim((string) $item[$key]);
            }
        }

        return '';
    }

    /**
     * @return array<int, string>
     */
    private function stringList(array $item, array $keys): array
    {
        foreach ($keys as $key) {
            if (! isset($item[$key])) {
                continue;
            }

            if (is_array($item[$key])) {
                return collect($item[$key])
                    ->flatten()
                    ->map(fn ($value): string => trim((string) $value))
                    ->filter()
                    ->values()
                    ->all();
            }

            return collect(explode(',', (string) $item[$key]))
                ->map(fn (string $value): string => trim($value))
                ->filter()
                ->values()
                ->all();
        }

        return [];
    }

    private function nullableInt(array $item, array $keys): ?int
    {
        foreach ($keys as $key) {
            if (isset($item[$key]) && is_numeric($item[$key])) {
                return (int) $item[$key];
            }
        }

        return null;
    }

    /**
     * @return array<int, mixed>
     */
    private function flattenItems(array $decoded): array
    {
        $items = [];

        foreach ($decoded as $value) {
            if (! is_array($value)) {
                continue;
            }

            if (isset($value['項目']) || isset($value['item'])) {
                $items[] = $value;
                continue;
            }

            $items = array_merge($items, $this->flattenItems($value));
        }

        return $items;
    }

    /**
     * @return array<string|int, mixed>
     */
    private function decode(?string $json): array
    {
        if (! is_string($json) || $json === '') {
            return [];
        }

        $decoded = json_decode($json, true);

        return is_array($decoded) ? $decoded : [];
    }

    /**
     * @return array{available: bool, channel: null, count: null, tags: array<int, array{id: int, name: string}>, ai: array<string, mixed>, trend_available: bool, generated_at: string}
     */
    private function empty(bool $available): array
    {
        return [
            'available' => $available,
            'channel' => null,
            'count' => null,
            'tags' => [],
            'ai' => ['daily' => null, 'topic' => null, 'people' => null, 'aspect' => null],
            'trend_available' => false,
            'generated_at' => now('Asia/Taipei')->format('Y-m-d H:i:s'),
        ];
    }
}
