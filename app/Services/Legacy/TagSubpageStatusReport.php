<?php

namespace App\Services\Legacy;

use Illuminate\Database\QueryException;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class TagSubpageStatusReport
{
    public function __construct(private readonly LegacyTagFilter $tagFilter)
    {
    }

    /**
     * @return array<string, mixed>
     */
    public function forTagFilters(Request $request, string $sectionKey, ?int $tagId = null): array
    {
        $filters = $this->tagFilter->filters($request);

        if ($tagId !== null && $tagId > 0) {
            array_unshift($filters['tagid'], $tagId);
            $filters['tagid'] = collect($filters['tagid'])->unique()->values()->all();
        }

        $tagNames = $this->safeTagNames();
        $subject = $this->tagTitle($filters, $tagNames);
        $section = $this->section($sectionKey, false);

        return $this->payload($subject, $filters, $section);
    }

    /**
     * @return array<string, mixed>
     */
    public function forKeyword(Request $request, string $sectionKey, string $keyword): array
    {
        $keyword = trim(urldecode($keyword)) ?: '蔡英文';
        $section = $this->section($sectionKey, true);

        return $this->payload($keyword, [
            'tagid' => [],
            'or' => [],
            'not' => [],
            'limit' => max(1, min(1000, (int) $request->query('limit', 1000))),
            'tag' => $keyword,
        ], $section);
    }

    /**
     * @param array<string, mixed> $filters
     * @param array<string, mixed> $section
     * @return array<string, mixed>
     */
    private function payload(string $subject, array $filters, array $section): array
    {
        return [
            'subject' => $subject,
            'section' => $section,
            'filters' => $this->displayFilters($filters),
            'dependencies' => collect($section['tables'])
                ->map(fn (string $table): array => $this->dependency($table))
                ->values()
                ->all(),
            'generated_at' => now('Asia/Taipei')->format('Y-m-d H:i:s'),
        ];
    }

    /**
     * @return array<string, mixed>
     */
    private function section(string $sectionKey, bool $keyword): array
    {
        if ($sectionKey === 'comments') {
            return [
                'key' => 'comments',
                'title' => '標籤近期留言',
                'legacy_file' => 'comments_recent.php',
                'tables' => ['urt_comment', 'urt_comment_author', 'urt_video', 'urt_count'],
                'reason' => 'Legacy 先用 `urt_count.tags` 找頻道，再讀 `urt_comment` 和 `urt_comment_author` 做近期留言排行；本機 comment tables 目前沒有資料。',
                'next_step' => '等 comment dump 或 comment ingestion 重建完成後，再做留言排行與作者 drilldown。',
            ];
        }

        if ($sectionKey === 'keyword-videos') {
            return [
                'key' => 'keyword-videos',
                'title' => '關鍵字影片',
                'legacy_file' => 'tag_video.php + api/tags_relation_date.php',
                'tables' => ['urt_show_video_tag', 'urt_show_video_tag_date', 'urt_video'],
                'reason' => 'Legacy 逐日呼叫 `api/tags_relation_date.php` 產生 keyword-video relation cache；本機 `urt_show_video_tag` 與 `urt_show_video_tag_date` 目前沒有資料。',
                'next_step' => '等 keyword-video relation cache dump，或先完成 real-time YouTube dashboard tag relation builder 後，再顯示影片排行。',
            ];
        }

        if ($keyword) {
            return [
                'key' => 'keyword-cloud',
                'title' => '關鍵字文字雲',
                'legacy_file' => 'tag_cloud.php + api/tag_tags_days.php',
                'tables' => ['urt_show_tag_cloud_tag', 'urt_show_video_tag', 'urt_video_log_history'],
                'reason' => 'Legacy 會依關鍵字與頻道 tag 條件補寫 `urt_show_tag_cloud_tag`；本機相關 cache tables 目前沒有資料。',
                'next_step' => '等 `urt_show_tag_cloud_tag` 或 keyword relation cache dump 後，再以 real-time YouTube dashboard 方式呈現文字雲。',
            ];
        }

        return [
            'key' => 'tag-cloud',
            'title' => '標籤文字雲',
            'legacy_file' => 'cloud.php + api/tags_video.php',
            'tables' => ['urt_show_tag_cloud', 'urt_video', 'urt_count'],
            'reason' => 'Legacy 會從 `urt_video` 重新計算並補寫 `urt_show_tag_cloud`；本機 cache table 目前沒有資料。',
            'next_step' => 'Run `php artisan reports:tag-cloud:build --execute --tagid=1 --days=1,3,7,30,90` to populate `urt_show_tag_cloud` from local `urt_video`/`urt_count`/`tags`.',
        ];
    }

    /**
     * @return array<int, string>
     */
    private function safeTagNames(): array
    {
        try {
            return $this->tagFilter->tagNames();
        } catch (QueryException) {
            return [];
        }
    }

    /**
     * @param array{tagid: list<int>, or: list<int>, not: list<int>} $filters
     * @param array<int, string> $tagNames
     */
    private function tagTitle(array $filters, array $tagNames): string
    {
        $ids = collect([...$filters['tagid'], ...$filters['or']])
            ->map(fn (mixed $id): int => (int) $id)
            ->filter(fn (int $id): bool => $id > 0)
            ->unique()
            ->values();

        if ($ids->isEmpty()) {
            return '全部標籤';
        }

        return $ids
            ->map(fn (int $id): string => $tagNames[$id] ?? (string) $id)
            ->implode(' ');
    }

    /**
     * @param array<string, mixed> $filters
     * @return array<string, string|int>
     */
    private function displayFilters(array $filters): array
    {
        return array_filter([
            'tag' => $filters['tag'] ?? '',
            'tagid' => implode(',', $filters['tagid'] ?? []),
            'or' => implode(',', $filters['or'] ?? []),
            'not' => implode(',', $filters['not'] ?? []),
            'limit' => $filters['limit'] ?? 1000,
        ], fn (mixed $value): bool => $value !== '');
    }

    /**
     * @return array{table: string, rows: int|null, status: string}
     */
    private function dependency(string $table): array
    {
        try {
            $rows = DB::table($table)->count();

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
