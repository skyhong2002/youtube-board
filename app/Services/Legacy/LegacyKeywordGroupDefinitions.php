<?php

namespace App\Services\Legacy;

class LegacyKeywordGroupDefinitions
{
    /**
     * @return array{name: string, label: string, source: string, source_status: string, groups: list<array{name: string, tag_para: string, filters: array{tagid: list<int>, or: list<int>, not: list<int>, tagid_string: string, or_string: string, not_string: string}>}
     */
    public function get(string $key, bool $includeAll = false): array
    {
        $key = $this->normalizeKey($key);
        $definition = $this->parseGroupFile($key, $includeAll) ?? $this->fallbackDefinition($key);

        return [
            'name' => $definition['name'],
            'label' => $definition['label'],
            'source' => $definition['source'],
            'source_status' => $definition['source_status'],
            'groups' => collect($definition['groups'])
                ->map(fn (array $row): array => $row + ['filters' => $this->filters((string) $row['tag_para'])])
                ->values()
                ->all(),
        ];
    }

    /**
     * @return list<array{name: string, label: string, groups_count: int, source_status: string}>
     */
    public function options(): array
    {
        $keys = collect(array_keys($this->fallbackDefinitions()))
            ->merge($this->legacyGroupKeys())
            ->unique()
            ->sort()
            ->values();

        return $keys
            ->map(function (string $key): array {
                $definition = $this->get($key);

                return [
                    'name' => $definition['name'],
                    'label' => $definition['label'],
                    'groups_count' => count($definition['groups']),
                    'source_status' => $definition['source_status'],
                ];
            })
            ->values()
            ->all();
    }

    private function normalizeKey(string $key): string
    {
        $key = trim($key);
        $key = preg_replace('/[^a-zA-Z0-9_]/', '', $key) ?: 'position';

        return $key;
    }

    /**
     * @return list<string>
     */
    private function legacyGroupKeys(): array
    {
        $dir = $this->legacyGroupDir();

        if (! is_dir($dir)) {
            return [];
        }

        return collect(glob($dir.'/group_*.php') ?: [])
            ->map(fn (string $path): string => preg_replace('/^group_|\.php$/', '', basename($path)) ?: '')
            ->filter()
            ->values()
            ->all();
    }

    private function legacyGroupDir(): string
    {
        return rtrim((string) config('legacy.ground_truth_path'), '/').'/urtube/group';
    }

    /**
     * @return array{name: string, label: string, source: string, source_status: string, groups: list<array{name: string, tag_para: string}>}|null
     */
    private function parseGroupFile(string $key, bool $includeAll): ?array
    {
        $path = $this->legacyGroupDir().'/group_'.$key.'.php';

        if (! is_file($path) || ! is_readable($path)) {
            return null;
        }

        $source = (string) file_get_contents($path);
        $source = preg_replace('/\/\*.*?\*\//s', '', $source) ?? $source;
        $source = preg_replace('/^\s*\/\/.*$/m', '', $source) ?? $source;
        $source = $this->handleAllBlocks($source, $includeAll);

        preg_match('/\$group_name\s*=\s*"([^"]+)";/u', $source, $nameMatch);
        preg_match_all('/\$group_array\[\$counter\]\[\'(name|tag_para)\'\]\s*=\s*"([^"]*)";/u', $source, $matches, PREG_SET_ORDER);

        $groups = [];
        $current = [];

        foreach ($matches as $match) {
            $current[$match[1]] = $match[2];

            if (isset($current['name'], $current['tag_para'])) {
                $groups[] = [
                    'name' => $current['name'],
                    'tag_para' => $current['tag_para'],
                ];
                $current = [];
            }
        }

        if ($groups === []) {
            return null;
        }

        return [
            'name' => $key,
            'label' => $nameMatch[1] ?? $key,
            'source' => $path,
            'source_status' => 'parsed',
            'groups' => $groups,
        ];
    }

    private function handleAllBlocks(string $source, bool $includeAll): string
    {
        if ($includeAll) {
            return preg_replace('/if\s*\(\s*isset\(\$_GET\[\'all\'\]\)\s*\)\s*\{(.*?)\}/s', '$1', $source) ?? $source;
        }

        return preg_replace('/if\s*\(\s*isset\(\$_GET\[\'all\'\]\)\s*\)\s*\{.*?\}/s', '', $source) ?? $source;
    }

    /**
     * @return array{name: string, label: string, source: string, source_status: string, groups: list<array{name: string, tag_para: string}>}
     */
    private function fallbackDefinition(string $key): array
    {
        $definitions = $this->fallbackDefinitions();
        $definition = $definitions[$key] ?? $definitions['position'];

        return [
            'name' => array_key_exists($key, $definitions) ? $key : 'position',
            'label' => $definition['label'],
            'source' => 'embedded fallback',
            'source_status' => 'fallback',
            'groups' => $definition['groups'],
        ];
    }

    /**
     * @return array{tagid: list<int>, or: list<int>, not: list<int>, tagid_string: string, or_string: string, not_string: string}
     */
    private function filters(string $tagPara): array
    {
        preg_match_all('/(tagid|or|not)=([^\s]+)/', $tagPara, $matches, PREG_SET_ORDER);
        $filters = ['tagid' => [], 'or' => [], 'not' => []];

        foreach ($matches as $match) {
            $filters[$match[1]] = $this->integerList($match[2]);
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
            ->values()
            ->all();
        sort($items);

        return $items;
    }

    /**
     * @return array<string, array{label: string, groups: list<array{name: string, tag_para: string}>}>
     */
    private function fallbackDefinitions(): array
    {
        return [
            'all' => [
                'label' => '全部',
                'groups' => [
                    ['name' => '全部', 'tag_para' => 'or=1,2,13,14'],
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
                ],
            ],
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
            'politician' => [
                'label' => '族群',
                'groups' => [
                    ['name' => '新聞', 'tag_para' => 'tagid=13'],
                    ['name' => '個人社論', 'tag_para' => 'tagid=1 not=2,9,10,13'],
                    ['name' => '台灣立場', 'tag_para' => 'tagid=9,48'],
                    ['name' => '中國立場', 'tag_para' => 'tagid=9,49'],
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
                ],
            ],
        ];
    }
}
