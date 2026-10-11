<?php

namespace App\Console\Commands\Reports;

use App\Console\GuardedIngestionCommand;
use App\Services\Ingestion\PeopleReportsPreview;
use Illuminate\Database\QueryException;

class ReportsPeopleBuildCommand extends GuardedIngestionCommand
{
    protected $signature = 'reports:people:build {--group=政治人物 : tag_group group_name to preview} {--tagid=13 : Legacy tagid filter passed to tag_period.php} {--days=37 : Legacy period length passed to tag_period.php} {--limit=20 : Number of people tags to print/build} {--offset=0 : People tag offset, or auto for scheduler rotation} {--keyword-limit=5000 : Number of local keywords to scan when building tag-date cache} {--execute : Build selected local people tag-date cache rows} {--dry-run : Force preview mode; this is the default} {--json : Emit JSON instead of text}';

    protected $description = 'Preview or execute legacy political-people tag-date cache generation from local DB';

    public function handle(PeopleReportsPreview $preview): int
    {
        $groupName = trim((string) $this->option('group')) ?: '政治人物';
        $tagId = max(1, (int) $this->option('tagid'));
        $days = max(1, min(365, (int) $this->option('days')));
        $limit = max(1, min(200, (int) $this->option('limit')));

        try {
            $payload = $preview->preview(
                groupName: $groupName,
                tagId: $tagId,
                days: $days,
                limit: $limit,
                execute: (bool) $this->option('execute') && ! (bool) $this->option('dry-run'),
                keywordLimit: (int) $this->option('keyword-limit'),
                offset: (string) $this->option('offset'),
            );

            if ((bool) $this->option('json')) {
                $this->line(json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));

                return (int) ($payload['exit_code'] ?? 0);
            }

            $this->line(sprintf(
                'reports:people:build mode=%s group="%s" candidates=%d latest_time=%s tagid=%d days=%d cache_writes=%d failed=%d generated_at=%s writes=%d',
                $payload['mode'],
                $payload['group_name'],
                $payload['candidates'],
                $payload['latest_time'] ?? 'n/a',
                $payload['tagid'],
                $payload['days'],
                $payload['cache_writes'],
                $payload['failed_rows'],
                $payload['generated_at'],
                count($payload['writes']),
            ));

            foreach ($payload['rows'] as $index => $row) {
                $this->line(sprintf(
                    '#%d %s latest_time=%s preview="%s"',
                    $index + 1,
                    $row['tag'],
                    $row['latest_time'],
                    $row['modern_api_preview'],
                ));
            }

            return (int) ($payload['exit_code'] ?? 0);
        } catch (QueryException $exception) {
            $this->error('reports:people:build unavailable: failure=query_failed exception_class='.$exception::class.' secrets=not_printed');

            return 1;
        }

    }
}
