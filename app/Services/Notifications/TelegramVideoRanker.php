<?php

namespace App\Services\Notifications;

class TelegramVideoRanker
{
    private const DIVERSITY_GROUPS = [
        '泛綠', '泛藍', '泛白', '泛紅', '較無偏', '中立', '公共電視', '公共媒體',
    ];

    /**
     * @param  array<string, mixed>  $event
     * @return list<array<string, mixed>>
     */
    public function select(array $event, int $limit = 3): array
    {
        $videos = array_values(array_filter(
            (array) ($event['videos'] ?? []),
            static fn (mixed $video): bool => is_array($video)
                && trim((string) ($video['title'] ?? '')) !== ''
                && trim((string) ($video['url'] ?? '')) !== ''
                && trim((string) ($video['channel'] ?? '')) !== '',
        ));
        $limit = max(0, min(3, $limit));

        if ($videos === [] || $limit === 0) {
            return [];
        }

        $maxViews = max(0, ...array_map(
            static fn (array $video): int => max(0, (int) ($video['view_count'] ?? 0)),
            $videos,
        ));
        $eventTitle = (string) ($event['title'] ?? '');
        $keywords = array_values(array_filter(array_map(
            fn (mixed $keyword): string => $this->normalize((string) $keyword),
            (array) ($event['keywords'] ?? []),
        )));

        foreach ($videos as $index => $video) {
            $videoTitle = (string) $video['title'];
            $normalizedTitle = $this->normalize($videoTitle);
            $covered = count(array_filter(
                $keywords,
                static fn (string $keyword): bool => $keyword !== '' && str_contains($normalizedTitle, $keyword),
            ));
            $keywordCoverage = $keywords === [] ? 0.0 : $covered / count($keywords);
            $popularity = $maxViews > 0
                ? log1p(max(0, (int) ($video['view_count'] ?? 0))) / log1p($maxViews)
                : 0.0;
            $videos[$index]['_base_score'] = 0.50 * $this->dice($eventTitle, $videoTitle)
                + 0.25 * min(1.0, $keywordCoverage)
                + 0.25 * $popularity;
        }

        $selected = [];
        $selectedChannels = [];
        $selectedGroups = [];

        while ($videos !== [] && count($selected) < $limit) {
            $hasNewChannel = $selectedChannels !== [] && collect($videos)->contains(
                fn (array $video): bool => ! isset($selectedChannels[$this->channelKey($video)]),
            );
            $candidates = $hasNewChannel
                ? array_values(array_filter(
                    $videos,
                    fn (array $video): bool => ! isset($selectedChannels[$this->channelKey($video)]),
                ))
                : $videos;

            usort($candidates, function (array $left, array $right) use ($selectedChannels, $selectedGroups): int {
                $leftScore = $this->adjustedScore($left, $selectedChannels, $selectedGroups);
                $rightScore = $this->adjustedScore($right, $selectedChannels, $selectedGroups);

                return $rightScore <=> $leftScore
                    ?: ((int) ($right['view_count'] ?? 0) <=> (int) ($left['view_count'] ?? 0))
                    ?: strcmp((string) ($right['published_at'] ?? ''), (string) ($left['published_at'] ?? ''))
                    ?: ((int) ($left['position'] ?? 0) <=> (int) ($right['position'] ?? 0));
            });

            $picked = $candidates[0];
            unset($picked['_base_score']);
            $selected[] = $picked;
            $selectedChannels[$this->channelKey($picked)] = true;
            $group = (string) ($picked['group'] ?? '其他');
            if (in_array($group, self::DIVERSITY_GROUPS, true)) {
                $selectedGroups[$group] = true;
            }

            $pickedId = (string) ($picked['video_id'] ?? $picked['url']);
            $videos = array_values(array_filter(
                $videos,
                static fn (array $video): bool => (string) ($video['video_id'] ?? $video['url']) !== $pickedId,
            ));
        }

        return $selected;
    }

    /**
     * @param  array<string, bool>  $selectedChannels
     * @param  array<string, bool>  $selectedGroups
     */
    private function adjustedScore(array $video, array $selectedChannels, array $selectedGroups): float
    {
        $score = (float) ($video['_base_score'] ?? 0.0);
        $channel = $this->channelKey($video);
        $group = (string) ($video['group'] ?? '其他');

        if ($selectedChannels !== [] && ! isset($selectedChannels[$channel])) {
            $score += 0.05;
        }
        if ($selectedChannels !== []
            && in_array($group, self::DIVERSITY_GROUPS, true)
            && ! isset($selectedGroups[$group])) {
            $score += 0.15;
        }

        return $score;
    }

    private function channelKey(array $video): string
    {
        return (int) ($video['u_id'] ?? 0) > 0
            ? 'u:'.(int) $video['u_id']
            : 'c:'.trim((string) ($video['channel'] ?? ''));
    }

    private function dice(string $left, string $right): float
    {
        $leftBigrams = $this->bigrams($this->normalize($left));
        $rightBigrams = $this->bigrams($this->normalize($right));

        if ($leftBigrams === [] || $rightBigrams === []) {
            return 0.0;
        }

        $intersection = count(array_intersect($leftBigrams, $rightBigrams));

        return (2.0 * $intersection) / (count($leftBigrams) + count($rightBigrams));
    }

    /**
     * @return list<string>
     */
    private function bigrams(string $value): array
    {
        $length = mb_strlen($value, 'UTF-8');
        if ($length === 0) {
            return [];
        }
        if ($length === 1) {
            return [$value];
        }

        $bigrams = [];
        for ($index = 0; $index < $length - 1; $index++) {
            $bigrams[] = mb_substr($value, $index, 2, 'UTF-8');
        }

        return array_values(array_unique($bigrams));
    }

    private function normalize(string $value): string
    {
        return preg_replace('/[^\p{L}\p{N}]+/u', '', mb_strtolower($value, 'UTF-8')) ?? '';
    }
}
