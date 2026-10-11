<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Hash;
use RuntimeException;
use Symfony\Component\HttpFoundation\Response;

class OpsBasicAuth
{
    public function handle(Request $request, Closure $next): Response
    {
        $username = (string) config('services.ops.basic_auth_user', '');
        $passwordHash = (string) config('services.ops.basic_auth_password_hash', '');

        if ($username !== '' && $passwordHash !== '') {
            $providedUsername = (string) $request->getUser();
            $providedPassword = (string) $request->getPassword();

            if (hash_equals($username, $providedUsername) && $this->passwordMatches($providedPassword, $passwordHash)) {
                return $next($request);
            }

            return response('Unauthorized', 401)->header('WWW-Authenticate', 'Basic realm="Operations"');
        }

        if (app()->environment('production')) {
            return response('Operations authentication is required.', 403);
        }

        return $next($request);
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
