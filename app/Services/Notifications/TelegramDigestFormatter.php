<?php

namespace App\Services\Notifications;

/**
 * Renders a compact headline and metadata followed by a long, expandable
 * report whose source titles are direct YouTube links.
 */
class TelegramDigestFormatter
{
    public const MAX_LENGTH = 4096;

    /**
     * @param  array<string, mixed>  $post
     */
    public function format(array $post): string
    {
        $title = trim((string) ($post['title'] ?? '')) ?: '未命名事件';
        $dashboardUrl = trim((string) ($post['url'] ?? ''));
        $headline = $dashboardUrl !== ''
            ? '<a href="'.$this->attr($dashboardUrl).'"><b>'.$this->e($title).'</b></a>'
            : '<b>'.$this->e($title).'</b>';
        $metric = trim((string) ($post['metric_line'] ?? ''));

        if ($metric === '') {
            $counts = [];
            if ((int) ($post['video_count'] ?? 0) > 0) {
                $counts[] = '影片'.(int) $post['video_count'];
            }
            if ((int) ($post['media_count'] ?? 0) > 0) {
                $counts[] = '媒體'.(int) $post['media_count'];
            }
            $metric = implode('、', $counts);
        }

        $header = $headline.($metric !== '' ? '　'.$this->e($metric) : '');
        $meta = $this->metaBlocks($post);
        $footer = $this->footer($post);
        $summary = trim((string) ($post['summary'] ?? ''));
        $description = trim((string) ($post['description'] ?? ''));

        if ($summary === '' || ($description !== '' && ! str_contains($summary, $description))) {
            $summary = trim($summary.($summary !== '' && $description !== '' ? "\n\n" : '').$description);
        }

        $coverage = $this->coverageBlocks(
            (array) ($post['videos'] ?? []),
            (array) ($post['recommendations'] ?? []),
        );
        $expanded = $this->expandedWithinBudget($header, $meta, $summary, $coverage, $footer);
        $blocks = array_values(array_filter([
            $header,
            ...$meta,
            $expanded !== '' ? '<blockquote expandable>'.$expanded.'</blockquote>' : '',
            $footer,
        ], static fn (string $block): bool => $block !== ''));
        $message = implode("\n\n", $blocks);

        if ($this->visibleLength($message) <= self::MAX_LENGTH) {
            return $message;
        }

        return $this->truncateVisibleMessage($header, $meta, $summary, $coverage, $footer);
    }

    /**
     * @param  array<string, mixed>  $post
     * @return list<string>
     */
    private function metaBlocks(array $post): array
    {
        $context = [];
        foreach ([
            '分類' => trim((string) ($post['category'] ?? '')),
            '角度' => trim((string) ($post['angle'] ?? '')),
            '陣營' => trim((string) ($post['camp'] ?? '')),
        ] as $label => $value) {
            if ($value !== '') {
                $context[] = $label.$value;
            }
        }

        $blocks = [];
        if ($context !== []) {
            $blocks[] = $this->e(implode('｜', $context));
        }

        $tagCounts = (array) ($post['channel_tag_counts'] ?? []);
        if ($tagCounts !== []) {
            $parts = [];
            foreach (array_slice($tagCounts, 0, 6, true) as $tag => $count) {
                $parts[] = trim((string) $tag).max(0, (int) $count);
            }
            if ($parts !== []) {
                $blocks[] = '頻道標籤　'.$this->e(implode('、', $parts));
            }
        }

        foreach ([
            '關鍵字' => (array) ($post['keywords'] ?? []),
            '人物' => (array) ($post['people'] ?? []),
            '地名' => (array) ($post['places'] ?? []),
        ] as $label => $values) {
            $values = $this->cleanList($values, $label === '關鍵字' ? 8 : 6);
            if ($values !== []) {
                $blocks[] = $label.'　'.$this->e(implode('、', $values));
            }
        }

        $burst = trim((string) ($post['burst_line'] ?? ''));
        if ($burst !== '') {
            array_unshift($blocks, $this->e($burst));
        }

        return $blocks;
    }

    /**
     * @param  list<array<string, mixed>>  $videos
     * @return list<array{html: string, video: bool}>
     */
    private function coverageBlocks(array $videos, array $recommendations): array
    {
        $videos = array_values(array_filter($videos, static fn (mixed $video): bool => is_array($video)
            && trim((string) ($video['title'] ?? '')) !== ''
            && trim((string) ($video['url'] ?? '')) !== ''));
        $pickIndexes = [];

        foreach ($recommendations as $recommendation) {
            if (! is_array($recommendation)) {
                continue;
            }

            $recommendationKey = $this->videoKey($recommendation);
            foreach ($videos as $index => $video) {
                if (! in_array($index, $pickIndexes, true) && $this->videoKey($video) === $recommendationKey) {
                    $pickIndexes[] = $index;
                    break;
                }
            }
            if (count($pickIndexes) >= 3) {
                break;
            }
        }

        if ($pickIndexes === [] && $recommendations === []) {
            $pickedGroups = [];
            foreach ($videos as $index => $video) {
                $group = trim((string) ($video['group'] ?? '')) ?: '其他';
                if (! isset($pickedGroups[$group])) {
                    $pickIndexes[] = $index;
                    $pickedGroups[$group] = true;
                }
                if (count($pickIndexes) >= 3) {
                    break;
                }
            }
        }

        $blocks = [];
        if ($pickIndexes !== []) {
            $blocks[] = ['html' => '<b>先看</b>', 'video' => false];
            foreach ($pickIndexes as $index) {
                $blocks[] = ['html' => $this->videoLine($videos[$index]), 'video' => true];
            }
        }

        $groups = [];
        foreach ($videos as $index => $video) {
            if (in_array($index, $pickIndexes, true)) {
                continue;
            }

            $groups[trim((string) ($video['group'] ?? '')) ?: '其他'][] = $video;
        }

        $order = ['泛綠', '泛藍', '泛白', '泛紅', '較無偏', '中立', '公共電視', '公共媒體', '其他'];
        uksort($groups, static function (string $left, string $right) use ($order): int {
            $leftIndex = array_search($left, $order, true);
            $rightIndex = array_search($right, $order, true);

            return ($leftIndex === false ? 99 : $leftIndex) <=> ($rightIndex === false ? 99 : $rightIndex)
                ?: strcmp($left, $right);
        });

        foreach ($groups as $group => $items) {
            $blocks[] = ['html' => '<b>'.$this->e($group).'</b>', 'video' => false];
            foreach ($items as $video) {
                $blocks[] = ['html' => $this->videoLine($video), 'video' => true];
            }
        }

        return $blocks;
    }

    /**
     * @param  array<string, mixed>  $video
     */
    private function videoKey(array $video): string
    {
        $videoId = trim((string) ($video['video_id'] ?? ''));

        return $videoId !== '' ? 'id:'.$videoId : 'url:'.trim((string) ($video['url'] ?? ''));
    }

    /**
     * @param  array<string, mixed>  $video
     */
    private function videoLine(array $video): string
    {
        $channel = trim((string) ($video['channel'] ?? '')) ?: '未知頻道';
        $tags = $this->cleanList((array) ($video['tags'] ?? []), 3);
        $source = $channel.($tags !== [] ? '〔'.implode('、', $tags).'〕' : '');

        return '<b>'.$this->e($source).'</b>　<a href="'.$this->attr((string) $video['url']).'">〈'.$this->e((string) $video['title']).'〉</a>';
    }

    /**
     * @param  list<string>  $meta
     * @param  list<array{html: string, video: bool}>  $coverage
     */
    private function expandedWithinBudget(
        string $header,
        array $meta,
        string $summary,
        array $coverage,
        string $footer,
    ): string {
        $videoCount = count(array_filter($coverage, static fn (array $row): bool => $row['video']));
        $requiredVideos = min(2, $videoCount);
        $included = [];
        $includedVideos = 0;
        $optionalOffset = count($coverage);

        foreach ($coverage as $index => $row) {
            $included[] = $row['html'];
            $includedVideos += (int) $row['video'];
            if ($includedVideos >= $requiredVideos) {
                $optionalOffset = $index + 1;
                break;
            }
        }

        $build = function (string $summaryHtml, array $rows, int $videos) use (
            $header,
            $meta,
            $footer,
            $videoCount,
        ): string {
            $remaining = max(0, $videoCount - $videos);
            $expanded = implode("\n", array_filter([
                $summaryHtml,
                $rows !== [] ? implode("\n", $rows) : '',
                $remaining > 0 ? '其餘'.$remaining.'支見完整整理' : '',
            ]));

            return implode("\n\n", array_filter([
                $header,
                ...$meta,
                '<blockquote expandable>'.$expanded.'</blockquote>',
                $footer,
            ]));
        };

        $summaryHtml = $summary !== '' ? nl2br($this->e($summary), false) : '';
        if ($this->visibleLength($build($summaryHtml, $included, $includedVideos)) > self::MAX_LENGTH) {
            $summaryLength = mb_strlen($summary, 'UTF-8');
            $low = 0;
            $high = $summaryLength;
            $best = '';

            while ($low <= $high) {
                $middle = intdiv($low + $high, 2);
                $trimmed = rtrim(mb_substr($summary, 0, $middle, 'UTF-8'));
                $candidate = $trimmed !== ''
                    ? nl2br($this->e($trimmed).($middle < $summaryLength ? '…' : ''), false)
                    : '';

                if ($this->visibleLength($build($candidate, $included, $includedVideos)) <= self::MAX_LENGTH) {
                    $best = $candidate;
                    $low = $middle + 1;
                } else {
                    $high = $middle - 1;
                }
            }

            $summaryHtml = $best;
        }

        foreach (array_slice($coverage, $optionalOffset) as $row) {
            $candidate = [...$included, $row['html']];
            $candidateVideos = $includedVideos + (int) $row['video'];

            if ($this->visibleLength($build($summaryHtml, $candidate, $candidateVideos)) > self::MAX_LENGTH) {
                break;
            }

            $included = $candidate;
            if ($row['video']) {
                $includedVideos++;
            }
        }

        $remaining = max(0, $videoCount - $includedVideos);

        return implode("\n", array_filter([
            $summaryHtml,
            $included !== [] ? implode("\n", $included) : '',
            $remaining > 0 ? '其餘'.$remaining.'支見完整整理' : '',
        ]));
    }

    /**
     * @param  list<string>  $meta
     * @param  list<array{html: string, video: bool}>  $coverage
     */
    private function truncateVisibleMessage(
        string $header,
        array $meta,
        string $summary,
        array $coverage,
        string $footer,
    ): string {
        $priorityCoverage = [];
        $priorityVideos = 0;
        foreach ($coverage as $row) {
            $priorityCoverage[] = $row['html'];
            if ($row['video']) {
                $priorityVideos++;
            }
            if ($priorityVideos >= min(2, count(array_filter(
                $coverage,
                static fn (array $candidate): bool => $candidate['video'],
            )))) {
                break;
            }
        }
        $videoCount = count(array_filter($coverage, static fn (array $row): bool => $row['video']));
        $includedVideos = $priorityVideos;
        $remaining = max(0, $videoCount - $includedVideos);

        $build = function (string $trimmed, bool $wasTrimmed) use (
            $header,
            &$meta,
            $priorityCoverage,
            $remaining,
            $footer,
        ): string {
            $expanded = implode("\n", array_filter([
                $trimmed !== '' ? $this->e($trimmed).($wasTrimmed ? '…' : '') : '',
                $priorityCoverage !== [] ? implode("\n", $priorityCoverage) : '',
                $remaining > 0 ? '其餘'.$remaining.'支見完整整理' : '',
            ]));

            return implode("\n\n", array_filter([
                $header,
                ...$meta,
                $expanded !== '' ? '<blockquote expandable>'.$expanded.'</blockquote>' : '',
                $footer,
            ]));
        };

        while ($meta !== [] && $this->visibleLength($build('', $summary !== '')) > self::MAX_LENGTH) {
            array_pop($meta);
        }

        $full = $build($summary, false);
        if ($this->visibleLength($full) <= self::MAX_LENGTH) {
            return $full;
        }

        $summaryLength = mb_strlen($summary, 'UTF-8');
        $low = 0;
        $high = $summaryLength;
        $best = '';
        while ($low <= $high) {
            $middle = intdiv($low + $high, 2);
            $candidateSummary = rtrim(mb_substr($summary, 0, $middle, 'UTF-8'));
            $candidate = $build($candidateSummary, $middle < $summaryLength);

            if ($this->visibleLength($candidate) <= self::MAX_LENGTH) {
                $best = $candidate;
                $low = $middle + 1;
            } else {
                $high = $middle - 1;
            }
        }

        return $best !== '' ? $best : $build('', $summary !== '');
    }

    /**
     * @param  array<string, mixed>  $post
     */
    private function footer(array $post): string
    {
        $url = trim((string) ($post['url'] ?? ''));
        $label = trim((string) ($post['label'] ?? ''));
        $link = $url !== '' ? '<a href="'.$this->attr($url).'">完整整理</a>' : '';

        return $link !== '' && $label !== ''
            ? $link.' · '.$this->e($label)
            : ($link !== '' ? $link : $this->e($label));
    }

    /**
     * @return list<string>
     */
    private function cleanList(array $values, int $limit): array
    {
        return collect($values)
            ->filter(fn (mixed $value): bool => is_scalar($value) && trim((string) $value) !== '')
            ->map(fn (mixed $value): string => trim((string) $value))
            ->unique()
            ->take($limit)
            ->values()
            ->all();
    }

    private function visibleLength(string $html): int
    {
        $visible = html_entity_decode(strip_tags(str_replace(['<br>', '<br/>', '<br />'], "\n", $html)), ENT_QUOTES | ENT_HTML5, 'UTF-8');

        return intdiv(strlen(mb_convert_encoding($visible, 'UTF-16LE', 'UTF-8')), 2);
    }

    private function e(string $value): string
    {
        return str_replace(['&', '<', '>'], ['&amp;', '&lt;', '&gt;'], $value);
    }

    private function attr(string $value): string
    {
        return htmlspecialchars($value, ENT_QUOTES | ENT_SUBSTITUTE | ENT_HTML5, 'UTF-8');
    }
}
