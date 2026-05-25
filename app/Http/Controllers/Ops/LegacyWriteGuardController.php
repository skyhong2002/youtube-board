<?php

namespace App\Http\Controllers\Ops;

use App\Http\Controllers\Controller;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;

class LegacyWriteGuardController extends Controller
{
    /**
     * @return Response|JsonResponse
     */
    public function __invoke(Request $request, string $script): Response|JsonResponse
    {
        $endpoint = $this->endpoints()[$script] ?? null;

        abort_if($endpoint === null, 404);

        $payload = [
            'script' => $script,
            'legacy_path' => '/home/urtube/redir/'.$script.'.php',
            'label' => $endpoint['label'],
            'side_effects' => $endpoint['side_effects'],
            'safe_alternative' => $endpoint['safe_alternative'],
            'method' => $request->method(),
            'query' => $request->query(),
            'read_only' => true,
            'writes' => 0,
            'external_calls' => 0,
            'blocked_reason' => 'Legacy writeback endpoints are disabled in the Laravel rebuild. Use read-only reports and ingestion preview commands until writes are explicitly approved.',
        ];

        if ($request->expectsJson()) {
            return response()->json($payload, 403);
        }

        return response()->view('ops.legacy-write-guard', $payload, 403);
    }

    /**
     * @return array<string, array{label: string, side_effects: list<string>, safe_alternative: string}>
     */
    private function endpoints(): array
    {
        return [
            'add_live' => [
                'label' => 'Add a video to the live table',
                'side_effects' => ['insert urt_video_live'],
                'safe_alternative' => 'Use youtube:live:poll or reports:live:build previews from /ops/ingestion.',
            ],
            'add_live_tvbs' => [
                'label' => 'Add a TVBS video to the TVBS live table',
                'side_effects' => ['insert urt_video_live_tvbs'],
                'safe_alternative' => 'Use youtube:tvbs:live:poll or youtube:tvbs:videos previews from /ops/ingestion.',
            ],
            'add_video' => [
                'label' => 'Fetch a YouTube video and insert local video rows',
                'side_effects' => ['call YouTube Data API videos.list', 'insert urt_video', 'insert urt_video_live when applicable'],
                'safe_alternative' => 'Use youtube:channels:videos preview from /ops/ingestion.',
            ],
            'ai_day' => [
                'label' => 'Persist AI daily summary output',
                'side_effects' => ['insert urt_ai_date'],
                'safe_alternative' => 'Use ai:daily preview or read-only /ai/days prompt pages.',
            ],
            'ai_hour' => [
                'label' => 'Persist AI hourly summary output',
                'side_effects' => ['insert urt_ai_hour'],
                'safe_alternative' => 'Use ai:hourly preview or read-only /ai/hours pages.',
            ],
            'channel_ai' => [
                'label' => 'Persist channel AI prompt output',
                'side_effects' => ['insert urt_channel_ai'],
                'safe_alternative' => 'Use read-only /channels/{u_id}/prompt and /channels/{u_id}/ai pages.',
            ],
            'channel_gpt' => [
                'label' => 'Persist channel GPT topic, people, and aspect output',
                'side_effects' => ['insert urt_channel_ai topic rows', 'insert urt_channel_ai people rows', 'insert urt_channel_ai aspect rows'],
                'safe_alternative' => 'Use read-only /channels/{u_id}/ai pages.',
            ],
            'make_live' => [
                'label' => 'Restore a deleted live row',
                'side_effects' => ['update urt_video_live.del_flag'],
                'safe_alternative' => 'Use youtube:live:cleanup preview to inspect stale live rows without writes.',
            ],
            'renew' => [
                'label' => 'Refresh channel metadata from YouTube',
                'side_effects' => ['call YouTube Data API channels.list', 'insert urt_channel_history', 'update urt_channel'],
                'safe_alternative' => 'Use youtube:channels:stats preview from /ops/ingestion.',
            ],
            'tag' => [
                'label' => 'Add or remove a channel tag',
                'side_effects' => ['insert urt_tag_log', 'update urt_count.tags'],
                'safe_alternative' => 'Use read-only tag/channel reports until local write workflows are approved.',
            ],
        ];
    }
}
