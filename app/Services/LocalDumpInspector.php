<?php

namespace App\Services;

use App\Support\LegacyDashboardSchema;
use RuntimeException;

class LocalDumpInspector
{
    /**
     * @return array<string, mixed>
     */
    public function inspect(string $requestedFile, int $maxFileBytes, int $maxExpandedBytes): array
    {
        $base = realpath((string) config('local_import.directory'));

        if ($base === false || ! is_dir($base)) {
            throw new RuntimeException('dump_directory_unavailable');
        }

        $requestedFile = trim($requestedFile);

        if (
            $requestedFile === ''
            || strlen($requestedFile) > 255
            || preg_match('/\A[a-zA-Z0-9._\/-]+\z/', $requestedFile) !== 1
        ) {
            throw new RuntimeException('invalid_dump_filename');
        }

        $path = realpath($base.DIRECTORY_SEPARATOR.$requestedFile);

        if (
            $path === false
            || ! is_file($path)
            || ! is_readable($path)
            || ! str_starts_with($path, $base.DIRECTORY_SEPARATOR)
        ) {
            throw new RuntimeException('dump_file_unavailable');
        }

        if (preg_match('/\.sql(?:\.gz)?\z/i', $path) !== 1) {
            throw new RuntimeException('unsupported_dump_extension');
        }

        $allowedTables = array_fill_keys(array_column(LegacyDashboardSchema::statements(
            database_path('schema/legacy-dashboard-baseline.sql'),
        ), 'table'), true);
        $compressed = str_ends_with(strtolower($path), '.gz');
        $reviewed = $this->snapshotAndInspect(
            $path,
            $compressed,
            $maxFileBytes,
            $maxExpandedBytes,
            $allowedTables,
        );

        return [
            'path' => $reviewed['path'],
            'file' => basename($path),
            'compressed' => $compressed,
            'reviewed_compressed' => false,
            'size_bytes' => $reviewed['size_bytes'],
            'expanded_bytes' => $reviewed['expanded_bytes'],
            'sha256' => $reviewed['sha256'],
            'reviewed_size_bytes' => $reviewed['reviewed_size_bytes'],
            'reviewed_sha256' => $reviewed['reviewed_sha256'],
            'tables' => array_values(array_keys($reviewed['tables'])),
            'statements' => $reviewed['counts'],
            'replacement_required' => $reviewed['counts']['drop_table'] > 0,
            'unsafe_reasons' => array_values(array_unique($reviewed['unsafe'])),
        ];
    }

    /**
     * @param  array<string, mixed>  $inspection
     */
    public function assertUnchanged(array $inspection): void
    {
        $path = (string) ($inspection['path'] ?? '');
        $expectedSize = (int) ($inspection['reviewed_size_bytes'] ?? 0);
        $expectedSha = (string) ($inspection['reviewed_sha256'] ?? '');
        $size = $path !== '' && is_file($path) ? filesize($path) : false;
        $sha256 = $size !== false ? hash_file('sha256', $path) : false;

        if (
            $size === false
            || $size !== $expectedSize
            || ! is_string($sha256)
            || preg_match('/\A[a-f0-9]{64}\z/', $expectedSha) !== 1
            || ! hash_equals($expectedSha, $sha256)
        ) {
            throw new RuntimeException('dump_artifact_changed');
        }
    }

    /**
     * @param  array<string, mixed>|null  $inspection
     */
    public function cleanup(?array $inspection): void
    {
        $path = (string) ($inspection['path'] ?? '');
        $directory = realpath((string) config('local_import.staging_directory'));
        $resolved = $path !== '' ? realpath($path) : false;

        if (
            $directory !== false
            && $resolved !== false
            && str_starts_with($resolved, $directory.DIRECTORY_SEPARATOR.'.reviewed-')
        ) {
            @unlink($resolved);
        }
    }

    /**
     * @param  array<string, bool>  $allowedTables
     * @return array{
     *     path: string,
     *     size_bytes: int,
     *     expanded_bytes: int,
     *     sha256: string,
     *     reviewed_size_bytes: int,
     *     reviewed_sha256: string,
     *     tables: array<string, bool>,
     *     counts: array{create_table: int, drop_table: int, insert: int},
     *     unsafe: list<string>
     * }
     */
    private function snapshotAndInspect(
        string $sourcePath,
        bool $compressed,
        int $maxFileBytes,
        int $maxExpandedBytes,
        array $allowedTables,
    ): array {
        $directory = (string) config('local_import.staging_directory');

        if (! is_dir($directory) && ! mkdir($directory, 0700, true) && ! is_dir($directory)) {
            throw new RuntimeException('dump_staging_unavailable');
        }

        $source = fopen($sourcePath, 'rb');

        if ($source === false) {
            throw new RuntimeException('dump_read_failed');
        }

        $stagedPath = tempnam($directory, '.reviewed-');

        if ($stagedPath === false) {
            fclose($source);
            throw new RuntimeException('dump_staging_unavailable');
        }

        @chmod($stagedPath, 0600);
        $staged = fopen($stagedPath, 'wb');

        if ($staged === false) {
            fclose($source);
            @unlink($stagedPath);
            throw new RuntimeException('dump_staging_unavailable');
        }

        $sourceHash = hash_init('sha256');
        $reviewedHash = hash_init('sha256');
        $bytes = 0;
        $expandedBytes = 0;
        $carry = '';
        $tables = [];
        $counts = [
            'create_table' => 0,
            'drop_table' => 0,
            'insert' => 0,
        ];
        $unsafe = [];
        $parser = $this->newParserState();
        $inflater = $compressed ? inflate_init(ZLIB_ENCODING_GZIP) : null;
        $firstChunk = true;

        if ($compressed && $inflater === false) {
            fclose($source);
            fclose($staged);
            @unlink($stagedPath);
            throw new RuntimeException('dump_read_failed');
        }

        try {
            while (! feof($source)) {
                $chunk = fread($source, 1024 * 1024);

                if ($chunk === false) {
                    throw new RuntimeException('dump_read_failed');
                }

                if ($chunk === '') {
                    continue;
                }

                $bytes += strlen($chunk);

                if ($bytes > $maxFileBytes) {
                    throw new RuntimeException('dump_file_size_out_of_range');
                }

                hash_update($sourceHash, $chunk);

                if ($firstChunk) {
                    $firstChunk = false;
                    $this->afterFirstSourceChunkHashed($sourcePath);
                }

                $expanded = $compressed
                    ? inflate_add($inflater, $chunk, ZLIB_SYNC_FLUSH)
                    : $chunk;

                if ($expanded === false) {
                    throw new RuntimeException('dump_read_failed');
                }

                $this->consumeExpandedChunk(
                    $expanded,
                    $maxExpandedBytes,
                    $staged,
                    $reviewedHash,
                    $expandedBytes,
                    $carry,
                    $parser,
                    $allowedTables,
                    $tables,
                    $counts,
                    $unsafe,
                );
            }

            if ($bytes <= 0) {
                throw new RuntimeException('dump_file_size_out_of_range');
            }

            if ($compressed) {
                $tail = '';

                if (inflate_get_status($inflater) !== ZLIB_STREAM_END) {
                    $tail = inflate_add($inflater, '', ZLIB_FINISH);
                }

                if (
                    $tail === false
                    || inflate_get_status($inflater) !== ZLIB_STREAM_END
                    || inflate_get_read_len($inflater) !== $bytes
                ) {
                    throw new RuntimeException('dump_read_failed');
                }

                $this->consumeExpandedChunk(
                    $tail,
                    $maxExpandedBytes,
                    $staged,
                    $reviewedHash,
                    $expandedBytes,
                    $carry,
                    $parser,
                    $allowedTables,
                    $tables,
                    $counts,
                    $unsafe,
                );
            }

            if ($expandedBytes <= 0) {
                throw new RuntimeException('dump_expanded_size_out_of_range');
            }

            $this->scanSql($carry, true, $parser, $allowedTables, $tables, $counts, $unsafe);
            $this->finishSql($parser, $unsafe);

            if (! fflush($staged) || (function_exists('fsync') && ! fsync($staged))) {
                throw new RuntimeException('dump_staging_unavailable');
            }
        } catch (\Throwable $exception) {
            fclose($source);
            fclose($staged);
            @unlink($stagedPath);
            throw $exception;
        }

        fclose($source);
        fclose($staged);

        return [
            'path' => $stagedPath,
            'size_bytes' => $bytes,
            'expanded_bytes' => $expandedBytes,
            'sha256' => hash_final($sourceHash),
            'reviewed_size_bytes' => $expandedBytes,
            'reviewed_sha256' => hash_final($reviewedHash),
            'tables' => $tables,
            'counts' => $counts,
            'unsafe' => $unsafe,
        ];
    }

    /**
     * Test seam proving that a path swap between hashing and lexing cannot alter
     * the bytes already read from the single source handle.
     */
    protected function afterFirstSourceChunkHashed(string $sourcePath): void
    {
        // Intentionally empty.
    }

    /**
     * @param  resource  $staged
     * @param  array{mode: string, statement: string, sql_mode_value: ?string, insert_table: ?string, insert_phase: ?string, insert_token: string, insert_token_separated: bool, insert_rows: int, insert_invalid: bool, overflow: bool}  $parser
     * @param  array<string, bool>  $allowedTables
     * @param  array<string, bool>  $tables
     * @param  array{create_table: int, drop_table: int, insert: int}  $counts
     * @param  list<string>  $unsafe
     */
    private function consumeExpandedChunk(
        string $chunk,
        int $maxExpandedBytes,
        $staged,
        \HashContext $reviewedHash,
        int &$expandedBytes,
        string &$carry,
        array &$parser,
        array $allowedTables,
        array &$tables,
        array &$counts,
        array &$unsafe,
    ): void {
        if ($chunk === '') {
            return;
        }

        $expandedBytes += strlen($chunk);

        if ($expandedBytes > $maxExpandedBytes) {
            throw new RuntimeException('dump_expanded_size_out_of_range');
        }

        hash_update($reviewedHash, $chunk);
        $this->writeAll($staged, $chunk);
        $carry = $this->scanSql(
            $carry.$chunk,
            false,
            $parser,
            $allowedTables,
            $tables,
            $counts,
            $unsafe,
        );
    }

    /**
     * @param  resource  $stream
     */
    private function writeAll($stream, string $contents): void
    {
        $offset = 0;
        $length = strlen($contents);

        while ($offset < $length) {
            $written = fwrite($stream, substr($contents, $offset));

            if ($written === false || $written === 0) {
                throw new RuntimeException('dump_staging_unavailable');
            }

            $offset += $written;
        }
    }

    /**
     * @return array{mode: string, statement: string, sql_mode_value: ?string, insert_table: ?string, insert_phase: ?string, insert_token: string, insert_token_separated: bool, insert_rows: int, insert_invalid: bool, overflow: bool}
     */
    private function newParserState(): array
    {
        return [
            'mode' => 'normal',
            'statement' => '',
            'sql_mode_value' => null,
            'insert_table' => null,
            'insert_phase' => null,
            'insert_token' => '',
            'insert_token_separated' => false,
            'insert_rows' => 0,
            'insert_invalid' => false,
            'overflow' => false,
        ];
    }

    /**
     * @param  array{mode: string, statement: string, sql_mode_value: ?string, insert_table: ?string, insert_phase: ?string, insert_token: string, insert_token_separated: bool, insert_rows: int, insert_invalid: bool, overflow: bool}  $state
     * @param  array<string, bool>  $allowedTables
     * @param  array<string, bool>  $tables
     * @param  array{create_table: int, drop_table: int, insert: int}  $counts
     * @param  list<string>  $unsafe
     */
    private function scanSql(
        string $sql,
        bool $final,
        array &$state,
        array $allowedTables,
        array &$tables,
        array &$counts,
        array &$unsafe,
    ): string {
        $length = strlen($sql);
        $safeEnd = $final ? $length : max(0, $length - 2);
        $index = 0;

        while ($index < $safeEnd) {
            $char = $sql[$index];
            $next = $index + 1 < $length ? $sql[$index + 1] : '';

            if ($state['mode'] === 'line_comment') {
                $index++;

                if ($char === "\n" || $char === "\r") {
                    $state['mode'] = 'normal';
                    $this->appendStatement($state, ' ', $unsafe);
                }

                continue;
            }

            if ($state['mode'] === 'block_comment') {
                if ($char === '*' && $next === '/') {
                    $state['mode'] = 'normal';
                    $this->appendStatement($state, ' ', $unsafe);
                    $index += 2;
                } else {
                    $index++;
                }

                continue;
            }

            if ($state['mode'] === 'single_quote' || $state['mode'] === 'double_quote') {
                $quote = $state['mode'] === 'single_quote' ? "'" : '"';

                if ($char === '\\') {
                    if ($state['sql_mode_value'] !== null) {
                        $state['sql_mode_value'] = '__invalid__';
                    }
                    $index += $next === '' ? 1 : 2;
                } elseif ($char === $quote && $next === $quote) {
                    if ($state['sql_mode_value'] !== null) {
                        $state['sql_mode_value'] = '__invalid__';
                    }
                    $index += 2;
                } elseif ($char === $quote) {
                    $state['mode'] = 'normal';
                    $index++;
                } else {
                    if ($state['sql_mode_value'] !== null) {
                        if (
                            strlen($state['sql_mode_value']) >= 64
                            || preg_match('/[A-Z0-9_,]/i', $char) !== 1
                        ) {
                            $state['sql_mode_value'] = '__invalid__';
                        } else {
                            $state['sql_mode_value'] .= $char;
                        }
                    }
                    $index++;
                }

                continue;
            }

            if ($state['mode'] === 'backtick') {
                if ($state['insert_table'] === null) {
                    $this->appendStatement($state, $char, $unsafe);
                }

                if ($char === '`' && $next === '`') {
                    if ($state['insert_table'] === null) {
                        $this->appendStatement($state, $next, $unsafe);
                    }
                    $index += 2;
                } elseif ($char === '`') {
                    $state['mode'] = 'normal';
                    $index++;
                } else {
                    $index++;
                }

                continue;
            }

            if ($char === '/' && $next === '*') {
                if (($sql[$index + 2] ?? '') === '!') {
                    $unsafe[] = 'mysql_executable_comment_refused';
                }

                if ($state['insert_table'] !== null) {
                    $this->refuseInsertSyntax($state, $unsafe);
                }

                $state['mode'] = 'block_comment';
                $this->appendStatement($state, ' ', $unsafe);
                $index += 2;

                continue;
            }

            if (($char === '-' && $next === '-') || $char === '#') {
                if ($state['insert_table'] !== null) {
                    $this->refuseInsertSyntax($state, $unsafe);
                }

                $state['mode'] = 'line_comment';
                $this->appendStatement($state, ' ', $unsafe);
                $index += $char === '#' ? 1 : 2;

                continue;
            }

            if ($char === "'" || $char === '"') {
                $state['mode'] = $char === "'" ? 'single_quote' : 'double_quote';

                if ($state['insert_table'] !== null) {
                    $this->beginInsertQuotedLiteral($state, $char, $unsafe);
                } else {
                    $state['sql_mode_value'] = $char === "'"
                        && preg_match('/\A\s*SET\s+SQL_MODE\s*=\s*\z/i', $state['statement']) === 1
                            ? ''
                            : null;
                    $this->appendStatement($state, "''", $unsafe);
                }
                $index++;

                continue;
            }

            if ($char === '`') {
                $state['mode'] = 'backtick';

                if ($state['insert_table'] !== null) {
                    $this->refuseInsertSyntax($state, $unsafe);
                } else {
                    $this->appendStatement($state, $char, $unsafe);
                }
                $index++;

                continue;
            }

            if ($char === ';') {
                $this->classifyStatement($state, $allowedTables, $tables, $counts, $unsafe);
                $state = $this->newParserState();
                $index++;

                continue;
            }

            $this->appendStatement($state, $char, $unsafe);
            $index++;
        }

        return substr($sql, $index);
    }

    /**
     * @param  array{mode: string, statement: string, sql_mode_value: ?string, insert_table: ?string, insert_phase: ?string, insert_token: string, insert_token_separated: bool, insert_rows: int, insert_invalid: bool, overflow: bool}  $state
     * @param  list<string>  $unsafe
     */
    private function appendStatement(array &$state, string $contents, array &$unsafe): void
    {
        if ($state['insert_table'] !== null) {
            $this->consumeInsertSyntax($state, $contents, $unsafe);

            return;
        }

        if ($state['overflow']) {
            return;
        }

        if (trim($contents) === '') {
            if ($state['statement'] === '' || str_ends_with($state['statement'], ' ')) {
                return;
            }

            $contents = ' ';
        }

        $state['statement'] .= $contents;

        if (strlen($state['statement']) > 131072) {
            $state['overflow'] = true;
            $unsafe[] = 'statement_metadata_too_large';

            return;
        }

        if (
            preg_match(
                '/\A\s*INSERT\s+INTO\s+`?([a-z0-9_]+)`?(?:\s*\(\s*`?[a-z0-9_]+`?(?:\s*,\s*`?[a-z0-9_]+`?)*\s*\))?\s+VALUES\b/i',
                $state['statement'],
                $match,
            ) === 1
        ) {
            $state['insert_table'] = strtolower($match[1]);
            $state['insert_phase'] = 'expect_row';
        }
    }

    /**
     * @param  array{mode: string, statement: string, sql_mode_value: ?string, insert_table: ?string, insert_phase: ?string, insert_token: string, insert_token_separated: bool, insert_rows: int, insert_invalid: bool, overflow: bool}  $state
     * @param  list<string>  $unsafe
     */
    private function consumeInsertSyntax(array &$state, string $contents, array &$unsafe): void
    {
        foreach (str_split($contents) as $char) {
            if (ctype_space($char)) {
                if ($state['insert_phase'] === 'expect_value' && $state['insert_token'] !== '') {
                    $state['insert_token_separated'] = true;
                }

                continue;
            }

            if ($state['insert_invalid']) {
                continue;
            }

            if ($state['insert_phase'] === 'expect_row') {
                if ($char === '(') {
                    $state['insert_phase'] = 'expect_value';

                    continue;
                }

                $this->refuseInsertSyntax($state, $unsafe);

                continue;
            }

            if ($state['insert_phase'] === 'after_row') {
                if ($char === ',') {
                    $state['insert_phase'] = 'expect_row';

                    continue;
                }

                $this->refuseInsertSyntax($state, $unsafe);

                continue;
            }

            if ($state['insert_phase'] !== 'expect_value') {
                $this->refuseInsertSyntax($state, $unsafe);

                continue;
            }

            if ($char === ',' || $char === ')') {
                if (! $this->isAllowedInsertLiteral($state['insert_token'])) {
                    $this->refuseInsertSyntax($state, $unsafe);

                    continue;
                }

                $state['insert_token'] = '';
                $state['insert_token_separated'] = false;

                if ($char === ')') {
                    $state['insert_rows']++;
                    $state['insert_phase'] = 'after_row';
                }

                continue;
            }

            if ($char === '(' || $state['insert_token_separated']) {
                $this->refuseInsertSyntax($state, $unsafe);

                continue;
            }

            if (preg_match('/[a-z0-9_.+\-]/i', $char) !== 1 || strlen($state['insert_token']) >= 256) {
                $this->refuseInsertSyntax($state, $unsafe);

                continue;
            }

            $state['insert_token'] .= $char;
        }
    }

    /**
     * @param  array{mode: string, statement: string, sql_mode_value: ?string, insert_table: ?string, insert_phase: ?string, insert_token: string, insert_token_separated: bool, insert_rows: int, insert_invalid: bool, overflow: bool}  $state
     * @param  list<string>  $unsafe
     */
    private function beginInsertQuotedLiteral(array &$state, string $quote, array &$unsafe): void
    {
        $prefix = $state['insert_token'];

        if (
            $state['insert_phase'] !== 'expect_value'
            || $quote !== "'"
            || $state['insert_token_separated']
            || ($prefix !== '' && preg_match('/\A(?:N|[XB]|_[a-z0-9]+)\z/i', $prefix) !== 1)
        ) {
            $this->refuseInsertSyntax($state, $unsafe);

            return;
        }

        $state['insert_token'] = '__quoted_literal__';
        $state['insert_token_separated'] = false;
    }

    private function isAllowedInsertLiteral(string $token): bool
    {
        if ($token === '__quoted_literal__' || preg_match('/\A(?:NULL|TRUE|FALSE)\z/i', $token) === 1) {
            return true;
        }

        if (preg_match('/\A0x[0-9a-f]+\z/i', $token) === 1 || preg_match('/\A0b[01]+\z/i', $token) === 1) {
            return true;
        }

        return preg_match('/\A[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?\z/i', $token) === 1;
    }

    /**
     * @param  array{insert_invalid: bool}  $state
     * @param  list<string>  $unsafe
     */
    private function refuseInsertSyntax(array &$state, array &$unsafe): void
    {
        if (! $state['insert_invalid']) {
            $unsafe[] = 'unsupported_insert_values_syntax';
        }

        $state['insert_invalid'] = true;
    }

    /**
     * @param  array{mode: string, statement: string, sql_mode_value: ?string, insert_table: ?string, insert_phase: ?string, insert_token: string, insert_token_separated: bool, insert_rows: int, insert_invalid: bool, overflow: bool}  $state
     * @param  array<string, bool>  $allowedTables
     * @param  array<string, bool>  $tables
     * @param  array{create_table: int, drop_table: int, insert: int}  $counts
     * @param  list<string>  $unsafe
     */
    private function classifyStatement(
        array $state,
        array $allowedTables,
        array &$tables,
        array &$counts,
        array &$unsafe,
    ): void {
        $statement = trim($state['statement']);

        if ($statement === '' && $state['insert_table'] === null) {
            return;
        }

        if ($state['mode'] !== 'normal' || $state['overflow']) {
            $unsafe[] = 'incomplete_or_oversized_statement';

            return;
        }

        if ($state['insert_table'] !== null) {
            if (
                $state['insert_invalid']
                || $state['insert_phase'] !== 'after_row'
                || $state['insert_token'] !== ''
                || $state['insert_rows'] < 1
            ) {
                if (! $state['insert_invalid']) {
                    $unsafe[] = 'unsupported_insert_values_syntax';
                }

                return;
            }

            $this->recordStatement('insert', $state['insert_table'], $allowedTables, $tables, $counts, $unsafe);

            return;
        }

        if (preg_match('/\ACREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?`?([a-z0-9_]+)`?\s*\(/i', $statement, $match) === 1) {
            if (preg_match('/\b(?:DATA|INDEX)\s+DIRECTORY\b|\bSELECT\b/i', $statement) === 1) {
                $unsafe[] = 'unsupported_create_table_clause';

                return;
            }

            $this->recordStatement('create_table', strtolower($match[1]), $allowedTables, $tables, $counts, $unsafe);

            return;
        }

        if (preg_match('/\ADROP\s+TABLE\s+IF\s+EXISTS\s+`?([a-z0-9_]+)`?\z/i', $statement, $match) === 1) {
            $this->recordStatement('drop_table', strtolower($match[1]), $allowedTables, $tables, $counts, $unsafe);

            return;
        }

        if ($this->isAllowedSessionSet($statement, $state['sql_mode_value'])) {
            return;
        }

        $unsafe[] = $this->unsupportedStatementReason($statement);
    }

    /**
     * @param  array<string, bool>  $allowedTables
     * @param  array<string, bool>  $tables
     * @param  array{create_table: int, drop_table: int, insert: int}  $counts
     * @param  list<string>  $unsafe
     */
    private function recordStatement(
        string $kind,
        string $table,
        array $allowedTables,
        array &$tables,
        array &$counts,
        array &$unsafe,
    ): void {
        $counts[$kind]++;
        $tables[$table] = true;

        if (! isset($allowedTables[$table])) {
            $unsafe[] = 'table_outside_dashboard_allowlist';
        }
    }

    private function unsupportedStatementReason(string $statement): string
    {
        if (preg_match('/\A([a-z]+)(?:\s+([a-z_]+))?/i', $statement, $match) !== 1) {
            return 'unsupported_statement';
        }

        $parts = array_filter([
            strtolower($match[1]),
            isset($match[2]) ? strtolower($match[2]) : null,
        ]);

        return 'unsupported_statement_'.implode('_', $parts);
    }

    private function isAllowedSessionSet(string $statement, ?string $sqlModeValue): bool
    {
        if (preg_match('/\ASET\s+NAMES\s+utf8mb4\z/i', $statement) === 1) {
            return true;
        }

        $setting = '(?:CHARACTER_SET_CLIENT|CHARACTER_SET_RESULTS|COLLATION_CONNECTION|FOREIGN_KEY_CHECKS)';

        if (preg_match('/\ASET\s+@OLD_('.$setting.')\s*=\s*@@\1\z/i', $statement) === 1) {
            return true;
        }

        if (preg_match('/\ASET\s+('.$setting.')\s*=\s*@OLD_\1\z/i', $statement) === 1) {
            return true;
        }

        if (preg_match('/\ASET\s+FOREIGN_KEY_CHECKS\s*=\s*[01]\z/i', $statement) === 1) {
            return true;
        }

        return preg_match('/\ASET\s+SQL_MODE\s*=\s*\'\'\z/i', $statement) === 1
            && in_array(strtoupper((string) $sqlModeValue), ['', 'NO_AUTO_VALUE_ON_ZERO'], true);
    }

    /**
     * @param  array{mode: string, statement: string, sql_mode_value: ?string, insert_table: ?string, insert_phase: ?string, insert_token: string, insert_token_separated: bool, insert_rows: int, insert_invalid: bool, overflow: bool}  $state
     * @param  list<string>  $unsafe
     */
    private function finishSql(array $state, array &$unsafe): void
    {
        if ($state['mode'] === 'line_comment' && trim($state['statement']) === '' && $state['insert_table'] === null) {
            return;
        }

        if (
            $state['mode'] !== 'normal'
            || trim($state['statement']) !== ''
            || $state['insert_table'] !== null
            || $state['overflow']
        ) {
            $unsafe[] = 'unterminated_sql_content';
        }
    }
}
