<?php

$allowedHosts = array_values(array_filter(array_map(
    static fn (string $host): string => strtolower(trim($host)),
    explode(',', (string) env('LOCAL_DUMP_IMPORT_ALLOWED_HOSTS', 'mysql,mariadb')),
)));

return [
    'directory' => storage_path('app/db-dumps'),
    'audit_directory' => storage_path('app/private/dump-imports'),
    'staging_directory' => storage_path('app/private/dump-import-staging'),
    'allowed_hosts' => $allowedHosts,
    'database' => 'youtube_board',
    'client' => 'mariadb',
];
