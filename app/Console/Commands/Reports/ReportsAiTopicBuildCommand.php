<?php

namespace App\Console\Commands\Reports;

use App\Console\GuardedIngestionCommand;
use App\Services\Ingestion\AiCommandInputValidator;
use App\Services\Ingestion\AiTopicCacheBuilder;
use InvalidArgumentException;

class ReportsAiTopicBuildCommand extends GuardedIngestionCommand
{
    protected $signature = 'reports:ai-topic:build {--from= : Start date in YYYY-MM-DD; defaults to yesterday in the ingestion timezone} {--to= : End date in YYYY-MM-DD; defaults to --from} {--condition=all : Daily condition, one of all/green/blue/neutral/finance/world} {--type=oneday : Legacy urt_ai_date data_type} {--pk= : Optional explicit urt_ai_date pk instead of a date range} {--row-limit=31 : Daily source row cap per run, max 62} {--topic-limit=100 : Topic cap per daily row, max 200} {--channel-limit=100 : Channel-map cap per daily row, max 200} {--video-limit=5000 : Distinct referenced video cap per daily row, max 10000} {--missing-only : Skip rows whose data_json/video_json cache already exists} {--execute : Write urt_ai_date.data_json and urt_ai_date.video_json} {--dry-run : Force preview mode; this is the default} {--json : Emit JSON instead of text}';

    protected $description = 'Project legacy api_topic.php topic/video statistics from urt_ai_date.result_json into the data_json/video_json cache; preview by default and manual only';

    public function handle(AiTopicCacheBuilder $builder): int
    {
        $execute = (bool) $this->option('execute') && ! (bool) $this->option('dry-run');

        try {
            $pkOption = $this->option('pk');
            $result = $builder->build(
                from: is_string($this->option('from')) ? (string) $this->option('from') : null,
                to: is_string($this->option('to')) ? (string) $this->option('to') : null,
                condition: (string) $this->option('condition'),
                dataType: (string) $this->option('type'),
                pk: is_string($pkOption) && trim($pkOption) !== ''
                    ? AiCommandInputValidator::integer($pkOption, '--pk', 1)
                    : null,
                rowLimit: AiCommandInputValidator::integer($this->option('row-limit'), '--row-limit', 1),
                topicLimit: AiCommandInputValidator::integer($this->option('topic-limit'), '--topic-limit', 1),
                channelLimit: AiCommandInputValidator::integer($this->option('channel-limit'), '--channel-limit', 1),
                videoLimit: AiCommandInputValidator::integer($this->option('video-limit'), '--video-limit', 1),
                missingOnly: (bool) $this->option('missing-only'),
                execute: $execute,
            );
        } catch (InvalidArgumentException $exception) {
            $failure = [
                'mode' => $execute ? 'execute' : 'preview',
                'status' => 'blocked',
                'exit_code' => 1,
                'blocked_reason' => 'validation_failed',
                'failure_reason' => $exception->getMessage(),
                'writes' => [],
            ];

            if ((bool) $this->option('json')) {
                $this->line(json_encode($failure, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));
            } else {
                $this->error('reports:ai-topic:build blocked: '.$exception->getMessage());
            }

            return 1;
        }

        $exitCode = (int) $result['exit_code'];

        if ((bool) $this->option('json')) {
            $this->line(json_encode($result, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));

            return $exitCode;
        }

        $this->line(sprintf(
            'reports:ai-topic:build mode=%s status=%s from=%s to=%s condition=%s type=%s pk=%s rows=%d updated=%d would_update=%d unchanged=%d skipped=%d failed=%d truncated=%s blocked_reason=%s',
            $result['mode'],
            $result['status'],
            $result['from'],
            $result['to'],
            $result['condition'],
            $result['data_type'],
            $result['pk'] === null ? 'none' : (string) $result['pk'],
            $result['selected_rows'],
            $result['updated'],
            $result['would_update'],
            $result['unchanged'],
            $result['skipped'],
            $result['failed_rows'],
            ($result['source_truncated'] ?? false) ? 'yes' : 'no',
            $result['blocked_reason'] ?? 'none',
        ));

        foreach (array_slice($result['rows'], 0, 40) as $row) {
            $this->line(sprintf(
                '%s pk=%d condition=%s type=%s status=%s topics=%d channels=%d videos=%d reason=%s',
                $row['date'],
                $row['pk'],
                $row['condition'],
                $row['data_type'],
                $row['status'],
                $row['topic_count'],
                $row['channel_count'],
                $row['video_count'],
                $row['blocked_reason'] ?? 'none',
            ));
        }

        return $exitCode;

    }
}
