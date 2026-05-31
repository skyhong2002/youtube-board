<?php

namespace App\Services\Legacy;

use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;

class GroupDirectoryReport
{
    /**
     * @return array<string, mixed>
     */
    public function index(): array
    {
        try {
            $groups = DB::table('tag_group')
                ->selectRaw('group_name, COUNT(*) as tags_count, MAX(latest_time) as latest_time')
                ->where(function ($query): void {
                    $query->whereNull('del_flag')->orWhere('del_flag', '<', '1');
                })
                ->groupBy('group_name')
                ->orderByDesc('tags_count')
                ->limit(200)
                ->get()
                ->map(fn (object $row): array => [
                    'name' => (string) $row->group_name,
                    'label' => (string) $row->group_name,
                    'tags_count' => (int) $row->tags_count,
                    'latest_time' => (string) $row->latest_time,
                    'source' => 'tag_group',
                ])
                ->values()
                ->all();

            $configured = collect($this->configuredGroups())
                ->reject(fn (array $group): bool => collect($groups)->contains('name', $group['name']))
                ->map(fn (array $group): array => $group + ['source' => 'legacy group file'])
                ->values()
                ->all();

            return [
                'available' => true,
                'title' => 'Group directory',
                'groups' => [...$groups, ...$configured],
                'dependencies' => [$this->dependency('tag_group')],
                'generated_at' => now('Asia/Taipei')->format('Y-m-d H:i:s'),
            ];
        } catch (QueryException) {
            return [
                'available' => false,
                'title' => 'Group directory',
                'groups' => collect($this->configuredGroups())
                    ->map(fn (array $group): array => $group + ['source' => 'legacy group file'])
                    ->values()
                    ->all(),
                'dependencies' => [$this->dependency('tag_group')],
                'generated_at' => now('Asia/Taipei')->format('Y-m-d H:i:s'),
            ];
        }
    }

    /**
     * @return array<string, mixed>
     */
    public function show(string $groupName): array
    {
        $groupName = trim(urldecode($groupName));
        $configured = collect($this->configuredGroups())->firstWhere('name', $groupName);

        try {
            $rows = DB::table('tag_group')
                ->where('group_name', $groupName)
                ->where(function ($query): void {
                    $query->whereNull('del_flag')->orWhere('del_flag', '<', '1');
                })
                ->orderByDesc('latest_time')
                ->orderBy('tag')
                ->get(['tag', 'latest_time'])
                ->map(fn (object $row): array => [
                    'tag' => (string) $row->tag,
                    'latest_time' => (string) $row->latest_time,
                    'source' => 'tag_group',
                ])
                ->values()
                ->all();
        } catch (QueryException) {
            $rows = [];
        }

        if ($rows === [] && is_array($configured)) {
            $rows = collect($configured['tags'])
                ->map(fn (string $tag): array => [
                    'tag' => $tag,
                    'latest_time' => '',
                    'source' => 'legacy group file',
                ])
                ->all();
        }

        $label = is_array($configured) ? $configured['label'] : $groupName;

        return [
            'available' => $rows !== [],
            'title' => $label.' group tags',
            'group' => [
                'name' => $groupName,
                'label' => $label,
                'source' => is_array($configured) && $configured['tags_count'] === count($rows) ? 'legacy group file' : 'tag_group',
            ],
            'tags' => $rows,
            'dependencies' => [$this->dependency('tag_group')],
            'generated_at' => now('Asia/Taipei')->format('Y-m-d H:i:s'),
        ];
    }

    /**
     * @return list<array{name: string, label: string, tags_count: int, latest_time: string, tags: list<string>}>
     */
    private function configuredGroups(): array
    {
        $groups = [
            'tags_president2024' => ['label' => '總統候選人', 'tags' => ['侯友宜', '柯文哲', '賴清德', '趙少康', '蕭美琴', '吳欣盈']],
            'tags_coldwar' => ['label' => '新冷戰', 'tags' => ['美國', '中國', '俄羅斯', '烏克蘭', '北約']],
            'tags_elect' => ['label' => '選舉', 'tags' => ['總統大選', '立委', '民調', '政見', '投票']],
            'tags_straits' => ['label' => '兩岸', 'tags' => ['石斑魚', '軍演', '共軍', '航母', '解放軍', '台海', '兩岸', '兩岸統一', '台獨']],
            'tags_economy' => ['label' => '經濟', 'tags' => ['通膨', '景氣', '股市', '匯率', '房價']],
        ];

        return collect($groups)
            ->map(fn (array $row, string $name): array => [
                'name' => $name,
                'label' => $row['label'],
                'tags_count' => count($row['tags']),
                'latest_time' => '',
                'tags' => $row['tags'],
            ])
            ->values()
            ->all();
    }

    /**
     * @return array{table: string, rows: int|null, status: string}
     */
    private function dependency(string $table): array
    {
        try {
            $rows = DB::table($table)->count();

            return [
                'table' => $table,
                'rows' => $rows,
                'status' => $rows > 0 ? 'present' : 'empty',
            ];
        } catch (QueryException) {
            return [
                'table' => $table,
                'rows' => null,
                'status' => 'missing',
            ];
        }
    }
}
