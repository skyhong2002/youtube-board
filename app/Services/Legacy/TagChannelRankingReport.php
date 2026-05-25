<?php

namespace App\Services\Legacy;

use Illuminate\Database\QueryException;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class TagChannelRankingReport
{
    private const SORT_COLUMNS = [
        'viewCount',
        'subscriberCount',
        'videoCount',
        'view_week',
        'view_month',
        'views_pred_week',
        'views_pred_month',
        'sub_week',
        'sub_month',
        'video_week',
        'video_month',
    ];

    public function __construct(private readonly LegacyTagFilter $tagFilter)
    {
    }

    /**
     * @return array{available: bool, rows: array<int, array<string, mixed>>, tag: array{id: int, name: string}, filters: array<string, mixed>, generated_at: string, sort_column: string}
     */
    public function forTag(Request $request, int $tagId): array
    {
        try {
            $tagNames = $this->tagFilter->tagNames();
            $filters = $this->filters($request, $tagId);
            $sortColumn = $this->sortColumn($request);
            $rows = $this->rows($filters, $tagNames, $sortColumn);

            return [
                'available' => true,
                'rows' => $rows,
                'tag' => ['id' => $tagId, 'name' => $tagNames[$tagId] ?? (string) $tagId],
                'filters' => $request->query(),
                'generated_at' => now('Asia/Taipei')->format('Y-m-d H:i:s'),
                'sort_column' => $sortColumn,
            ];
        } catch (QueryException) {
            return [
                'available' => false,
                'rows' => [],
                'tag' => ['id' => $tagId, 'name' => (string) $tagId],
                'filters' => $request->query(),
                'generated_at' => now('Asia/Taipei')->format('Y-m-d H:i:s'),
                'sort_column' => 'view_month',
            ];
        }
    }

    /**
     * @return array{or: array<int>, tagid: array<int>, not: array<int>, limit: int, min: int}
     */
    private function filters(Request $request, int $tagId): array
    {
        $filters = $this->tagFilter->filters($request);

        if ($filters['tagid'] === []) {
            $filters['tagid'] = [$tagId];
        } elseif (! in_array($tagId, $filters['tagid'], true)) {
            array_unshift($filters['tagid'], $tagId);
        }

        $filters['min'] = max(0, (int) $request->query('min', 0));

        return $filters;
    }

    private function sortColumn(Request $request): string
    {
        $column = (string) $request->query('column', 'view_month');

        return in_array($column, self::SORT_COLUMNS, true) ? $column : 'view_month';
    }

    /**
     * @param array{or: array<int>, tagid: array<int>, not: array<int>, limit: int, min: int} $filters
     * @param array<int, string> $tagNames
     * @return array<int, array<string, mixed>>
     */
    private function rows(array $filters, array $tagNames, string $sortColumn): array
    {
        $query = DB::table('urt_count')
            ->join('urt_channel', 'urt_count.u_id', '=', 'urt_channel.u_id')
            ->select([
                'urt_count.*',
                'urt_channel.youtube_id',
                'urt_channel.title',
                'urt_channel.thumbnails',
                'urt_channel.flag_del',
            ])
            ->where(function ($query): void {
                $query->whereNull('urt_channel.flag_del')
                    ->orWhere('urt_channel.flag_del', '<', 1);
            });

        if ($filters['or'] !== []) {
            $query->where(function ($query) use ($filters): void {
                foreach ($filters['or'] as $tagId) {
                    $query->orWhere('urt_count.tags', 'like', '%['.$tagId.']%');
                }
            });
        }

        foreach ($filters['tagid'] as $tagId) {
            $query->where('urt_count.tags', 'like', '%['.$tagId.']%');
        }

        if ($filters['not'] !== []) {
            $query->where(function ($query) use ($filters): void {
                foreach ($filters['not'] as $tagId) {
                    $query->where('urt_count.tags', 'not like', '%['.$tagId.']%');
                }
            });
        }

        $minColumn = $filters['or'] !== [] ? 'viewCount' : 'subscriberCount';
        $query->where('urt_count.'.$minColumn, '>=', $filters['min']);

        return $query
            ->orderByDesc('urt_count.'.$sortColumn)
            ->limit($filters['limit'])
            ->get()
            ->map(function ($row, int $index) use ($tagNames): array {
                return [
                    'rank' => $index + 1,
                    'u_id' => (int) $row->u_id,
                    'youtube_id' => $row->youtube_id,
                    'title' => $row->title ?? 'Unknown channel',
                    'thumbnail' => $row->thumbnails,
                    'view_count' => (int) ($row->viewCount ?? 0),
                    'subscriber_count' => (int) ($row->subscriberCount ?? 0),
                    'video_count' => (int) ($row->videoCount ?? 0),
                    'view_week' => (int) ($row->view_week ?? 0),
                    'view_month' => (int) ($row->view_month ?? 0),
                    'views_pred_week' => (int) ($row->views_pred_week ?? 0),
                    'views_pred_month' => (int) ($row->views_pred_month ?? 0),
                    'pred_gap' => (int) ($row->views_pred_month ?? 0) - (int) ($row->view_month ?? 0),
                    'tags' => $this->tagFilter->tagsFromString($row->tags ?? '', $tagNames),
                    'youtube_url' => 'https://www.youtube.com/channel/'.$row->youtube_id,
                ];
            })
            ->all();
    }
}
