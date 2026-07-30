<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (Schema::hasTable('telegram_digest_stories')) {
            return;
        }

        Schema::create('telegram_digest_stories', function (Blueprint $table): void {
            $table->engine = 'InnoDB';
            $table->id();
            $table->string('story_key', 64)->unique();
            $table->string('canonical_title', 500);
            $table->longText('fingerprint_json');
            $table->longText('video_ids_json');
            $table->longText('video_channels_json');
            $table->longText('observations_json');
            $table->dateTime('first_seen_at');
            $table->dateTime('last_seen_at');
            $table->dateTime('last_posted_at')->nullable();
            $table->longText('last_posted_video_ids_json')->nullable();
            $table->longText('last_posted_channel_ids_json')->nullable();
            $table->unsignedInteger('post_count')->default(0);
            $table->timestamps();
            $table->index('last_seen_at');
            $table->index('last_posted_at');
        });
    }

    public function down(): void
    {
        // Durable notification history must survive application rollbacks.
    }
};
