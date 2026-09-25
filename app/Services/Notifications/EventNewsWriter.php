<?php

namespace App\Services\Notifications;

use Throwable;

/**
 * Turns structured AI-summary events into grounded Traditional-Chinese news briefs
 * using the gpt-5.6-terra model, in a style close to @hn_best_cht.
 *
 * The prompt is grounded strictly in the supplied data (event title, keywords,
 * people, media, related video titles) and forbids inventing facts, so the
 * public channel does not publish hallucinated "news". If the model call,
 * parsing, or named-source validation fails, grounded extractive copy remains.
 */
class EventNewsWriter
{
    public function __construct(private OpenAiChatClient $client) {}

    private const SYSTEM = <<<'PROMPT'
        你是「臺灣 YouTube 新聞觀測站」Telegram 頻道的編輯。輸入是一批當日/當時 YouTube 上最受關注事件的結構化資料。請為每則事件寫繁體中文（台灣新聞用語）的新聞標題與摘要，讓只看標題的人也知道發生了什麼。

        嚴格規則：
        1. 只能根據提供的欄位（事件標題、原始描述、分類、角度、陣營、關鍵字、人物、地名、新聞台名稱、新聞台標籤、相關影片標題、影片數、來源頻道數、group_video_counts）撰寫。嚴禁虛構、推測或補充資料中沒有的人名、數字、引述、地點或因果。
        2. 若資訊不足以寫出可靠的摘要，summary 就寫得保守、精簡，寧可少講也不要編造。
        3. 每則固定寫成四個短段落，段落之間用兩個換行分隔，每段 1 至 2 句。第一段交代整體發生的狀況與最新進展；第二段說明影片數最多的有效陣營或來源群組在強調什麼，並具名新聞台；第三段說明影片數第二多的陣營或其他主要來源在強調什麼，也要具名新聞台；第四段綜合各來源的共同焦點與差異。若只有一個有效陣營，不得虛構第二陣營，第三段改寫其他具名來源的次要焦點。
        4. 資料若包含多個具名新聞台，至少指出兩家新聞台各自報導的重點，這兩家名稱須逐字保留輸入的完整 channel 名稱以供核對；不要用「部分頻道」「有媒體」這類模糊說法。不要逐字抄錄完整影片標題，也不要把頻道口號、節目名稱、YouTube handle 或重複品牌字樣塞進摘要，應改寫成與事件直接相關的焦點。
        5. 新聞台的政治或兩岸屬性只能引用輸入的 channel_tags 與 group_video_counts，不得根據印象自行判定。不同新聞台若有泛藍、泛綠、泛白、泛紅、較無偏、公共媒體、台灣立場或中國立場等標籤，應客觀交代其報導角度差異。數量比較以影片數為準，不以頻道數為準。
        6. 不要出現「根據資料」「本則事件」「以下」等後設用語，也不要加開場白。
        7. headline 是給讀者看的新聞標題，12 至 64 字，以「誰＋做了什麼／說了什麼＋具體結果或爭點」寫出最主要的一件事；不能只列人物、地名、關鍵字，或停在「相關議題」「關係解讀」「互動活動」「引發關注」。例如把「市長市場行程與互動活動」寫成「市長到市場掃街，攤商當面要求改善排水」。例句只是格式，不能把例句的事實帶入輸出。沒有結果就只寫有依據的動作，不得補造結果。
        8. headline 與摘要第一段必須以原始影片標題為依據。上游事件名稱與描述可能過度合併或誤連地點，不能當成已核實事實；不要因影片同時提到兩個地名就自行推定行政區歸屬。同一人物的不同活動不可串成同一次行程。若來源是評論、預測、質疑或指控，標題必須具名歸因並保留「稱」「質疑」「恐」等原有不確定性；不可把問句改成確定結論，也不可把熱門影片數當成社會支持度。只有評論可用時，就交代誰對哪件事提出什麼具體說法。
        9. headline_video_ids 必須列出直接支持標題的輸入 videos[].video_id（至少一個），標題的每項具體主張都須有列出的影片支持。不要為寫標題新增輸入以外的事實。不足以寫出可靠標題時 headline 留空，headline_video_ids 用空陣列。
        10. 第一段直接交代具體動作、說法或進展，不要只寫「成為分析焦點」「引發討論」。來源分布與媒體比較放在後三段。
        11. 只輸出 JSON 物件，格式為 {"items":[{"title": 原事件標題（原封不動，僅供資料對應）, "headline": 新聞標題, "headline_video_ids": [支持標題的影片ID], "summary": 你寫的四段摘要}]}。items 的順序與數量必須對應輸入事件。
        PROMPT;

    /**
     * @param  list<array<string, mixed>>  $events
     * @return array<string, string> event title => summary (only well-formed entries)
     */
    public function summaries(array $events): array
    {
        return array_map(static fn (array $brief): string => $brief['summary'], $this->briefs($events));
    }

    /**
     * Original titles remain identity keys; editorial headlines are display-only.
     *
     * @param  list<array<string, mixed>>  $events
     * @return array<string, array{headline: string, summary: string}>
     */
    public function briefs(array $events): array
    {
        $events = array_values(array_filter(
            $events,
            static fn (array $event): bool => trim((string) ($event['title'] ?? '')) !== ''
        ));

        if ($events === []) {
            return [];
        }

        $fallbacks = collect($events)
            ->mapWithKeys(fn (array $event): array => [
                (string) $event['title'] => [
                    'headline' => (string) $event['title'],
                    'summary' => $this->fallback($event),
                ],
            ])
            ->filter(fn (array $brief): bool => $brief['summary'] !== '')
            ->all();
        $user = json_encode(['events' => $events], JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT | JSON_THROW_ON_ERROR);

        try {
            $result = $this->client->complete(self::SYSTEM, $user, [
                'response_format' => ['type' => 'json_object'],
            ]);
        } catch (Throwable) {
            return $fallbacks;
        }

        $generated = $this->parse($result['content']);

        foreach ($events as $event) {
            $title = (string) $event['title'];
            $item = $generated[$title] ?? [];
            $summary = $item['summary'] ?? null;

            if ($summary !== null && $this->namesRequiredMedia($summary, $event)) {
                $fallbacks[$title] = [
                    'headline' => $title,
                    'summary' => $summary,
                ];
            }

            // Source-name checks on the body must not discard an independently
            // valid headline when a grounded fallback body is available.
            if (isset($fallbacks[$title])) {
                $fallbacks[$title]['headline'] = $this->validatedHeadline($item, $event) ?? $title;
            }
        }

        return $fallbacks;
    }

    /**
     * Check shape and source membership, not factual entailment. Editorial
     * grounding and attribution are required by the prompt above.
     */
    private function validatedHeadline(array $item, array $event): ?string
    {
        $headline = $item['headline'] ?? null;
        $evidence = $item['headline_video_ids'] ?? null;
        if (! is_string($headline) || ! is_array($evidence) || ! array_is_list($evidence) || $evidence === []) {
            return null;
        }

        $headline = trim($headline);
        if (mb_strlen($headline) < 12 || mb_strlen($headline) > 64
            || preg_match('/[\r\n<>]/u', $headline) === 1) {
            return null;
        }

        $knownIds = collect((array) ($event['videos'] ?? []))
            ->filter(fn (mixed $video): bool => is_array($video) && is_string($video['title'] ?? null) && trim($video['title']) !== '')
            ->pluck('video_id')->filter(fn (mixed $id): bool => is_string($id) && $id !== '')->all();
        foreach ($evidence as $id) {
            if (! is_string($id) || ! in_array($id, $knownIds, true)) {
                return null;
            }
        }

        return $headline;
    }

    /**
     * Build a grounded summary when the editorial model is unavailable. Every
     * sentence is copied or composed from named source descriptions/titles.
     *
     * @param  array<string, mixed>  $event
     */
    private function fallback(array $event): string
    {
        $paragraphs = [];
        $description = trim((string) ($event['description'] ?? ''));
        if ($description !== '') {
            $paragraphs[] = $this->sentence($this->focusText($description, 180));
        } else {
            $title = trim((string) ($event['title'] ?? ''));
            $keywords = collect((array) ($event['keywords'] ?? []))
                ->filter(fn (mixed $keyword): bool => is_scalar($keyword) && trim((string) $keyword) !== '')
                ->map(fn (mixed $keyword): string => trim((string) $keyword))
                ->unique()
                ->take(4)
                ->values()
                ->all();
            if ($title !== '') {
                $paragraphs[] = $this->sentence(
                    $title.($keywords !== [] ? '，目前報導聚焦'.implode('、', $keywords) : ''),
                );
            }
        }

        $videos = collect((array) ($event['videos'] ?? []))
            ->filter(fn (mixed $video): bool => is_array($video))
            ->values();
        $reports = collect((array) ($event['media_reports'] ?? []))
            ->filter(fn (mixed $report): bool => is_array($report))
            ->map(function (array $report) use ($videos): array {
                if (trim((string) ($report['group'] ?? '')) !== '') {
                    return $report;
                }

                $uId = (int) ($report['u_id'] ?? 0);
                $channel = trim((string) ($report['channel'] ?? $report['媒體'] ?? ''));
                $matchingVideo = $videos->first(fn (array $video): bool => (
                    $uId > 0 && (int) ($video['u_id'] ?? 0) === $uId
                ) || (
                    $channel !== '' && trim((string) ($video['channel'] ?? '')) === $channel
                ));
                if (is_array($matchingVideo)) {
                    $report['group'] = trim((string) ($matchingVideo['group'] ?? ''));
                }

                return $report;
            })
            ->values();
        $groupOrder = collect((array) ($event['group_video_counts'] ?? []))
            ->filter(fn (mixed $count): bool => (int) $count > 0)
            ->sortDesc()
            ->keys();
        $orderedReports = $groupOrder
            ->map(fn (mixed $group): mixed => $reports->first(
                fn (array $report): bool => (string) ($report['group'] ?? '') === (string) $group,
            ))
            ->filter(fn (mixed $report): bool => is_array($report))
            ->concat($reports)
            ->unique(fn (array $report): string => trim((string) ($report['channel'] ?? $report['媒體'] ?? '')))
            ->values();

        $seenChannels = [];
        foreach ($orderedReports as $report) {
            if (! is_array($report)) {
                continue;
            }
            $channel = trim((string) ($report['channel'] ?? $report['媒體'] ?? ''));
            $detail = trim((string) ($report['description'] ?? $report['描述'] ?? ''));
            if ($channel === '' || $detail === '' || isset($seenChannels[$channel])) {
                continue;
            }

            $group = trim((string) ($report['group'] ?? ''));
            $paragraphs[] = $this->sourceParagraph($channel, $detail, $group);
            $seenChannels[$channel] = true;
            if (count($seenChannels) >= 2) {
                break;
            }
        }

        if (count($seenChannels) < 2) {
            $orderedVideos = $groupOrder
                ->map(fn (mixed $group): mixed => $videos->first(
                    fn (array $video): bool => (string) ($video['group'] ?? '') === (string) $group,
                ))
                ->filter(fn (mixed $video): bool => is_array($video))
                ->concat($videos)
                ->unique(fn (array $video): string => trim((string) ($video['channel'] ?? '')))
                ->values();

            foreach ($orderedVideos as $video) {
                if (! is_array($video)) {
                    continue;
                }
                $channel = trim((string) ($video['channel'] ?? ''));
                $title = trim((string) ($video['title'] ?? ''));
                if ($channel === '' || $title === '' || isset($seenChannels[$channel])) {
                    continue;
                }

                $paragraphs[] = $this->sourceParagraph(
                    $channel,
                    $title,
                    trim((string) ($video['group'] ?? '')),
                );
                $seenChannels[$channel] = true;
                if (count($seenChannels) >= 2) {
                    break;
                }
            }
        }

        if ($paragraphs === []) {
            return '';
        }
        if (count($seenChannels) < 2) {
            return '';
        }

        $focus = collect((array) ($event['keywords'] ?? []))
            ->filter(fn (mixed $keyword): bool => is_scalar($keyword) && trim((string) $keyword) !== '')
            ->map(fn (mixed $keyword): string => trim((string) $keyword))
            ->unique()
            ->take(5)
            ->values()
            ->all();
        if ($focus !== []) {
            $paragraphs[] = '整體報導共同關注'.implode('、', $focus).'等進展。';
        }

        return implode("\n\n", array_slice(array_values(array_unique($paragraphs)), 0, 4));
    }

    private function sentence(string $value): string
    {
        $value = trim($value);

        return preg_match('/[。！？!?]$/u', $value) === 1 ? $value : $value.'。';
    }

    private function shortTitle(string $title): string
    {
        return $this->focusText($title, 56);
    }

    private function sourceParagraph(string $channel, string $detail, string $group): string
    {
        $group = trim($group) ?: '其他';
        $focus = $this->focusText($detail, 44);

        return $group.'來源中，'.$channel.'著重'.$this->sentence($focus);
    }

    private function focusText(string $value, int $limit): string
    {
        $value = preg_replace('/\s+/u', ' ', trim($value)) ?? trim($value);
        $value = preg_replace('/^(?:【[^】]{1,30}】\s*)+/u', '', $value) ?? $value;
        $value = preg_replace('/^(?:[#＃][\p{L}\p{N}_-]+\s*)+/u', '', $value) ?? $value;
        $value = preg_replace('/\s*@[-_.a-z0-9]+\s*$/iu', '', $value) ?? $value;
        $parts = preg_split('/\s*[｜|]\s*/u', $value) ?: [];
        $value = trim((string) ($parts[0] ?? $value));
        $value = trim($value);
        $value = preg_replace('/[。.!！?？]+$/u', '', $value) ?? $value;

        return mb_strlen($value, 'UTF-8') > $limit
            ? rtrim(mb_substr($value, 0, $limit, 'UTF-8'), " \t\n\r\0\x0B，、；;：:").'…'
            : $value;
    }

    /**
     * AI copy may replace the grounded fallback only when it preserves the
     * required named-source attribution.
     *
     * @param  array<string, mixed>  $event
     */
    private function namesRequiredMedia(string $summary, array $event): bool
    {
        $channels = collect((array) ($event['media_reports'] ?? []))
            ->filter(fn (mixed $report): bool => is_array($report))
            ->map(fn (array $report): string => trim((string) ($report['channel'] ?? $report['媒體'] ?? '')))
            ->filter(fn (string $channel): bool => $channel !== '')
            ->unique()
            ->values();

        if ($channels->count() < 2) {
            $channels = $channels
                ->merge(collect((array) ($event['videos'] ?? []))
                    ->filter(fn (mixed $video): bool => is_array($video))
                    ->map(fn (array $video): string => trim((string) ($video['channel'] ?? '')))
                    ->filter(fn (string $channel): bool => $channel !== ''))
                ->unique()
                ->values();
        }

        if ($channels->count() < 2) {
            return true;
        }

        return $channels
            ->filter(fn (string $channel): bool => str_contains($summary, $channel))
            ->count() >= 2;
    }

    /**
     * @return array<string, array<string, mixed>>
     */
    private function parse(string $content): array
    {
        $decoded = json_decode($this->stripFence($content), true);
        $items = data_get($decoded, 'items');

        if (! is_array($items)) {
            return [];
        }

        $map = [];
        foreach ($items as $item) {
            if (! is_array($item)) {
                continue;
            }
            $title = is_string($item['title'] ?? null) ? trim($item['title']) : '';
            $summary = is_string($item['summary'] ?? null) ? trim($item['summary']) : '';
            if ($title !== '' && $summary !== '') {
                $map[$title] = [...$item, 'summary' => $summary];
            }
        }

        return $map;
    }

    private function stripFence(string $content): string
    {
        $trimmed = trim($content);

        if (str_starts_with($trimmed, '```')) {
            $trimmed = preg_replace('/^```(?:json)?\s*|\s*```$/i', '', $trimmed) ?? $trimmed;
        }

        return trim($trimmed);
    }
}
