<?php

namespace App\Services\Ingestion;

use App\Services\Legacy\LegacyTagFilter;
use Carbon\CarbonImmutable;
use Carbon\CarbonInterface;
use Illuminate\Database\Query\Builder;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

class AiHourlyPreview
{
    public const MAX_PROMPT_VIDEO_LIMIT = 5000;

    public function __construct(private readonly LegacyTagFilter $tagFilter) {}

    /**
     * @return array<string, mixed>
     */
    public function preview(
        ?string $condition = null,
        int $hour = 1,
        int $period = 1,
        int $limit = 20,
        int $promptVideoLimit = self::MAX_PROMPT_VIDEO_LIMIT,
        ?CarbonInterface $now = null,
    ): array {
        $timezone = (string) config('ingestion.timezone', config('app.timezone', 'Asia/Taipei'));
        $now = $now === null
            ? CarbonImmutable::now($timezone)
            : CarbonImmutable::instance($now->toDateTimeImmutable())->setTimezone($timezone);
        $hour = max(0, min(168, $hour));
        $period = max(1, min(48, $period));
        $limit = max(1, min(1000, $limit));
        $requestedPromptVideoLimit = $promptVideoLimit;
        $promptVideoLimit = $promptVideoLimit <= 0
            ? self::MAX_PROMPT_VIDEO_LIMIT
            : min(self::MAX_PROMPT_VIDEO_LIMIT, $promptVideoLimit);
        $explicitCondition = is_string($condition) && trim($condition) !== '';
        $conditionType = $this->conditionType($condition);
        $filters = $this->filters($conditionType, $explicitCondition);
        $matchingUIds = $this->matchingUIds($filters);
        $periodWindow = $this->periodWindow($now, $hour, $period);
        $videoQuery = $this->videoQuery($periodWindow, $matchingUIds, $filters);
        $videoRows = (clone $videoQuery)->count();
        $sourceRows = (clone $videoQuery)
            ->orderByDesc('viewCount')
            ->orderBy('videoId')
            ->limit($promptVideoLimit + 1)
            ->get($this->videoColumns());
        $sourceTruncated = $videoRows > $promptVideoLimit || $sourceRows->count() > $promptVideoLimit;
        $rows = $sourceRows->take($promptVideoLimit);
        $bounds = $this->promptBounds($videoRows);
        $prompt = $this->prompt($rows, $bounds);
        $displayRows = $rows->take($limit)->map(fn (object $row): array => $this->mapVideoRow($row))->values();
        $hasEligibleSource = $rows->isNotEmpty() && ! $sourceTruncated;

        return [
            'mode' => 'ingestion-preview',
            'status' => $sourceTruncated ? 'blocked' : 'success',
            'exit_code' => $sourceTruncated ? 1 : 0,
            'failed_rows' => $sourceTruncated ? 1 : 0,
            'source' => 'legacy_ai_hour_prompt',
            'generated_at' => $now->format('Y-m-d H:i:s'),
            'condition_type' => $conditionType,
            'explicit_condition' => $explicitCondition,
            'filters' => [
                'tagid' => $filters['tagid'],
                'or' => $filters['or'],
                'not' => $filters['not'],
            ],
            'hour' => $hour,
            'period' => $period,
            'date_from' => $periodWindow['from'],
            'date_to' => $periodWindow['to'],
            'data_type' => 'each',
            'matching_channels' => $matchingUIds === null ? null : count($matchingUIds),
            'video_rows' => $videoRows,
            'displayed_rows' => $displayRows->count(),
            'prompt_video_rows' => $rows->count(),
            'prompt_video_limit' => $promptVideoLimit,
            'prompt_video_limit_requested' => $requestedPromptVideoLimit,
            'prompt_video_limit_clamped' => $requestedPromptVideoLimit !== $promptVideoLimit,
            'prompt_video_limit_max' => self::MAX_PROMPT_VIDEO_LIMIT,
            'prompt_omitted_video_rows' => max(0, $videoRows - $rows->count()),
            'source_complete' => ! $sourceTruncated,
            'source_truncated' => $sourceTruncated,
            'blocked_reason' => $sourceTruncated ? 'hourly_prompt_video_limit_exceeded' : null,
            'prompt_bounds' => $bounds,
            'prompt_chars' => mb_strlen($prompt, 'UTF-8'),
            'prompt' => $prompt,
            'existing_ai_hour_rows' => $this->existingAiHourRows($conditionType, $periodWindow),
            'would_call_ai_requests' => $hasEligibleSource ? 1 : 0,
            'would_insert_ai_hour_rows' => $hasEligibleSource ? 1 : 0,
            'api_call_skipped' => 'AI chat completions are intentionally skipped in planning mode',
            'writes_skipped' => [
                'OpenAI/OpenCode chat completion for hourly AI prompt',
                'urt_ai_hour insert',
            ],
            'rows' => $displayRows->all(),
            'writes' => [],
        ];
    }

    private function conditionType(?string $condition): string
    {
        $condition = is_string($condition) && trim($condition) !== '' ? trim($condition) : 'all';

        return in_array($condition, ['all', 'green', 'blue', 'neutral', 'finance', 'world', 'news'], true)
            ? $condition
            : 'all';
    }

    /**
     * @return array{or: list<int>, tagid: list<int>, not: list<int>, limit: int}
     */
    private function filters(string $conditionType, bool $explicitCondition): array
    {
        if (! $explicitCondition) {
            return ['or' => [], 'tagid' => [], 'not' => [31, 41], 'limit' => 1000];
        }

        return match ($conditionType) {
            'blue' => ['or' => [], 'tagid' => [3, 13], 'not' => [], 'limit' => 1000],
            'green' => ['or' => [], 'tagid' => [4, 13], 'not' => [], 'limit' => 1000],
            'neutral' => ['or' => [], 'tagid' => [13], 'not' => [3, 4, 5, 6, 31, 41], 'limit' => 1000],
            'finance' => ['or' => [], 'tagid' => [31], 'not' => [], 'limit' => 1000],
            'world' => ['or' => [], 'tagid' => [41], 'not' => [], 'limit' => 1000],
            'news' => ['or' => [13, 31, 41], 'tagid' => [13], 'not' => [], 'limit' => 1000],
            default => ['or' => [], 'tagid' => [102], 'not' => [], 'limit' => 1000],
        };
    }

    /**
     * @param  array{or: list<int>, tagid: list<int>, not: list<int>}  $filters
     * @return list<int>|null
     */
    private function matchingUIds(array $filters): ?array
    {
        if ($filters['or'] === [] && $filters['tagid'] === [] && $filters['not'] === []) {
            return null;
        }

        if (! Schema::hasTable('urt_count')) {
            return [];
        }

        return $this->tagFilter->matchingChannelTags($filters)
            ->pluck('u_id')
            ->map(fn (mixed $uId): int => (int) $uId)
            ->filter(fn (int $uId): bool => $uId > 0)
            ->unique()
            ->values()
            ->all();
    }

    /**
     * @return array{from: string, to: string}
     */
    private function periodWindow(CarbonImmutable $now, int $hour, int $period): array
    {
        return [
            'from' => $now->subHours($hour + $period - 1)->startOfHour()->format('Y-m-d H:i:s'),
            'to' => $now->subHours($hour)->setMinute(59)->setSecond(59)->format('Y-m-d H:i:s'),
        ];
    }

    /**
     * @param  array{from: string, to: string}  $periodWindow
     * @param  list<int>|null  $matchingUIds
     * @param  array{or: list<int>, tagid: list<int>, not: list<int>}  $filters
     */
    private function videoQuery(array $periodWindow, ?array $matchingUIds, array $filters): Builder
    {
        $query = DB::table('urt_video');

        if (! Schema::hasTable('urt_video')) {
            return $query->whereRaw('1 = 0');
        }

        $query
            ->where('publishedAt', '>=', $periodWindow['from'])
            ->where('publishedAt', '<=', $periodWindow['to']);

        if ($matchingUIds !== null && $matchingUIds !== []) {
            $query->whereIn('u_id', $matchingUIds);
        } elseif ($matchingUIds === [] && ($filters['or'] !== [] || $filters['tagid'] !== [] || $filters['not'] !== [])) {
            $query->whereRaw('1 = 0');
        }

        return $query;
    }

    /**
     * @return list<string>
     */
    private function videoColumns(): array
    {
        $desired = ['pk', 'u_id', 'videoId', 'publishedAt', 'title', 'channelTitle', 'viewCount', 'likeCount', 'commentCount'];
        $available = Schema::hasTable('urt_video') ? Schema::getColumnListing('urt_video') : [];

        return collect($desired)
            ->filter(fn (string $column): bool => in_array($column, $available, true))
            ->values()
            ->all();
    }

    /**
     * @return array{min: int, max: int}
     */
    private function promptBounds(int $videoRows): array
    {
        return [
            'min' => 3 + (int) floor($videoRows / 31),
            'max' => 6 + (int) ceil($videoRows / 29),
        ];
    }

    /**
     * @param  Collection<int, object>  $rows
     * @param  array{min: int, max: int}  $bounds
     */
    private function prompt(Collection $rows, array $bounds): string
    {
        $lines = [
            '',
            '請把下面的影片標題列表，整理成 '.$bounds['min'].' ~ '.$bounds['max'].' 個主要事件，是把不同標題但是講類似的事整併在一起成事件，盡量整併最多的影片，留下最少兩部影片的事件。',
            '',
            '每個事件都有事件與描述，並列出每個事件的關鍵字與人物與地名，加上一個欄位判斷出這事件論述的角度是比較偏台灣或是中國出發，也加上一個欄位判斷出這觀點立場是比較偏國民黨或民進黨陣營思考，以新聞的分類（類型：政治、地方、國際、財經、娛樂、體育、氣象、生活、兩岸、健康、科技、文化)，跟分出來的 videoId (最前面的序號) 列表。',
            '',
            '後用 JSON 列出，元素：事件、描述、角度、陣營，陣列：關鍵字、人物、地名、分類、videoId，請用繁體中文回應，且只要 JSON 就好：',
            '',
        ];

        foreach ($rows as $row) {
            $videoId = (string) $this->value($row, 'videoId');
            $title = (string) ($this->value($row, 'title') ?? '');
            $lines[] = $videoId.'：'.$title;
        }

        return implode("\n", $lines);
    }

    /**
     * @param  array{from: string, to: string}  $periodWindow
     */
    private function existingAiHourRows(string $conditionType, array $periodWindow): int
    {
        if (! Schema::hasTable('urt_ai_hour')) {
            return 0;
        }

        return DB::table('urt_ai_hour')
            ->where('date_from', $periodWindow['from'])
            ->where('date_to', $periodWindow['to'])
            ->where('condition_type', $conditionType)
            ->where('data_type', 'each')
            ->whereNull('del_flag')
            ->count();
    }

    /**
     * @return array<string, mixed>
     */
    private function mapVideoRow(object $row): array
    {
        return [
            'pk' => $this->value($row, 'pk') !== null ? (int) $this->value($row, 'pk') : null,
            'u_id' => $this->value($row, 'u_id') !== null ? (int) $this->value($row, 'u_id') : null,
            'video_id' => (string) $this->value($row, 'videoId'),
            'published_at' => $this->value($row, 'publishedAt') !== null ? (string) $this->value($row, 'publishedAt') : null,
            'title' => $this->value($row, 'title') !== null ? (string) $this->value($row, 'title') : null,
            'channel_title' => $this->value($row, 'channelTitle') !== null ? (string) $this->value($row, 'channelTitle') : null,
            'view_count' => $this->value($row, 'viewCount') !== null ? (int) $this->value($row, 'viewCount') : null,
            'like_count' => $this->value($row, 'likeCount') !== null ? (int) $this->value($row, 'likeCount') : null,
            'comment_count' => $this->value($row, 'commentCount') !== null ? (int) $this->value($row, 'commentCount') : null,
        ];
    }

    private function value(object $row, string $column): mixed
    {
        return property_exists($row, $column) ? $row->{$column} : null;
    }
}
