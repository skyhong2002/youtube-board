<?php

namespace App\Services\Notifications;

use App\Services\Legacy\AiTopicProjector;
use Illuminate\Contracts\Cache\Repository;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * Selects the most notable events from the latest daily/hourly AI summary,
 * has {@see EventNewsWriter} write a news brief for each, and posts one Telegram
 * message per event (hn_best_cht style) via {@see TelegramClient}.
 *
 * Dedup: an event is only marked "seen" after a real send, so a dry-run never
 * suppresses the first live post. Hourly runs only publish "重大事件" — events
 * whose video count clears the configured floor.
 */
class TelegramDigestBroadcaster
{
    public function __construct(
        private EventNewsWriter $writer,
        private TelegramClient $telegram,
        private TelegramDigestFormatter $formatter,
        private TelegramEventEnricher $enricher,
        private TelegramStoryTracker $stories,
        private TelegramDailyDispatchGate $dailyDispatch,
        private TelegramVideoRanker $videoRanker,
        private AiTopicProjector $topicProjector,
    ) {}

    /**
     * @return array{period: string, considered: int, eligible: int, posted: int, skipped_seen: int, skipped_incomplete: int, dry_run: bool}
     */
    public function run(string $period, bool $force = false): array
    {
        $period = $period === 'hourly' ? 'hourly' : 'daily';
        $context = $period === 'hourly' ? $this->latestHourly() : $this->latestDaily();

        if ($context === null) {
            return $this->summary($period, 0, 0, 0, 0, 0, ! $this->telegram->isLive());
        }

        if ($period === 'daily') {
            if ($this->dailyDispatch->completed($context['key'])) {
                return $this->summary($period, count($context['events']), 0, 0, 1, 0, ! $this->telegram->isLive());
            }

            foreach ($context['events'] as $event) {
                if ($this->alreadyPosted($this->seenKey($period, $context['key'], (string) $event['title']))) {
                    $this->dailyDispatch->adopt($context['key']);

                    return $this->summary($period, count($context['events']), 0, 0, 1, 0, ! $this->telegram->isLive());
                }
            }
        }

        [$events, $considered, $eligible] = $this->prepare($period, $context['events']);

        $fresh = [];
        $skippedSeen = 0;
        $batchSeen = [];
        $batchStories = [];
        foreach ($events as $event) {
            $eventEligible = $period !== 'hourly'
                || $event['video_count'] >= (int) config('services.telegram.hourly_min_videos', 8);
            $key = $this->seenKey($period, $context['key'], $event['title']);
            $decision = $this->stories->evaluate($event, $context, $eventEligible, $period);

            $storyId = (int) ($decision['story_id'] ?? 0);

            // The AI can emit title variants for one event in the same row.
            // Story-level batch dedup catches those even when exact titles differ.
            if (isset($batchSeen[$key]) || ($storyId > 0 && isset($batchStories[$storyId]))) {
                $skippedSeen++;

                continue;
            }
            $batchSeen[$key] = true;
            if ($storyId > 0) {
                $batchStories[$storyId] = true;
            }

            if (! $force && $this->alreadyPosted($key)) {
                if ($period === 'hourly') {
                    $this->stories->rememberExistingPost($storyId);
                }
                $skippedSeen++;

                continue;
            }

            if (! $force && ! ($decision['should_post'] ?? false)) {
                $skippedSeen++;

                continue;
            }

            $event['dispatch'] = $decision;
            $fresh[] = $event;
        }

        $cap = max(0, (int) config(
            'services.telegram.'.($period === 'hourly' ? 'hourly_max_posts' : 'daily_max_posts'),
            5,
        ));

        if ($fresh === []) {
            return $this->summary($period, $considered, $eligible, 0, $skippedSeen, 0, ! $this->telegram->isLive());
        }

        $rendered = $this->render($period, $context, $fresh);
        $skippedIncomplete = count(array_filter(
            $rendered,
            static fn (array $post): bool => ! $post['complete'],
        ));
        $posts = array_values(array_filter(
            $rendered,
            static fn (array $post): bool => $post['complete'],
        ));
        $posts = array_slice($posts, 0, $period === 'daily' ? min(1, $cap) : $cap);

        if ($posts === []) {
            return $this->summary(
                $period,
                $considered,
                $eligible,
                0,
                $skippedSeen,
                $skippedIncomplete,
                ! $this->telegram->isLive(),
            );
        }

        $posted = 0;
        $dryRun = false;
        foreach ($posts as $post) {
            if ($period === 'daily' && $this->telegram->isLive()
                && ! $this->dailyDispatch->claim($context['key'], (int) $post['story_id'], $post['html'])) {
                $skippedSeen++;

                continue;
            }

            $result = $this->telegram->send($post['html'], $post['preview_url']);
            $dryRun = $dryRun || $result['dry_run'];

            if ($result['sent']) {
                $this->markPosted($this->seenKey($period, $context['key'], $post['title']));
                $this->stories->markPosted((int) $post['story_id']);
                if ($period === 'daily') {
                    $this->dailyDispatch->markSent($context['key']);
                }
                $posted++;
            } else {
                if (! $result['dry_run']) {
                    Log::warning('Telegram digest send failed.', [
                        'period' => $period,
                        'story_id' => (int) $post['story_id'],
                        'uncertain' => (bool) ($result['uncertain'] ?? false),
                        'error' => $result['error'],
                    ]);
                }

                if ($period === 'daily' && ! ($result['uncertain'] ?? false)) {
                    $this->dailyDispatch->releaseFailed($context['key']);
                }
            }
        }

        return $this->summary(
            $period,
            $considered,
            $eligible,
            $posted,
            $skippedSeen,
            $skippedIncomplete,
            $dryRun,
        );
    }

    /**
     * Render the messages that would be posted, without sending or marking them
     * seen. Used for pre-go-live sampling (`--dry-run`).
     *
     * @return list<string>
     */
    public function preview(string $period): array
    {
        $period = $period === 'hourly' ? 'hourly' : 'daily';
        $context = $period === 'hourly' ? $this->latestHourly() : $this->latestDaily();

        if ($context === null) {
            return [];
        }

        [$events] = $this->prepare($period, $context['events']);
        $events = array_values(array_filter(
            $events,
            fn (array $event): bool => $period !== 'hourly'
                || $event['video_count'] >= (int) config('services.telegram.hourly_min_videos', 8),
        ));

        foreach ($events as $index => $event) {
            $events[$index]['dispatch'] = [
                'story_id' => 0,
                'metric_line' => sprintf(
                    $period === 'daily'
                        ? '昨日整理　影片%d、媒體%d'
                        : '近1小時　影片%d、媒體%d',
                    $event['video_count'],
                    $event['media_count'],
                ),
                'burst_line' => '',
            ];
        }

        $posts = array_values(array_filter(
            $this->render($period, $context, $events),
            static fn (array $post): bool => $post['complete'],
        ));
        $cap = max(0, (int) config(
            'services.telegram.'.($period === 'hourly' ? 'hourly_max_posts' : 'daily_max_posts'),
            5,
        ));
        $posts = array_slice($posts, 0, $period === 'daily' ? min(1, $cap) : $cap);

        return array_map(
            static fn (array $post): string => $post['html'],
            $posts,
        );
    }

    /**
     * Resolve source metadata and sort by prominence. The cap is applied only
     * after novelty checks so a covered top event cannot starve a new one.
     *
     * @param  list<array<string, mixed>>  $events
     * @return array{0: list<array<string, mixed>>, 1: int, 2: int}
     */
    private function prepare(string $period, array $events): array
    {
        $considered = count($events);
        $events = array_map($this->enricher->enrich(...), $events);

        usort($events, static function (array $a, array $b) use ($period): int {
            if ($period === 'daily') {
                $groupDiversity = static fn (array $event): int => collect((array) ($event['videos'] ?? []))
                    ->map(static fn (mixed $video): string => is_array($video)
                        ? trim((string) ($video['group'] ?? ''))
                        : '')
                    ->filter(static fn (string $group): bool => $group !== '' && $group !== '其他')
                    ->unique()
                    ->count();

                return ($b['media_count'] <=> $a['media_count'])
                    ?: ($b['video_count'] <=> $a['video_count'])
                    ?: ($groupDiversity($b) <=> $groupDiversity($a))
                    ?: (array_sum(array_map(
                        static fn (array $video): int => max(0, (int) ($video['view_count'] ?? 0)),
                        $b['videos'],
                    )) <=> array_sum(array_map(
                        static fn (array $video): int => max(0, (int) ($video['view_count'] ?? 0)),
                        $a['videos'],
                    )))
                    ?: (($a['source_position'] ?? 0) <=> ($b['source_position'] ?? 0));
            }

            return ($b['video_count'] <=> $a['video_count'])
                ?: ($b['media_count'] <=> $a['media_count']);
        });

        $eligible = $period === 'hourly'
            ? count(array_filter(
                $events,
                fn (array $event): bool => $event['video_count'] >= (int) config('services.telegram.hourly_min_videos', 8),
            ))
            : count($events);

        return [$events, $considered, $eligible];
    }

    /**
     * Ground, summarize, and format the given events into ready-to-send posts.
     *
     * @param  array{key: string, url: string, label: string, events: list<array<string, mixed>>}  $context
     * @param  list<array<string, mixed>>  $events
     * @return list<array{title: string, html: string, preview_url: string|null, story_id: int, complete: bool, event: array<string, mixed>}>
     */
    private function render(string $period, array $context, array $events): array
    {
        foreach ($events as $index => $event) {
            $events[$index]['recommendations'] = $this->videoRanker->select($event);
        }

        $summaries = $this->writer->summaries(array_map(static fn (array $event): array => [
            'title' => $event['title'],
            'description' => $event['description'],
            'category' => $event['category'],
            'angle' => $event['angle'],
            'camp' => $event['camp'],
            'keywords' => $event['keywords'],
            'people' => $event['people'],
            'places' => $event['places'],
            'media' => $event['media'],
            'media_reports' => $event['media_reports'] ?? [],
            'videos' => array_map(static fn (array $video): array => [
                'video_id' => $video['video_id'],
                'title' => $video['title'],
                'channel' => $video['channel'],
                'channel_tags' => $video['tags'],
                'view_count' => $video['view_count'],
            ], array_slice($event['videos'], 0, 18)),
            'video_count' => $event['video_count'],
            'media_count' => $event['media_count'],
        ], $events));

        return array_map(function (array $event) use ($period, $context, $summaries): array {
            $summary = trim((string) ($summaries[$event['title']] ?? ''));
            $previewUrl = trim((string) data_get($event, 'recommendations.0.url', '')) ?: null;

            return [
                'title' => $event['title'],
                'html' => $this->formatter->format([
                    'title' => $event['title'],
                    'summary' => $summary,
                    'description' => $event['description'],
                    'category' => $event['category'],
                    'angle' => $event['angle'],
                    'camp' => $event['camp'],
                    'keywords' => $event['keywords'],
                    'people' => $event['people'],
                    'places' => $event['places'],
                    'video_count' => $event['video_count'],
                    'media_count' => $event['media_count'],
                    'channel_tag_counts' => $event['channel_tag_counts'],
                    'videos' => $event['videos'],
                    'recommendations' => $event['recommendations'],
                    'metric_line' => (string) data_get($event, 'dispatch.metric_line', ''),
                    'burst_line' => (string) data_get($event, 'dispatch.burst_line', ''),
                    'url' => $context['url'],
                    'label' => $context['label'],
                ]),
                'preview_url' => $previewUrl,
                'story_id' => (int) data_get($event, 'dispatch.story_id', 0),
                'complete' => $this->complete($period, $event, $summary, $previewUrl),
                'event' => $event,
            ];
        }, $events);
    }

    /**
     * @param  array<string, mixed>  $event
     */
    private function complete(string $period, array $event, string $summary, ?string $previewUrl): bool
    {
        $channels = collect((array) ($event['videos'] ?? []))
            ->filter(fn (mixed $video): bool => is_array($video) && trim((string) ($video['channel'] ?? '')) !== '')
            ->map(fn (array $video): string => (int) ($video['u_id'] ?? 0) > 0
                ? 'u:'.(int) $video['u_id']
                : 'c:'.trim((string) $video['channel']))
            ->unique()
            ->count();
        $mediaReports = collect((array) ($event['media_reports'] ?? []))
            ->filter(fn (mixed $report): bool => is_array($report)
                && trim((string) ($report['channel'] ?? '')) !== '')
            ->map(fn (array $report): string => (int) ($report['u_id'] ?? 0) > 0
                ? 'u:'.(int) $report['u_id']
                : 'c:'.trim((string) $report['channel']))
            ->unique()
            ->count();

        return count((array) ($event['videos'] ?? [])) >= 3
            && $channels >= 2
            && count((array) ($event['recommendations'] ?? [])) >= 2
            && $summary !== ''
            && is_string($previewUrl)
            && str_starts_with($previewUrl, 'https://www.youtube.com/watch?v=')
            && ($period !== 'daily' || $mediaReports >= 2);
    }

    /**
     * @return array{key: string, url: string, label: string, events: list<array<string, mixed>>}|null
     */
    private function latestDaily(): ?array
    {
        try {
            $row = DB::table('urt_ai_date')
                ->whereNull('del_flag')
                // urt_ai_date also stores week/period aggregates; the daily
                // digest must only ever publish a daily-shaped row.
                ->whereIn('data_type', ['oneday', 'todate'])
                ->where(function ($q): void {
                    $q->whereNull('condition_type')->orWhere('condition_type', 'all');
                })
                ->orderByDesc('date_from')
                ->orderByDesc('pk')
                ->first();
        } catch (QueryException) {
            return null;
        }

        if ($row === null) {
            return null;
        }

        $date = substr((string) $row->date_from, 0, 10);
        $events = $this->normalizeEvents($this->decodeList($row->result_json ?? null));
        $cached = $this->topicProjector->cached($row);
        $topicData = is_array($cached) ? (array) ($cached['topic'] ?? []) : [];

        if (! $this->usableDailyProjection($events, $topicData)) {
            $projection = $this->topicProjector->project($row, 100, 100, 5000);
            if (! $projection['complete']) {
                Log::warning('Telegram daily digest projection is incomplete.', [
                    'pk' => (int) ($row->pk ?? 0),
                    'blocked_reason' => $projection['blocked_reason'],
                ]);

                return null;
            }
            $topicData = $projection['topic'];
        }

        $events = $this->hydrateDailyEvents($events, $topicData);

        return [
            'key' => 'd:'.$date,
            'url' => $this->dashboard('/ai/days/'.$date),
            'label' => $date,
            'date_from' => (string) $row->date_from,
            'events' => $events,
        ];
    }

    /**
     * @return array{key: string, url: string, label: string, events: list<array<string, mixed>>}|null
     */
    private function latestHourly(): ?array
    {
        try {
            $row = DB::table('urt_ai_hour')
                ->whereNull('del_flag')
                ->where(function ($q): void {
                    $q->whereNull('condition_type')->orWhere('condition_type', 'all');
                })
                ->orderByDesc('date_from')
                ->orderByDesc('pk')
                ->first();
        } catch (QueryException) {
            return null;
        }

        if ($row === null) {
            return null;
        }

        $from = (string) $row->date_from;
        $date = substr($from, 0, 10);
        $hour = substr($from, 11, 2);

        return [
            'key' => 'h:'.$from,
            'url' => $this->dashboard('/ai/hours?date='.$date),
            'label' => $date.' '.$hour.'時',
            'date_from' => $from,
            'events' => $this->normalizeEvents($this->decodeList($row->result_json ?? null)),
        ];
    }

    /**
     * @param  list<mixed>  $items
     * @return list<array<string, mixed>>
     */
    private function normalizeEvents(array $items): array
    {
        $events = [];
        foreach ($items as $sourcePosition => $item) {
            $item = is_array($item) ? $item : [];
            $title = $this->text($item, ['事件', '議題', '標題', 'event', 'topic', 'title']);
            if ($title === '') {
                continue;
            }

            $videoIds = $this->stringList($item, ['videoId', 'video_id', 'video_ids', 'videos']);
            $media = array_keys($this->arrayValue($item, ['媒體事件', 'media_events', 'mediaEvents']));

            $events[] = [
                'title' => $title,
                'description' => $this->text($item, ['描述', '說明', 'description', 'content']),
                'category' => $this->textOrFirst($item, ['分類', '類型', 'category', 'type']),
                'angle' => $this->text($item, ['角度', 'angle']),
                'camp' => $this->text($item, ['陣營', 'camp', 'stance']),
                'keywords' => $this->stringList($item, ['關鍵字', 'keywords']),
                'people' => $this->stringList($item, ['人物', 'people']),
                'places' => $this->stringList($item, ['地名', 'places']),
                'media' => array_values(array_filter(array_map('strval', $media))),
                'media_reports' => [],
                'video_ids' => $videoIds,
                'video_count' => count($videoIds),
                'media_count' => count($media),
                'source_position' => $sourcePosition,
            ];
        }

        return $events;
    }

    private function usableDailyProjection(array $events, array $topicData): bool
    {
        if ($events === [] || $topicData === []) {
            return false;
        }

        foreach ($events as $event) {
            $stats = $topicData[$event['title']] ?? null;
            if (! is_array($stats)
                || ! is_array($stats['videos'] ?? null)
                || ($stats['videos'] ?? []) === []
                || ! is_array($stats['媒體明細'] ?? null)
                || ($stats['媒體明細'] ?? []) === []) {
                return false;
            }
        }

        return true;
    }

    /**
     * @param  list<array<string, mixed>>  $events
     * @param  array<string, array<string, mixed>>  $topicData
     * @return list<array<string, mixed>>
     */
    private function hydrateDailyEvents(array $events, array $topicData): array
    {
        foreach ($events as $index => $event) {
            $stats = (array) ($topicData[$event['title']] ?? []);
            $mediaReports = collect((array) ($stats['媒體明細'] ?? []))
                ->filter(fn (mixed $report): bool => is_array($report))
                ->map(fn (array $report): array => [
                    'u_id' => (int) ($report['u_id'] ?? 0),
                    'channel' => trim((string) ($report['媒體'] ?? '')),
                    'event' => trim((string) ($report['事件'] ?? '')),
                    'description' => trim((string) ($report['描述'] ?? '')),
                    'category' => trim((string) ($report['分類'] ?? '')),
                    'angle' => trim((string) ($report['角度'] ?? '')),
                    'camp' => trim((string) ($report['陣營'] ?? '')),
                    'keywords' => $this->scalarList($report['關鍵字'] ?? []),
                    'people' => $this->scalarList($report['人物'] ?? []),
                    'places' => $this->scalarList($report['地名'] ?? []),
                    'video_ids' => $this->scalarList($report['videoId'] ?? []),
                ])
                ->values()
                ->all();
            $videoIds = collect((array) ($stats['videos'] ?? []))
                ->flatten()
                ->filter(fn (mixed $videoId): bool => is_scalar($videoId) && trim((string) $videoId) !== '')
                ->map(fn (mixed $videoId): string => trim((string) $videoId))
                ->unique()
                ->values()
                ->all();

            $events[$index]['video_ids'] = $videoIds;
            $events[$index]['video_count'] = count($videoIds);
            $events[$index]['media_count'] = max(
                count(array_unique(array_filter(array_column($mediaReports, 'channel')))),
                (int) ($stats['媒體數'] ?? 0),
            );
            $events[$index]['media_reports'] = $mediaReports;
            $events[$index]['keywords'] = $this->countedKeys($stats['關鍵字'] ?? []);
            $events[$index]['people'] = $this->countedKeys($stats['人物'] ?? []);
            $events[$index]['places'] = $this->countedKeys($stats['地名'] ?? []);
            $events[$index]['angle'] = implode('、', $this->countedKeys($stats['角度'] ?? [], 2));
            $events[$index]['camp'] = implode('、', $this->countedKeys($stats['陣營'] ?? [], 4));
            $events[$index]['category'] = $this->mostCommon(array_column($mediaReports, 'category'));
        }

        return $events;
    }

    /**
     * @return list<string>
     */
    private function countedKeys(mixed $counts, int $limit = 8): array
    {
        if (! is_array($counts)) {
            return [];
        }

        arsort($counts);

        return collect(array_keys($counts))
            ->filter(fn (mixed $value): bool => is_scalar($value) && trim((string) $value) !== '')
            ->map(fn (mixed $value): string => trim((string) $value))
            ->take($limit)
            ->values()
            ->all();
    }

    /**
     * @return list<string>
     */
    private function scalarList(mixed $values): array
    {
        return collect(is_array($values) ? $values : [])
            ->flatten()
            ->filter(fn (mixed $value): bool => is_scalar($value) && trim((string) $value) !== '')
            ->map(fn (mixed $value): string => trim((string) $value))
            ->unique()
            ->values()
            ->all();
    }

    private function mostCommon(array $values): string
    {
        $counts = array_count_values(array_values(array_filter(
            array_map(static fn (mixed $value): string => trim((string) $value), $values),
        )));
        arsort($counts);

        return (string) (array_key_first($counts) ?? '');
    }

    private function seenKey(string $period, string $contextKey, string $title): string
    {
        return 'tg:digest:'.$period.':'.$contextKey.':'.md5($title);
    }

    /**
     * Dedup lives in a store SHARED by the web + scheduler containers (default:
     * the database cache), so a post from one container is not re-sent by the
     * other. A store failure fails open (allow the post) rather than crash.
     */
    private function alreadyPosted(string $key): bool
    {
        try {
            return $this->dedupStore()->has($key);
        } catch (\Throwable) {
            return false;
        }
    }

    private function markPosted(string $key): void
    {
        try {
            $this->dedupStore()->put($key, true, now()->addDays(3));
        } catch (\Throwable) {
            // best-effort; a missed mark only risks a later duplicate, never a crash
        }
    }

    private function dedupStore(): Repository
    {
        $store = (string) config('services.telegram.dedup_store', 'database');

        return Cache::store($store !== '' ? $store : null);
    }

    private function dashboard(string $path): string
    {
        return (string) config('services.telegram.dashboard_url', 'https://youtube.observe.tw').$path;
    }

    /**
     * @return array{period: string, considered: int, eligible: int, posted: int, skipped_seen: int, skipped_incomplete: int, dry_run: bool}
     */
    private function summary(
        string $period,
        int $considered,
        int $eligible,
        int $posted,
        int $skipped,
        int $skippedIncomplete,
        bool $dryRun,
    ): array {
        return [
            'period' => $period,
            'considered' => $considered,
            'eligible' => $eligible,
            'posted' => $posted,
            'skipped_seen' => $skipped,
            'skipped_incomplete' => $skippedIncomplete,
            'dry_run' => $dryRun,
        ];
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
     */
    private function textOrFirst(array $item, array $keys): string
    {
        $text = $this->text($item, $keys);

        return $text !== '' ? $text : ($this->stringList($item, $keys)[0] ?? '');
    }

    /**
     * @param  list<string>  $keys
     * @return list<string>
     */
    private function stringList(array $item, array $keys): array
    {
        foreach ($keys as $key) {
            if (isset($item[$key]) && is_array($item[$key])) {
                return array_values(array_filter(
                    array_map(static fn (mixed $v): string => is_scalar($v) ? trim((string) $v) : '', $item[$key]),
                    static fn (string $v): bool => $v !== ''
                ));
            }
        }

        return [];
    }

    /**
     * @param  list<string>  $keys
     * @return array<string, mixed>
     */
    private function arrayValue(array $item, array $keys): array
    {
        foreach ($keys as $key) {
            if (isset($item[$key]) && is_array($item[$key])) {
                return $item[$key];
            }
        }

        return [];
    }

    /**
     * @return list<mixed>
     */
    private function decodeList(mixed $json): array
    {
        $decoded = json_decode((string) $json, true);

        return is_array($decoded) ? array_values($decoded) : [];
    }

    /**
     * @return array<string, mixed>
     */
    private function decodeObject(mixed $json): array
    {
        $decoded = json_decode((string) $json, true);

        return is_array($decoded) ? $decoded : [];
    }
}
