<?php

namespace App\Services\Legacy;

use Illuminate\Database\QueryException;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class AiEventReport
{
    /**
     * @return array{
     *     available: bool,
     *     aipk: int,
     *     event: string,
     *     title: string,
     *     date: string|null,
     *     summary_events: list<array<string, mixed>>,
     *     people: array<string, mixed>|null,
     *     media: array<string, mixed>|null,
     *     videos: list<array<string, string>>,
     *     mode: string,
     *     has_event_ai: bool,
     *     history_available: bool,
     *     generated_at: string
     * }
     */
    public function forRequest(Request $request, int $aipk, string $mode = 'show'): array
    {
        $event = $this->eventName($request->query('event'));

        try {
            $directEvent = $event === '' ? DB::table('urt_ai_event')->where('pk', $aipk)->first() : null;
            $resolvedAipk = $directEvent ? (int) $directEvent->aipk : $aipk;
            $event = $event !== '' ? $event : (string) ($directEvent->event_name ?? '');
            $daily = DB::table('urt_ai_date')->where('pk', $resolvedAipk)->first();
            $summaryRow = $directEvent && ($directEvent->prompt_type ?? null) === 'summary'
                ? $directEvent
                : $this->eventRow($resolvedAipk, $event, 'summary');
            $peopleRow = $this->eventRow($resolvedAipk, $event, 'people');
            $mediaRow = $this->eventRow($resolvedAipk, $event, 'media');
            $summaryEvents = $this->summaryEvents($summaryRow?->result_json);
            $people = $this->people($peopleRow?->result_json);
            $media = $this->media($mediaRow?->result_json);

            return [
                'available' => true,
                'aipk' => $resolvedAipk,
                'event' => $event,
                'title' => $this->title($event, $daily),
                'date' => $daily ? substr((string) $daily->date_to, 0, 10) : ($summaryRow ? substr((string) $summaryRow->date_to, 0, 10) : null),
                'summary_events' => $summaryEvents,
                'people' => $people,
                'media' => $media,
                'videos' => $this->wallVideos($summaryEvents, $people),
                'mode' => in_array($mode, ['show', 'people', 'wall'], true) ? $mode : 'show',
                'has_event_ai' => $summaryRow !== null || $peopleRow !== null || $mediaRow !== null,
                'history_available' => $this->periodTableHasData(),
                'generated_at' => now('Asia/Taipei')->format('Y-m-d H:i:s'),
            ];
        } catch (QueryException) {
            return $this->empty(false, $aipk, $event, $mode);
        }
    }

    private function eventRow(int $aipk, string $event, string $promptType): ?object
    {
        if ($event === '') {
            return DB::table('urt_ai_event')
                ->where('aipk', $aipk)
                ->where('prompt_type', $promptType)
                ->whereNull('del_flag')
                ->orderByDesc('pk')
                ->first();
        }

        return DB::table('urt_ai_event')
            ->where('aipk', $aipk)
            ->where('event_name', $event)
            ->where('prompt_type', $promptType)
            ->whereNull('del_flag')
            ->orderByDesc('pk')
            ->first();
    }

    private function periodTableHasData(): bool
    {
        try {
            return DB::table('urt_ai_period')->exists();
        } catch (QueryException) {
            return false;
        }
    }

    /**
     * @return list<array<string, mixed>>
     */
    private function summaryEvents(mixed $json): array
    {
        $decoded = $this->decodeObject($json);
        $events = $decoded['events'] ?? [];

        if (! is_array($events)) {
            return [];
        }

        return collect($events)
            ->map(function (mixed $event): array {
                $event = is_array($event) ? $event : [];

                return [
                    'event' => $this->text($event, ['event', '事件', 'title']),
                    'description' => $this->text($event, ['description', '描述']),
                    'keywords' => $this->stringList($event, ['keywords', '關鍵字']),
                    'media' => $this->stringList($event, ['media', '媒體']),
                    'facts' => $this->evidenceList($event['fact'] ?? []),
                    'opinions' => $this->opinionList($event['opinion'] ?? []),
                ];
            })
            ->filter(fn (array $event): bool => $event['event'] !== '')
            ->values()
            ->all();
    }

    /**
     * @return array<string, mixed>|null
     */
    private function people(mixed $json): ?array
    {
        $decoded = $this->decodeObject($json);

        if ($decoded === []) {
            return null;
        }

        return [
            'main_subject' => $this->text($decoded, ['main_subject', '主體角色']),
            'supporting' => $this->peopleList($decoded['supporting_persons'] ?? []),
            'opposing' => $this->peopleList($decoded['opposing_persons'] ?? []),
            'other' => $this->peopleList($decoded['other_opinions_persons'] ?? []),
        ];
    }

    /**
     * @return array<string, mixed>|null
     */
    private function media(mixed $json): ?array
    {
        $decoded = $this->decodeObject($json);

        if ($decoded === []) {
            return null;
        }

        return [
            'main_subject' => $this->text($decoded, ['main_subject', '主體角色']),
            'supporting' => $this->mediaList($decoded['supporting_medias'] ?? []),
            'opposing' => $this->mediaList($decoded['opposing_medias'] ?? []),
            'other' => $this->mediaList($decoded['other_opinions_medias'] ?? []),
            'all' => $this->stringList($decoded, ['all_medias', '全部媒體']),
        ];
    }

    /**
     * @return list<array<string, string|null>>
     */
    private function evidenceList(mixed $items): array
    {
        if (! is_array($items)) {
            return [];
        }

        return collect($items)
            ->map(fn (mixed $item): array => [
                'media' => is_array($item) ? $this->text($item, ['media', '媒體']) : '',
                'headline' => is_array($item) ? $this->text($item, ['headline', '標題']) : '',
                'video_id' => is_array($item) ? $this->text($item, ['video_id', 'videoId']) : '',
            ])
            ->filter(fn (array $item): bool => $item['headline'] !== '')
            ->values()
            ->all();
    }

    /**
     * @return list<array<string, string|null>>
     */
    private function opinionList(mixed $items): array
    {
        if (! is_array($items)) {
            return [];
        }

        return collect($items)
            ->map(fn (mixed $item): array => [
                'media' => is_array($item) ? $this->text($item, ['media', '媒體']) : '',
                'stance' => is_array($item) ? $this->text($item, ['stance', '角度', '立場']) : '',
                'intensity' => is_array($item) ? $this->text($item, ['intensity', '強度']) : '',
                'content' => is_array($item) ? $this->text($item, ['content', '內容', 'description']) : '',
                'video_id' => is_array($item) ? $this->text($item, ['video_id', 'videoId']) : '',
            ])
            ->filter(fn (array $item): bool => $item['content'] !== '')
            ->values()
            ->all();
    }

    /**
     * @return list<array<string, mixed>>
     */
    private function peopleList(mixed $items): array
    {
        if (! is_array($items)) {
            return [];
        }

        return collect($items)
            ->map(function (mixed $item): array {
                $item = is_array($item) ? $item : [];
                $videos = $item['videos'] ?? [];
                $firstVideo = is_array($videos) && isset($videos[0]) && is_array($videos[0]) ? $videos[0] : [];

                return [
                    'person' => $this->text($item, ['person', '人物']),
                    'role' => $this->text($item, ['role', '角色']),
                    'stance' => $this->text($item, ['support_or_opposition', '立場']),
                    'strength' => $this->text($item, ['strength', '強度']),
                    'description' => $this->text($item, ['description', '描述']),
                    'video_id' => $this->text($firstVideo, ['video_id', 'videoId']),
                    'media' => $this->text($firstVideo, ['media', '媒體']),
                    'videos' => $this->videosFromList($videos),
                ];
            })
            ->filter(fn (array $item): bool => $item['person'] !== '')
            ->values()
            ->all();
    }

    /**
     * @return list<array<string, string>>
     */
    private function mediaList(mixed $items): array
    {
        if (! is_array($items)) {
            return [];
        }

        return collect($items)
            ->map(function (mixed $item): array {
                $item = is_array($item) ? $item : [];

                return [
                    'media' => $this->text($item, ['media', '媒體']),
                    'stance' => $this->text($item, ['support_or_opposition', '立場']),
                    'strength' => $this->text($item, ['strength', '強度']),
                    'description' => $this->text($item, ['description', '描述']),
                ];
            })
            ->filter(fn (array $item): bool => $item['media'] !== '')
            ->values()
            ->all();
    }

    /**
     * @param list<array<string, mixed>> $summaryEvents
     * @param array<string, mixed>|null $people
     * @return list<array<string, string>>
     */
    private function wallVideos(array $summaryEvents, ?array $people): array
    {
        $videos = [];

        foreach ($summaryEvents as $summary) {
            foreach ([...$summary['facts'], ...$summary['opinions']] as $item) {
                if (($item['video_id'] ?? '') === '') {
                    continue;
                }

                $videos[] = [
                    'video_id' => (string) $item['video_id'],
                    'media' => (string) ($item['media'] ?? ''),
                    'label' => (string) (($item['headline'] ?? '') ?: ($item['content'] ?? '')),
                    'source' => isset($item['headline']) ? 'fact' : 'opinion',
                ];
            }
        }

        if ($people) {
            foreach (['supporting', 'opposing', 'other'] as $section) {
                foreach ($people[$section] ?? [] as $person) {
                    foreach ($person['videos'] ?? [] as $video) {
                        if (($video['video_id'] ?? '') === '') {
                            continue;
                        }

                        $videos[] = [
                            'video_id' => (string) $video['video_id'],
                            'media' => (string) ($video['media'] ?? ''),
                            'label' => (string) ($person['person'] ?? ''),
                            'source' => $section,
                        ];
                    }
                }
            }
        }

        return collect($videos)
            ->unique('video_id')
            ->values()
            ->all();
    }

    /**
     * @return list<array<string, string>>
     */
    private function videosFromList(mixed $videos): array
    {
        if (! is_array($videos)) {
            return [];
        }

        return collect($videos)
            ->map(function (mixed $video): array {
                $video = is_array($video) ? $video : [];

                return [
                    'media' => $this->text($video, ['media', '媒體']),
                    'video_id' => $this->text($video, ['video_id', 'videoId']),
                ];
            })
            ->filter(fn (array $video): bool => $video['video_id'] !== '')
            ->values()
            ->all();
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
     * @param  list<string>  $keys
     */
    private function text(array $item, array $keys): string
    {
        foreach ($keys as $key) {
            if (isset($item[$key]) && is_scalar($item[$key])) {
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
            if (! isset($item[$key])) {
                continue;
            }

            if (is_array($item[$key])) {
                return collect($item[$key])
                    ->flatten()
                    ->filter(fn (mixed $value): bool => is_scalar($value) && trim((string) $value) !== '')
                    ->map(fn (mixed $value): string => trim((string) $value))
                    ->values()
                    ->all();
            }

            if (is_scalar($item[$key]) && trim((string) $item[$key]) !== '') {
                return [trim((string) $item[$key])];
            }
        }

        return [];
    }

    private function eventName(mixed $value): string
    {
        return is_string($value) ? trim($value) : '';
    }

    private function title(string $event, ?object $daily): string
    {
        $date = $daily ? substr((string) $daily->date_to, 0, 10) : null;

        if ($event !== '' && $date) {
            return $event.' 到 '.$date.' 的相關報導';
        }

        return $event !== '' ? $event.' 相關報導' : '事件分析';
    }

    /**
     * @return array{available: bool, aipk: int, event: string, title: string, date: string|null, summary_events: list<array<string, mixed>>, people: array<string, mixed>|null, media: array<string, mixed>|null, videos: list<array<string, string>>, mode: string, has_event_ai: bool, history_available: bool, generated_at: string}
     */
    private function empty(bool $available, int $aipk, string $event, string $mode): array
    {
        return [
            'available' => $available,
            'aipk' => $aipk,
            'event' => $event,
            'title' => $event !== '' ? $event.' 相關報導' : '事件分析',
            'date' => null,
            'summary_events' => [],
            'people' => null,
            'media' => null,
            'videos' => [],
            'mode' => in_array($mode, ['show', 'people', 'wall'], true) ? $mode : 'show',
            'has_event_ai' => false,
            'history_available' => false,
            'generated_at' => now('Asia/Taipei')->format('Y-m-d H:i:s'),
        ];
    }
}
