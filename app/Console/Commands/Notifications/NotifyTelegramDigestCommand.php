<?php

namespace App\Console\Commands\Notifications;

use App\Services\Notifications\TelegramDigestBroadcaster;
use Illuminate\Console\Command;

class NotifyTelegramDigestCommand extends Command
{
    protected $signature = 'notify:telegram:digest {--period=daily : daily or hourly} {--force : Ignore the already-posted dedup guard} {--dry-run : Render and print the posts without sending}';

    protected $description = 'Post the latest daily/hourly AI event digest to the Telegram channel';

    public function handle(TelegramDigestBroadcaster $broadcaster): int
    {
        $period = strtolower(trim((string) $this->option('period')));

        if (! in_array($period, ['daily', 'hourly'], true)) {
            $this->error('notify:telegram:digest unavailable: --period must be daily or hourly');

            return 1;
        }

        if ($this->option('dry-run')) {
            $messages = $broadcaster->preview($period);

            foreach ($messages as $index => $html) {
                $this->line('----- post '.($index + 1).' -----');
                $this->line($html);
            }

            $this->info('notify:telegram:digest period='.$period.' preview='.count($messages).' sent=0 (dry-run)');

            return 0;
        }

        $result = $broadcaster->run($period, (bool) $this->option('force'));

        $this->info(sprintf(
            'notify:telegram:digest period=%s considered=%d eligible=%d posted=%d skipped_seen=%d skipped_incomplete=%d dry_run=%s',
            $result['period'],
            $result['considered'],
            $result['eligible'],
            $result['posted'],
            $result['skipped_seen'],
            $result['skipped_incomplete'],
            $result['dry_run'] ? 'yes' : 'no',
        ));

        return 0;

    }
}
