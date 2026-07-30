<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (Schema::hasTable('telegram_digest_dispatches')) {
            return;
        }

        Schema::create('telegram_digest_dispatches', function (Blueprint $table): void {
            $table->engine = 'InnoDB';
            $table->id();
            $table->string('dispatch_key', 64);
            $table->string('period', 16);
            $table->string('context_key', 191);
            $table->unsignedBigInteger('story_id')->nullable();
            $table->string('status', 16);
            $table->string('message_hash', 64)->nullable();
            $table->dateTime('attempted_at');
            $table->dateTime('sent_at')->nullable();
            $table->timestamps();
            $table->unique('dispatch_key', 'tg_dispatches_key_unique');
            $table->index(['period', 'context_key'], 'tg_dispatches_period_context_index');
            $table->index('story_id', 'tg_dispatches_story_index');
        });
    }

    public function down(): void
    {
        // Durable notification history must survive application rollbacks.
    }
};
