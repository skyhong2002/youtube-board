<?php

namespace App\Services\Legacy;

class LegacyStopwords
{
    private const FALLBACK = [
        '會員', 'YouTube', '加入', '節目', '時間', '小編', '報告', '分享', '管理員', '留言', '斗內', '下載',
        '平台', '主持', '訊息', '粉專', '群組', '爆料', '討論', '同意', '頻道', '立場', '聊天室', '2020年',
        'Pay', 'ATM', '直播', '帳號', '10月', '11月', '12月', '7月', '1月', '3月', '24小時', '主持人',
        '線上', '線上直播', 'Clubhouse', '粉絲團', 'Podcast', '商品', '折扣', '2021年', '2022年', '2023年',
        '歷史', '國際', '全台', '社會', '焦點', '世界', '禁止', '測試', '影片', '規範', '網站', '官網',
        '電視', '新聞', '資訊', '發言', '科技', '即時新聞', '全球', '晚報', '日常', 'Taiwan', 'TVBS',
        '中天電視', '中天新聞', '少康戰情室', '關鍵時刻', '民視新聞台', '新台灣加油', '新聞面對面',
        '中天', '三立', '三立新聞', '東森', '民視', '中視', '台視', '新唐', '壹電視', '新聞台', '電視台',
        '年代', 'K2', '不演了新聞台', '鄭知道了', '辣新聞', '辣新聞152', 'Android', 'APP', 'iOS',
        'Spotify', 'KKBOX', 'LINE', 'Facebook', 'Instagram', 'Twitch', 'Telegram', 'WeChat', 'WhatsApp',
        'Gary', 'UCC', 'MER', 'CIA', '精神', '呼籲', '支援', '力量', '自然', 'S21', 'T1', 'F1',
        '董事長', '董事長開講', '羅斯', 'IVE',
    ];

    /**
     * @return list<string>
     */
    public function all(): array
    {
        return collect([...self::FALLBACK, ...$this->legacyWords()])
            ->map(fn (string $word): string => trim($word))
            ->filter(fn (string $word): bool => $word !== '')
            ->unique()
            ->values()
            ->all();
    }

    /**
     * @return array<string, true>
     */
    public function lookup(): array
    {
        return array_fill_keys($this->all(), true);
    }

    /**
     * @return list<string>
     */
    private function legacyWords(): array
    {
        $path = rtrim((string) config('legacy.ground_truth_path'), '/').'/urtube/stopwords.php';

        if (! is_readable($path)) {
            return [];
        }

        $contents = file_get_contents($path);

        if (! is_string($contents)) {
            return [];
        }

        preg_match_all('/\$stopwords\[\]\s*=\s*"([^"]+)"/u', $contents, $matches);

        return $matches[1] ?? [];
    }
}
