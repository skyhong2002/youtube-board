<?php

namespace App\Services\Notifications;

use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Throwable;

class TelegramDailyDispatchGate
{
    public function completed(string $contextKey): bool
    {
        if (! Schema::hasTable('telegram_digest_dispatches')) {
            return true;
        }

        try {
            return DB::table('telegram_digest_dispatches')
                ->where('dispatch_key', $this->key($contextKey))
                ->exists();
        } catch (Throwable) {
            return true;
        }
    }

    public function adopt(string $contextKey): void
    {
        if (! Schema::hasTable('telegram_digest_dispatches')) {
            return;
        }

        try {
            DB::table('telegram_digest_dispatches')->insertOrIgnore([
                'dispatch_key' => $this->key($contextKey),
                'period' => 'daily',
                'context_key' => $contextKey,
                'story_id' => null,
                'status' => 'adopted',
                'message_hash' => null,
                'attempted_at' => now(),
                'sent_at' => now(),
                'created_at' => now(),
                'updated_at' => now(),
            ]);
        } catch (Throwable) {
            // Adoption is best-effort; a later claim still fails closed if storage is unavailable.
        }
    }

    public function claim(string $contextKey, int $storyId, string $message): bool
    {
        if (! Schema::hasTable('telegram_digest_dispatches')) {
            return false;
        }

        try {
            DB::table('telegram_digest_dispatches')->insert([
                'dispatch_key' => $this->key($contextKey),
                'period' => 'daily',
                'context_key' => $contextKey,
                'story_id' => $storyId > 0 ? $storyId : null,
                'status' => 'pending',
                'message_hash' => hash('sha256', $message),
                'attempted_at' => now(),
                'sent_at' => null,
                'created_at' => now(),
                'updated_at' => now(),
            ]);

            return true;
        } catch (QueryException) {
            return false;
        } catch (Throwable) {
            return false;
        }
    }

    public function markSent(string $contextKey): void
    {
        try {
            DB::table('telegram_digest_dispatches')
                ->where('dispatch_key', $this->key($contextKey))
                ->where('status', 'pending')
                ->update([
                    'status' => 'sent',
                    'sent_at' => now(),
                    'updated_at' => now(),
                ]);
        } catch (Throwable) {
            // An uncertain pending claim intentionally remains fail-closed.
        }
    }

    public function releaseFailed(string $contextKey): void
    {
        try {
            DB::table('telegram_digest_dispatches')
                ->where('dispatch_key', $this->key($contextKey))
                ->where('status', 'pending')
                ->delete();
        } catch (Throwable) {
            // An uncertain pending claim intentionally remains fail-closed.
        }
    }

    private function key(string $contextKey): string
    {
        return hash('sha256', 'daily|'.$contextKey);
    }
}
