<?php

namespace App\Services\Legacy;

use Illuminate\Http\Request;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;

class LegacyTagFilter
{
    /**
     * @return array{or: array<int>, tagid: array<int>, not: array<int>, limit: int}
     */
    public function filters(Request $request): array
    {
        return [
            'or' => $this->integerList($request->query('or')),
            'tagid' => $this->integerList($request->query('tagid')),
            'not' => $this->integerList($request->query('not')),
            'limit' => max(1, min(1000, (int) $request->query('limit', 1000))),
        ];
    }

    /**
     * @return array<int, string>
     */
    public function tagNames(): array
    {
        return DB::table('urt_tag')
            ->orderBy('tag_id')
            ->pluck('tag_name', 'tag_id')
            ->mapWithKeys(fn ($name, $id) => [(int) $id => $name])
            ->all();
    }

    /**
     * @param array{or: array<int>, tagid: array<int>, not: array<int>, limit: int} $filters
     * @return Collection<int, object>
     */
    public function matchingChannelTags(array $filters): Collection
    {
        $query = DB::table('urt_count')->select(['u_id', 'tags']);

        if ($filters['or'] !== []) {
            $query->where(function ($query) use ($filters): void {
                foreach ($filters['or'] as $tagId) {
                    $query->orWhere('tags', 'like', '%['.$tagId.']%');
                }
            });
        }

        foreach ($filters['tagid'] as $tagId) {
            $query->where('tags', 'like', '%['.$tagId.']%');
        }

        if ($filters['not'] !== []) {
            $query->where(function ($query) use ($filters): void {
                foreach ($filters['not'] as $tagId) {
                    $query->where('tags', 'not like', '%['.$tagId.']%');
                }
            });
        }

        return $query->get();
    }

    /**
     * @param array<int, string> $tagNames
     * @return array<int, array{id: int, name: string}>
     */
    public function visibleTags(string $tagString, array $tagNames): array
    {
        $visibleTagIds = [1, 2, 3, 4, 5, 6, 60, 43, 48, 49, 81];

        return collect($this->tagsFromString($tagString, $tagNames))
            ->filter(fn (array $tag): bool => in_array($tag['id'], $visibleTagIds, true))
            ->values()
            ->all();
    }

    /**
     * @param array<int, string> $tagNames
     * @return array<int, array{id: int, name: string}>
     */
    public function tagsFromString(string $tagString, array $tagNames): array
    {
        preg_match_all('/\[(\d+)\]/', $tagString, $matches);

        return collect($matches[1] ?? [])
            ->map(fn (string $id): int => (int) $id)
            ->unique()
            ->map(fn (int $id): array => [
                'id' => $id,
                'name' => $tagNames[$id] ?? (string) $id,
            ])
            ->values()
            ->all();
    }

    /**
     * @return array<int>
     */
    public function integerList(mixed $value): array
    {
        if (! is_string($value) || $value === '') {
            return [];
        }

        return collect(explode(',', $value))
            ->map(fn (string $item): int => (int) trim($item))
            ->filter(fn (int $item): bool => $item > 0)
            ->unique()
            ->values()
            ->all();
    }
}
