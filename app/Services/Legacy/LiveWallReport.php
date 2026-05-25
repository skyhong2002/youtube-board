<?php

namespace App\Services\Legacy;

use Illuminate\Http\Request;

class LiveWallReport
{
    /**
     * @return array{variant: string, type: int, title: string, tabs: array<int, string>, streams: list<array{slot: int, video_id: string, label: string}>, generated_at: string}
     */
    public function forVariant(Request $request, string $variant): array
    {
        $type = max(1, min(7, (int) $request->query('type', 1)));
        $tabs = [
            1 => '主流新聞',
            2 => '公廣集團',
            3 => '談話國際',
            4 => '台灣地景',
            5 => '地震直播',
            6 => '國會現場',
            7 => '政治現場',
        ];
        $streams = match ($variant) {
            'china' => [
                ['slot' => 1, 'video_id' => 'dSgvHzDGX3k', 'label' => 'China stream 1'],
                ['slot' => 2, 'video_id' => '-GDOZ_XVQDA', 'label' => 'China stream 2'],
                ['slot' => 3, 'video_id' => 'OhHsiIvqfgk', 'label' => 'China stream 3'],
                ['slot' => 4, 'video_id' => 'imuXJFb2Uh0', 'label' => 'China stream 4'],
            ],
            'alternate' => [
                ['slot' => 1, 'video_id' => '6dXQoQqG7o8', 'label' => 'Alternate stream 1'],
                ['slot' => 2, 'video_id' => 'mARiTBux7YQ', 'label' => 'Alternate stream 2'],
                ['slot' => 3, 'video_id' => 'ex9lbHmXBO0', 'label' => 'Alternate stream 3'],
                ['slot' => 4, 'video_id' => 'fJKhyf4C8UY', 'label' => 'Alternate stream 4'],
            ],
            default => $this->legacyLive4Streams($type),
        };

        return [
            'variant' => $variant,
            'type' => $type,
            'title' => $this->title($variant, $type, $tabs[$type] ?? '四窗直播'),
            'tabs' => $variant === 'news' ? $tabs : [],
            'streams' => $streams,
            'generated_at' => now('Asia/Taipei')->format('Y-m-d H:i:s'),
        ];
    }

    /**
     * @return list<array{slot: int, video_id: string, label: string}>
     */
    private function legacyLive4Streams(int $type): array
    {
        $streams = match ($type) {
            2 => [
                ['quwqlazU-c8', '公視新聞'],
                ['C6gYqSHLRw4', '公視'],
                ['wM0g8EoUZ_E', '華視'],
                ['6KlRR_DGhmI', '公視台語台'],
            ],
            3 => [
                ['5n0y6b0Q25o', '鏡新聞'],
                ['-Bk_tdwVDPQ', '中天深喉嚨'],
                ['6IquAgfvYmc', '寰宇新聞'],
                ['1I2iq41Akmo', '東森財經'],
            ],
            4 => [
                ['91PfFoqvuUk', '地震'],
                ['z_fY1pj1VBw', '象山'],
                ['xwAWSh35uuw', '漁人碼頭'],
                ['UCG1aXVO8H8', '多良'],
            ],
            5 => [
                ['KyT4qSK8lJo', '地震'],
                ['q2OqoVjIZJY', '台南'],
                ['meHTKm4XBS8', '華視'],
                ['5cRG33-IVVg', 'TREM'],
            ],
            6 => [
                ['zkDPXEIIuSs', '國會現場 1'],
                ['PT9HDbvsRSA', '國會現場 2'],
                ['JEfEzYctdrI', '國會現場 3'],
                ['WeBCFkb0SJw', '國會現場 4'],
            ],
            7 => [
                ['tg3EV-tvtI4', '政治現場 1'],
                ['QElZ52jXWyg', '政治現場 2'],
                ['8Xz8TeXnuk8', '政治現場 3'],
                ['R2VDU_T2-DY', '政治現場 4'],
            ],
            default => [
                ['QsGswQvRmtU', '三立'],
                ['vr3XyVCR4T0', '中天'],
                ['ylYJSBUgaMA', '民視'],
                ['m_dhMSvUCIc', 'TVBS'],
            ],
        };

        return collect($streams)
            ->map(fn (array $stream, int $index): array => [
                'slot' => $index + 1,
                'video_id' => $stream[0],
                'label' => $stream[1],
            ])
            ->values()
            ->all();
    }

    private function title(string $variant, int $type, string $typeLabel): string
    {
        return match ($variant) {
            'china' => '中國相關同時四窗直播',
            'alternate' => '備用同時四窗直播',
            default => ($type === 5 ? '地震' : $typeLabel).' 同時四窗直播',
        };
    }
}
