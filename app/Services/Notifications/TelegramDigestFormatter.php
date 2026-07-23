<?php

namespace App\Services\Notifications;

/**
 * Renders a single AI event into one Telegram post (HTML parse mode), modelled
 * on the @hn_best_cht style: bold headline, a short news-brief paragraph, then a
 * compact facet/footer line with a link back to the dashboard.
 *
 * Pure and side-effect free so the exact copy/format is unit-testable without a
 * bot token or LLM. The broadcaster maps report data + the LLM summary into the
 * `$post` shape documented on {@see format()}.
 */
class TelegramDigestFormatter
{
    /** Telegram rejects messages longer than this many UTF-16 code units. */
    public const MAX_LENGTH = 4096;

    /**
     * @param  array{
     *     title: string,
     *     summary: string,
     *     keywords?: list<string>,
     *     people?: list<string>,
     *     video_count?: int,
     *     media_count?: int,
     *     url?: string,
     *     label?: string,
     *     breaking?: bool
     * }  $post
     */
    public function format(array $post): string
    {
        $title = trim((string) ($post['title'] ?? ''));
        $title = $title !== '' ? $title : '未命名事件';
        $prefix = ($post['breaking'] ?? false) ? '🔴 ' : '';

        $blocks = [
            '<b>'.$this->e($prefix.$title).'</b>',
        ];

        $summary = trim((string) ($post['summary'] ?? ''));
        if ($summary !== '') {
            $blocks[] = $this->e($summary);
        }

        $facet = $this->facetLine($post);
        if ($facet !== '') {
            $blocks[] = $facet;
        }

        $blocks[] = $this->footer($post);

        return $this->clamp(implode("\n\n", array_filter($blocks, static fn (string $b): bool => $b !== '')), $post);
    }

    /**
     * @param  array<string, mixed>  $post
     */
    private function facetLine(array $post): string
    {
        $parts = [];

        $counts = [];
        $videos = (int) ($post['video_count'] ?? 0);
        if ($videos > 0) {
            $counts[] = $videos.' 部影片';
        }
        $media = (int) ($post['media_count'] ?? 0);
        if ($media > 0) {
            $counts[] = $media.' 家媒體';
        }
        if ($counts !== []) {
            $parts[] = '🎬 '.$this->e(implode('・', $counts));
        }

        $keywords = $this->take($post['keywords'] ?? [], 4);
        if ($keywords !== []) {
            $parts[] = '🔑 '.$this->e(implode('・', $keywords));
        }

        $people = $this->take($post['people'] ?? [], 3);
        if ($people !== []) {
            $parts[] = '👤 '.$this->e(implode('、', $people));
        }

        return implode('　', $parts);
    }

    /**
     * @param  array<string, mixed>  $post
     */
    private function footer(array $post): string
    {
        $url = trim((string) ($post['url'] ?? ''));
        $label = trim((string) ($post['label'] ?? ''));

        $link = $url !== ''
            ? '🔗 <a href="'.$this->e($url).'">相關影片整理</a>'
            : '';

        if ($link !== '' && $label !== '') {
            return $link.' · '.$this->e($label);
        }

        return $link !== '' ? $link : ($label !== '' ? '🕘 '.$this->e($label) : '');
    }

    /**
     * @param  list<string>|array<int|string, mixed>  $values
     * @return list<string>
     */
    private function take(array $values, int $limit): array
    {
        $clean = [];
        foreach ($values as $value) {
            $text = trim((string) $value);
            if ($text !== '') {
                $clean[] = $text;
            }
            if (count($clean) >= $limit) {
                break;
            }
        }

        return $clean;
    }

    /**
     * Keep the post within Telegram's limit by trimming the summary block only
     * (never the headline or footer, never mid-tag).
     *
     * @param  array<string, mixed>  $post
     */
    private function clamp(string $message, array $post): string
    {
        if ($this->length($message) <= self::MAX_LENGTH) {
            return $message;
        }

        $summary = trim((string) ($post['summary'] ?? ''));
        if ($summary === '') {
            return mb_substr($message, 0, self::MAX_LENGTH, 'UTF-8');
        }

        $overflow = $this->length($message) - self::MAX_LENGTH;
        $keep = max(0, $this->length($summary) - $overflow - 1);
        $trimmed = rtrim(mb_substr($summary, 0, $keep, 'UTF-8')).'…';

        return str_replace($this->e($summary), $this->e($trimmed), $message);
    }

    private function length(string $value): int
    {
        // Telegram counts UTF-16 code units; mb character count is safely
        // conservative for CJK + BMP emoji content.
        return mb_strlen($value, 'UTF-8');
    }

    private function e(string $value): string
    {
        // Telegram HTML parse mode only requires &, <, > to be escaped.
        return str_replace(['&', '<', '>'], ['&amp;', '&lt;', '&gt;'], $value);
    }
}
