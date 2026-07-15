<?php

use App\Console\Commands\DeploymentSchemaCheckCommand;
use App\Console\Commands\DeploymentMigrateCommand;
use App\Console\Commands\ImportLocalDumpCommand;
use Illuminate\Foundation\Application;
use Illuminate\Foundation\Configuration\Exceptions;
use Illuminate\Foundation\Configuration\Middleware;

return Application::configure(basePath: dirname(__DIR__))
    ->withRouting(
        web: __DIR__.'/../routes/web.php',
        commands: __DIR__.'/../routes/console.php',
        health: '/up',
    )
    ->withCommands([
        DeploymentMigrateCommand::class,
        DeploymentSchemaCheckCommand::class,
        ImportLocalDumpCommand::class,
    ])
    ->withMiddleware(function (Middleware $middleware): void {
        $middleware->validateCsrfTokens(except: [
            'ops/deploy/dokploy',
            'redir/*',
            'prompt/*',
        ]);
    })
    ->withExceptions(function (Exceptions $exceptions): void {
        //
    })->create();
