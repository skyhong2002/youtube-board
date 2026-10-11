<?php

use App\Console\Commands\DeploymentSchemaCheckCommand;
use App\Console\Commands\ImportLocalDumpCommand;
use Illuminate\Foundation\Application;
use Illuminate\Foundation\Configuration\Exceptions;
use Illuminate\Foundation\Configuration\Middleware;
use App\Http\Middleware\OpsBasicAuth;

return Application::configure(basePath: dirname(__DIR__))
    ->withRouting(
        web: __DIR__.'/../routes/web.php',
        commands: __DIR__.'/../routes/console.php',
        health: '/up',
    )
    ->withCommands([
        DeploymentSchemaCheckCommand::class,
        ImportLocalDumpCommand::class,
    ])
    ->withMiddleware(function (Middleware $middleware): void {
        $middleware->alias([
            'ops.auth' => OpsBasicAuth::class,
        ]);
        $middleware->validateCsrfTokens(except: [
            'ops/deploy/dokploy',
            'redir/*',
            'prompt/*',
        ]);
    })
    ->withExceptions(function (Exceptions $exceptions): void {
        //
    })->create();
