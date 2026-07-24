<?php

namespace App\Services\Legacy;

use Illuminate\Database\QueryException;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;

class ChannelPromptReport
{
    /**
     * @return array{available: bool, channel: array<string, mixed>|null, title: string, period: array<string, string>, videos: list<array<string, mixed>>, prompt: string, prompt_bounds: array{min: int, max: int}, generated_at: string}
     */
    public function forChannel(Request $request, int $uId): array
    {
        try {
            $channel = $this->channel($uId);
            $period = $this->period($request, $uId);
            $videos = $this->videos($request, $uId, $period);
            $bounds = $this->promptBounds(count($videos));

            return [
                'available' => true,
                'channel' => $channel,
                'title' => ($channel['title'] ?? 'Channel').' '.$period['date'].' AI prompt preview',
                'period' => $period,
                'videos' => $videos,
                'prompt' => $this->prompt($videos, $bounds),
                'prompt_bounds' => $bounds,
                'generated_at' => now('Asia/Taipei')->format('Y-m-d H:i:s'),
            ];
        } catch (QueryException) {
            return [
                'available' => false,
                'channel' => null,
                'title' => 'Channel AI prompt preview',
                'period' => ['date' => '', 'from' => '', 'to' => '', 'previous' => '', 'next' => ''],
                'videos' => [],
                'prompt' => '',
                'prompt_bounds' => ['min' => 0, 'max' => 0],
                'generated_at' => now('Asia/Taipei')->format('Y-m-d H:i:s'),
            ];
        }
    }

    /**
     * @return array<string, mixed>|null
     */
    private function channel(int $uId): ?array
    {
        $row = DB::table('urt_channel')->where('u_id', $uId)->first();

        if (! $row) {
            return null;
        }

        return [
            'u_id' => (int) $row->u_id,
            'youtube_id' => $row->youtube_id ?? null,
            'title' => $row->title ?? 'Unknown channel',
            'thumbnail' => $row->thumbnails ?? null,
        ];
    }

    /**
     * @return array{date: string, from: string, to: string, previous: string, next: string}
     */
    private function period(Request $request, int $uId): array
    {
        if ($request->filled('from')) {
            $fromDate = $this->date((string) $request->query('from'), $this->latestVideoDate($uId));
            $toDate = $this->date((string) $request->query('to', $fromDate), $fromDate);

            if ($fromDate > $toDate) {
                [$fromDate, $toDate] = [$toDate, $fromDate];
            }
        } else {
            $fromDate = $this->date((string) ($request->route('date') ?? $request->query('date', '')), $this->latestVideoDate($uId));
            $toDate = $fromDate;
        }

        return [
            'date' => $fromDate === $toDate ? $fromDate : $fromDate.' - '.$toDate,
            'from' => $fromDate.' 00:00:00',
            'to' => $toDate.' 23:59:59',
            'previous' => Carbon::parse($fromDate, 'Asia/Taipei')->subDay()->toDateString(),
            'next' => Carbon::parse($toDate, 'Asia/Taipei')->addDay()->toDateString(),
        ];
    }

    private function latestVideoDate(int $uId): string
    {
        $date = DB::table('urt_video')->where('u_id', $uId)->max('publishedAt');

        return is_string($date) ? substr($date, 0, 10) : now('Asia/Taipei')->toDateString();
    }

    private function isCalendarDate(string $value): bool
    {
        return preg_match('/^(\d{4})-(\d{2})-(\d{2})$/', $value, $parts) === 1
            && checkdate((int) $parts[2], (int) $parts[3], (int) $parts[1]);
    }

    private function date(string $date, string $fallback): string
    {
        return $this->isCalendarDate($date) ? $date : $fallback;
    }

    /**
     * @param array{from: string, to: string} $period
     * @return list<array<string, mixed>>
     */
    private function videos(Request $request, int $uId, array $period): array
    {
        $limit = max(1, min(1000, (int) $request->query('limit', 1000)));

        return DB::table('urt_video')
            ->where('u_id', $uId)
            ->where('publishedAt', '>=', $period['from'])
            ->where('publishedAt', '<=', $period['to'])
            ->orderByRaw('coalesce(viewCount, 0) desc')
            ->limit($limit)
            ->get()
            ->map(fn (object $row): array => [
                'video_id' => (string) $row->videoId,
                'published_at' => (string) $row->publishedAt,
                'title' => (string) $row->title,
                'thumbnail' => $row->thumbnails ?? 'https://i.ytimg.com/vi/'.$row->videoId.'/default.jpg',
                'view_count' => (int) ($row->viewCount ?? 0),
                'like_count' => (int) ($row->likeCount ?? 0),
                'comment_count' => (int) ($row->commentCount ?? 0),
                'watch_url' => 'https://www.youtube.com/watch?v='.$row->videoId,
            ])
            ->all();
    }

    /**
     * @return array{min: int, max: int}
     */
    private function promptBounds(int $videoCount): array
    {
        $min = 3 + (int) floor($videoCount / 31);
        $max = 6 + (int) ceil($videoCount / 29);

        if ($videoCount < 10) {
            $min = (int) floor($videoCount / 4);
            $max = (int) ceil($videoCount / 2);

            if ($min < 2) {
                $min = 2;
            }
        }

        return ['min' => $min, 'max' => max($min, $max)];
    }

    /**
     * @param list<array<string, mixed>> $videos
     * @param array{min: int, max: int} $bounds
     */
    private function prompt(array $videos, array $bounds): string
    {
        $lines = [
            '請把下面的新聞列表，整理成 '.$bounds['min'].' ~ '.$bounds['max'].' 個重要事件，讓每個事件新聞數較多且觀看數均勻分布，列出描述，並列出每個事件的關鍵字與人物與地名，加上一個欄位判斷出這事件論述的角度是比較偏台灣或是中國出發，也加上一個欄位判斷出這觀點立場是比較偏國民黨或民進黨陣營思考，以及新聞的分類（類型：政治、地方、國際、財經、娛樂、體育、氣象、生活、兩岸、健康、科技、文化)，跟分出來的 videoId (最前面的序號) 列表，後用 JSON 列出元素包含：事件、描述、角度、陣營、分類，以及關鍵字、人物、地名、類型、videoId 這幾個 Array，請用繁體中文回應，且只要 JSON 就好：',
            '',
        ];

        foreach ($videos as $video) {
            $lines[] = sprintf(
                '%s <date>%s</date> %s (觀看:%d)',
                $video['video_id'],
                $video['published_at'],
                $video['title'],
                $video['view_count'],
            );
        }

        return implode("\n", $lines);
    }
}
