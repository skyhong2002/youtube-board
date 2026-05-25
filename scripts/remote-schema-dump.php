<?php

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

if (! $link) {
    fwrite(STDERR, "db_connect_failed\n");
    exit(3);
}

if (! mysql_select_db($database, $link)) {
    fwrite(STDERR, "db_select_failed\n");
    exit(4);
}

mysql_query("SET NAMES utf8mb4", $link);

function quote_identifier($identifier)
{
    return '`'.str_replace('`', '``', $identifier).'`';
}

function run_query($sql, $link)
{
    $result = mysql_query($sql, $link);

    if (! $result) {
        fwrite(STDERR, "query_failed: ".$sql."\n");
        fwrite(STDERR, mysql_error($link)."\n");
        exit(5);
    }

    return $result;
}

$safeDatabase = mysql_real_escape_string($database, $link);

echo "-- YouTube Board legacy schema-only dump\n";
echo "-- Source database: ".$database."\n";
echo "-- Source host: REDACTED\n";
echo "-- Source user: ".str_replace("\n", '', $user)."\n";
echo "-- Generated at: ".date('c')."\n";
echo "-- Contains schema only. No table data is included.\n\n";
echo "SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT;\n";
echo "SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS;\n";
echo "SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION;\n";
echo "SET NAMES utf8mb4;\n";
echo "SET @OLD_FOREIGN_KEY_CHECKS=@@FOREIGN_KEY_CHECKS;\n";
echo "SET FOREIGN_KEY_CHECKS=0;\n\n";

$tables = array();
$views = array();
$result = run_query("SHOW FULL TABLES FROM ".quote_identifier($database), $link);
$tableNameColumn = 'Tables_in_'.$database;

while ($row = mysql_fetch_assoc($result)) {
    $name = $row[$tableNameColumn];
    $type = $row['Table_type'];

    if ($type === 'VIEW') {
        $views[] = $name;
    } else {
        $tables[] = $name;
    }
}

sort($tables);
sort($views);

foreach ($tables as $table) {
    $statusResult = run_query(
        "SELECT table_rows, data_length, index_length FROM information_schema.tables WHERE table_schema='".$safeDatabase."' AND table_name='".mysql_real_escape_string($table, $link)."'",
        $link
    );
    $status = mysql_fetch_assoc($statusResult);

    echo "--\n";
    echo "-- Table: ".$table."\n";
    if ($status) {
        echo "-- Estimated rows: ".$status['table_rows']."; data bytes: ".$status['data_length']."; index bytes: ".$status['index_length']."\n";
    }
    echo "--\n\n";

    $createResult = run_query("SHOW CREATE TABLE ".quote_identifier($database).".".quote_identifier($table), $link);
    $create = mysql_fetch_assoc($createResult);

    echo "DROP TABLE IF EXISTS ".quote_identifier($table).";\n";
    echo $create['Create Table'].";\n\n";
}

foreach ($views as $view) {
    echo "--\n";
    echo "-- View: ".$view."\n";
    echo "--\n\n";

    $createResult = run_query("SHOW CREATE VIEW ".quote_identifier($database).".".quote_identifier($view), $link);
    $create = mysql_fetch_assoc($createResult);

    echo "DROP VIEW IF EXISTS ".quote_identifier($view).";\n";
    echo $create['Create View'].";\n\n";
}

$triggerResult = mysql_query("SHOW TRIGGERS FROM ".quote_identifier($database), $link);
if ($triggerResult) {
    while ($trigger = mysql_fetch_assoc($triggerResult)) {
        $triggerName = $trigger['Trigger'];
        $createResult = mysql_query("SHOW CREATE TRIGGER ".quote_identifier($database).".".quote_identifier($triggerName), $link);

        if (! $createResult) {
            continue;
        }

        $create = mysql_fetch_assoc($createResult);

        echo "DELIMITER ;;\n";
        echo "DROP TRIGGER IF EXISTS ".quote_identifier($triggerName).";;\n";
        echo $create['SQL Original Statement'].";;\n";
        echo "DELIMITER ;\n\n";
    }
}

$routineResult = mysql_query("SELECT routine_name, routine_type FROM information_schema.routines WHERE routine_schema='".$safeDatabase."' ORDER BY routine_type, routine_name", $link);
if ($routineResult) {
    while ($routine = mysql_fetch_assoc($routineResult)) {
        $routineType = strtoupper($routine['routine_type']);
        $routineName = $routine['routine_name'];
        $createResult = mysql_query("SHOW CREATE ".$routineType." ".quote_identifier($database).".".quote_identifier($routineName), $link);

        if (! $createResult) {
            continue;
        }

        $create = mysql_fetch_assoc($createResult);
        $createColumn = $routineType === 'PROCEDURE' ? 'Create Procedure' : 'Create Function';

        echo "DELIMITER ;;\n";
        echo "DROP ".$routineType." IF EXISTS ".quote_identifier($routineName).";;\n";
        echo $create[$createColumn].";;\n";
        echo "DELIMITER ;\n\n";
    }
}

echo "SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS;\n";
echo "SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT;\n";
echo "SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS;\n";
echo "SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION;\n";
