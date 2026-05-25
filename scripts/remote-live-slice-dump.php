<?php

date_default_timezone_set('Asia/Taipei');

$stderr = fopen('php://stderr', 'w');

$configFiles = array(
    '/home/urtube/live.php',
    '/home/urtube/index.php',
    '/home/urtube/app/admin.php',
);

$host = null;
$user = null;
$password = null;
$database = null;

foreach ($configFiles as $file) {
    if (! is_readable($file)) {
        continue;
    }

    $source = file_get_contents($file);

    if (
        preg_match('/mysql_connect\(\s*["\']([^"\']+)["\']\s*,\s*["\']([^"\']+)["\']\s*,\s*["\']([^"\']*)["\']\s*\)/', $source, $connectionMatch)
        && preg_match('/mysql_select_db\(\s*["\']([^"\']+)["\']\s*\)/', $source, $databaseMatch)
    ) {
        $host = $connectionMatch[1];
        $user = $connectionMatch[2];
        $password = $connectionMatch[3];
        $database = $databaseMatch[1];
        break;
    }
}

if ($database === null) {
    fwrite($stderr, "db_config_not_found\n");
    exit(2);
}

$link = mysql_connect($host, $user, $password);

if (! $link) {
    fwrite($stderr, "db_connect_failed\n");
    exit(3);
}

if (! mysql_select_db($database, $link)) {
    fwrite($stderr, "db_select_failed\n");
    exit(4);
}

mysql_query("SET NAMES utf8mb4", $link);

function progress($message)
{
    fwrite($GLOBALS['stderr'], $message."\n");
}

function quote_identifier($identifier)
{
    return '`'.str_replace('`', '``', $identifier).'`';
}

function run_query($sql)
{
    $result = mysql_query($sql, $GLOBALS['link']);

    if (! $result) {
        fwrite($GLOBALS['stderr'], "query_failed: ".$sql."\n");
        fwrite($GLOBALS['stderr'], mysql_error($GLOBALS['link'])."\n");
        exit(5);
    }

    return $result;
}

function sql_value($value)
{
    if ($value === null) {
        return 'NULL';
    }

    return "'".mysql_real_escape_string($value, $GLOBALS['link'])."'";
}

function sanitize_create_statement($statement)
{
    $statement = preg_replace("/ DATA DIRECTORY='[^']*'/", '', $statement);
    $statement = preg_replace("/ INDEX DIRECTORY='[^']*'/", '', $statement);

    return $statement;
}

function table_columns($table)
{
    $columns = array();
    $result = run_query('SHOW COLUMNS FROM '.quote_identifier($GLOBALS['database']).'.'.quote_identifier($table));

    while ($row = mysql_fetch_assoc($result)) {
        $columns[] = $row['Field'];
    }

    return $columns;
}

function dump_insert_rows($table, $where, $dedupeColumn, &$seen)
{
    $columns = table_columns($table);
    $columnSql = array();

    foreach ($columns as $column) {
        $columnSql[] = quote_identifier($column);
    }

    $sql = 'SELECT * FROM '.quote_identifier($GLOBALS['database']).'.'.quote_identifier($table);

    if ($where !== null && $where !== '') {
        $sql .= ' WHERE '.$where;
    }

    $result = run_query($sql);
    $rows = array();
    $dumped = 0;

    echo "-- Data for table: ".$table."\n";

    while ($row = mysql_fetch_assoc($result)) {
        if ($dedupeColumn !== null) {
            $dedupeValue = isset($row[$dedupeColumn]) ? $row[$dedupeColumn] : null;

            if ($dedupeValue !== null && isset($seen[$table][$dedupeValue])) {
                continue;
            }

            if ($dedupeValue !== null) {
                $seen[$table][$dedupeValue] = true;
            }
        }

        $values = array();

        foreach ($columns as $column) {
            $values[] = sql_value($row[$column]);
        }

        $rows[] = '('.implode(',', $values).')';
        $dumped++;

        if (count($rows) >= 100) {
            echo 'INSERT INTO '.quote_identifier($table).' ('.implode(',', $columnSql).") VALUES\n";
            echo implode(",\n", $rows).";\n";
            $rows = array();
        }
    }

    if (count($rows) > 0) {
        echo 'INSERT INTO '.quote_identifier($table).' ('.implode(',', $columnSql).") VALUES\n";
        echo implode(",\n", $rows).";\n";
    }

    echo "-- Dumped rows for ".$table.": ".$dumped."\n\n";
    progress('dumped '.$table.' rows='.$dumped);

    return $dumped;
}

function collect_distinct($sql, $column)
{
    $values = array();
    $result = run_query($sql);

    while ($row = mysql_fetch_assoc($result)) {
        if ($row[$column] !== null && $row[$column] !== '') {
            $values[$row[$column]] = true;
        }
    }

    return $values;
}

function in_chunks($column, $values, $chunkSize)
{
    $chunks = array();
    $current = array();
    $count = 0;

    foreach ($values as $value => $_) {
        $current[] = sql_value($value);
        $count++;

        if ($count >= $chunkSize) {
            $chunks[] = quote_identifier($column).' IN ('.implode(',', $current).')';
            $current = array();
            $count = 0;
        }
    }

    if (count($current) > 0) {
        $chunks[] = quote_identifier($column).' IN ('.implode(',', $current).')';
    }

    return $chunks;
}

$cutoffDate = getenv('LIVE_SLICE_CUTOFF_DATE');
if (! $cutoffDate) {
    $cutoffDate = date('Y-m-d', strtotime('-7 days'));
}

$cutoffDateTime = $cutoffDate.' 00:00:00';
$safeCutoffDate = mysql_real_escape_string($cutoffDate, $link);
$safeCutoffDateTime = mysql_real_escape_string($cutoffDateTime, $link);
$liveWhere = "videoId IN (SELECT videoId FROM urt_video_live_log WHERE the_date >= '".$safeCutoffDate."')"
    ." OR actualEndTime IS NULL"
    ." OR mtime >= '".$safeCutoffDateTime."'"
    ." OR publishedAt >= '".$safeCutoffDateTime."'"
    ." OR actualStartTime >= '".$safeCutoffDateTime."'"
    ." OR scheduledStartTime >= '".$safeCutoffDateTime."'";

progress('collecting anchor video/channel ids');

$videoIds = collect_distinct('SELECT videoId FROM urt_video_live WHERE '.$liveWhere, 'videoId');
$recentLogVideoIds = collect_distinct("SELECT videoId FROM urt_video_live_log WHERE the_date >= '".$safeCutoffDate."'", 'videoId');
foreach ($recentLogVideoIds as $videoId => $_) {
    $videoIds[$videoId] = true;
}

$uIds = collect_distinct('SELECT u_id FROM urt_video_live WHERE '.$liveWhere, 'u_id');
$recentLogUIds = collect_distinct("SELECT u_id FROM urt_video_live_log WHERE the_date >= '".$safeCutoffDate."'", 'u_id');
foreach ($recentLogUIds as $uId => $_) {
    $uIds[$uId] = true;
}

progress('anchor video ids='.count($videoIds).' channel ids='.count($uIds));

echo "-- YouTube Board recent live slice dump\n";
echo "-- Source database: ".$database."\n";
echo "-- Source host: REDACTED\n";
echo "-- Source user: ".str_replace("\n", '', $user)."\n";
echo "-- Generated at: ".date('c')."\n";
echo "-- Cutoff date: ".$cutoffDate."\n";
echo "-- Includes all schema, selected recent live data, and full reference channel/tag tables.\n";
echo "-- Production secrets are not included by table selection.\n\n";
echo "SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT;\n";
echo "SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS;\n";
echo "SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION;\n";
echo "SET NAMES utf8mb4;\n";
echo "SET @OLD_FOREIGN_KEY_CHECKS=@@FOREIGN_KEY_CHECKS;\n";
echo "SET FOREIGN_KEY_CHECKS=0;\n";
echo "SET SQL_MODE='NO_AUTO_VALUE_ON_ZERO';\n\n";

$tables = array();
$result = run_query('SHOW FULL TABLES FROM '.quote_identifier($database));
$tableNameColumn = 'Tables_in_'.$database;

while ($row = mysql_fetch_assoc($result)) {
    if ($row['Table_type'] === 'BASE TABLE') {
        $tables[] = $row[$tableNameColumn];
    }
}

sort($tables);

foreach ($tables as $table) {
    $createResult = run_query('SHOW CREATE TABLE '.quote_identifier($database).'.'.quote_identifier($table));
    $create = mysql_fetch_assoc($createResult);

    echo "--\n";
    echo "-- Table schema: ".$table."\n";
    echo "--\n\n";
    echo 'DROP TABLE IF EXISTS '.quote_identifier($table).";\n";
    echo sanitize_create_statement($create['Create Table']).";\n\n";
}

$seen = array();

progress('dumping full reference tables');
dump_insert_rows('tag_group', null, 'pk', $seen);
dump_insert_rows('tags', null, 'pk', $seen);
dump_insert_rows('urt_tag', null, 'tag_id', $seen);
dump_insert_rows('urt_channel', null, 'u_id', $seen);
dump_insert_rows('urt_count', null, 'u_id', $seen);

progress('dumping live slice tables');
dump_insert_rows('urt_video_live', '('.$liveWhere.')', 'videoId', $seen);
dump_insert_rows('urt_video_live_log', "the_date >= '".$safeCutoffDate."'", 'pk', $seen);
dump_insert_rows('urt_show_live_date', "the_date >= '".$safeCutoffDate."'", 'pk', $seen);
dump_insert_rows('urt_show_live_tag_date', "the_date >= '".$safeCutoffDate."'", 'pk', $seen);

$videoIdConditions = in_chunks('videoId', $videoIds, 500);

foreach ($videoIdConditions as $condition) {
    dump_insert_rows('urt_show_video_live', $condition, 'pk_live', $seen);
}

dump_insert_rows('urt_video', "publishedAt >= '".$safeCutoffDateTime."'", 'videoId', $seen);

foreach ($videoIdConditions as $condition) {
    dump_insert_rows('urt_video', $condition, 'videoId', $seen);
}

dump_insert_rows('urt_video_live_log_tvbs', "the_date >= '".$safeCutoffDate."'", 'pk', $seen);
dump_insert_rows(
    'urt_video_live_tvbs',
    "actualEndTime IS NULL OR mtime >= '".$safeCutoffDateTime."' OR publishedAt >= '".$safeCutoffDateTime."' OR actualStartTime >= '".$safeCutoffDateTime."' OR scheduledStartTime >= '".$safeCutoffDateTime."'",
    'videoId',
    $seen
);

echo "SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS;\n";
echo "SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT;\n";
echo "SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS;\n";
echo "SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION;\n";

progress('done');
