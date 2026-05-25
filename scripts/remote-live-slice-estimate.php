<?php

date_default_timezone_set('Asia/Taipei');

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
    fwrite(STDERR, "db_config_not_found\n");
    exit(2);
}

$link = mysql_connect($host, $user, $password);
$stderr = fopen('php://stderr', 'w');

if (! $link) {
    fwrite(STDERR, "db_connect_failed\n");
    exit(3);
}

if (! mysql_select_db($database, $link)) {
    fwrite(STDERR, "db_select_failed\n");
    exit(4);
}

mysql_query("SET NAMES utf8mb4", $link);

function scalar_query($sql, $link)
{
    $result = mysql_query($sql, $link);

    if (! $result) {
        fwrite($GLOBALS['stderr'], "query_failed: ".$sql."\n");
        fwrite($GLOBALS['stderr'], mysql_error($link)."\n");
        exit(5);
    }

    $row = mysql_fetch_row($result);

    return $row ? $row[0] : 0;
}

function table_size($table, $database, $link)
{
    $safeDatabase = mysql_real_escape_string($database, $link);
    $safeTable = mysql_real_escape_string($table, $link);
    $sql = "SELECT table_rows, data_length, index_length FROM information_schema.tables WHERE table_schema='".$safeDatabase."' AND table_name='".$safeTable."'";
    $result = mysql_query($sql, $link);

    if (! $result) {
        return array(0, 0, 0);
    }

    $row = mysql_fetch_assoc($result);

    if (! $row) {
        return array(0, 0, 0);
    }

    return array((float) $row['table_rows'], (float) $row['data_length'], (float) $row['index_length']);
}

function estimate_mb($table, $count, $database, $link)
{
    list($totalRows, $dataBytes, $indexBytes) = table_size($table, $database, $link);

    if ($totalRows <= 0) {
        return 0.0;
    }

    return ($count * (($dataBytes + $indexBytes) / $totalRows)) / 1024 / 1024;
}

$cutoffDate = date('Y-m-d', strtotime('-7 days'));
$cutoffDateTime = $cutoffDate.' 00:00:00';
$anchorWhere = "videoId IN (SELECT videoId FROM urt_video_live_log WHERE the_date >= '".$cutoffDate."')"
    ." OR actualEndTime IS NULL"
    ." OR mtime >= '".$cutoffDateTime."'"
    ." OR publishedAt >= '".$cutoffDateTime."'"
    ." OR actualStartTime >= '".$cutoffDateTime."'"
    ." OR scheduledStartTime >= '".$cutoffDateTime."'";
$anchorVideoSubquery = "SELECT videoId FROM urt_video_live WHERE ".$anchorWhere;
$anchorChannelSubquery = "SELECT u_id FROM urt_video_live WHERE ".$anchorWhere;

$tables = array(
    array('urt_video_live', $anchorWhere),
    array('urt_video_live_log', "the_date >= '".$cutoffDate."'"),
    array('urt_show_video_live', "videoId IN (".$anchorVideoSubquery.")"),
    array('urt_video', "publishedAt >= '".$cutoffDateTime."'"),
    array('urt_show_live_date', "the_date >= '".$cutoffDate."'"),
    array('urt_show_live_tag_date', "the_date >= '".$cutoffDate."'"),
    array('urt_channel', "u_id IN (".$anchorChannelSubquery.") OR u_id IN (SELECT u_id FROM urt_video_live_log WHERE the_date >= '".$cutoffDate."')"),
    array('urt_count', "u_id IN (".$anchorChannelSubquery.") OR u_id IN (SELECT u_id FROM urt_video_live_log WHERE the_date >= '".$cutoffDate."')"),
    array('urt_tag', '1=1'),
);

function emit_line($line)
{
    echo $line."\n";
    flush();
}

emit_line("cutoff_date=".$cutoffDate);
emit_line("strategy=recent_7_days_live_logs_plus_current_or_recent_live_streams");

$totalRows = 0;
$totalMb = 0.0;

foreach ($tables as $tableConfig) {
    $table = $tableConfig[0];
    $where = $tableConfig[1];
    $count = (int) scalar_query("SELECT COUNT(*) FROM ".$table." WHERE ".$where, $link);
    $mb = estimate_mb($table, $count, $database, $link);
    $totalRows += $count;
    $totalMb += $mb;

    emit_line("table=".$table." rows=".$count." estimated_mb=".round($mb, 1));
}

emit_line("total_rows=".$totalRows." estimated_mb=".round($totalMb, 1));
