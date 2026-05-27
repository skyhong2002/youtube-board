<?php

namespace App\Support;

use Illuminate\Http\Request;
class ReportNavigation
{
    /**
     * @return array<int, array{label: string, url: string, active: bool}>
     */
    public static function main(Request $request): array
    {
        $routeName = (string) ($request->route()?->getName() ?? '');

        return [
            self::item('總覽', 'home', $routeName === 'home'),
            self::item('直播', 'live.current', str_starts_with($routeName, 'live.')),
            self::item('分類', 'tags.index', str_starts_with($routeName, 'tags.')),
            self::item('關鍵字', 'keywords.index', str_starts_with($routeName, 'keywords.')),
            self::item('群組', 'groups.index', str_starts_with($routeName, 'groups.')),
            self::item('AI', 'ai.days.index', str_starts_with($routeName, 'ai.')),
            self::item('市長', 'mayor.index', str_starts_with($routeName, 'mayor.')),
        ];
    }

    /**
     * @return array<int, array{label: string, url: string, active: bool}>
     */
    public static function system(Request $request): array
    {
        $routeName = (string) ($request->route()?->getName() ?? '');

        $items = [
            self::item('擷取排程', 'ops.ingestion', str_starts_with($routeName, 'ops.ingestion')),
        ];

        if (app()->environment(['local', 'testing'])) {
            $items[] = [
                'label' => '整合檢查',
                'url' => url('/dev/check'),
                'active' => str_starts_with($routeName, 'dev.'),
            ];
        }

        return $items;
    }

    /**
     * @return array<int, array{label: string, url: string|null}>
     */
    public static function breadcrumbs(Request $request): array
    {
        $routeName = (string) ($request->route()?->getName() ?? '');
        $params = $request->route()?->parameters() ?? [];
        $crumbs = [
            ['label' => 'YouTube Board', 'url' => route('home')],
        ];

        if ($routeName === 'home') {
            return $crumbs;
        }

        $section = self::sectionFor($routeName);
        if ($section !== null) {
            $crumbs[] = $section;
        }

        if (str_starts_with($routeName, 'channels.')) {
            $uId = $params['u_id'] ?? null;
            if ($uId !== null) {
                $crumbs[] = ['label' => '頻道 '.$uId, 'url' => route('channels.show', ['u_id' => $uId])];
            }
        }

        if (str_starts_with($routeName, 'tags.') && isset($params['tagId'])) {
            $crumbs[] = ['label' => '標籤 '.$params['tagId'], 'url' => route('tags.channels', ['tagId' => $params['tagId']])];
        }

        if (str_starts_with($routeName, 'keywords.') && isset($params['keyword'])) {
            $crumbs[] = ['label' => (string) $params['keyword'], 'url' => route('keywords.days', ['keyword' => $params['keyword']])];
        }

        if (str_starts_with($routeName, 'groups.') && isset($params['groupName'])) {
            $crumbs[] = ['label' => (string) $params['groupName'], 'url' => route('groups.show', ['groupName' => $params['groupName']])];
        }

        if (str_starts_with($routeName, 'videos.') && isset($params['videoId'])) {
            $crumbs[] = ['label' => '影片 '.$params['videoId'], 'url' => route('videos.show', ['videoId' => $params['videoId']])];
        }

        if (str_starts_with($routeName, 'ops.')) {
            $crumbs[] = ['label' => '系統', 'url' => route('ops.ingestion')];
        }

        return self::dedupeCrumbs($crumbs);
    }

    /**
     * @return array<int, array{label: string, url: string, active: bool}>
     */
    public static function section(Request $request): array
    {
        $routeName = (string) ($request->route()?->getName() ?? '');
        $params = $request->route()?->parameters() ?? [];

        if (str_starts_with($routeName, 'live.')) {
            return self::liveSection($routeName);
        }

        if (str_starts_with($routeName, 'ai.')) {
            return self::aiSection($routeName, $params);
        }

        if (str_starts_with($routeName, 'groups.')) {
            return self::groupSection($routeName, $params);
        }

        if (str_starts_with($routeName, 'channels.')) {
            return self::channelSection($routeName, $params);
        }

        if (str_starts_with($routeName, 'tags.') || str_starts_with($routeName, 'keywords.')) {
            return self::tagKeywordSection($routeName, $params, $request);
        }

        if (str_starts_with($routeName, 'ops.')) {
            return self::opsSection($routeName);
        }

        return [];
    }

    /**
     * @return array{label: string, url: string, active: bool}
     */
    private static function item(string $label, string $route, bool $active, array $params = []): array
    {
        return [
            'label' => $label,
            'url' => route($route, $params),
            'active' => $active,
        ];
    }

    /**
     * @return array{label: string, url: string}|null
     */
    private static function sectionFor(string $routeName): ?array
    {
        return match (true) {
            str_starts_with($routeName, 'keywords.') => ['label' => '關鍵字', 'url' => route('keywords.index')],
            str_starts_with($routeName, 'live.') => ['label' => '直播', 'url' => route('live.current')],
            str_starts_with($routeName, 'ai.') => ['label' => 'AI', 'url' => route('ai.days.index')],
            str_starts_with($routeName, 'groups.') => ['label' => '群組', 'url' => route('groups.index')],
            str_starts_with($routeName, 'mayor.') => ['label' => '市長', 'url' => route('mayor.index')],
            str_starts_with($routeName, 'channels.') => ['label' => '頻道', 'url' => route('home')],
            str_starts_with($routeName, 'videos.') => ['label' => '影片', 'url' => route('live.current')],
            str_starts_with($routeName, 'comments.') => ['label' => '留言', 'url' => route('tags.comments.index')],
            str_starts_with($routeName, 'ops.') => ['label' => '系統', 'url' => route('ops.ingestion')],
            str_starts_with($routeName, 'dev.') => ['label' => '系統', 'url' => route('ops.ingestion')],
            default => null,
        };
    }

    /**
     * @return array<int, array{label: string, url: string|null}>
     */
    private static function dedupeCrumbs(array $crumbs): array
    {
        $deduped = [];
        $last = null;

        foreach ($crumbs as $crumb) {
            $key = $crumb['label'].'|'.($crumb['url'] ?? '');
            if ($key === $last) {
                continue;
            }

            $deduped[] = $crumb;
            $last = $key;
        }

        return $deduped;
    }

    /**
     * @return array<int, array{label: string, url: string, active: bool}>
     */
    private static function liveSection(string $routeName): array
    {
        return [
            self::item('目前', 'live.current', $routeName === 'live.current'),
            self::item('帶狀', 'live.continuous', $routeName === 'live.continuous'),
            self::item('單日', 'live.days.index', str_starts_with($routeName, 'live.days.')),
            self::item('期間', 'live.periods', $routeName === 'live.periods'),
            self::item('頻道', 'live.channels', $routeName === 'live.channels'),
            self::item('小時', 'live.hours', $routeName === 'live.hours'),
            self::item('標籤', 'live.tags', $routeName === 'live.tags'),
            self::item('每日趨勢', 'live.trends.daily', $routeName === 'live.trends.daily'),
            self::item('新聞牆', 'live.wall', $routeName === 'live.wall', ['variant' => 'news']),
        ];
    }

    /**
     * @return array<int, array{label: string, url: string, active: bool}>
     */
    private static function aiSection(string $routeName, array $params): array
    {
        $items = [
            self::item('每日', 'ai.days.index', str_starts_with($routeName, 'ai.days.') || $routeName === 'ai.days.index'),
            self::item('每小時', 'ai.hours', $routeName === 'ai.hours'),
            self::item('期間', 'ai.periods', $routeName === 'ai.periods'),
            self::item('立場', 'ai.aspects', $routeName === 'ai.aspects'),
        ];

        if (isset($params['id'])) {
            $items[] = self::item('事件', 'ai.events.show', $routeName === 'ai.events.show', ['id' => $params['id']]);
            $items[] = self::item('人物', 'ai.events.people', $routeName === 'ai.events.people', ['id' => $params['id']]);
            $items[] = self::item('影片牆', 'ai.events.wall', $routeName === 'ai.events.wall', ['id' => $params['id']]);
        }

        return $items;
    }

    /**
     * @return array<int, array{label: string, url: string, active: bool}>
     */
    private static function groupSection(string $routeName, array $params): array
    {
        $items = [self::item('群組列表', 'groups.index', $routeName === 'groups.index')];
        $groupName = $params['groupName'] ?? null;

        if ($groupName !== null) {
            $items[] = self::item('總覽', 'groups.show', $routeName === 'groups.show', ['groupName' => $groupName]);
            $items[] = self::item('直播', 'groups.live', $routeName === 'groups.live', ['groupName' => $groupName]);
            $items[] = self::item('排名', 'groups.ranking', $routeName === 'groups.ranking', ['groupName' => $groupName]);
            $items[] = self::item('趨勢', 'groups.trends', $routeName === 'groups.trends', ['groupName' => $groupName]);
        }

        return $items;
    }

    /**
     * @return array<int, array{label: string, url: string, active: bool}>
     */
    private static function channelSection(string $routeName, array $params): array
    {
        $uId = $params['u_id'] ?? null;
        if ($uId === null) {
            return [];
        }

        return [
            self::item('基本資料', 'channels.show', $routeName === 'channels.show', ['u_id' => $uId]),
            self::item('影片', 'channels.videos', $routeName === 'channels.videos', ['u_id' => $uId]),
            self::item('留言', 'channels.comments', $routeName === 'channels.comments', ['u_id' => $uId]),
            self::item('文字雲', 'channels.cloud', $routeName === 'channels.cloud', ['u_id' => $uId]),
            self::item('趨勢', 'channels.trends', $routeName === 'channels.trends', ['u_id' => $uId]),
            self::item('人物', 'channels.people', $routeName === 'channels.people', ['u_id' => $uId]),
            self::item('AI', 'channels.ai', $routeName === 'channels.ai', ['u_id' => $uId]),
            self::item('每日重點', 'channels.ai.days', str_starts_with($routeName, 'channels.ai.days'), ['u_id' => $uId]),
            self::item('Prompt', 'channels.prompt', $routeName === 'channels.prompt', ['u_id' => $uId]),
        ];
    }

    /**
     * @return array<int, array{label: string, url: string, active: bool}>
     */
    private static function tagKeywordSection(string $routeName, array $params, Request $request): array
    {
        $tagId = $params['tagId'] ?? null;
        $keyword = $params['keyword'] ?? null;
        $query = $request->query();

        if ($tagId !== null) {
            return [
                self::item('頻道排行', 'tags.channels', $routeName === 'tags.channels', ['tagId' => $tagId] + $query),
                self::item('影片', 'tags.videos', $routeName === 'tags.videos', ['tagId' => $tagId] + $query),
                self::item('直播影片', 'tags.live.videos', $routeName === 'tags.live.videos', ['tagId' => $tagId] + $query),
                self::item('留言', 'tags.comments', $routeName === 'tags.comments', ['tagId' => $tagId] + $query),
                self::item('文字雲', 'tags.cloud', $routeName === 'tags.cloud', ['tagId' => $tagId] + $query),
                self::item('逐日', 'tags.days', $routeName === 'tags.days', ['tagId' => $tagId] + $query),
                self::item('趨勢', 'tags.trends', $routeName === 'tags.trends', ['tagId' => $tagId] + $query),
                self::item('比較', 'tags.compare', $routeName === 'tags.compare', $query),
            ];
        }

        if ($keyword !== null) {
            return [
                self::item('逐日', 'keywords.days', $routeName === 'keywords.days', ['keyword' => $keyword] + $query),
                self::item('影片', 'keywords.videos', $routeName === 'keywords.videos', ['keyword' => $keyword] + $query),
                self::item('文字雲', 'keywords.cloud', $routeName === 'keywords.cloud', ['keyword' => $keyword] + $query),
                self::item('直播趨勢', 'keywords.live.trends', $routeName === 'keywords.live.trends', ['keyword' => $keyword] + $query),
                self::item('群組趨勢', 'keywords.groups.trends', $routeName === 'keywords.groups.trends', ['keyword' => $keyword] + $query),
                self::item('比較', 'tags.compare', $routeName === 'tags.compare', ['tags' => $keyword] + $query),
            ];
        }

        if (str_starts_with($routeName, 'keywords.')) {
            return [
                self::item('關鍵字列表', 'keywords.index', $routeName === 'keywords.index'),
            ];
        }

        return [
            self::item('分類列表', 'tags.index', $routeName === 'tags.index'),
            self::item('分類影片', 'tags.videos.index', $routeName === 'tags.videos.index'),
            self::item('分類直播', 'tags.live.videos.index', $routeName === 'tags.live.videos.index'),
            self::item('分類留言', 'tags.comments.index', $routeName === 'tags.comments.index'),
            self::item('分類文字雲', 'tags.cloud.index', $routeName === 'tags.cloud.index'),
            self::item('分類逐日', 'tags.days.index', $routeName === 'tags.days.index'),
            self::item('分類趨勢', 'tags.trends.index', $routeName === 'tags.trends.index'),
            self::item('分類比較', 'tags.compare', $routeName === 'tags.compare'),
        ];
    }

    /**
     * @return array<int, array{label: string, url: string, active: bool}>
     */
    private static function opsSection(string $routeName): array
    {
        return [
            self::item('擷取排程', 'ops.ingestion', $routeName === 'ops.ingestion'),
        ];
    }
}
