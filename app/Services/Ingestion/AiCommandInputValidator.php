<?php

namespace App\Services\Ingestion;

use Carbon\CarbonImmutable;
use InvalidArgumentException;
use Throwable;

final class AiCommandInputValidator
{
    /** @var list<string> */
    public const DAILY_CONDITIONS = ['all', 'green', 'blue', 'neutral', 'finance', 'world'];

    /** @var list<string> */
    public const HOURLY_CONDITIONS = ['all', 'green', 'blue', 'neutral', 'finance', 'world', 'news'];

    /** @var list<string> */
    public const DAILY_DATA_TYPES = ['oneday', 'todate', 'week'];

    /** @var list<string> */
    public const EVENT_PROMPT_TYPES = ['summary', 'people', 'media'];

    /**
     * @param  list<string>  $aliases
     */
    public static function date(?string $value, string $option, array $aliases = []): ?string
    {
        if ($value === null) {
            return null;
        }

        $value = trim($value);

        if (in_array($value, $aliases, true)) {
            return $value;
        }

        if (preg_match('/^(\d{4})-(\d{2})-(\d{2})$/', $value, $matches) !== 1
            || ! checkdate((int) $matches[2], (int) $matches[3], (int) $matches[1])) {
            $accepted = $aliases === []
                ? 'a valid calendar date in YYYY-MM-DD'
                : implode(', ', $aliases).', or a valid calendar date in YYYY-MM-DD';

            throw new InvalidArgumentException("{$option} must be {$accepted}");
        }

        return $value;
    }

    /**
     * @param  list<string>|null  $allowed
     */
    public static function condition(?string $value, ?array $allowed = null): string
    {
        if ($value === null) {
            return 'all';
        }

        $value = trim($value);

        if ($value === '' || preg_match('/^[A-Za-z0-9_-]{1,40}$/', $value) !== 1) {
            throw new InvalidArgumentException('--condition contains unsupported characters');
        }

        if ($allowed !== null && ! in_array($value, $allowed, true)) {
            throw new InvalidArgumentException('--condition must be one of: '.implode(', ', $allowed));
        }

        return $value;
    }

    /**
     * @param  list<string>  $allowed
     */
    public static function type(string $value, array $allowed): string
    {
        $value = strtolower(trim($value));

        if (! in_array($value, $allowed, true)) {
            throw new InvalidArgumentException('--type must be one of: '.implode(', ', $allowed));
        }

        return $value;
    }

    /**
     * @return list<string>
     */
    public static function promptTypes(string $value): array
    {
        $types = array_map('trim', explode(',', $value));

        if ($types === [] || in_array('', $types, true)) {
            throw new InvalidArgumentException('--prompt-types must contain at least one supported type');
        }

        $unsupported = array_values(array_diff($types, self::EVENT_PROMPT_TYPES));

        if ($unsupported !== []) {
            throw new InvalidArgumentException('--prompt-types contains unsupported values: '.implode(', ', array_unique($unsupported)));
        }

        return array_values(array_unique($types));
    }

    public static function integer(mixed $value, string $option, int $minimum = 0): int
    {
        $value = is_int($value)
            ? (string) $value
            : (is_string($value) ? trim($value) : '');
        $integer = preg_match('/^-?\d+$/', $value) === 1
            ? filter_var($value, FILTER_VALIDATE_INT)
            : false;

        if ($integer === false || $integer < $minimum) {
            $expectation = match ($minimum) {
                0 => 'a non-negative integer',
                1 => 'a positive integer',
                default => "an integer greater than or equal to {$minimum}",
            };

            throw new InvalidArgumentException("{$option} must be {$expectation}");
        }

        return $integer;
    }

    public static function nonEmptyString(mixed $value, string $option): string
    {
        if (! is_string($value) || trim($value) === '') {
            throw new InvalidArgumentException("{$option} must not be empty");
        }

        return trim($value);
    }

    public static function commaSeparated(mixed $value, string $option): string
    {
        $value = self::nonEmptyString($value, $option);
        $items = array_map('trim', explode(',', $value));

        if (in_array('', $items, true)) {
            throw new InvalidArgumentException("{$option} must contain only non-empty values");
        }

        return implode(',', $items);
    }

    public static function timestamp(mixed $value, string $option, string $timezone): ?CarbonImmutable
    {
        if ($value === null) {
            return null;
        }

        $value = self::nonEmptyString($value, $option);

        try {
            $timestamp = CarbonImmutable::createFromFormat('!Y-m-d H:i:s', $value, $timezone);
        } catch (Throwable) {
            throw new InvalidArgumentException("{$option} must be a valid timestamp in Y-m-d H:i:s");
        }

        if ($timestamp === false || $timestamp->format('Y-m-d H:i:s') !== $value) {
            throw new InvalidArgumentException("{$option} must be a valid timestamp in Y-m-d H:i:s");
        }

        return $timestamp;
    }
}
