<?php

namespace App\Http\Controllers\Ops;

use App\Http\Controllers\Controller;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;

class LegacyPromptGuardController extends Controller
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
            'legacy_path' => '/home/urtube/prompt/'.$script.'.php',
            'label' => $endpoint['label'],
            'side_effects' => $endpoint['side_effects'],
            'safe_alternative' => $endpoint['safe_alternative'],
            'method' => $request->method(),
            'query' => $request->query(),
            'read_only' => true,
            'writes' => 0,
            'external_calls' => 0,
            'blocked_reason' => 'Legacy AI prompt scripts are disabled in the Laravel rebuild. Use read-only AI report pages and ingestion preview commands until generation/writeback is explicitly approved.',
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
            'ai_hour_prompt' => [
                'label' => 'Generate and persist an hourly AI summary',
                'side_effects' => ['call AI chat completions', 'insert urt_ai_hour'],
                'safe_alternative' => 'Use ai:hourly preview from /ops/ingestion or read-only /ai/hours.',
            ],
            'ai_cont_prompt' => [
                'label' => 'Generate and persist a continuous-period AI summary',
                'side_effects' => ['call AI chat completions', 'insert urt_ai_period'],
                'safe_alternative' => 'Use read-only /ai/periods and /api/api_event.php cache shells.',
            ],
            'ai_event_prompt' => [
                'label' => 'Generate and persist an AI event summary',
                'side_effects' => ['call AI chat completions', 'insert urt_ai_event'],
                'safe_alternative' => 'Use read-only /ai/events/{id} pages when cached event rows exist.',
            ],
            'ai_period_prompt' => [
                'label' => 'Render legacy period prompt material from daily AI rows',
                'side_effects' => ['expose raw legacy prompt text assembled from urt_ai_date'],
                'safe_alternative' => 'Use read-only /ai/periods for cached period summaries.',
            ],
        ];
    }
}
