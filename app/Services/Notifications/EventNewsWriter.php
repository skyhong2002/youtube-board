<?php

namespace App\Services\Notifications;

use Throwable;

/**
 * Turns structured AI-summary events into grounded Traditional-Chinese news briefs
 * using the full gpt-5.4 model, in a style close to @hn_best_cht.
 *
 * The prompt is grounded strictly in the supplied data (event title, keywords,
 * people, media, related video titles) and forbids inventing facts, so the
 * public channel does not publish hallucinated "news". If the model call or
 * parsing fails, callers get an empty map and fall back to no summary.
 */
class EventNewsWriter
{
    public function __construct(private OpenAiChatClient $client) {}

    private const SYSTEM = <<<'PROMPT'
        你是「臺灣 YouTube 新聞觀測站」Telegram 頻道的編輯。輸入是一批當日/當時 YouTube 上最受關注事件的結構化資料。請為每則事件寫一段繁體中文（台灣新聞用語）的新聞式摘要。

        嚴格規則：
        1. 只能根據提供的欄位（事件標題、原始描述、分類、角度、陣營、關鍵字、人物、地名、新聞台名稱、新聞台標籤、相關影片標題、影片數、媒體數）撰寫。嚴禁虛構、推測或補充資料中沒有的人名、數字、引述、地點或因果。
        2. 若資訊不足以寫出可靠的摘要，summary 就寫得保守、精簡，寧可少講也不要編造。
        3. 每則 3 至 6 句，像新聞導言，客觀中立、資訊密度高。資料若包含多個具名新聞台，至少指出兩家新聞台各自報導的重點；不要用「部分頻道」「有媒體」這類模糊說法。
        4. 新聞台的政治或兩岸屬性只能引用輸入的 channel_tags，不得根據印象自行判定。不同新聞台若有泛藍、泛綠、泛白、泛紅、較無偏、公共媒體、台灣立場或中國立場等標籤，應客觀交代其報導角度差異。
        5. 不要出現「根據資料」「本則事件」「以下」等後設用語，也不要加開場白或結語。
        6. 只輸出 JSON 物件，格式為 {"items":[{"title": 原事件標題（原封不動）, "summary": 你寫的摘要}]}。items 的順序與數量必須對應輸入事件。
        PROMPT;

    /**
     * @param  list<array<string, mixed>>  $events
     * @return array<string, string> event title => summary (only well-formed entries)
     */
    public function summaries(array $events): array
    {
        $events = array_values(array_filter(
            $events,
            static fn (array $event): bool => trim((string) ($event['title'] ?? '')) !== ''
        ));

        if ($events === []) {
            return [];
        }

        $user = json_encode(['events' => $events], JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT | JSON_THROW_ON_ERROR);

        try {
            $result = $this->client->complete(self::SYSTEM, $user, [
                'response_format' => ['type' => 'json_object'],
            ]);
        } catch (Throwable) {
            return [];
        }

        return $this->parse($result['content']);
    }

    /**
     * @return array<string, string>
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
            $title = trim((string) ($item['title'] ?? ''));
            $summary = trim((string) ($item['summary'] ?? ''));
            if ($title !== '' && $summary !== '') {
                $map[$title] = $summary;
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
