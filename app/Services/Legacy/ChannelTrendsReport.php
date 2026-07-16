<?php

namespace App\Services\Legacy;

use Illuminate\Database\QueryException;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class ChannelTrendsReport
{
    public function __construct(private readonly LegacyChannelReportApiReport $apiReport)
    {
    }

    /**
     * @return array<string, mixed>
     */
    public function forChannel(Request $request, int $uId): array
    {
        $limit = max(1, min(1095, (int) $request->query('limit', 300)));
        $mode = $this->mode($request);
        $apiRequest = Request::create('/api/api_channel_log.php', 'GET', array_merge($request->query(), [
            'u_id' => $uId,
            'limit' => $limit,
        ]));
        $payload = $this->apiReport->channelLog($apiRequest);
        $result = $payload['result'] ?? [];
        $meta = $payload['meta'] ?? [];
        $channel = $this->channel($uId, $meta['channel'] ?? null);
        $rows = $this->rows(is_array($result) ? $result : [], $mode);
        $available = $mode === 'videos'
            ? (int) ($meta['video_points'] ?? 0) > 0
            : (int) ($meta['view_points'] ?? 0) > 0;
        $blockedReason = $available
            ? null
            : ($meta['blocked_reason'] ?? 'local urt_log has no usable rows for this channel');

        return [
            'available' => $available,
            'data_available' => $rows !== [] && $available,
            'channel' => $channel,
            'title' => ($channel['title'] ?? '頻道').' 在 '.$limit.' 天的折線圖',
            'rows' => $rows,
            'mode' => $mode,
            'mode_label' => $this->modeLabel($mode),
            'filters' => [
                'limit' => $limit,
                'orig' => $request->query('orig') !== null ? 1 : 0,
                'each' => $request->query('each') !== null ? 1 : 0,
                'videos' => $request->query('videos') !== null ? 1 : 0,
            ],
            'dependencies' => [$this->dependency($uId)],
            'blocked_reason' => $blockedReason,
            'generated_at' => now('Asia/Taipei')->format('Y-m-d H:i:s'),
            'legacy_file' => 'channel_line.php + api/api_channel_log.php',
        ];
    }

    private function mode(Request $request): string
    {
        if ($request->query('videos') !== null) {
            return 'videos';
        }

        if ($request->query('orig') !== null) {
            return 'orig';
        }

        if ($request->query('each') !== null) {
            return 'pred';
        }

        return 'moving';
    }

    private function modeLabel(string $mode): string
    {
        return match ($mode) {
            'orig' => '原始資料',
            'pred' => '估計值',
            'videos' => '影片數',
            default => '移動曲線',
        };
    }

    /**
     * @param array<string, mixed> $result
     * @return list<array{date: string, value: int, orig: int, pred: int, moving: int, videos: int}>
     */
    private function rows(array $result, string $mode): array
    {
        return collect($result)
            ->map(function (mixed $row, string $date) use ($mode): ?array {
                if (! is_array($row)) {
                    return null;
                }

                $orig = (int) ($row['orig'] ?? 0);
                $pred = (int) ($row['pred'] ?? 0);
                $moving = (int) ($row['moving'] ?? 0);
                $videos = (int) ($row['videos'] ?? 0);

                return [
                    'date' => $date,
                    'value' => match ($mode) {
                        'orig' => $orig,
                        'pred' => $pred,
                        'videos' => $videos,
                        default => $moving,
                    },
                    'orig' => $orig,
                    'pred' => $pred,
                    'moving' => $moving,
                    'videos' => $videos,
                ];
            })
            ->filter()
            ->values()
            ->all();
    }

    /**
     * @param array<string, mixed>|null $metaChannel
     * @return array<string, mixed>|null
     */
    private function channel(int $uId, mixed $metaChannel): ?array
    {
        if (is_array($metaChannel) && ($metaChannel['u_id'] ?? null) !== null) {
            return [
                'u_id' => (int) $metaChannel['u_id'],
                'title' => (string) ($metaChannel['title'] ?? 'Unknown channel'),
                'youtube_id' => $metaChannel['youtube_id'] ?? null,
                'thumbnail' => null,
            ];
        }

        try {
            $row = DB::table('urt_channel')->where('u_id', $uId)->first();
        } catch (QueryException) {
            return null;
        }

        if ($row === null) {
            return null;
        }

        return [
            'u_id' => (int) $row->u_id,
            'title' => (string) ($row->title ?? 'Unknown channel'),
            'youtube_id' => $row->youtube_id ?? null,
            'thumbnail' => $row->thumbnails ?? null,
        ];
    }

    /**
     * @return array{table: string, rows: int|null, status: string}
     */
    private function dependency(int $uId): array
    {
        try {
            $rows = DB::table('urt_log')->where('u_id', $uId)->count();

            return [
                'table' => 'urt_log',
                'rows' => $rows,
                'status' => $rows > 0 ? 'present' : 'empty',
            ];
        } catch (QueryException) {
            return [
                'table' => 'urt_log',
                'rows' => null,
                'status' => 'missing',
            ];
        }
    }
}
