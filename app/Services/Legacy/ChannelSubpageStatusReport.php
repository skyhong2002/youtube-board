<?php

namespace App\Services\Legacy;

use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;

class ChannelSubpageStatusReport
{
    /**
     * @return array{
     *     channel: array<string, mixed>|null,
     *     section: array<string, mixed>,
     *     dependencies: list<array{table: string, rows: int|null, status: string}>,
     *     generated_at: string
     * }
     */
    public function forChannel(int $uId, string $sectionKey): array
    {
        $section = $this->section($sectionKey);
        $channel = $this->channel($uId);

        return [
            'channel' => $channel,
            'section' => $section,
            'dependencies' => collect($section['tables'])
                ->map(fn (string $table): array => $this->dependency($table, $uId, $sectionKey))
                ->values()
                ->all(),
            'generated_at' => now('Asia/Taipei')->format('Y-m-d H:i:s'),
        ];
    }

    /**
     * @return array<string, mixed>
     */
    private function section(string $sectionKey): array
    {
        return match ($sectionKey) {
            'comments' => [
                'key' => 'comments',
                'title' => '頻道留言',
                'legacy_file' => 'channel_comments.php',
                'modern_path' => 'comments',
                'tables' => ['urt_comment', 'urt_comment_author'],
                'reason' => 'Legacy 會先找近期影片，再讀 `urt_comment.authors_json` 統計留言者；本地 comment tables 目前沒有資料。',
                'next_step' => '等 comment dump 或重建 comment queue 後，再做作者排行與留言 drilldown。',
            ],
            'cloud' => [
                'key' => 'cloud',
                'title' => '頻道文字雲',
                'legacy_file' => 'reports:channel-cloud:build',
                'modern_path' => 'cloud',
                'tables' => ['urt_show_cloud', 'urt_show_tag_cloud'],
                'reason' => 'Laravel 透過 `reports:channel-cloud:build` 從本機頻道影片重建文字雲 cache；本地 cloud cache tables 目前沒有資料。',
                'next_step' => '執行 channel cloud cache builder 後，再用 D3 呈現文字雲。',
            ],
            default => [
                'key' => 'trends',
                'title' => '頻道線圖',
                'legacy_file' => 'channel_line.php',
                'modern_path' => 'trends',
                'tables' => ['urt_log'],
                'reason' => 'Legacy 從 `urt_log.thedata` 展開每日 view/subscriber trend；本地 `urt_log` 目前沒有資料。',
                'next_step' => '等 `urt_log` dump 後，再重建頻道日增觀看與移動平均線圖。',
            ],
        };
    }

    /**
     * @return array<string, mixed>|null
     */
    private function channel(int $uId): ?array
    {
        try {
            $row = DB::table('urt_channel')->where('u_id', $uId)->first();
        } catch (QueryException) {
            return null;
        }

        if (! $row) {
            return null;
        }

        return [
            'u_id' => (int) $row->u_id,
            'title' => $row->title ?? 'Unknown channel',
            'thumbnail' => $row->thumbnails ?? null,
        ];
    }

    /**
     * @return array{table: string, rows: int|null, status: string}
     */
    private function dependency(string $table, int $uId, string $sectionKey): array
    {
        try {
            $query = DB::table($table);

            if ($sectionKey === 'trends' && $table === 'urt_log') {
                $query->where('u_id', $uId);
            }

            $rows = $query->count();

            return [
                'table' => $table,
                'rows' => $rows,
                'status' => $rows > 0 ? 'present' : 'empty',
            ];
        } catch (QueryException) {
            return [
                'table' => $table,
                'rows' => null,
                'status' => 'missing',
            ];
        }
    }
}
