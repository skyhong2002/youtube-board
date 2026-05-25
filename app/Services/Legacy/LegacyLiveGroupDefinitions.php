<?php

namespace App\Services\Legacy;

class LegacyLiveGroupDefinitions
{
    /**
     * @return array{name: string, label: string, groups: list<array{name: string, tag_para: string, filters: array{tagid: list<int>, or: list<int>, not: list<int>, tagid_string: string, or_string: string, not_string: string}>}
     */
    public function get(string $key): array
    {
        $key = $this->normalizeKey($key);
        $definition = $this->definitions()[$key] ?? $this->definitions()['media'];

        return [
            'name' => $key,
            'label' => $definition['label'],
            'groups' => collect($definition['groups'])
                ->map(fn (array $row): array => $row + ['filters' => $this->filters($row['tag_para'])])
                ->values()
                ->all(),
        ];
    }

    /**
     * @return list<array{name: string, label: string, groups_count: int}>
     */
    public function options(): array
    {
        return collect($this->definitions())
            ->map(fn (array $definition, string $key): array => [
                'name' => $key,
                'label' => $definition['label'],
                'groups_count' => count($definition['groups']),
            ])
            ->values()
            ->all();
    }

    private function normalizeKey(string $key): string
    {
        $key = trim($key);
        $key = preg_replace('/[^a-zA-Z0-9_]/', '', $key) ?: 'media';

        return $key;
    }

    /**
     * @return array{tagid: list<int>, or: list<int>, not: list<int>, tagid_string: string, or_string: string, not_string: string}
     */
    private function filters(string $tagPara): array
    {
        preg_match_all('/(tagid|or|not)=([^\s]+)/', $tagPara, $matches, PREG_SET_ORDER);
        $filters = ['tagid' => [], 'or' => [], 'not' => []];

        foreach ($matches as $match) {
            $key = $match[1];
            $filters[$key] = $this->integerList($match[2]);
        }

        return $filters + [
            'tagid_string' => implode(',', $filters['tagid']),
            'or_string' => implode(',', $filters['or']),
            'not_string' => implode(',', $filters['not']),
        ];
    }

    /**
     * @return list<int>
     */
    private function integerList(string $value): array
    {
        $items = collect(explode(',', $value))
            ->map(fn (string $item): int => (int) trim($item))
            ->filter(fn (int $item): bool => $item > 0)
            ->unique()
            ->sort()
            ->values()
            ->all();

        return $items;
    }

    /**
     * @return array<string, array{label: string, groups: list<array{name: string, tag_para: string}>}>
     */
    private function definitions(): array
    {
        return [
            'media' => [
                'label' => '主要媒體',
                'groups' => [
                    ['name' => '旺中', 'tag_para' => 'tagid=53'],
                    ['name' => 'TVBS', 'tag_para' => 'tagid=29'],
                    ['name' => '三立', 'tag_para' => 'tagid=64'],
                    ['name' => '東森', 'tag_para' => 'tagid=63'],
                    ['name' => '民視', 'tag_para' => 'tagid=50'],
                    ['name' => '台視', 'tag_para' => 'tagid=65'],
                    ['name' => '年代', 'tag_para' => 'tagid=80'],
                ],
            ],
            'media_social' => [
                'label' => '新聞與社論',
                'groups' => [
                    ['name' => '旺中', 'tag_para' => 'tagid=53 or=1,13'],
                    ['name' => 'TVBS', 'tag_para' => 'tagid=29 or=1,13'],
                    ['name' => '三立', 'tag_para' => 'tagid=64 or=1,13'],
                    ['name' => '東森', 'tag_para' => 'tagid=63 or=1,13'],
                    ['name' => '台視', 'tag_para' => 'tagid=65 or=1,13'],
                    ['name' => 'ETtoday', 'tag_para' => 'tagid=66 or=1,13'],
                ],
            ],
            'media_all' => [
                'label' => '媒體',
                'groups' => [
                    ['name' => '旺中', 'tag_para' => 'tagid=53'],
                    ['name' => 'TVBS', 'tag_para' => 'tagid=29'],
                    ['name' => '東森', 'tag_para' => 'tagid=63'],
                    ['name' => '民視', 'tag_para' => 'tagid=50'],
                    ['name' => '三立', 'tag_para' => 'tagid=64'],
                    ['name' => '大紀元', 'tag_para' => 'tagid=55'],
                    ['name' => '台視', 'tag_para' => 'tagid=65'],
                    ['name' => 'ETtoday', 'tag_para' => 'tagid=66'],
                    ['name' => '華視', 'tag_para' => 'tagid=69'],
                    ['name' => '自由時報', 'tag_para' => 'tagid=70'],
                    ['name' => '年代', 'tag_para' => 'tagid=80'],
                    ['name' => '公共電視', 'tag_para' => 'tagid=19'],
                    ['name' => '中廣飛碟', 'tag_para' => 'tagid=75'],
                    ['name' => '政經', 'tag_para' => 'tagid=71'],
                    ['name' => '八大', 'tag_para' => 'tagid=72'],
                    ['name' => '龍華環宇', 'tag_para' => 'tagid=73'],
                    ['name' => '非凡', 'tag_para' => 'tagid=76'],
                    ['name' => '鏡傳媒', 'tag_para' => 'tagid=77'],
                    ['name' => 'NOWnews', 'tag_para' => 'tagid=78'],
                    ['name' => '緯來', 'tag_para' => 'tagid=84'],
                    ['name' => 'UDN', 'tag_para' => 'tagid=85'],
                    ['name' => '麥卡貝', 'tag_para' => 'tagid=67'],
                    ['name' => 'STR Network', 'tag_para' => 'tagid=68'],
                    ['name' => '關鍵評論網', 'tag_para' => 'tagid=18'],
                ],
            ],
            'position' => [
                'label' => '政治立場',
                'groups' => [
                    ['name' => '泛藍', 'tag_para' => 'tagid=3'],
                    ['name' => '泛白', 'tag_para' => 'tagid=6'],
                    ['name' => '泛綠', 'tag_para' => 'tagid=4'],
                    ['name' => '泛紅', 'tag_para' => 'tagid=5'],
                ],
            ],
            'tv_position' => [
                'label' => '政論節目立場',
                'groups' => [
                    ['name' => '台灣立場', 'tag_para' => 'tagid=48'],
                    ['name' => '中國立場', 'tag_para' => 'tagid=49'],
                ],
            ],
            'two' => [
                'label' => '台灣立場 vs 中國立場',
                'groups' => [
                    ['name' => '台灣立場', 'tag_para' => 'tagid=9,48'],
                    ['name' => '中國立場', 'tag_para' => 'tagid=9,49'],
                    ['name' => '新聞', 'tag_para' => 'tagid=13'],
                    ['name' => '個人社論', 'tag_para' => 'tagid=1 not=2,9,10,13'],
                    ['name' => '全部', 'tag_para' => 'or=1,2,13,14'],
                    ['name' => '政治人物', 'tag_para' => 'tagid=2'],
                    ['name' => '大外宣', 'tag_para' => 'tagid=15'],
                ],
            ],
            'china' => [
                'label' => '中國影響',
                'groups' => [
                    ['name' => '中國官方', 'tag_para' => 'tagid=11'],
                    ['name' => '大外宣', 'tag_para' => 'tagid=15'],
                    ['name' => '新大外宣', 'tag_para' => 'tagid=90'],
                    ['name' => '泛藍', 'tag_para' => 'tagid=3'],
                    ['name' => '泛紅', 'tag_para' => 'tagid=5'],
                    ['name' => '中國政論', 'tag_para' => 'tagid=10'],
                    ['name' => '異議份子', 'tag_para' => 'tagid=22'],
                ],
            ],
            'all' => [
                'label' => '全部',
                'groups' => [
                    ['name' => '全部', 'tag_para' => 'or=1,2,13,14'],
                ],
            ],
            'politic' => [
                'label' => '社會觀察',
                'groups' => [
                    ['name' => '全部', 'tag_para' => 'or=1,2,13,14'],
                    ['name' => '個人社論', 'tag_para' => 'tagid=1 not=2,9,10,13'],
                    ['name' => '新聞', 'tag_para' => 'tagid=13'],
                    ['name' => '台灣立場', 'tag_para' => 'tagid=9,48'],
                    ['name' => '中國立場', 'tag_para' => 'tagid=9,49'],
                    ['name' => '政治人物', 'tag_para' => 'tagid=2'],
                ],
            ],
        ];
    }
}
