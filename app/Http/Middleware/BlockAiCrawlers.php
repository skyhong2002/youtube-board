<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

class BlockAiCrawlers
{
    public function handle(Request $request, Closure $next): Response
    {
        $userAgent = (string) $request->userAgent();

        if ($userAgent !== '' && $this->isBlocked($userAgent)) {
            return response('Forbidden', Response::HTTP_FORBIDDEN, ['Content-Type' => 'text/plain']);
        }

        return $next($request);
    }

    private function isBlocked(string $userAgent): bool
    {
        foreach ((array) config('crawlers.blocked_user_agents', []) as $token) {
            if (is_string($token) && $token !== '' && stripos($userAgent, $token) !== false) {
                return true;
            }
        }

        return false;
    }
}
