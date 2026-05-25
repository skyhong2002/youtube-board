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

$tables = array(
    'urt_ai_date',
    'urt_ai_event',
    'urt_ai_hour',
    'urt_channel_ai',
);

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

function run_unbuffered_query($sql)
{
    $result = mysql_unbuffered_query($sql, $GLOBALS['link']);

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

function scalar_query($sql)
{
    $result = run_query($sql);
    $row = mysql_fetch_row($result);

    return $row ? $row[0] : 0;
}

function table_size($table)
{
    $safeDatabase = mysql_real_escape_string($GLOBALS['database'], $GLOBALS['link']);
    $safeTable = mysql_real_escape_string($table, $GLOBALS['link']);
    $sql = "SELECT table_rows, data_length, index_length FROM information_schema.tables WHERE table_schema='".$safeDatabase."' AND table_name='".$safeTable."'";
    $result = run_query($sql);
    $row = mysql_fetch_assoc($result);

    if (! $row) {
        return array(0, 0, 0);
    }

    return array((int) $row['table_rows'], (int) $row['data_length'], (int) $row['index_length']);
}

function dump_insert_rows($table)
{
    $columns = table_columns($table);
    $columnSql = array();

    foreach ($columns as $column) {
        $columnSql[] = quote_identifier($column);
    }

    $batchSize = (int) getenv('AI_TABLES_INSERT_BATCH_SIZE');
    if ($batchSize <= 0) {
        $batchSize = 25;
    }

    $orderBy = in_array('pk', $columns) ? ' ORDER BY '.quote_identifier('pk') : '';
    $result = run_unbuffered_query('SELECT * FROM '.quote_identifier($GLOBALS['database']).'.'.quote_identifier($table).$orderBy);
    $rows = array();
    $dumped = 0;

    echo "-- Data for table: ".$table."\n";

    while ($row = mysql_fetch_assoc($result)) {
        $values = array();

        foreach ($columns as $column) {
            $values[] = sql_value($row[$column]);
        }

        $rows[] = '('.implode(',', $values).')';
        $dumped++;

        if (count($rows) >= $batchSize) {
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
}

function emit_estimate($tables)
{
    $totalRows = 0;
    $totalBytes = 0;

    echo "table\tactual_rows\testimated_rows\tdata_bytes\tindex_bytes\ttotal_bytes\n";

    foreach ($tables as $table) {
        $actualRows = (int) scalar_query('SELECT COUNT(*) FROM '.quote_identifier($GLOBALS['database']).'.'.quote_identifier($table));
        list($estimatedRows, $dataBytes, $indexBytes) = table_size($table);
        $bytes = $dataBytes + $indexBytes;
        $totalRows += $actualRows;
        $totalBytes += $bytes;

        echo $table."\t".$actualRows."\t".$estimatedRows."\t".$dataBytes."\t".$indexBytes."\t".$bytes."\n";
    }

    echo "TOTAL\t".$totalRows."\t\t\t\t".$totalBytes."\n";
}

$mode = getenv('AI_TABLES_MODE');

if ($mode === 'estimate') {
    emit_estimate($tables);
    exit(0);
}

echo "-- YouTube Board AI tables dump\n";
echo "-- Source database: ".$database."\n";
echo "-- Source host: REDACTED\n";
echo "-- Source user: ".str_replace("\n", '', $user)."\n";
echo "-- Generated at: ".date('c')."\n";
echo "-- Includes schema and full data for AI report tables only.\n";
echo "-- Production secrets are not included by table selection.\n\n";
echo "SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT;\n";
echo "SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS;\n";
echo "SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION;\n";
echo "SET NAMES utf8mb4;\n";
echo "SET @OLD_FOREIGN_KEY_CHECKS=@@FOREIGN_KEY_CHECKS;\n";
echo "SET FOREIGN_KEY_CHECKS=0;\n";
echo "SET SQL_MODE='NO_AUTO_VALUE_ON_ZERO';\n\n";

foreach ($tables as $table) {
    list($estimatedRows, $dataBytes, $indexBytes) = table_size($table);
    $createResult = run_query('SHOW CREATE TABLE '.quote_identifier($database).'.'.quote_identifier($table));
    $create = mysql_fetch_assoc($createResult);

    echo "--\n";
    echo "-- Table schema: ".$table."\n";
    echo "-- Estimated rows: ".$estimatedRows."; data bytes: ".$dataBytes."; index bytes: ".$indexBytes."\n";
    echo "--\n\n";
    echo 'DROP TABLE IF EXISTS '.quote_identifier($table).";\n";
    echo sanitize_create_statement($create['Create Table']).";\n\n";
}

foreach ($tables as $table) {
    dump_insert_rows($table);
}

echo "SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS;\n";
echo "SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT;\n";
echo "SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS;\n";
echo "SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION;\n";

progress('done');
