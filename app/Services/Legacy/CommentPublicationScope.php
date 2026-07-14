<?php

namespace App\Services\Legacy;

use Illuminate\Database\Query\Builder;
use Illuminate\Support\Facades\Schema;

final class CommentPublicationScope
{
    public static function complete(Builder $query, string $column = 'urt_comment.pageToken'): Builder
    {
        if (! Schema::hasColumn('urt_comment', 'pageToken')) {
            return $query;
        }

        return $query->where(function (Builder $query) use ($column): void {
            $query->whereNull($column)->orWhere($column, '');
        });
    }
}
