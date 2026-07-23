<?php

namespace App\Services\Notifications;

/**
 * Renders a normalized AI event digest into a Telegram message (HTML parse mode).
 *
 * Pure and side-effect free so the exact copy/format is unit-testable without a
 * bot token. The broadcaster is responsible for mapping report output into the
 * `$digest` shape documented on {@see format()}.
 */
class TelegramDigestFormatter
{
    /** Telegram rejects messages longer than this many UTF-16 code units. */
    public const MAX_LENGTH = 4096;

    /**
     * @param  array{
     *     period: 'daily'|'hourly',
     *     label: string,
     *     url: string,
     *     events: list<array{title: string, keywords: list<string>, people: list<string>, video_count: int, media_count: int}>
     * }  $digest
     */
    public function format(array $digest, int $maxEvents): string
    {
        $isDaily = ($digest['period'] ?? 'daily') === 'daily';
        $heading = $isDaily ? '📊 YouTube 輿情整理・每日精華' : '⚡️ YouTube 輿情・即時重大事件';
        $clock = $isDaily ? '🗓' : '🕚';

        $lines = [
            '<b>'.$this->e($heading).'</b>',
            $clock.' '.$this->e((string) ($digest['label'] ?? '')),
            '',
        ];

        $events = array_values($digest['events'] ?? []);
        $shown = array_slice($events, 0, max(1, $maxEvents));

        foreach ($shown as $index => $event) {
            $lines[] = $this->renderEvent($index + 1, $event);
        }

        $remaining = count($events) - count($shown);
        if ($remaining > 0) {
            $lines[] = '';
            $lines[] = '⋯ 另有 '.$remaining.' 則事件';
        }

        $url = (string) ($digest['url'] ?? '');
        if ($url !== '') {
            $lines[] = '';
            $lines[] = '🔗 <a href="'.$this->e($url).'">完整整理</a>';
        }

        return $this->fit(implode("\n", $lines), $url);
    }

    /**
     * @param  array{title: string, keywords: list<string>, people: list<string>, video_count: int, media_count: int}  $event
     */
    private function renderEvent(int $rank, array $event): string
    {
        $title = trim((string) ($event['title'] ?? ''));
        $header = '<b>'.$rank.'.</b> '.$this->e($title !== '' ? $title : '（未命名事件）');

        $facets = [];

        $keywords = $this->take($event['keywords'] ?? [], 3);
        if ($keywords !== []) {
            $facets[] = '🔑 '.$this->e(implode('、', $keywords));
        }

        $people = $this->take($event['people'] ?? [], 3);
        if ($people !== []) {
            $facets[] = '👤 '.$this->e(implode('、', $people));
        }

        $counts = [];
        $videoCount = (int) ($event['video_count'] ?? 0);
        if ($videoCount > 0) {
            $counts[] = $videoCount.' 部影片';
        }
        $mediaCount = (int) ($event['media_count'] ?? 0);
        if ($mediaCount > 0) {
            $counts[] = $mediaCount.' 家媒體';
        }
        if ($counts !== []) {
            $facets[] = '🎬 '.$this->e(implode('・', $counts));
        }

        return $facets === []
            ? $header
            : $header."\n".'   '.implode('　', $facets);
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
     * Ensure the message stays within Telegram's length limit, dropping whole
     * trailing lines (never mid-tag) and preserving the footer link.
     */
    private function fit(string $message, string $url): string
    {
        if ($this->length($message) <= self::MAX_LENGTH) {
            return $message;
        }

        $footer = $url !== '' ? "\n\n".'🔗 <a href="'.$this->e($url).'">完整整理</a>' : '';
        $budget = self::MAX_LENGTH - $this->length($footer);

        $lines = explode("\n", $message);
        $kept = [];
        foreach ($lines as $line) {
            if ($url !== '' && str_contains($line, 'href="'.$this->e($url).'"')) {
                continue; // re-appended as footer
            }
            $candidate = implode("\n", [...$kept, $line]);
            if ($this->length($candidate) > $budget) {
                break;
            }
            $kept[] = $line;
        }

        return rtrim(implode("\n", $kept))."\n".$footer;
    }

    private function length(string $value): int
    {
        // Telegram counts UTF-16 code units; approximate with mb character count,
        // which is safely conservative for CJK + BMP emoji content.
        return mb_strlen($value, 'UTF-8');
    }

    private function e(string $value): string
    {
        // Telegram HTML parse mode only requires &, <, > to be escaped.
        return str_replace(['&', '<', '>'], ['&amp;', '&lt;', '&gt;'], $value);
    }
}
