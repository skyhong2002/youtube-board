<?php

use Illuminate\Foundation\Application;
use Illuminate\Http\Request;

$requestUri = $_SERVER['REQUEST_URI'] ?? '';
if (preg_match('#^/index\.php(?:\?(.*))?$#', $requestUri, $matches)) {
    header('Location: /'.(isset($matches[1]) && $matches[1] !== '' ? '?'.$matches[1] : ''), true, 308);
    exit;
}

define('LARAVEL_START', microtime(true));

// Determine if the application is in maintenance mode...
if (file_exists($maintenance = __DIR__.'/../storage/framework/maintenance.php')) {
    require $maintenance;
}

// Register the Composer autoloader...
require __DIR__.'/../vendor/autoload.php';

// Bootstrap Laravel and handle the request...
/** @var Application $app */
$app = require_once __DIR__.'/../bootstrap/app.php';

$app->handleRequest(Request::capture());
