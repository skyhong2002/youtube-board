<?php

namespace App\Services\Notifications;

use Illuminate\Database\QueryException;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;

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
    ) {}

    /**
     * @return array{period: string, considered: int, eligible: int, posted: int, skipped_seen: int, dry_run: bool}
     */
    public function run(string $period, bool $force = false): array
    {
        $period = $period === 'hourly' ? 'hourly' : 'daily';
        $context = $period === 'hourly' ? $this->latestHourly() : $this->latestDaily();

        if ($context === null) {
            return $this->summary($period, 0, 0, 0, 0, ! $this->telegram->isLive());
        }

        [$events, $considered, $eligible] = $this->select($period, $context['events']);

        $fresh = [];
        $skippedSeen = 0;
        $batchSeen = [];
        foreach ($events as $event) {
            $key = $this->seenKey($period, $context['key'], $event['title']);

            // Guard against duplicate titles within one batch too — the cache
            // is only marked after a successful send, so two same-titled events
            // would otherwise both pass the freshness check.
            if (isset($batchSeen[$key]) || (! $force && $this->alreadyPosted($key))) {
                $skippedSeen++;

                continue;
            }
            $batchSeen[$key] = true;
            $fresh[] = $event;
        }

        if ($fresh === []) {
            return $this->summary($period, $considered, $eligible, 0, $skippedSeen, ! $this->telegram->isLive());
        }

        $posted = 0;
        $dryRun = false;
        foreach ($this->render($period, $context, $fresh) as $post) {
            $result = $this->telegram->send($post['html']);
            $dryRun = $dryRun || $result['dry_run'];

            if ($result['sent']) {
                $this->markPosted($this->seenKey($period, $context['key'], $post['title']));
                $posted++;
            }
        }

        return $this->summary($period, $considered, $eligible, $posted, $skippedSeen, $dryRun);
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

        [$events] = $this->select($period, $context['events']);

        return array_map(
            static fn (array $post): string => $post['html'],
            $this->render($period, $context, $events)
        );
    }

    /**
     * Apply the hourly threshold, sort by prominence, and cap per run.
     *
     * @param  list<array<string, mixed>>  $events
     * @return array{0: list<array<string, mixed>>, 1: int, 2: int}
     */
    private function select(string $period, array $events): array
    {
        $considered = count($events);

        if ($period === 'hourly') {
            $minVideos = (int) config('services.telegram.hourly_min_videos', 8);
            $events = array_values(array_filter(
                $events,
                static fn (array $event): bool => $event['video_count'] >= $minVideos
            ));
        }

        usort($events, static fn (array $a, array $b): int => ($b['video_count'] <=> $a['video_count'])
            ?: ($b['media_count'] <=> $a['media_count']));

        // A non-positive cap disables posting for the period entirely.
        $cap = (int) config('services.telegram.'.($period === 'hourly' ? 'hourly_max_posts' : 'daily_max_posts'), 5);
        $events = array_slice($events, 0, max(0, $cap));

        return [$events, $considered, count($events)];
    }

    /**
     * Ground, summarize, and format the given events into ready-to-send posts.
     *
     * @param  array{key: string, url: string, label: string, events: list<array<string, mixed>>}  $context
     * @param  list<array<string, mixed>>  $events
     * @return list<array{title: string, html: string}>
     */
    private function render(string $period, array $context, array $events): array
    {
        foreach ($events as $index => $event) {
            $events[$index]['video_titles'] = $this->videoTitles($event['video_ids']);
        }

        $summaries = $this->writer->summaries(array_map(static fn (array $event): array => [
            'title' => $event['title'],
            'keywords' => $event['keywords'],
            'people' => $event['people'],
            'media' => $event['media'],
            'video_titles' => $event['video_titles'],
            'video_count' => $event['video_count'],
            'media_count' => $event['media_count'],
        ], $events));

        return array_map(fn (array $event): array => [
            'title' => $event['title'],
            'html' => $this->formatter->format([
                'title' => $event['title'],
                'summary' => $summaries[$event['title']] ?? '',
                'keywords' => $event['keywords'],
                'people' => $event['people'],
                'video_count' => $event['video_count'],
                'media_count' => $event['media_count'],
                'url' => $context['url'],
                'label' => $context['label'],
                'breaking' => $period === 'hourly',
            ]),
        ], $events);
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
        $events = $this->enrichFromDataJson($events, $this->decodeObject($row->data_json ?? null));

        return [
            'key' => 'd:'.$date,
            'url' => $this->dashboard('/ai/days/'.$date),
            'label' => $date,
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
        foreach ($items as $item) {
            $item = is_array($item) ? $item : [];
            $title = $this->text($item, ['事件', '議題', '標題', 'event', 'topic', 'title']);
            if ($title === '') {
                continue;
            }

            $videoIds = $this->stringList($item, ['videoId', 'video_id', 'video_ids', 'videos']);
            $media = array_keys($this->arrayValue($item, ['媒體事件', 'media_events', 'mediaEvents']));

            $events[] = [
                'title' => $title,
                'keywords' => $this->stringList($item, ['關鍵字', 'keywords']),
                'people' => $this->stringList($item, ['人物', 'people']),
                'media' => array_values(array_filter(array_map('strval', $media))),
                'video_ids' => $videoIds,
                'video_count' => count($videoIds),
                'media_count' => count($media),
            ];
        }

        return $events;
    }

    /**
     * Enrich daily events with richer per-event stats from data_json when present
     * (keyed by event title): keyword/people names and video/media counts.
     *
     * @param  list<array<string, mixed>>  $events
     * @param  array<string, mixed>  $dataJson
     * @return list<array<string, mixed>>
     */
    private function enrichFromDataJson(array $events, array $dataJson): array
    {
        foreach ($events as $index => $event) {
            $stats = $dataJson[$event['title']] ?? null;
            if (! is_array($stats)) {
                continue;
            }

            $keywords = array_keys($this->arrayValue($stats, ['關鍵字', 'keywords']));
            $people = array_keys($this->arrayValue($stats, ['人物', 'people']));

            if ($keywords !== []) {
                $events[$index]['keywords'] = array_map('strval', $keywords);
            }
            if ($people !== []) {
                $events[$index]['people'] = array_map('strval', $people);
            }
            if (isset($stats['影片數'])) {
                $events[$index]['video_count'] = max($event['video_count'], (int) $stats['影片數']);
            }
            if (isset($stats['媒體數'])) {
                $events[$index]['media_count'] = max($event['media_count'], (int) $stats['媒體數']);
            }
        }

        return $events;
    }

    /**
     * @param  list<string>  $videoIds
     * @return list<string>
     */
    private function videoTitles(array $videoIds): array
    {
        if ($videoIds === []) {
            return [];
        }

        try {
            return DB::table('urt_video')
                ->whereIn('videoId', array_slice($videoIds, 0, 12))
                ->orderByDesc('viewCount')
                ->limit(6)
                ->pluck('title')
                ->map(static fn (mixed $t): string => trim((string) $t))
                ->filter(static fn (string $t): bool => $t !== '')
                ->values()
                ->all();
        } catch (QueryException) {
            return [];
        }
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

    private function dedupStore(): \Illuminate\Contracts\Cache\Repository
    {
        $store = (string) config('services.telegram.dedup_store', 'database');

        return Cache::store($store !== '' ? $store : null);
    }

    private function dashboard(string $path): string
    {
        return (string) config('services.telegram.dashboard_url', 'https://youtube.observe.tw').$path;
    }

    /**
     * @return array{period: string, considered: int, eligible: int, posted: int, skipped_seen: int, dry_run: bool}
     */
    private function summary(string $period, int $considered, int $eligible, int $posted, int $skipped, bool $dryRun): array
    {
        return [
            'period' => $period,
            'considered' => $considered,
            'eligible' => $eligible,
            'posted' => $posted,
            'skipped_seen' => $skipped,
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
