<!doctype html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Integration Check - YouTube Board</title>
    <style>
        body {
            margin: 0;
            background: #f6f7f9;
            color: #18202a;
            font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        }

        main {
            max-width: 760px;
            margin: 48px auto;
            padding: 0 20px;
        }

        h1 {
            margin: 0 0 18px;
            font-size: 24px;
            font-weight: 700;
        }

        dl {
            display: grid;
            grid-template-columns: 180px 1fr;
            gap: 12px 18px;
            margin: 0;
            padding: 24px;
            background: #fff;
            border: 1px solid #d8dde5;
            border-radius: 8px;
        }

        dt {
            color: #5f6b7a;
            font-weight: 600;
        }

        dd {
            margin: 0;
            word-break: break-word;
        }

        .ok {
            color: #0c7a43;
            font-weight: 700;
        }

        .fail {
            color: #b42318;
            font-weight: 700;
        }
    </style>
</head>
<body>
    <main>
        <h1>Integration Check</h1>
        <dl>
            <dt>Service</dt>
            <dd>{{ $payload['service'] ?? 'unknown' }}</dd>

            <dt>Status</dt>
            <dd class="{{ ($payload['ok'] ?? false) ? 'ok' : 'fail' }}">
                {{ ($payload['ok'] ?? false) ? 'OK' : 'Failed' }}
            </dd>

            <dt>HTTP status</dt>
            <dd>{{ $payload['http_status'] ?? 'n/a' }}</dd>

            <dt>Video ID</dt>
            <dd>{{ data_get($payload, 'video.id', 'n/a') }}</dd>

            <dt>Title</dt>
            <dd>{{ data_get($payload, 'video.title', 'n/a') }}</dd>

            <dt>Channel</dt>
            <dd>{{ data_get($payload, 'video.channel_title', 'n/a') }}</dd>

            <dt>Published</dt>
            <dd>{{ data_get($payload, 'video.published_at', 'n/a') }}</dd>

            <dt>View count field</dt>
            <dd>{{ data_get($payload, 'video.view_count_available') ? 'available' : 'missing' }}</dd>

            @if (! ($payload['ok'] ?? false))
                <dt>Error</dt>
                <dd>{{ $payload['error'] ?? 'Unknown error' }}</dd>
            @endif
        </dl>
    </main>
</body>
</html>
