<?php

namespace App\Services\Legacy;

use Illuminate\Database\QueryException;
use Illuminate\Http\Request;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;

class TagVideosReport
{
    private const SORT_COLUMNS = ['viewCount', 'likeCount', 'commentCount', 'publishedAt'];

    public function __construct(private readonly LegacyTagFilter $tagFilter)
    {
    }

    /**
     * @return array{available: bool, rows: array<int, array<string, mixed>>, tag: array{id: int, name: string}, filters: array<string, mixed>, generated_at: string, title: string, sort_column: string}
     */
    public function forTag(Request $request, int $tagId = 0): array
    {
        try {
            $tagNames = $this->tagFilter->tagNames();
            $filters = $this->filters($request, $tagId);
            $channelTags = $this->tagFilter->matchingChannelTags($filters);
            $sortColumn = $this->sortColumn($request);
            $rows = $this->rows($filters, $channelTags, $tagNames, $sortColumn);

            return [
                'available' => true,
                'rows' => $rows,
                'tag' => ['id' => $tagId, 'name' => $tagNames[$tagId] ?? ($tagId > 0 ? (string) $tagId : '所有頻道')],
                'filters' => $this->displayFilters($request, $filters),
                'generated_at' => now('Asia/Taipei')->format('Y-m-d H:i:s'),
                'title' => $this->title($filters, $tagNames),
                'sort_column' => $sortColumn,
            ];
        } catch (QueryException) {
            return [
                'available' => false,
                'rows' => [],
                'tag' => ['id' => $tagId, 'name' => $tagId > 0 ? (string) $tagId : '所有頻道'],
                'filters' => $request->query(),
                'generated_at' => now('Asia/Taipei')->format('Y-m-d H:i:s'),
                'title' => '影片',
                'sort_column' => 'viewCount',
            ];
        }
    }

    /**
     * @return array{or: array<int>, tagid: array<int>, not: array<int>, limit: int, min: int, hours: int}
     */
    private function filters(Request $request, int $tagId): array
    {
        $filters = $this->tagFilter->filters($request);

        if ($tagId > 0) {
            if ($filters['tagid'] === []) {
                $filters['tagid'] = [$tagId];
            } elseif (! in_array($tagId, $filters['tagid'], true)) {
                array_unshift($filters['tagid'], $tagId);
            }
        }

        $filters['min'] = max(0, (int) $request->query('min', 1000));
        $filters['hours'] = max(1, min(8760, (int) $request->query('hours', 24)));

        return $filters;
    }

    private function sortColumn(Request $request): string
    {
        $column = (string) $request->query('column', 'viewCount');

        return in_array($column, self::SORT_COLUMNS, true) ? $column : 'viewCount';
    }

    /**
     * @param array{or: array<int>, tagid: array<int>, not: array<int>, limit: int, min: int, hours: int} $filters
     * @param Collection<int, object> $channelTags
     * @param array<int, string> $tagNames
     * @return array<int, array<string, mixed>>
     */
    private function rows(array $filters, Collection $channelTags, array $tagNames, string $sortColumn): array
    {
        if ($channelTags->isEmpty()) {
            return [];
        }

        $channelTagsById = $channelTags->keyBy('u_id');
        $expireTime = now('Asia/Taipei')->subHours($filters['hours'])->format('Y-m-d H:i:s');

        return DB::table('urt_video')
            ->whereIn('u_id', $channelTagsById->keys()->all())
            ->where('publishedAt', '>=', $expireTime)
            ->where('viewCount', '>=', $filters['min'])
            ->orderByDesc($sortColumn)
            ->limit($filters['limit'])
            ->get()
            ->map(function (object $row, int $index) use ($channelTagsById, $tagNames): array {
                $viewCount = (int) ($row->viewCount ?? 0);
                $commentCount = (int) ($row->commentCount ?? 0);
                $countRow = $channelTagsById->get($row->u_id);

                return [
                    'rank' => $index + 1,
                    'video_id' => $row->videoId,
                    'u_id' => (int) $row->u_id,
                    'thumbnail' => $row->thumbnails,
                    'channel_title' => $row->channelTitle,
                    'published_at' => $row->publishedAt,
                    'title' => $row->title,
                    'view_count' => $viewCount,
                    'like_count' => (int) ($row->likeCount ?? 0),
                    'comment_count' => $commentCount,
                    'comment_ratio' => $viewCount > 0 ? $commentCount / $viewCount * 1000 : null,
                    'tags' => $this->tagFilter->visibleTags($countRow->tags ?? '', $tagNames),
                    'youtube_url' => 'https://www.youtube.com/watch?v='.$row->videoId,
                ];
            })
            ->all();
    }

    /**
     * @param array{or: array<int>, tagid: array<int>, not: array<int>, limit: int, min: int, hours: int} $filters
     * @return array<string, mixed>
     */
    private function displayFilters(Request $request, array $filters): array
    {
        return array_merge($request->query(), [
            'hours' => $filters['hours'],
            'min' => $filters['min'],
        ]);
    }

    /**
     * @param array{or: array<int>, tagid: array<int>, not: array<int>, limit: int, min: int, hours: int} $filters
     * @param array<int, string> $tagNames
     */
    private function title(array $filters, array $tagNames): string
    {
        $tagIds = array_values(array_unique(array_merge($filters['tagid'], $filters['or'])));
        $prefix = collect($tagIds)
            ->map(fn (int $tagId): string => $tagNames[$tagId] ?? (string) $tagId)
            ->filter()
            ->implode(' ');

        if ($prefix === '') {
            $prefix = '所有頻道';
        }

        return $prefix.' '.$filters['hours'].'小時內觀看最多的影片';
    }
}
