<?php

namespace App\Providers;

use App\Services\DeploymentSchemaVerifier;
use App\Services\Ingestion\IngestionCommandLockContext;
use App\Services\Ingestion\IngestionTelemetry;
use App\Services\Ingestion\YoutubeQuotaReservationContext;
use Illuminate\Foundation\Events\DiagnosingHealth;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\ServiceProvider;

class AppServiceProvider extends ServiceProvider
{
    /**
     * Register any application services.
     */
    public function register(): void
    {
        $this->app->singleton(IngestionCommandLockContext::class);
        $this->app->singleton(IngestionTelemetry::class);
        $this->app->singleton(YoutubeQuotaReservationContext::class);
    }

    /**
     * Bootstrap any application services.
     */
    public function boot(): void
    {
        Event::listen(DiagnosingHealth::class, function (): void {
            app(DeploymentSchemaVerifier::class)->assertReady();
        });
    }
}
