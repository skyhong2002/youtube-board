<?php

namespace App\Console\Commands\Reports;

use App\Console\GuardedIngestionCommand;
use App\Services\Ingestion\GroupViewCacheBuilder;

class ReportsGroupViewBuildCommand extends GuardedIngestionCommand
{
    protected $signature = 'reports:group-view:build {--group=六都市長候選人 : Legacy group name, a tag_group group_name or a tags_* configured set} {--view=politician : Legacy comparison view name} {--days=30 : Aggregation day count, max 90} {--tags= : Optional explicit comma-separated keyword override, max 600} {--tag-limit=600 : Keyword cap, max 600} {--execute : Write the urt_show_group.the_result cache row} {--dry-run : Force preview mode; this is the default} {--json : Emit JSON instead of text}';

    protected $description = 'Project the legacy api/group_view.php comparison payload from local urt_show_tag_date rows into urt_show_group; preview by default and manual only';

    public function handle(GroupViewCacheBuilder $builder): int
    {
        $execute = (bool) $this->option('execute') && ! (bool) $this->option('dry-run');
        $tags = collect(explode(',', (string) $this->option('tags')))
            ->map(fn (string $tag): string => trim($tag))
            ->filter()
            ->values()
            ->all();
        $result = $builder->build(
            group: (string) $this->option('group'),
            view: (string) $this->option('view'),
            days: (int) $this->option('days'),
            explicitTags: $tags,
            tagLimit: (int) $this->option('tag-limit'),
            execute: $execute,
        );
        $exitCode = (int) $result['exit_code'];

        if ((bool) $this->option('json')) {
            $this->line(json_encode($result, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));

            return $exitCode;
        }

        $this->line(sprintf(
            'reports:group-view:build mode=%s status=%s group=%s view=%s days=%d tags=%d groups=%d source_rows=%d action=%s blocked_reason=%s',
            $result['mode'],
            $result['status'],
            $result['group'],
            $result['view'],
            $result['days'],
            $result['tag_count'] ?? 0,
            $result['group_count'] ?? 0,
            $result['source_rows'] ?? 0,
            $result['action'] ?? 'none',
            $result['blocked_reason'] ?? 'none',
        ));

        return $exitCode;

    }
}
