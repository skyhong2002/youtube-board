<?php

namespace App\Support;

use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Throwable;

class ReportSourceTimestampLookup
{
    /**
     * MAX() over the large legacy tables is re-run for every report request, so
     * share the result across requests for a short window.
     */
    public const CACHE_TTL_SECONDS = 60;

    private const TIMESTAMP_COLUMNS = [
        'ctime',
        'date_from',
        'date_to',
        'ftime',
        'latest_time',
        'mtime',
        'publishedAt',
        'stime',
        'the_date',
        'thedate',
        'vtime',
    ];

    /** @var array<string, bool> */
    private array $tableExists = [];

    /** @var array<string, list<string>> */
    private array $columnListings = [];

    /** @var array<string, array<string, mixed>> */
    private array $maxValues = [];

    /**
     * @param  list<string>  $columns
     * @param  array<string, mixed>  $where
     * @param  array<string, list<mixed>>  $whereIn
     */
    public function latest(string $table, array $columns, array $where = [], array $whereIn = []): ?CarbonImmutable
    {
        $table = trim($table);
        $columns = array_values(array_unique(array_filter(array_map(
            fn (mixed $column): string => is_string($column) ? trim($column) : '',
            $columns,
        ))));

        if ($table === '' || $columns === [] || ! $this->hasTable($table)) {
            return null;
        }

        $where = array_filter(
            $where,
            fn (mixed $_value, mixed $column): bool => is_string($column) && $this->hasColumn($table, $column),
            ARRAY_FILTER_USE_BOTH,
        );
        $whereIn = array_filter(
            $whereIn,
            fn (mixed $values, mixed $column): bool => is_string($column)
                && $this->hasColumn($table, $column)
                && is_array($values)
                && $values !== [],
            ARRAY_FILTER_USE_BOTH,
        );
        ksort($where);
        ksort($whereIn);
        $scopeKey = $table.'|'.sha1(json_encode([$where, $whereIn], JSON_THROW_ON_ERROR | JSON_INVALID_UTF8_SUBSTITUTE));
        $availableColumns = array_values(array_filter(
            $columns,
            fn (string $column): bool => $this->hasColumn($table, $column),
        ));
        $missingColumns = array_values(array_filter(
            $availableColumns,
            fn (string $column): bool => ! array_key_exists($column, $this->maxValues[$scopeKey] ?? []),
        ));

        if ($missingColumns !== []) {
            $prefetchColumns = array_values(array_intersect(
                $this->columnListing($table),
                array_values(array_unique([...self::TIMESTAMP_COLUMNS, ...$availableColumns])),
            ));
            $this->loadMaxValues($scopeKey, $table, $prefetchColumns, $where, $whereIn);
        }

        $latest = null;

        foreach ($availableColumns as $column) {
            $timestamp = $this->parseTimestamp($this->maxValues[$scopeKey][$column] ?? null);

            if ($timestamp !== null && ($latest === null || $timestamp->greaterThan($latest))) {
                $latest = $timestamp;
            }
        }

        return $latest;
    }

    /**
     * @param  list<string>  $columns
     * @param  array<string, mixed>  $where
     * @param  array<string, list<mixed>>  $whereIn
     */
    private function loadMaxValues(string $scopeKey, string $table, array $columns, array $where, array $whereIn): void
    {
        $cacheKey = 'report-source-timestamps:'.sha1($scopeKey.'|'.implode(',', $columns));
        $fetch = fn (): array => $this->queryMaxValues($table, $columns, $where, $whereIn);

        try {
            try {
                $values = Cache::remember($cacheKey, self::CACHE_TTL_SECONDS, $fetch);
            } catch (Throwable) {
                $values = $fetch();
            }
        } catch (Throwable) {
            $values = array_fill_keys($columns, null);
        }

        foreach ($columns as $column) {
            $this->maxValues[$scopeKey][$column] = $values[$column] ?? null;
        }
    }

    /**
     * @param  list<string>  $columns
     * @param  array<string, mixed>  $where
     * @param  array<string, list<mixed>>  $whereIn
     * @return array<string, mixed>
     */
    private function queryMaxValues(string $table, array $columns, array $where, array $whereIn): array
    {
        $grammar = DB::connection()->getQueryGrammar();
        $query = DB::table($table);

        foreach ($where as $column => $value) {
            $value === null ? $query->whereNull($column) : $query->where($column, $value);
        }

        foreach ($whereIn as $column => $values) {
            $query->whereIn($column, $values);
        }

        $aliases = [];
        $selects = [];

        foreach ($columns as $index => $column) {
            $alias = 'report_max_'.$index;
            $aliases[$column] = $alias;
            $selects[] = DB::raw(sprintf(
                'MAX(%s) AS %s',
                $grammar->wrap($column),
                $grammar->wrap($alias),
            ));
        }

        $row = $query->select($selects)->first();
        $values = [];

        foreach ($aliases as $column => $alias) {
            $value = $row->{$alias} ?? null;
            $values[$column] = $value instanceof \DateTimeInterface ? $value->format('Y-m-d H:i:s') : $value;
        }

        return $values;
    }

    private function hasTable(string $table): bool
    {
        if (array_key_exists($table, $this->tableExists)) {
            return $this->tableExists[$table];
        }

        try {
            return $this->tableExists[$table] = Schema::hasTable($table);
        } catch (Throwable) {
            return $this->tableExists[$table] = false;
        }
    }

    private function hasColumn(string $table, string $column): bool
    {
        return in_array($column, $this->columnListing($table), true);
    }

    /** @return list<string> */
    private function columnListing(string $table): array
    {
        if (array_key_exists($table, $this->columnListings)) {
            return $this->columnListings[$table];
        }

        if (! $this->hasTable($table)) {
            return $this->columnListings[$table] = [];
        }

        try {
            return $this->columnListings[$table] = Schema::getColumnListing($table);
        } catch (Throwable) {
            return $this->columnListings[$table] = [];
        }
    }

    private function parseTimestamp(mixed $value): ?CarbonImmutable
    {
        if ($value instanceof CarbonImmutable) {
            return $value->setTimezone($this->timezone());
        }

        if ($value === null) {
            return null;
        }

        $text = trim((string) $value);

        if ($text === '' || $text === '0000-00-00' || $text === '0000-00-00 00:00:00') {
            return null;
        }

        try {
            return CarbonImmutable::parse($text, $this->timezone())->setTimezone($this->timezone());
        } catch (Throwable) {
            return null;
        }
    }

    private function timezone(): string
    {
        return (string) config('ingestion.timezone', config('app.timezone', 'Asia/Taipei'));
    }
}
