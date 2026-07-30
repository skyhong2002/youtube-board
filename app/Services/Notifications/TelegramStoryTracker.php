<?php

namespace App\Services\Notifications;

use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Throwable;

class TelegramStoryTracker
{
    /**
     * Observe an hourly event and decide whether it represents a publishable
     * first report, update, burst, or resurfacing.
     *
     * @param  array<string, mixed>  $event
     * @param  array<string, mixed>  $context
     * @return array<string, mixed>
     */
    public function evaluate(array $event, array $context, bool $eligible): array
    {
        if (! Schema::hasTable('telegram_digest_stories')) {
            return $this->fallback($event);
        }

        try {
            return DB::transaction(function () use ($event, $context, $eligible): array {
                $now = now();
                $fingerprint = $this->fingerprint($event);
                $videoIds = $this->videoIds($event);
                $videoChannels = $this->videoChannels($event);
                $story = $this->matchingStory($fingerprint, $videoIds, $now);

                if ($story === null) {
                    $storyId = DB::table('telegram_digest_stories')->insertGetId([
                        'story_key' => hash('sha256', $fingerprint['title'].'|'.$now->format('Y-m-d H:i:s.u')),
                        'canonical_title' => mb_substr((string) ($event['title'] ?? ''), 0, 500),
                        'fingerprint_json' => $this->encode($fingerprint),
                        'video_ids_json' => $this->encode($videoIds),
                        'video_channels_json' => $this->encode($videoChannels),
                        'observations_json' => $this->encode([]),
                        'first_seen_at' => $now,
                        'last_seen_at' => $now,
                        'last_posted_at' => null,
                        'last_posted_video_ids_json' => null,
                        'last_posted_channel_ids_json' => null,
                        'post_count' => 0,
                        'created_at' => $now,
                        'updated_at' => $now,
                    ]);
                    $story = DB::table('telegram_digest_stories')->where('id', $storyId)->lockForUpdate()->first();
                } else {
                    $story = DB::table('telegram_digest_stories')->where('id', $story->id)->lockForUpdate()->first();
                }

                $allVideoIds = array_values(array_unique(array_merge(
                    $this->decodeList($story->video_ids_json ?? null),
                    $videoIds,
                )));
                $allVideoChannels = array_merge(
                    $this->decodeMap($story->video_channels_json ?? null),
                    $videoChannels,
                );
                $mergedFingerprint = $this->mergeFingerprint(
                    $this->decodeMap($story->fingerprint_json ?? null),
                    $fingerprint,
                );
                $observations = $this->observations(
                    $this->decodeList($story->observations_json ?? null),
                    $context,
                    count($videoIds),
                    $this->mediaCount($videoChannels),
                );
                $postedVideoIds = $this->decodeList($story->last_posted_video_ids_json ?? null);
                $postedChannelIds = $this->decodeList($story->last_posted_channel_ids_json ?? null);
                $deltaVideoIds = array_values(array_diff($allVideoIds, $postedVideoIds));
                $deltaChannels = $this->channelsForVideos($deltaVideoIds, $allVideoChannels);
                $currentChannels = array_values(array_unique(array_values($videoChannels)));
                $newChannels = array_values(array_diff($deltaChannels, $postedChannelIds));
                $burst = $this->burst($observations, count($videoIds), count($currentChannels));
                $lastPostedAt = $story->last_posted_at ? Carbon::parse((string) $story->last_posted_at) : null;
                $hoursSince = $lastPostedAt?->diffInHours($now, true);
                $decision = $this->decision(
                    firstPostEligible: $eligible,
                    lastPostedAt: $lastPostedAt,
                    hoursSince: $hoursSince,
                    deltaVideos: count($deltaVideoIds),
                    deltaMedia: count($deltaChannels),
                    burst: $burst,
                );

                DB::table('telegram_digest_stories')->where('id', $story->id)->update([
                    'canonical_title' => mb_substr((string) ($event['title'] ?? ''), 0, 500),
                    'fingerprint_json' => $this->encode($mergedFingerprint),
                    'video_ids_json' => $this->encode($allVideoIds),
                    'video_channels_json' => $this->encode($allVideoChannels),
                    'observations_json' => $this->encode($observations),
                    'last_seen_at' => $now,
                    'updated_at' => $now,
                ]);

                return [
                    'story_id' => (int) $story->id,
                    'should_post' => $decision['should_post'],
                    'trigger' => $decision['trigger'],
                    'metric_line' => $this->metricLine(
                        $decision['trigger'],
                        count($videoIds),
                        count($currentChannels),
                        count($deltaVideoIds),
                        count($deltaChannels),
                        $hoursSince,
                    ),
                    'burst_line' => $burst['is_burst']
                        ? sprintf(
                            '近1小時影片%d、媒體%d，為前%d小時均值%s倍',
                            count($videoIds),
                            count($currentChannels),
                            $burst['baseline_hours'],
                            $this->ratio($burst['ratio']),
                        )
                        : '',
                    'delta_video_count' => count($deltaVideoIds),
                    'delta_media_count' => count($deltaChannels),
                    'new_media_count' => count($newChannels),
                    'hours_since_post' => $hoursSince,
                ];
            }, 3);
        } catch (Throwable) {
            return $this->fallback($event);
        }
    }

    public function markPosted(int $storyId): void
    {
        if ($storyId < 1 || ! Schema::hasTable('telegram_digest_stories')) {
            return;
        }

        try {
            DB::transaction(function () use ($storyId): void {
                $story = DB::table('telegram_digest_stories')->where('id', $storyId)->lockForUpdate()->first();

                if (! $story) {
                    return;
                }

                $videoIds = $this->decodeList($story->video_ids_json ?? null);
                $channels = array_values(array_unique(array_values(
                    $this->decodeMap($story->video_channels_json ?? null),
                )));

                DB::table('telegram_digest_stories')->where('id', $storyId)->update([
                    'last_posted_at' => now(),
                    'last_posted_video_ids_json' => $this->encode($videoIds),
                    'last_posted_channel_ids_json' => $this->encode($channels),
                    'post_count' => (int) ($story->post_count ?? 0) + 1,
                    'updated_at' => now(),
                ]);
            }, 3);
        } catch (Throwable) {
            // A state failure must not turn a successful Telegram send into a crash.
        }
    }

    /**
     * Bootstrap durable story state from the previous exact-hour cache during
     * rollout. Repeated cache hits must not keep moving the last-posted time.
     */
    public function rememberExistingPost(int $storyId): void
    {
        if ($storyId < 1 || ! Schema::hasTable('telegram_digest_stories')) {
            return;
        }

        try {
            DB::transaction(function () use ($storyId): void {
                $story = DB::table('telegram_digest_stories')->where('id', $storyId)->lockForUpdate()->first();

                if (! $story || $story->last_posted_at !== null) {
                    return;
                }

                $videoIds = $this->decodeList($story->video_ids_json ?? null);
                $channels = array_values(array_unique(array_values(
                    $this->decodeMap($story->video_channels_json ?? null),
                )));

                DB::table('telegram_digest_stories')->where('id', $storyId)->update([
                    'last_posted_at' => now(),
                    'last_posted_video_ids_json' => $this->encode($videoIds),
                    'last_posted_channel_ids_json' => $this->encode($channels),
                    'post_count' => max(1, (int) ($story->post_count ?? 0)),
                    'updated_at' => now(),
                ]);
            }, 3);
        } catch (Throwable) {
            // The legacy cache still suppresses this exact post if state adoption fails.
        }
    }

    /**
     * @param  array<string, mixed>  $event
     * @return array<string, mixed>
     */
    private function fallback(array $event): array
    {
        return [
            'story_id' => 0,
            // Without durable state we cannot prove that this story was not
            // already pushed in a prior hour, so hourly delivery fails closed.
            'should_post' => false,
            'trigger' => 'tracker_unavailable',
            'metric_line' => sprintf(
                '近1小時　影片%d、媒體%d',
                (int) ($event['video_count'] ?? 0),
                (int) ($event['media_count'] ?? 0),
            ),
            'burst_line' => '',
            'delta_video_count' => (int) ($event['video_count'] ?? 0),
            'delta_media_count' => (int) ($event['media_count'] ?? 0),
            'new_media_count' => (int) ($event['media_count'] ?? 0),
            'hours_since_post' => null,
        ];
    }

    private function decision(
        bool $firstPostEligible,
        ?Carbon $lastPostedAt,
        ?float $hoursSince,
        int $deltaVideos,
        int $deltaMedia,
        array $burst,
    ): array {
        if ($lastPostedAt === null) {
            return [
                'should_post' => $firstPostEligible,
                'trigger' => $firstPostEligible ? 'first' : 'below_threshold',
            ];
        }

        $updateReady = $deltaVideos >= max(1, (int) config('services.telegram.update_min_videos', 5))
            && $deltaMedia >= max(1, (int) config('services.telegram.update_min_media', 2));
        $burstReady = $burst['is_burst']
            && $deltaVideos >= max(1, (int) config('services.telegram.burst_min_new_videos', 4))
            && $hoursSince >= max(1, (int) config('services.telegram.burst_cooldown_hours', 3));

        if ($burstReady) {
            return ['should_post' => true, 'trigger' => 'burst'];
        }

        if (! $updateReady || $hoursSince < max(1, (int) config('services.telegram.update_cooldown_hours', 24))) {
            return ['should_post' => false, 'trigger' => 'cooldown'];
        }

        return [
            'should_post' => true,
            'trigger' => $hoursSince >= max(1, (int) config('services.telegram.resurface_hours', 72))
                ? 'resurfaced'
                : 'update',
        ];
    }

    private function metricLine(
        string $trigger,
        int $currentVideos,
        int $currentMedia,
        int $deltaVideos,
        int $deltaMedia,
        ?float $hoursSince,
    ): string {
        return match ($trigger) {
            'update', 'burst' => sprintf('上次推播後　影片%d、媒體%d', $deltaVideos, $deltaMedia),
            'resurfaced' => sprintf(
                '相隔%d天再度升溫　影片%d、媒體%d',
                max(1, (int) floor(($hoursSince ?? 72) / 24)),
                $deltaVideos,
                $deltaMedia,
            ),
            default => sprintf('近1小時　影片%d、媒體%d', $currentVideos, $currentMedia),
        };
    }

    /**
     * @param  list<array<string, mixed>>  $observations
     * @return array{is_burst: bool, ratio: float|null, baseline_hours: int}
     */
    private function burst(array $observations, int $currentVideos, int $currentMedia): array
    {
        $requiredHours = max(1, (int) config('services.telegram.burst_baseline_hours', 3));
        $prior = array_slice(array_slice($observations, 0, -1), -$requiredHours);
        $baselineHours = count($prior);
        $baseline = $baselineHours > 0
            ? array_sum(array_map(static fn (array $row): int => (int) ($row['video_count'] ?? 0), $prior)) / $baselineHours
            : 0.0;
        $ratio = $baseline > 0 ? $currentVideos / $baseline : null;
        $isBurst = $baselineHours === $requiredHours
            && $ratio !== null
            && $currentVideos >= max(1, (int) config('services.telegram.burst_min_videos', 8))
            && $currentMedia >= max(1, (int) config('services.telegram.burst_min_media', 3))
            && $ratio >= max(1.0, (float) config('services.telegram.burst_ratio', 2.5));

        return ['is_burst' => $isBurst, 'ratio' => $ratio, 'baseline_hours' => $baselineHours];
    }

    /**
     * @param  list<array<string, mixed>>  $observations
     * @param  array<string, mixed>  $context
     * @return list<array<string, mixed>>
     */
    private function observations(
        array $observations,
        array $context,
        int $videoCount,
        int $mediaCount,
    ): array {
        $key = (string) ($context['key'] ?? '');
        $observations = array_values(array_filter(
            $observations,
            static fn (array $row): bool => (string) ($row['context_key'] ?? '') !== $key,
        ));
        $observations[] = [
            'context_key' => $key,
            'observed_at' => (string) ($context['date_from'] ?? now()->format('Y-m-d H:i:s')),
            'video_count' => $videoCount,
            'media_count' => $mediaCount,
        ];

        return array_slice($observations, -24);
    }

    private function matchingStory(array $fingerprint, array $videoIds, Carbon $now): ?object
    {
        $stories = DB::table('telegram_digest_stories')
            ->where('last_seen_at', '>=', $now->copy()->subHours(max(1, (int) config('services.telegram.story_match_hours', 72))))
            ->orderByDesc('last_seen_at')
            ->limit(100)
            ->get();

        foreach ($stories as $story) {
            $existingFingerprint = $this->decodeMap($story->fingerprint_json ?? null);
            $existingVideos = $this->decodeList($story->video_ids_json ?? null);

            if ($this->isMatch($fingerprint, $existingFingerprint, $videoIds, $existingVideos)) {
                return $story;
            }
        }

        return null;
    }

    private function isMatch(array $current, array $existing, array $currentVideos, array $existingVideos): bool
    {
        if (array_intersect($currentVideos, $existingVideos) !== []) {
            return true;
        }

        if (($current['category'] ?? '') !== '' && ($existing['category'] ?? '') !== ''
            && $current['category'] !== $existing['category']) {
            return false;
        }

        if (($current['title'] ?? '') !== '' && $current['title'] === ($existing['title'] ?? '')) {
            return true;
        }

        $sharedPeople = count(array_intersect($current['people'] ?? [], $existing['people'] ?? []));
        $sharedKeywords = count(array_intersect($current['keywords'] ?? [], $existing['keywords'] ?? []));
        $titleSimilarity = $this->jaccard($current['title_grams'] ?? [], $existing['title_grams'] ?? []);

        return ($sharedPeople >= 1 && ($sharedKeywords >= 1 || $titleSimilarity >= 0.25))
            || ($sharedKeywords >= 2 && $titleSimilarity >= 0.2)
            || $titleSimilarity >= 0.55;
    }

    /**
     * @param  array<string, mixed>  $event
     * @return array<string, mixed>
     */
    private function fingerprint(array $event): array
    {
        $title = $this->normalize((string) ($event['title'] ?? ''));

        return [
            'title' => $title,
            'title_grams' => $this->bigrams($title),
            'keywords' => $this->normalizedList((array) ($event['keywords'] ?? [])),
            'people' => $this->normalizedList((array) ($event['people'] ?? [])),
            'places' => $this->normalizedList((array) ($event['places'] ?? [])),
            'category' => $this->normalize((string) ($event['category'] ?? '')),
        ];
    }

    private function mergeFingerprint(array $existing, array $current): array
    {
        foreach (['title_grams', 'keywords', 'people', 'places'] as $key) {
            $current[$key] = array_values(array_unique(array_merge(
                (array) ($existing[$key] ?? []),
                (array) ($current[$key] ?? []),
            )));
        }

        return $current;
    }

    private function normalize(string $value): string
    {
        $value = mb_strtolower(trim($value), 'UTF-8');
        $value = preg_replace('/[\s　[:punct:]]+/u', '', $value) ?? $value;

        return trim(str_replace(['事件', '新聞', '最新', '後續', '焦點'], '', $value));
    }

    /**
     * @return list<string>
     */
    private function bigrams(string $value): array
    {
        $length = mb_strlen($value, 'UTF-8');

        if ($length < 2) {
            return $value !== '' ? [$value] : [];
        }

        $grams = [];
        for ($index = 0; $index < $length - 1; $index++) {
            $grams[] = mb_substr($value, $index, 2, 'UTF-8');
        }

        return array_values(array_unique($grams));
    }

    private function jaccard(array $left, array $right): float
    {
        $union = array_unique(array_merge($left, $right));

        return $union === [] ? 0.0 : count(array_intersect($left, $right)) / count($union);
    }

    /**
     * @return list<string>
     */
    private function normalizedList(array $values): array
    {
        return collect($values)
            ->map(fn (mixed $value): string => $this->normalize((string) $value))
            ->filter(fn (string $value): bool => mb_strlen($value, 'UTF-8') >= 2)
            ->unique()
            ->values()
            ->all();
    }

    /**
     * @param  array<string, mixed>  $event
     * @return list<string>
     */
    private function videoIds(array $event): array
    {
        return array_values(array_unique(array_map('strval', (array) ($event['video_ids'] ?? []))));
    }

    /**
     * @param  array<string, mixed>  $event
     * @return array<string, string>
     */
    private function videoChannels(array $event): array
    {
        $channels = [];
        foreach ((array) ($event['videos'] ?? []) as $video) {
            if (! is_array($video)) {
                continue;
            }

            $videoId = trim((string) ($video['video_id'] ?? ''));
            $channel = (int) ($video['u_id'] ?? 0) > 0
                ? 'u:'.(int) $video['u_id']
                : 'c:'.trim((string) ($video['channel'] ?? ''));

            if ($videoId !== '' && $channel !== 'c:') {
                $channels[$videoId] = $channel;
            }
        }

        return $channels;
    }

    private function mediaCount(array $videoChannels): int
    {
        return count(array_unique(array_values($videoChannels)));
    }

    /**
     * @return list<string>
     */
    private function channelsForVideos(array $videoIds, array $videoChannels): array
    {
        return array_values(array_unique(array_filter(array_map(
            static fn (string $videoId): string => (string) ($videoChannels[$videoId] ?? ''),
            $videoIds,
        ))));
    }

    private function ratio(?float $ratio): string
    {
        return $ratio === null ? '0' : rtrim(rtrim(number_format($ratio, 1, '.', ''), '0'), '.');
    }

    private function encode(mixed $value): string
    {
        return json_encode($value, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
    }

    /**
     * @return list<mixed>
     */
    private function decodeList(mixed $value): array
    {
        $decoded = is_string($value) ? json_decode($value, true) : null;

        return is_array($decoded) && array_is_list($decoded) ? $decoded : [];
    }

    /**
     * @return array<string, mixed>
     */
    private function decodeMap(mixed $value): array
    {
        $decoded = is_string($value) ? json_decode($value, true) : null;

        return is_array($decoded) && ! array_is_list($decoded) ? $decoded : [];
    }
}
