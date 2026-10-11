<?php

namespace App\Services\Ingestion;

use Carbon\CarbonImmutable;
use Carbon\CarbonInterface;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Throwable;

class YoutubeQuotaBudgetLedger
{
    private const PROVIDER = 'youtube_data_api_v3';

    private const TIMEZONE = 'America/Los_Angeles';

    /**
     * @return array<string, mixed>
     */
    public function state(int $budget, ?CarbonInterface $at = null): array
    {
        $budget = max(0, $budget);
        $now = $this->quotaNow($at);

        if ($budget === 0) {
            return $this->unavailableState($budget, $now, 'quota_budget_not_configured');
        }

        try {
            if (! Schema::hasTable('ingestion_youtube_quota_daily')) {
                return $this->unavailableState($budget, $now, 'quota_ledger_schema_missing');
            }

            $row = DB::table('ingestion_youtube_quota_daily')
                ->where('provider', self::PROVIDER)
                ->where('quota_date', $now->toDateString())
                ->first();

            return $this->payload(
                budget: $budget,
                now: $now,
                consumed: max(0, (int) ($row->consumed_units ?? 0)),
                reserved: max(0, (int) ($row->reserved_units ?? 0)),
                googleExhaustedAt: $row->google_exhausted_at ?? null,
                googleExhaustedUnits: isset($row->google_exhausted_units) ? (int) $row->google_exhausted_units : null,
            );
        } catch (Throwable) {
            return $this->unavailableState($budget, $now, 'quota_ledger_query_failed');
        }
    }

    /**
     * Trip the daily circuit breaker after Google reports the project quota
     * exhausted. Reservations for the same Pacific quota date are refused
     * until the next reset, regardless of how much local budget remains.
     * Best-effort: a ledger failure must not mask the API response.
     */
    public function markGoogleExhausted(?CarbonInterface $at = null): void
    {
        $now = $this->quotaNow($at);

        try {
            if (! Schema::hasColumn('ingestion_youtube_quota_daily', 'google_exhausted_at')) {
                return;
            }

            $timestamp = CarbonImmutable::now('UTC')->format('Y-m-d H:i:s');
            DB::table('ingestion_youtube_quota_daily')->insertOrIgnore([
                'provider' => self::PROVIDER,
                'quota_date' => $now->toDateString(),
                'consumed_units' => 0,
                'reserved_units' => 0,
                'created_at' => $timestamp,
                'updated_at' => $timestamp,
            ]);
            DB::table('ingestion_youtube_quota_daily')
                ->where('provider', self::PROVIDER)
                ->where('quota_date', $now->toDateString())
                ->whereNull('google_exhausted_at')
                ->update([
                    'google_exhausted_at' => $timestamp,
                    'google_exhausted_units' => DB::raw('consumed_units + reserved_units'),
                    'updated_at' => $timestamp,
                ]);
        } catch (Throwable) {
            // The next quotaExceeded response retries the write.
        }
    }

    /**
     * @return array{allowed: bool, reason: string|null, state: array<string, mixed>}
     */
    public function reserve(int $units, int $budget, ?CarbonInterface $at = null): array
    {
        $units = max(0, $units);
        $budget = max(0, $budget);
        $now = $this->quotaNow($at);
        $initial = $this->state($budget, $now);

        if ($units === 0) {
            return ['allowed' => true, 'reason' => null, 'state' => $initial];
        }

        if (! (bool) ($initial['available'] ?? false)) {
            return ['allowed' => false, 'reason' => (string) ($initial['reason'] ?? 'quota_ledger_unavailable'), 'state' => $initial];
        }

        if ((bool) ($initial['google_quota_exhausted'] ?? false)) {
            return ['allowed' => false, 'reason' => 'google_quota_exhausted', 'state' => $initial];
        }

        try {
            $timestamp = CarbonImmutable::now('UTC')->format('Y-m-d H:i:s');
            DB::table('ingestion_youtube_quota_daily')->insertOrIgnore([
                'provider' => self::PROVIDER,
                'quota_date' => $now->toDateString(),
                'consumed_units' => 0,
                'reserved_units' => 0,
                'created_at' => $timestamp,
                'updated_at' => $timestamp,
            ]);
            $affected = DB::table('ingestion_youtube_quota_daily')
                ->where('provider', self::PROVIDER)
                ->where('quota_date', $now->toDateString())
                ->whereRaw('(consumed_units + reserved_units + ?) <= ?', [$units, $budget])
                ->update([
                    'reserved_units' => DB::raw('reserved_units + '.(int) $units),
                    'updated_at' => $timestamp,
                ]);
            $state = $this->state($budget, $now);

            return [
                'allowed' => $affected === 1,
                'reason' => $affected === 1 ? null : 'quota_budget_exceeded',
                'state' => $state,
            ];
        } catch (Throwable) {
            return [
                'allowed' => false,
                'reason' => 'quota_ledger_reservation_failed',
                'state' => $this->unavailableState($budget, $now, 'quota_ledger_reservation_failed'),
            ];
        }
    }

    /**
     * @return array<string, mixed>
     */
    public function settle(int $plannedUnits, int $actualUnits, int $budget, ?CarbonInterface $at = null): array
    {
        $plannedUnits = max(0, $plannedUnits);
        $actualUnits = max(0, $actualUnits);
        $budget = max(0, $budget);
        $now = $this->quotaNow($at);

        if ($plannedUnits === 0) {
            return $this->state($budget, $now);
        }

        try {
            $affected = DB::table('ingestion_youtube_quota_daily')
                ->where('provider', self::PROVIDER)
                ->where('quota_date', $now->toDateString())
                ->update([
                    'reserved_units' => DB::raw('CASE WHEN reserved_units >= '.(int) $plannedUnits.' THEN reserved_units - '.(int) $plannedUnits.' ELSE 0 END'),
                    'consumed_units' => DB::raw('consumed_units + '.(int) $actualUnits),
                    'updated_at' => CarbonImmutable::now('UTC')->format('Y-m-d H:i:s'),
                ]);

            if ($affected !== 1) {
                return $this->unavailableState($budget, $now, 'quota_ledger_settlement_missing');
            }

            return $this->state($budget, $now) + ['settled' => true];
        } catch (Throwable) {
            return $this->unavailableState($budget, $now, 'quota_ledger_settlement_failed');
        }
    }

    private function quotaNow(?CarbonInterface $at): CarbonImmutable
    {
        return $at === null
            ? CarbonImmutable::now(self::TIMEZONE)
            : CarbonImmutable::instance($at->toDateTimeImmutable())->setTimezone(self::TIMEZONE);
    }

    /**
     * @return array<string, mixed>
     */
    private function payload(
        int $budget,
        CarbonImmutable $now,
        int $consumed,
        int $reserved,
        ?string $googleExhaustedAt = null,
        ?int $googleExhaustedUnits = null,
    ): array
    {
        $projected = $consumed + $reserved;

        return [
            'available' => true,
            'source' => 'database_atomic_daily_ledger',
            'provider' => self::PROVIDER,
            'quota_date' => $now->toDateString(),
            'window_start' => $now->startOfDay()->format('Y-m-d H:i:s T'),
            'window_end' => $now->endOfDay()->format('Y-m-d H:i:s T'),
            'window_timezone' => self::TIMEZONE,
            'budget_units' => $budget,
            'consumed_units' => $consumed,
            'reserved_units' => $reserved,
            'history_estimated_units' => $projected,
            'projected_units' => $projected,
            'remaining_units' => max(0, $budget - $projected),
            'google_quota_exhausted' => $googleExhaustedAt !== null,
            'google_exhausted_at' => $googleExhaustedAt,
            'google_exhausted_units' => $googleExhaustedUnits,
        ];
    }

    /**
     * @return array<string, mixed>
     */
    private function unavailableState(int $budget, CarbonImmutable $now, string $reason): array
    {
        return [
            'available' => false,
            'source' => 'database_atomic_daily_ledger',
            'provider' => self::PROVIDER,
            'quota_date' => $now->toDateString(),
            'window_timezone' => self::TIMEZONE,
            'budget_units' => $budget,
            'consumed_units' => 0,
            'reserved_units' => 0,
            'history_estimated_units' => 0,
            'projected_units' => 0,
            'remaining_units' => 0,
            'reason' => $reason,
        ];
    }
}
