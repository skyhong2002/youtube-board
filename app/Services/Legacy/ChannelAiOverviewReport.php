<?php

namespace App\Services\Legacy;

use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;

class ChannelAiOverviewReport
{
    /**
     * @return array{
     *     available: bool,
     *     channel: array<string, mixed>|null,
     *     title: string,
     *     prompt: list<string>,
     *     topic: array<string, mixed>|null,
     *     people: array<string, mixed>|null,
     *     aspect: array<string, mixed>|null,
     *     generated_at: string
     * }
     */
    public function forChannel(int $uId): array
    {
        try {
            $channel = $this->channel($uId);

            return [
                'available' => true,
                'channel' => $channel,
                'title' => ($channel['title'] ?? 'Channel').' GPT / AI',
                'prompt' => $this->prompt($channel),
                'topic' => $this->topic($uId),
                'people' => $this->people($uId),
                'aspect' => $this->aspect($uId),
                'generated_at' => now('Asia/Taipei')->format('Y-m-d H:i:s'),
            ];
        } catch (QueryException) {
            return [
                'available' => false,
                'channel' => null,
                'title' => 'Channel GPT / AI',
                'prompt' => [],
                'topic' => null,
                'people' => null,
                'aspect' => null,
                'generated_at' => now('Asia/Taipei')->format('Y-m-d H:i:s'),
            ];
        }
    }

    /**
     * @return array<string, mixed>|null
     */
    private function channel(int $uId): ?array
    {
        $row = DB::table('urt_channel')->where('u_id', $uId)->first();

        if (! $row) {
            return null;
        }

        return [
            'u_id' => (int) $row->u_id,
            'youtube_id' => $row->youtube_id ?? null,
            'title' => $row->title ?? 'Unknown channel',
            'thumbnail' => $row->thumbnails ?? null,
        ];
    }

    /**
     * @param array<string, mixed>|null $channel
     * @return list<string>
     */
    private function prompt(?array $channel): array
    {
        $youtubeId = (string) ($channel['youtube_id'] ?? '');
        $title = (string) ($channel['title'] ?? '這個頻道');
        $url = $youtubeId !== '' ? 'https://www.youtube.com/channel/'.$youtubeId : 'https://www.youtube.com/';

        return [
            '能否列出 '.$url.' 這個 '.$title.' 頻道中最近常討論的 5 到 8 個事件，其中包含強中弱，以及最近常提及的 5 到 8 個人物的好惡整體偏向 (支持與批評那個居多)？ 請用繁中回答，影片列表： '.$url.'/videos',
            '請把上面的回答轉成兩個 JSON，一個 JSON 是其事件，請把標題、內容、強弱分開，另一個人物的 JSON 有五個元素，人名、角色、內容、評價(正負面評價)、分數(評價對應負到正的 0 到 10 分)',
            '這頻道的影片是比較偏向泛藍泛綠泛紅泛白，兩岸角度多以中國或是台灣出發？在國際角度是以中國還是美國為優先呢？',
            '能否把上面的說明，用 JSON 產生，包含政治傾向的四個、兩岸角度與國際角度，各個選項除了內容外，並以 0 到 10 分標示其偏好，這三個 JSON 請包在一起，各是政治、兩岸、國際，內容為項目、描述與偏好度，政治項目為泛藍、泛綠、泛紅、泛白，兩岸的項目是台灣、中國，國際的項目是美國、中國，這些JSON 的元素名與元素資料都是用繁體中文(數字除外)表式：',
        ];
    }

    /**
     * @return array<string, mixed>|null
     */
    private function topic(int $uId): ?array
    {
        $row = $this->latestRow($uId, 'topic');

        if (! $row) {
            return null;
        }

        $decoded = $this->decode((string) ($row->result_json ?? ''));
        $items = $this->itemsByKeys($decoded, ['topics', 'discussion_topics', '討論主題', 'events', '事件']);

        return $this->section($row, collect($items)
            ->map(fn (mixed $item): array => $this->normalizedTopic($item))
            ->filter(fn (array $item): bool => $item['title'] !== '')
            ->values()
            ->all());
    }

    /**
     * @return array<string, mixed>|null
     */
    private function people(int $uId): ?array
    {
        $row = $this->latestRow($uId, 'people');

        if (! $row) {
            return null;
        }

        $decoded = $this->decode((string) ($row->result_json ?? ''));
        $items = $this->itemsByKeys($decoded, ['persons', 'figures', 'people', 'personalities', '人物']);

        return $this->section($row, collect($items)
            ->map(fn (mixed $item): array => $this->normalizedPerson($item))
            ->filter(fn (array $item): bool => $item['name'] !== '')
            ->values()
            ->all());
    }

    /**
     * @return array<string, mixed>|null
     */
    private function aspect(int $uId): ?array
    {
        $row = $this->latestRow($uId, 'aspect');

        if (! $row) {
            return null;
        }

        $decoded = $this->decode((string) ($row->result_json ?? ''));
        $groups = [];

        foreach ($decoded as $group => $items) {
            if (! is_array($items)) {
                continue;
            }

            $normalized = collect(array_is_list($items) ? $items : array_values($items))
                ->map(fn (mixed $item): array => $this->normalizedAspect($item))
                ->filter(fn (array $item): bool => $item['item'] !== '')
                ->values()
                ->all();

            if ($normalized !== []) {
                $groups[] = [
                    'name' => (string) $group,
                    'items' => $normalized,
                ];
            }
        }

        if ($groups === []) {
            $flat = collect($this->flattenItems($decoded))
                ->map(fn (mixed $item): array => $this->normalizedAspect($item))
                ->filter(fn (array $item): bool => $item['item'] !== '')
                ->values()
                ->all();

            if ($flat !== []) {
                $groups[] = ['name' => '立場', 'items' => $flat];
            }
        }

        return $this->section($row, $groups);
    }

    private function latestRow(int $uId, string $type): ?object
    {
        return DB::table('urt_channel_ai')
            ->where('u_id', $uId)
            ->where('data_type', $type)
            ->whereRaw('length(result_json) > 10')
            ->whereNull('del_flag')
            ->orderByDesc('pk')
            ->first();
    }

    /**
     * @param list<array<string, mixed>> $items
     * @return array<string, mixed>
     */
    private function section(object $row, array $items): array
    {
        return [
            'row' => [
                'pk' => (int) ($row->pk ?? 0),
                'data_type' => (string) ($row->data_type ?? ''),
                'ai_type' => (string) ($row->ai_type ?? ''),
                'ctime' => $row->ctime ?? null,
                'date_from' => $row->date_from ?? null,
                'date_to' => $row->date_to ?? null,
            ],
            'items' => $items,
        ];
    }

    /**
     * @return list<mixed>
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
     * @return array{title: string, content: string, strength: string}
     */
    private function normalizedTopic(mixed $item): array
    {
        $item = is_array($item) ? $item : [];

        return [
            'title' => $this->text($item, ['標題', '事件', '議題', 'topic', 'title']),
            'content' => $this->text($item, ['內容', '描述', 'content', 'description']),
            'strength' => $this->text($item, ['強弱', 'strength', 'intensity']),
        ];
    }

    /**
     * @return array{name: string, role: string, content: string, evaluation: string, score: int|null}
     */
    private function normalizedPerson(mixed $item): array
    {
        $item = is_array($item) ? $item : [];

        return [
            'name' => $this->text($item, ['人名', 'name']),
            'role' => $this->text($item, ['角色', 'role']),
            'content' => $this->text($item, ['內容', 'content']),
            'evaluation' => $this->text($item, ['評價', '正負面評價', 'evaluation', 'sentiment']),
            'score' => $this->nullableInt($item, ['分數', 'score']),
        ];
    }

    /**
     * @return array{item: string, description: string, preference: int|null}
     */
    private function normalizedAspect(mixed $item): array
    {
        $item = is_array($item) ? $item : [];

        return [
            'item' => $this->text($item, ['項目', 'item', 'name']),
            'description' => $this->text($item, ['描述', 'description', 'content']),
            'preference' => $this->nullableInt($item, ['偏好度', 'preference', 'score', 'value']),
        ];
    }

    /**
     * @return list<array<string, mixed>>
     */
    private function flattenItems(array $decoded): array
    {
        $items = [];

        foreach ($decoded as $value) {
            if (! is_array($value)) {
                continue;
            }

            if (isset($value['項目']) || isset($value['item']) || isset($value['name'])) {
                $items[] = $value;
                continue;
            }

            $items = array_merge($items, $this->flattenItems($value));
        }

        return $items;
    }

    private function text(array $item, array $keys): string
    {
        foreach ($keys as $key) {
            if (isset($item[$key]) && is_scalar($item[$key])) {
                return trim((string) $item[$key]);
            }
        }

        return '';
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
     * @return array<string|int, mixed>
     */
    private function decode(string $json): array
    {
        if (trim($json) === '') {
            return [];
        }

        $decoded = json_decode($json, true);

        return is_array($decoded) ? $decoded : [];
    }
}
