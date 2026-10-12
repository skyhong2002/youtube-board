<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\RateLimiter;
use RuntimeException;
use Symfony\Component\HttpFoundation\Response;

class OpsBasicAuth
{
    public function handle(Request $request, Closure $next): Response
    {
        $username = (string) config('services.ops.basic_auth_user', '');
        $passwordHash = (string) config('services.ops.basic_auth_password_hash', '');

        if ($username !== '' && $passwordHash !== '') {
            // Use the transport peer, not caller-controlled forwarded headers or usernames.
            // Behind a proxy this is deliberately a shared failure budget until trusted
            // ingress is separately configured; it is not a network access restriction.
            $limits = [
                'ops-auth:peer:'.hash('sha256', (string) $request->server('REMOTE_ADDR', 'unknown')) => 20,
                'ops-auth:global' => 120,
            ];
            // File-cache increments are not atomic. Serialize the complete auth
            // decision and reject contention before hashing, without locking the route.
            $lock = Cache::store(config('cache.limiter'))->lock('ops-auth:budget-lock', 30);
            if (! $lock->get()) {
                return $this->throttled(1);
            }
            try {
                foreach ($limits as $key => $limit) {
                    if (RateLimiter::tooManyAttempts($key, $limit)) {
                        return $this->throttled(RateLimiter::availableIn($key));
                    }
                }
                $providedUsername = (string) $request->getUser();
                $providedPassword = (string) $request->getPassword();

                $authenticated = hash_equals($username, $providedUsername)
                    && $this->passwordMatches($providedPassword, $passwordHash);

                if (! $authenticated) {
                    foreach (array_keys($limits) as $key) {
                        RateLimiter::hit($key, 60);
                    }
                }
            } finally {
                $lock->release();
            }
            if ($authenticated) {
                return $next($request);
            }

            return response('Unauthorized', 401)
                ->header('WWW-Authenticate', 'Basic realm="Operations"')
                ->header('Cache-Control', 'no-store');
        }

        if (app()->environment('production')) {
            return response('Operations authentication is required.', 403);
        }

        return $next($request);
    }

    private function throttled(int $retryAfter): Response
    {
        return response('Too many authentication attempts.', 429)
            ->header('Retry-After', (string) max(1, $retryAfter))
            ->header('Cache-Control', 'no-store');
    }

    private function passwordMatches(string $password, string $hash): bool
    {
        try {
            return Hash::check($password, $hash);
        } catch (RuntimeException) {
            // A hash the configured driver cannot verify is a misconfiguration, not a pass.
            return false;
        }
    }
}
