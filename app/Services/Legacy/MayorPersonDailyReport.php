<?php

namespace App\Services\Legacy;

use Carbon\CarbonImmutable;
use Illuminate\Database\Query\Builder;
use Illuminate\Database\QueryException;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

class MayorPersonDailyReport
{
    private const TAG_IDS = [3, 4, 5, 6];

    private const TAG_FALLBACK_NAMES = [
        3 => '泛藍',
        4 => '泛綠',
        5 => '泛紅',
        6 => '泛白',
    ];

    private const TYPES = [
        'tags_views' => '觀看聲量',
        'tags_video' => '影片提及聲量',
        'tags_result' => '關鍵字重要度',
    ];

    public function __construct(private readonly MayorReport $mayorReport)
    {
    }

    /**
     * @return array<string, mixed>
     */
    public function forPerson(Request $request, string $cityKey, string $person, ?string $routeDate = null): array
    {
        $city = $this->city($cityKey);
        $requestedPerson = trim(rawurldecode($person));
        $resolvedPerson = $this->resolvePerson($requestedPerson);
        $type = $this->type($request);
        $date = $this->date($request, $routeDate, $city['key'], $resolvedPerson, $type);
        $tagNames = $this->tagNames();
        $daily = $this->dailySignals($resolvedPerson, $date, $type, $tagNames);
        $previousDaily = $this->dailySignals($resolvedPerson, $this->shiftDate($date, -1), $type, $tagNames);
        $videoBundle = $this->videos($resolvedPerson, $date);
        $mediaShare = $this->mediaShareSnapshot($request, $city, $resolvedPerson, $date, $type);
        $summary = $this->summary($city, $resolvedPerson, $daily, $previousDaily, $mediaShare, $videoBundle['videos']);
        $ai = $this->aiCache($city['key'], $resolvedPerson, $date);

        return [
            'available' => $daily['available'] || $videoBundle['available'],
            'data_available' => $daily['has_data'] || $videoBundle['videos'] !== [],
            'title' => $city['label'].' '.$resolvedPerson.' 每日 Dashboard',
            'city' => $city,
            'cities' => $this->mayorReport->cities(),
            'person' => $resolvedPerson,
            'requested_person' => $requestedPerson,
            'used_alias' => false,
            'candidate_found' => in_array($resolvedPerson, $city['candidates'], true),
            'candidate_links' => $city['candidates'],
            'date' => $date,
            'prev_date' => $this->shiftDate($date, -1),
            'next_date' => $this->shiftDate($date, 1),
            'type' => $type,
            'type_name' => self::TYPES[$type],
            'types' => self::TYPES,
            'tagids' => self::TAG_IDS,
            'tag_rows' => $daily['tag_rows'],
            'daily_totals' => $daily['totals'],
            'previous_totals' => $previousDaily['totals'],
            'summary' => $summary,
            'ai' => $ai,
            'observations' => $ai['what_happened'] !== []
                ? $ai['what_happened']
                : $this->observations($summary, $daily, $previousDaily, $videoBundle),
            'recommendations' => $ai['adjustments'] !== []
                ? $ai['adjustments']
                : $this->recommendations($summary, $daily, $videoBundle),
            'videos' => $videoBundle['videos'],
            'video_source' => $videoBundle['source'],
            'related_keywords' => $videoBundle['related_keywords'],
            'cache_rows' => $daily['cache_rows'] + $videoBundle['cache_rows'],
            'dependencies' => $this->dependencies(),
            'generated_at' => now('Asia/Taipei')->format('Y-m-d H:i:s'),
        ];
    }

    /**
     * @return array{key: string, label: string, candidates: list<string>, factors: array<string, array<int, float>>, source: string}
     */
    private function city(string $cityKey): array
    {
        $cityKey = strtolower(trim($cityKey));
        $cityKey = preg_match('/^[a-z0-9_]+$/', $cityKey) ? $cityKey : 'taipei';
        $cities = $this->mayorReport->cities();

        return $cities[$cityKey] ?? $cities['taipei'];
    }

    private function resolvePerson(string $person): string
    {
        return $person;
    }

    private function type(Request $request): string
    {
        $type = (string) $request->query('type', 'tags_views');
        $type = match ($type) {
            'tags_view', 'views' => 'tags_views',
            'videos' => 'tags_video',
            'result' => 'tags_result',
            default => $type,
        };

        return array_key_exists($type, self::TYPES) ? $type : 'tags_views';
    }

    private function isCalendarDate(string $value): bool
    {
        return preg_match('/^(\d{4})-(\d{2})-(\d{2})$/', $value, $parts) === 1
            && checkdate((int) $parts[2], (int) $parts[3], (int) $parts[1]);
    }

    private function date(Request $request, ?string $routeDate, string $cityKey, string $person, string $type): string
    {
        if (is_string($routeDate) && $this->isCalendarDate($routeDate)) {
            return $routeDate;
        }

        $queryDate = $request->query('date');
        if (is_string($queryDate) && $this->isCalendarDate($queryDate)) {
            return $queryDate;
        }

        $today = max(0, min(3650, (int) $request->query('today', 0)));
        if ($request->has('today')) {
            return CarbonImmutable::now('Asia/Taipei')->subDays($today)->toDateString();
        }

        return $this->latestAiDate($cityKey, $person)
            ?? $this->latestSignalDate($person, $type)
            ?? $this->latestVideoDate($person)
            ?? CarbonImmutable::now('Asia/Taipei')->subDay()->toDateString();
    }

    private function shiftDate(string $date, int $days): string
    {
        return CarbonImmutable::parse($date, 'Asia/Taipei')->addDays($days)->toDateString();
    }

    private function latestSignalDate(string $person, string $type): ?string
    {
        if (! Schema::hasTable('urt_show_tag_date') || ! Schema::hasColumn('urt_show_tag_date', $type)) {
            return null;
        }

        try {
            $latest = DB::table('urt_show_tag_date')
                ->whereIn('tagid', array_map('strval', self::TAG_IDS))
                ->where(function (Builder $query): void {
                    $query->whereNull('tag_or')->orWhere('tag_or', '');
                })
                ->where(function (Builder $query): void {
                    $query->whereNull('tag_not')->orWhere('tag_not', '');
                })
                ->where($type, 'like', '%'.$this->escapeLike($person).'%')
                ->max('the_date');
        } catch (QueryException) {
            return null;
        }

        return is_string($latest) && preg_match('/^\d{4}-\d{2}-\d{2}/', $latest)
            ? substr($latest, 0, 10)
            : null;
    }

    private function latestAiDate(string $cityKey, string $person): ?string
    {
        if (! Schema::hasTable('urt_mayor_person_ai')) {
            return null;
        }

        try {
            $latest = DB::table('urt_mayor_person_ai')
                ->where('city_key', $cityKey)
                ->where('person', $person)
                ->whereNull('del_flag')
                ->max('the_date');
        } catch (QueryException) {
            return null;
        }

        return is_string($latest) && preg_match('/^\d{4}-\d{2}-\d{2}/', $latest)
            ? substr($latest, 0, 10)
            : null;
    }

    private function latestVideoDate(string $person): ?string
    {
        if (! Schema::hasTable('urt_video') || ! Schema::hasColumn('urt_video', 'publishedAt')) {
            return null;
        }

        $textColumns = collect(['title', 'description'])
            ->filter(fn (string $column): bool => Schema::hasColumn('urt_video', $column))
            ->values()
            ->all();

        if ($textColumns === []) {
            return null;
        }

        try {
            $latest = DB::table('urt_video')
                ->where(function (Builder $query) use ($person, $textColumns): void {
                    foreach ($textColumns as $column) {
                        $query->orWhere($column, 'like', '%'.$this->escapeLike($person).'%');
                    }
                })
                ->max('publishedAt');
        } catch (QueryException) {
            return null;
        }

        return is_string($latest) && preg_match('/^\d{4}-\d{2}-\d{2}/', $latest)
            ? substr($latest, 0, 10)
            : null;
    }

    /**
     * @param array<int, string> $tagNames
     * @return array{available: bool, has_data: bool, cache_rows: int, tag_rows: list<array<string, mixed>>, totals: array{views: float, videos: float, result: float, selected: float, positive: float, negative: float}}
     */
    private function dailySignals(string $person, string $date, string $type, array $tagNames): array
    {
        $empty = [
            'available' => false,
            'has_data' => false,
            'cache_rows' => 0,
            'tag_rows' => [],
            'totals' => [
                'views' => 0.0,
                'videos' => 0.0,
                'result' => 0.0,
                'selected' => 0.0,
                'positive' => 0.0,
                'negative' => 0.0,
            ],
        ];

        if (! Schema::hasTable('urt_show_tag_date')) {
            return $empty;
        }

        try {
            $records = DB::table('urt_show_tag_date')
                ->where('the_date', $date)
                ->whereIn('tagid', array_map('strval', self::TAG_IDS))
                ->where(function (Builder $query): void {
                    $query->whereNull('tag_or')->orWhere('tag_or', '');
                })
                ->where(function (Builder $query): void {
                    $query->whereNull('tag_not')->orWhere('tag_not', '');
                })
                ->orderByDesc('pk')
                ->get();
        } catch (QueryException) {
            return $empty;
        }

        $seen = [];
        $rows = [];
        $totals = $empty['totals'];

        foreach ($records as $record) {
            $tagId = (int) ($record->tagid ?? 0);

            if (! in_array($tagId, self::TAG_IDS, true) || isset($seen[$tagId])) {
                continue;
            }

            $seen[$tagId] = true;
            $views = $this->keywordValue($record->tags_views ?? null, $person);
            $videos = $this->keywordValue($record->tags_video ?? null, $person);
            $result = $this->keywordValue($record->tags_result ?? null, $person);
            $selected = match ($type) {
                'tags_video' => $videos,
                'tags_result' => $result,
                default => $views,
            };

            $effect = $selected >= 0 ? 'positive' : 'negative';
            $totals['views'] += $views;
            $totals['videos'] += $videos;
            $totals['result'] += $result;
            $totals['selected'] += $selected;
            $totals[$effect] += abs($selected);

            $rows[] = [
                'tag_id' => $tagId,
                'tag_name' => $tagNames[$tagId] ?? self::TAG_FALLBACK_NAMES[$tagId],
                'views' => $views,
                'videos' => $videos,
                'result' => $result,
                'selected' => $selected,
            ];
        }

        return [
            'available' => true,
            'has_data' => collect($rows)->contains(fn (array $row): bool => abs((float) $row['selected']) > 0.000001),
            'cache_rows' => count($rows),
            'tag_rows' => $rows,
            'totals' => $totals,
        ];
    }

    private function keywordValue(mixed $json, string $person): float
    {
        if (! is_string($json) || trim($json) === '') {
            return 0.0;
        }

        $decoded = json_decode($json, true);

        if (! is_array($decoded)) {
            return 0.0;
        }

        return is_numeric($decoded[$person] ?? null) ? (float) $decoded[$person] : 0.0;
    }

    /**
     * @return array{available: bool, source: string, cache_rows: int, videos: list<array<string, mixed>>, related_keywords: array<string, float>}
     */
    private function videos(string $person, string $date): array
    {
        $videoIds = [];
        $related = [];
        $cacheRows = 0;
        $source = 'urt_video title/description derived real-time YouTube dashboard';

        if (Schema::hasTable('urt_show_video_tag_date')) {
            try {
                $record = DB::table('urt_show_video_tag_date')
                    ->where('tag', $person)
                    ->where('the_date', $date)
                    ->orderByDesc('pk')
                    ->first();

                if ($record !== null) {
                    $cacheRows = 1;
                    $videoIds = $this->decodeVideoIds($record->videos_json ?? null);
                    $related = $this->decodeKeywordMap($record->tags_json ?? null, $person);
                    $source = 'urt_show_video_tag_date + urt_video';
                }
            } catch (QueryException) {
                $videoIds = [];
                $related = [];
            }
        }

        $videos = $this->videoRowsByIds($videoIds);

        if ($videos === []) {
            $videos = $this->rawVideoRows($person, $date);
        }

        if ($related === [] && $videos !== []) {
            $related = $this->keywordsFromTitles($videos, $person);
        }

        return [
            'available' => Schema::hasTable('urt_video') || Schema::hasTable('urt_show_video_tag_date'),
            'source' => $source,
            'cache_rows' => $cacheRows,
            'videos' => $videos,
            'related_keywords' => $related,
        ];
    }

    /**
     * @param list<string> $videoIds
     * @return list<array<string, mixed>>
     */
    private function videoRowsByIds(array $videoIds): array
    {
        $videoIds = collect($videoIds)
            ->map(fn (string $videoId): string => trim($videoId))
            ->filter()
            ->unique()
            ->values()
            ->all();

        if ($videoIds === [] || ! Schema::hasTable('urt_video') || ! Schema::hasColumn('urt_video', 'videoId')) {
            return [];
        }

        try {
            $query = DB::table('urt_video')
                ->select($this->videoColumns())
                ->whereIn('videoId', $videoIds);

            $this->orderVideos($query);

            return $this->mapVideos($query->limit(8)->get()->all());
        } catch (QueryException) {
            return [];
        }
    }

    /**
     * @return list<array<string, mixed>>
     */
    private function rawVideoRows(string $person, string $date): array
    {
        if (! Schema::hasTable('urt_video') || ! Schema::hasColumn('urt_video', 'publishedAt')) {
            return [];
        }

        $columns = $this->videoColumns();
        $textColumns = collect(['title', 'description'])
            ->filter(fn (string $column): bool => in_array($column, $columns, true))
            ->values()
            ->all();

        if ($textColumns === []) {
            return [];
        }

        try {
            $query = DB::table('urt_video')
                ->select($columns)
                ->whereBetween('publishedAt', [$date.' 00:00:00', $date.' 23:59:59'])
                ->where(function (Builder $query) use ($person, $textColumns): void {
                    foreach ($textColumns as $column) {
                        $query->orWhere($column, 'like', '%'.$this->escapeLike($person).'%');
                    }
                });

            $this->orderVideos($query);

            return $this->mapVideos($query->limit(8)->get()->all());
        } catch (QueryException) {
            return [];
        }
    }

    /**
     * @return list<string>
     */
    private function videoColumns(): array
    {
        $candidates = [
            'videoId',
            'u_id',
            'thumbnails',
            'channelTitle',
            'publishedAt',
            'title',
            'description',
            'viewCount',
            'likeCount',
            'commentCount',
        ];

        return collect($candidates)
            ->filter(fn (string $column): bool => Schema::hasColumn('urt_video', $column))
            ->values()
            ->all();
    }

    private function orderVideos(Builder $query): void
    {
        if (Schema::hasColumn('urt_video', 'viewCount')) {
            $query->orderByDesc('viewCount');
        }

        if (Schema::hasColumn('urt_video', 'publishedAt')) {
            $query->orderByDesc('publishedAt');
        }
    }

    /**
     * @param list<object> $rows
     * @return list<array<string, mixed>>
     */
    private function mapVideos(array $rows): array
    {
        return collect($rows)
            ->map(function (object $row, int $index): array {
                $videoId = (string) ($row->videoId ?? '');

                return [
                    'rank' => $index + 1,
                    'video_id' => $videoId,
                    'u_id' => (int) ($row->u_id ?? 0),
                    'thumbnail' => $row->thumbnails ?? null,
                    'channel_title' => (string) ($row->channelTitle ?? ''),
                    'published_at' => (string) ($row->publishedAt ?? ''),
                    'title' => (string) ($row->title ?? ''),
                    'view_count' => (int) ($row->viewCount ?? 0),
                    'like_count' => (int) ($row->likeCount ?? 0),
                    'comment_count' => (int) ($row->commentCount ?? 0),
                    'youtube_url' => 'https://www.youtube.com/watch?v='.$videoId,
                ];
            })
            ->filter(fn (array $row): bool => $row['video_id'] !== '' || $row['title'] !== '')
            ->values()
            ->all();
    }

    /**
     * @return list<string>
     */
    private function decodeVideoIds(mixed $json): array
    {
        if (! is_string($json) || trim($json) === '') {
            return [];
        }

        $decoded = json_decode($json, true);

        if (! is_array($decoded)) {
            return [];
        }

        foreach (['videos', 'videos_json', 'result', 'data'] as $key) {
            if (! array_is_list($decoded) && isset($decoded[$key]) && is_array($decoded[$key])) {
                $decoded = $decoded[$key];
                break;
            }
        }

        if (array_is_list($decoded)) {
            return collect($decoded)
                ->map(function (mixed $item): string {
                    if (is_array($item)) {
                        return trim((string) ($item['videoId'] ?? $item['video_id'] ?? $item['id'] ?? ''));
                    }

                    return trim((string) $item);
                })
                ->filter()
                ->values()
                ->all();
        }

        return collect($decoded)
            ->keys()
            ->map(fn (mixed $videoId): string => trim((string) $videoId))
            ->filter()
            ->values()
            ->all();
    }

    /**
     * @return array<string, float>
     */
    private function decodeKeywordMap(mixed $json, string $person): array
    {
        if (! is_string($json) || trim($json) === '') {
            return [];
        }

        $decoded = json_decode($json, true);

        if (! is_array($decoded)) {
            return [];
        }

        return collect($decoded)
            ->filter(fn (mixed $value, mixed $key): bool => is_string($key) && is_numeric($value) && $key !== $person)
            ->map(fn (mixed $value): float => (float) $value)
            ->sortDesc()
            ->take(10)
            ->all();
    }

    /**
     * @param list<array<string, mixed>> $videos
     * @return array<string, float>
     */
    private function keywordsFromTitles(array $videos, string $person): array
    {
        $stopwords = [$person, '新聞', '最新', '直播', '完整', '獨家', '台灣', '今天', '專訪'];
        $counts = [];

        foreach ($videos as $video) {
            preg_match_all('/[\p{Han}A-Za-z0-9]{2,}/u', (string) ($video['title'] ?? ''), $matches);

            foreach ($matches[0] ?? [] as $word) {
                if (in_array($word, $stopwords, true) || str_contains($person, $word) || str_contains($word, $person)) {
                    continue;
                }

                $counts[$word] = ($counts[$word] ?? 0) + 1;
            }
        }

        arsort($counts);

        return array_slice($counts, 0, 10, true);
    }

    /**
     * @param array{key: string, label: string, candidates: list<string>, factors: array<string, array<int, float>>, source: string} $city
     * @return array{percentage: float|null, raw: float|null, total: float|null}
     */
    private function mediaShareSnapshot(Request $request, array $city, string $person, string $date, string $type): array
    {
        $supportRequest = Request::create('/mayor/cities/'.$city['key'], 'GET', array_merge($request->query(), [
            'from' => $date,
            'to' => $date,
            'type' => $type,
        ]));
        $report = $this->mayorReport->report($supportRequest, $city['key']);
        $row = collect($report['series'] ?? [])->firstWhere('date', $date);

        if (! is_array($row)) {
            return ['percentage' => null, 'raw' => null, 'total' => null];
        }

        return [
            'percentage' => isset($row['percentages'][$person]) ? (float) $row['percentages'][$person] : null,
            'raw' => isset($row['raw'][$person]) ? (float) $row['raw'][$person] : null,
            'total' => isset($row['total']) ? (float) $row['total'] : null,
        ];
    }

    /**
     * @param array{key: string, label: string, candidates: list<string>, factors: array<string, array<int, float>>, source: string} $city
     * @param array{tag_rows: list<array<string, mixed>>, totals: array<string, float>} $daily
     * @param array{tag_rows: list<array<string, mixed>>, totals: array<string, float>} $previousDaily
     * @param array{percentage: float|null, raw: float|null, total: float|null} $mediaShare
     * @param list<array<string, mixed>> $videos
     * @return array<string, mixed>
     */
    private function summary(array $city, string $person, array $daily, array $previousDaily, array $mediaShare, array $videos): array
    {
        $factors = $city['factors'][$person] ?? [];
        $tagRows = collect($daily['tag_rows'])
            ->map(function (array $row) use ($factors): array {
                $factor = (float) ($factors[(int) $row['tag_id']] ?? 0.0);

                return $row + [
                    'factor' => $factor,
                    'weighted' => (float) $row['selected'] * $factor,
                ];
            })
            ->values()
            ->all();
        $dominant = collect($tagRows)->sortByDesc(fn (array $row): float => abs((float) $row['selected']))->first();
        $weighted = collect($tagRows)->sum(fn (array $row): float => (float) $row['weighted']);
        $positive = collect($tagRows)->filter(fn (array $row): bool => (float) $row['weighted'] > 0)->sum('weighted');
        $negative = abs(collect($tagRows)->filter(fn (array $row): bool => (float) $row['weighted'] < 0)->sum('weighted'));
        $delta = (float) ($daily['totals']['selected'] ?? 0) - (float) ($previousDaily['totals']['selected'] ?? 0);
        $posture = match (true) {
            $negative > $positive * 0.8 && $negative > 0 => '防守澄清',
            $positive > $negative * 1.3 && $positive > 0 => '主動放大',
            default => '持續觀察',
        };

        return [
            'media_share_percentage' => $mediaShare['percentage'],
            'rolling_volume' => $mediaShare['raw'],
            'weighted_score' => $weighted,
            'positive_pressure' => $positive,
            'negative_pressure' => $negative,
            'selected_total' => (float) ($daily['totals']['selected'] ?? 0),
            'selected_delta' => $delta,
            'views_total' => (float) ($daily['totals']['views'] ?? 0),
            'videos_total' => (float) ($daily['totals']['videos'] ?? 0),
            'result_total' => (float) ($daily['totals']['result'] ?? 0),
            'representative_videos' => count($videos),
            'dominant_tag' => $dominant,
            'tag_rows' => $tagRows,
            'posture' => $posture,
        ];
    }

    /**
     * @param array<string, mixed> $summary
     * @param array<string, mixed> $daily
     * @param array<string, mixed> $previousDaily
     * @param array<string, mixed> $videoBundle
     * @return list<string>
     */
    private function observations(array $summary, array $daily, array $previousDaily, array $videoBundle): array
    {
        if (! ($daily['has_data'] ?? false) && ($videoBundle['videos'] ?? []) === []) {
            return ['今天沒有抓到這位人物的 mayor tag cache 或代表影片，適合先檢查 ingestion 是否涵蓋該人物關鍵字。'];
        }

        $dominant = $summary['dominant_tag'] ?? null;
        $observations = [];

        if (is_array($dominant)) {
            $observations[] = '最高聲量來源是 '.$dominant['tag_name'].'，'.$this->formatNumber((float) $dominant['selected']).' '.$summary['posture'].'訊號。';
        }

        $delta = (float) ($summary['selected_delta'] ?? 0.0);
        if (abs($delta) > 0.000001) {
            $observations[] = '相較前一日，'.$this->formatNumber(abs($delta)).' '.$this->deltaWord($delta).'，需要比對代表影片標題確認是單一事件還是持續議題。';
        }

        if (($summary['representative_videos'] ?? 0) > 0) {
            $observations[] = '今天找到 '.number_format((int) $summary['representative_videos']).' 則代表影片，可作為市長辦公室晨會的事件清單。';
        }

        if ($observations === []) {
            $observations[] = '今日資料量低，先維持監測，不建議為單日低量訊號大幅調整訊息主軸。';
        }

        return $observations;
    }

    /**
     * @param array<string, mixed> $summary
     * @param array<string, mixed> $daily
     * @param array<string, mixed> $videoBundle
     * @return list<string>
     */
    private function recommendations(array $summary, array $daily, array $videoBundle): array
    {
        if (! ($daily['has_data'] ?? false) && ($videoBundle['videos'] ?? []) === []) {
            return [
                '先確認今日 mayor cache 與 keyword-video cache 是否完成，再決定是否回應。',
                '若這是新納入的人物，先把姓名、常見錯字與相關議題加入例行監測清單。',
            ];
        }

        $dominant = $summary['dominant_tag'] ?? null;
        $dominantName = is_array($dominant) ? (string) $dominant['tag_name'] : '最高聲量來源';
        $keywords = array_keys($videoBundle['related_keywords'] ?? []);
        $keywordText = $keywords === [] ? '代表影片標題' : implode('、', array_slice($keywords, 0, 3));

        return match ($summary['posture'] ?? '持續觀察') {
            '防守澄清' => [
                '優先準備 '.$dominantName.' 相關 Q&A，把容易被剪成短影音的爭點先寫成 3 句內回應。',
                '請幕僚逐條檢查 '.$keywordText.'，拆成事實、價值、地方影響三欄，避免只回應政治攻防。',
                '明日追蹤同一組 tag 是否降溫；若未降溫，安排本人短影音或地方行程補足主敘事。',
            ],
            '主動放大' => [
                '把 '.$dominantName.' 的正向訊號整理成一張晨會摘要，延伸成市政成果或政策主軸。',
                '挑選觀看最高的代表影片，回推可被引用的 15 秒說法，讓團隊統一口徑。',
                '把 '.$keywordText.' 連到下一個可執行行程或政策說明，避免熱度只停留在新聞討論。',
            ],
            default => [
                '維持監測並整理 '.$dominantName.' 的主要標題，不急著升高回應層級。',
                '把 '.$keywordText.' 做成今日風險清單，交由媒體與社群窗口各自判讀。',
                '明日比較同一人物頁的 delta；若連續兩天上升，再升級成正式應對專案。',
            ],
        };
    }

    /**
     * @return array{
     *     available: bool,
     *     pk: int|null,
     *     ai_type: string|null,
     *     provider: string|null,
     *     generated_at: string|null,
     *     summary: string|null,
     *     what_happened: list<string>,
     *     risks: list<array<string, mixed>>,
     *     adjustments: list<string>,
     *     actions_today: list<string>,
     *     follow_up_metrics: list<string>,
     *     raw: array<string, mixed>|null
     * }
     */
    private function aiCache(string $cityKey, string $person, string $date): array
    {
        $empty = [
            'available' => false,
            'pk' => null,
            'ai_type' => null,
            'provider' => null,
            'generated_at' => null,
            'summary' => null,
            'what_happened' => [],
            'risks' => [],
            'adjustments' => [],
            'actions_today' => [],
            'follow_up_metrics' => [],
            'raw' => null,
        ];

        if (! Schema::hasTable('urt_mayor_person_ai')) {
            return $empty;
        }

        try {
            $row = DB::table('urt_mayor_person_ai')
                ->where('city_key', $cityKey)
                ->where('person', $person)
                ->where('the_date', $date)
                ->whereNull('del_flag')
                ->orderByDesc('pk')
                ->first();
        } catch (QueryException) {
            return $empty;
        }

        if ($row === null) {
            return $empty;
        }

        $decoded = json_decode((string) ($row->result_json ?? ''), true);
        $decoded = is_array($decoded) ? $decoded : [];

        return [
            'available' => true,
            'pk' => (int) ($row->pk ?? 0),
            'ai_type' => is_string($row->ai_type ?? null) ? $row->ai_type : null,
            'provider' => is_string($row->provider ?? null) ? $row->provider : null,
            'generated_at' => is_string($row->mtime ?? null) ? $row->mtime : (is_string($row->ctime ?? null) ? $row->ctime : null),
            'summary' => $this->stringField($decoded, 'summary'),
            'what_happened' => $this->stringListField($decoded, 'what_happened'),
            'risks' => $this->arrayListField($decoded, 'risks'),
            'adjustments' => $this->stringListField($decoded, 'adjustments'),
            'actions_today' => $this->stringListField($decoded, 'actions_today'),
            'follow_up_metrics' => $this->stringListField($decoded, 'follow_up_metrics'),
            'raw' => $decoded,
        ];
    }

    /**
     * @param array<string, mixed> $payload
     */
    private function stringField(array $payload, string $key): ?string
    {
        $value = $payload[$key] ?? null;

        return is_string($value) && trim($value) !== '' ? trim($value) : null;
    }

    /**
     * @param array<string, mixed> $payload
     * @return list<string>
     */
    private function stringListField(array $payload, string $key): array
    {
        $value = $payload[$key] ?? null;

        if (! is_array($value)) {
            return [];
        }

        return collect($value)
            ->map(fn (mixed $item): string => trim(is_string($item) ? $item : (is_scalar($item) ? (string) $item : '')))
            ->filter()
            ->values()
            ->all();
    }

    /**
     * @param array<string, mixed> $payload
     * @return list<array<string, mixed>>
     */
    private function arrayListField(array $payload, string $key): array
    {
        $value = $payload[$key] ?? null;

        if (! is_array($value)) {
            return [];
        }

        return collect($value)
            ->filter(fn (mixed $item): bool => is_array($item))
            ->values()
            ->all();
    }

    /**
     * @return array<int, string>
     */
    private function tagNames(): array
    {
        if (! Schema::hasTable('urt_tag') || ! Schema::hasColumn('urt_tag', 'tag_id') || ! Schema::hasColumn('urt_tag', 'tag_name')) {
            return self::TAG_FALLBACK_NAMES;
        }

        try {
            return DB::table('urt_tag')
                ->whereIn('tag_id', self::TAG_IDS)
                ->pluck('tag_name', 'tag_id')
                ->mapWithKeys(fn (mixed $name, mixed $id): array => [(int) $id => (string) $name])
                ->all() + self::TAG_FALLBACK_NAMES;
        } catch (QueryException) {
            return self::TAG_FALLBACK_NAMES;
        }
    }

    /**
     * @return list<array{table: string, rows: int|null, status: string}>
     */
    private function dependencies(): array
    {
        return collect(['urt_mayor_person_ai', 'urt_show_tag_date', 'urt_show_video_tag_date', 'urt_video', 'urt_tag'])
            ->map(function (string $table): array {
                if (! Schema::hasTable($table)) {
                    return ['table' => $table, 'rows' => null, 'status' => 'missing'];
                }

                try {
                    $rows = DB::table($table)->count();

                    return ['table' => $table, 'rows' => $rows, 'status' => $rows > 0 ? 'present' : 'empty'];
                } catch (QueryException) {
                    return ['table' => $table, 'rows' => null, 'status' => 'missing'];
                }
            })
            ->values()
            ->all();
    }

    private function deltaWord(float $delta): string
    {
        return $delta > 0 ? '增加' : '下降';
    }

    private function formatNumber(float $value): string
    {
        return number_format($value, abs($value) >= 100 ? 0 : 2);
    }

    private function escapeLike(string $value): string
    {
        return addcslashes($value, '\\%_');
    }
}
