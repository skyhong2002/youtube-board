<?php

namespace App\Support;

use RuntimeException;

final class LegacyDashboardSchema
{
    public const TABLE_COUNT = 50;

    /**
     * @return list<array{table: string, sql: string}>
     */
    public static function statements(string $path): array
    {
        $contents = file_get_contents($path);

        if ($contents === false || trim($contents) === '') {
            throw new RuntimeException('Legacy dashboard baseline schema is missing or empty.');
        }

        $forbiddenPatterns = [
            '/\bDROP\s+(?:TABLE|DATABASE|VIEW)\b/i' => 'DROP statements',
            '/\bDATA\s+DIRECTORY\b/i' => 'DATA DIRECTORY clauses',
            '/\bINDEX\s+DIRECTORY\b/i' => 'INDEX DIRECTORY clauses',
            '/\bAUTO_INCREMENT\s*=\s*\d+/i' => 'source auto-increment counters',
            '/\b(?:INSERT|UPDATE|DELETE|REPLACE|TRUNCATE)\b/i' => 'data mutations',
        ];

        foreach ($forbiddenPatterns as $pattern => $description) {
            if (preg_match($pattern, $contents) === 1) {
                throw new RuntimeException("Legacy dashboard baseline schema contains forbidden {$description}.");
            }
        }

        $blocks = preg_split('/(?=^CREATE TABLE IF NOT EXISTS `)/m', $contents) ?: [];
        $statements = [];

        foreach ($blocks as $block) {
            $sql = trim($block);

            if ($sql === '') {
                continue;
            }

            if (preg_match('/\ACREATE TABLE IF NOT EXISTS `([a-z0-9_]+)`\s*\(/i', $sql, $match) !== 1) {
                throw new RuntimeException('Legacy dashboard baseline schema contains an unsupported statement.');
            }

            if (! str_ends_with($sql, ';')) {
                throw new RuntimeException("Legacy dashboard table {$match[1]} is missing its statement terminator.");
            }

            $statements[] = [
                'table' => $match[1],
                'sql' => $sql,
            ];
        }

        if (count($statements) !== self::TABLE_COUNT) {
            throw new RuntimeException(sprintf(
                'Legacy dashboard baseline schema must contain %d tables; found %d.',
                self::TABLE_COUNT,
                count($statements),
            ));
        }

        if (count(array_unique(array_column($statements, 'table'))) !== self::TABLE_COUNT) {
            throw new RuntimeException('Legacy dashboard baseline schema contains duplicate table names.');
        }

        return $statements;
    }
}
