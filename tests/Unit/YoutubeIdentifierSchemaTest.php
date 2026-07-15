<?php

namespace Tests\Unit;

use App\Support\YoutubeIdentifierSchema;
use PHPUnit\Framework\TestCase;

class YoutubeIdentifierSchemaTest extends TestCase
{
    public function test_plain_varchar_metadata_is_accepted_before_and_after_binary_conversion(): void
    {
        $definition = ['length' => 32, 'nullable' => false];
        $metadata = $this->validMetadata();

        $this->assertSame([], YoutubeIdentifierSchema::metadataIssues($definition, $metadata, false));
        $this->assertSame(
            ['collation_mismatch'],
            YoutubeIdentifierSchema::metadataIssues($definition, $metadata, true),
        );

        $metadata['collation'] = YoutubeIdentifierSchema::COLLATION;

        $this->assertSame([], YoutubeIdentifierSchema::metadataIssues($definition, $metadata, true));
    }

    public function test_missing_and_drifted_metadata_is_rejected_fail_closed(): void
    {
        $definition = ['length' => 32, 'nullable' => false];

        $this->assertSame(
            ['missing_column'],
            YoutubeIdentifierSchema::metadataIssues($definition, null, false),
        );

        $cases = [
            'data type' => ['data_type', 'text', 'not_plain_varchar(32)'],
            'column type' => ['column_type', 'varchar(31)', 'not_plain_varchar(32)'],
            'length' => ['character_maximum_length', 31, 'length_mismatch'],
            'nullability' => ['nullable', true, 'nullability_mismatch'],
            'character set' => ['character_set', 'latin1', 'character_set_mismatch'],
            'default' => ['default_is_null', false, 'unexpected_default'],
            'extra' => ['extra', 'DEFAULT_GENERATED', 'unexpected_extra'],
            'comment' => ['comment', 'legacy drift', 'unexpected_comment'],
            'generation' => ['generation_expression', '`other_column`', 'unexpected_generation_expression'],
            'collation' => ['collation', null, 'missing_collation'],
        ];

        foreach ($cases as $label => [$key, $value, $expectedIssue]) {
            $metadata = $this->validMetadata();
            $metadata[$key] = $value;

            $this->assertContains(
                $expectedIssue,
                YoutubeIdentifierSchema::metadataIssues($definition, $metadata, false),
                $label,
            );
        }
    }

    /**
     * @return array{
     *     data_type: string,
     *     column_type: string,
     *     character_maximum_length: int,
     *     nullable: bool,
     *     character_set: string,
     *     collation: string,
     *     default_is_null: bool,
     *     extra: string,
     *     comment: string,
     *     generation_expression: string
     * }
     */
    private function validMetadata(): array
    {
        return [
            'data_type' => 'varchar',
            'column_type' => 'varchar(32)',
            'character_maximum_length' => 32,
            'nullable' => false,
            'character_set' => YoutubeIdentifierSchema::CHARACTER_SET,
            'collation' => 'utf8mb4_unicode_ci',
            'default_is_null' => true,
            'extra' => '',
            'comment' => '',
            'generation_expression' => '',
        ];
    }
}
