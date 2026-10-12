#!/usr/bin/env bash
# Runs beside the source server; root owns deployment/execution approval.
# Credentials: MYSQL_PWD or BACKUP_DEFAULTS_FILE. Never password command arguments.
set -Eeuo pipefail
umask 077
stage=arguments
mode=${1:---preview}; shift || true
database= output= max_seconds=60 wait_seconds=5
for argument in "$@"; do
 case "$argument" in
  --database=*) database=${argument#*=};;
  --output=*) output=${argument#*=};;
  --max-seconds=*) max_seconds=${argument#*=};;
  --lock-wait-seconds=*) wait_seconds=${argument#*=};;
  *) printf 'Invalid backup option\n' >&2; exit 2;;
 esac
done
if [[ $mode == --preview ]]; then printf '{"mode":"preview","method":"bounded-ftwrl-logical","writes":0,"locks":0}\n'; exit 0; fi
[[ $mode == --execute || $mode == --manifest || $mode == --watchdog ]] || exit 2
[[ $database =~ ^[A-Za-z0-9_]+$ && ${#database} -le 64 && $output == /* && $output != / && $max_seconds =~ ^[0-9]+$ && $wait_seconds =~ ^[0-9]+$ ]] || exit 2
(( max_seconds >= 3 && max_seconds <= 300 && wait_seconds >= 1 && wait_seconds <= 10 && wait_seconds < max_seconds )) || exit 2
[[ -z ${BACKUP_DEFAULTS_FILE:-} || ( ${BACKUP_DEFAULTS_FILE} == /* && -f ${BACKUP_DEFAULTS_FILE} && ! -L ${BACKUP_DEFAULTS_FILE} ) ]] || exit 2
client=(mariadb)
dump=(mariadb-dump)
if [[ -n ${BACKUP_DEFAULTS_FILE:-} ]]; then client+=("--defaults-extra-file=$BACKUP_DEFAULTS_FILE"); dump+=("--defaults-extra-file=$BACKUP_DEFAULTS_FILE"); fi
connection=("--user=${BACKUP_DB_USER:-root}")
if [[ -n ${BACKUP_DB_HOST:-} ]]; then connection+=("--host=$BACKUP_DB_HOST" "--port=${BACKUP_DB_PORT:-3306}" --protocol=tcp); fi
client+=("${connection[@]}" --connect-timeout=5 --batch --skip-column-names --skip-reconnect)
dump+=("${connection[@]}")
sql(){ timeout --kill-after=2s 10s "${client[@]}" -e "$1"; }
# Process starttime prevents accidentally signalling a reused controller/worker PID.
starttime(){ [[ -r /proc/$1/stat ]] && awk '{print $22}' "/proc/$1/stat"; }
kill_work(){
 if [[ -f $output/work.pid ]]; then
  read -r child born < "$output/work.pid"
  if [[ $child =~ ^[0-9]+$ && $(starttime "$child" || true) == "$born" ]]; then
   kill -TERM -- "-$child" 2>/dev/null || true
   sleep 1
   [[ $(starttime "$child" || true) != "$born" ]] || kill -KILL -- "-$child" 2>/dev/null || true
  fi
 fi
}
# No unlocked artifact can be accepted: watchdog always marks invalid before KILL.
if [[ $mode == --watchdog ]]; then
 [[ -d $output && -f $output/holder.identity && -f $output/controller.pid ]] || exit 2
 read -r holder_id guard < "$output/holder.identity"
 read -r controller born < "$output/controller.pid"
 [[ $holder_id =~ ^[0-9]+$ && $guard =~ ^ytbackup_[a-f0-9]{32}$ && $controller =~ ^[0-9]+$ ]] || exit 2
 trap '' HUP
 touch "$output/watchdog.ready"
 sleep "$max_seconds"
 [[ ! -f $output/lock-released ]] || exit 0
 touch "$output/INVALID"
 owner=$(sql "SELECT IS_USED_LOCK('$guard')" 2>/dev/null || true)
 if [[ $owner == "$holder_id" ]]; then sql "KILL $holder_id" >/dev/null 2>&1 || true; fi
 alive=$(sql "SELECT COUNT(*) FROM information_schema.PROCESSLIST WHERE ID=$holder_id" 2>/dev/null || true)
 printf '%s\n' "$alive" > "$output/watchdog.remaining"
 kill_work
 if [[ $(starttime "$controller" || true) == "$born" ]]; then kill -TERM "$controller" 2>/dev/null || true; fi
 [[ $alive == 0 ]] || exit 1
 exit 0
fi
manifest(){
 local table type routine kind extra
 sql "SELECT VERSION(),@@GLOBAL.sql_mode,@@GLOBAL.lower_case_table_names,@@GLOBAL.max_allowed_packet,@@GLOBAL.time_zone,@@GLOBAL.character_set_server,@@GLOBAL.collation_server" > "$output/runtime.tsv"
 sql "SHOW CREATE DATABASE \`$database\`" > "$output/database.tsv"
 sql "SELECT TABLE_NAME,TABLE_TYPE,COALESCE(ENGINE,''),COALESCE(TABLE_COLLATION,''),COALESCE(AUTO_INCREMENT,''),CREATE_OPTIONS FROM information_schema.TABLES WHERE TABLE_SCHEMA='$database' ORDER BY BINARY TABLE_NAME" > "$output/tables.tsv"
 : > "$output/rows.tsv"; : > "$output/ddl.tsv"; : > "$output/checksums.tsv"
 while IFS=$'\t' read -r table type extra; do
  [[ $table =~ ^[A-Za-z0-9_]+$ ]] || return 1
  sql "SHOW CREATE TABLE \`$database\`.\`$table\`" >> "$output/ddl.tsv"
  if [[ $type == 'BASE TABLE' ]]; then
   sql "SELECT '$table',COUNT(*) FROM \`$database\`.\`$table\`" >> "$output/rows.tsv"
  fi
 done < "$output/tables.tsv"
 sql "SELECT TRIGGER_NAME,EVENT_MANIPULATION,EVENT_OBJECT_TABLE,ACTION_ORDER,COALESCE(ACTION_CONDITION,''),ACTION_STATEMENT,ACTION_ORIENTATION,ACTION_TIMING,SQL_MODE,DEFINER,CHARACTER_SET_CLIENT,COLLATION_CONNECTION,DATABASE_COLLATION FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA='$database' ORDER BY BINARY TRIGGER_NAME" > "$output/triggers.tsv"
 sql "SELECT ROUTINE_NAME,ROUTINE_TYPE FROM information_schema.ROUTINES WHERE ROUTINE_SCHEMA='$database' ORDER BY BINARY ROUTINE_NAME" > "$output/routines.tsv"
 : > "$output/routine-ddl.tsv"
 while IFS=$'\t' read -r routine kind; do
  [[ -z $routine ]] && continue
  [[ $routine =~ ^[A-Za-z0-9_]+$ && ( $kind == FUNCTION || $kind == PROCEDURE ) ]] || return 1
  sql "SHOW CREATE $kind \`$database\`.\`$routine\`" >> "$output/routine-ddl.tsv"
 done < "$output/routines.tsv"
 sql "SELECT EVENT_NAME FROM information_schema.EVENTS WHERE EVENT_SCHEMA='$database' ORDER BY BINARY EVENT_NAME" > "$output/events.tsv"
 : > "$output/event-ddl.tsv"
 while IFS= read -r routine; do
  [[ -z $routine ]] && continue
  [[ $routine =~ ^[A-Za-z0-9_]+$ ]] || return 1
  sql "SHOW CREATE EVENT \`$database\`.\`$routine\`" >> "$output/event-ddl.tsv"
 done < "$output/events.tsv"
 IFS=',' read -r -a checksum_tables <<< "${BACKUP_CHECKSUM_TABLES:-}"
 for table in "${checksum_tables[@]}"; do
  [[ -z $table ]] && continue
  [[ $table =~ ^[A-Za-z0-9_]+$ ]] || return 1
  sql "CHECKSUM TABLE \`$database\`.\`$table\` EXTENDED" >> "$output/checksums.tsv"
 done
}
if [[ $mode == --manifest ]]; then
 mkdir -m 700 "$output"
 manifest 2> "$output/private-errors.log"
 printf 'manifest-complete\n'
 exit 0
fi
# All artifact/error paths are private; output path must be fresh and non-reused.
for tool in mariadb mariadb-dump gzip timeout setsid sha256sum awk sync; do command -v "$tool" >/dev/null || exit 2; done
mkdir -m 700 "$output"
exec 2> "$output/private-errors.log"
self=$(realpath "$0")
guard=ytbackup_$(tr -d '-' < /proc/sys/kernel/random/uuid)
holder_id= work_pid= holder_pid= watchdog_pid=
printf '%s %s\n' "$$" "$(starttime $$)" > "$output/controller.pid"
cleanup(){
 local status=$? alive=unknown owner=
 trap - EXIT INT TERM HUP
 kill_work
 if [[ -n $holder_id ]]; then
  owner=$(sql "SELECT IS_USED_LOCK('$guard')" 2>/dev/null || true)
  if [[ $owner == "$holder_id" ]]; then sql "KILL $holder_id" >/dev/null 2>&1 || true; fi
  alive=$(sql "SELECT COUNT(*) FROM information_schema.PROCESSLIST WHERE ID=$holder_id" 2>/dev/null || true)
  printf '%s\n' "$alive" > "$output/cleanup.remaining"
  if [[ $alive == 0 ]]; then touch "$output/lock-released"; else status=1; touch "$output/INVALID"; fi
 fi
 if [[ -n $holder_pid ]]; then kill "$holder_pid" 2>/dev/null || true; fi
 if [[ $status != 0 || ! -f $output/COMPLETE || -f $output/INVALID ]]; then
  touch "$output/INVALID"; rm -f "$output/COMPLETE"; printf 'backup-failed stage=%s (private diagnostics retained)\n' "$stage"; status=1
 else printf 'backup-complete artifact=database.sql.gz lock-released=true\n'; fi
 # Do not terminate the independent watchdog unless lock absence is proven.
 if [[ -f $output/lock-released && -n $watchdog_pid ]]; then kill "$watchdog_pid" 2>/dev/null || true; fi
 exit "$status"
}
trap cleanup EXIT
trap 'exit 1' INT TERM HUP
stage=preflight
long=$(sql "SELECT COUNT(*) FROM information_schema.PROCESSLIST WHERE ID<>CONNECTION_ID() AND COMMAND<>'Sleep' AND TIME>10")
[[ $long == 0 ]] || exit 1
# coproc owns a single CLI session for the whole lock window; skip-reconnect is mandatory.
coproc HOLDER { "${client[@]}" --unbuffered 2>> "$output/private-errors.log"; }
holder_pid=$HOLDER_PID
exec {holder_input}>&"${HOLDER[1]}"
exec {holder_output}<&"${HOLDER[0]}"
printf "SET SESSION lock_wait_timeout=%s; SET SESSION wait_timeout=%s; SELECT CONCAT(CONNECTION_ID(), ' ', GET_LOCK('%s',0));\n" "$wait_seconds" "$((max_seconds+60))" "$guard" >&"$holder_input"
read -r -t 10 holder_id acquired <&"$holder_output"
[[ $holder_id =~ ^[0-9]+$ && $acquired == 1 ]] || exit 1
printf '%s %s\n' "$holder_id" "$guard" > "$output/holder.identity"
# A detached watchdog survives HUP, parent death and docker/SSH client loss.
setsid bash "$self" --watchdog "--database=$database" "--output=$output" "--max-seconds=$max_seconds" "--lock-wait-seconds=$wait_seconds" < /dev/null > "$output/watchdog.log" 2>&1 &
watchdog_pid=$!
for _ in {1..100}; do [[ ! -f $output/watchdog.ready ]] || break; sleep .02; done
[[ -f $output/watchdog.ready ]] || exit 1
stage=lock
printf "FLUSH TABLES WITH READ LOCK; SELECT CONCAT('LOCKED:',CONNECTION_ID(),':%s');\n" "$guard" >&"$holder_input"
read -r -t "$((wait_seconds+2))" sentinel <&"$holder_output"
[[ $sentinel == "LOCKED:$holder_id:$guard" ]] || exit 1
touch "$output/lock-acquired"
stage=manifest
manifest
stage=dump
# Pass argv as an array; pipefail cannot silently accept a failed dump with valid gzip.
setsid bash -c 'set -o pipefail; "$@" | gzip -1' backup-pipeline "${dump[@]}" --databases "$database" --skip-lock-tables --skip-add-locks --quick --hex-blob --routines --events --triggers --skip-comments --no-tablespaces > "$output/database.sql.gz.part" 2>> "$output/private-errors.log" &
work_pid=$!
printf '%s %s\n' "$work_pid" "$(starttime "$work_pid")" > "$output/work.pid"
wait "$work_pid"
rm -f "$output/work.pid"
stage=sentinel
printf "SELECT CONCAT('HELD:',CONNECTION_ID(),':',IS_USED_LOCK('%s'));\n" "$guard" >&"$holder_input"
read -r -t 5 sentinel <&"$holder_output"
[[ $sentinel == "HELD:$holder_id:$holder_id" && ! -f $output/INVALID ]] || exit 1
# Release immediately after snapshot: compression validation/copy is not in the lock window.
printf "UNLOCK TABLES; SELECT RELEASE_LOCK('%s');\nquit\n" "$guard" >&"$holder_input"
wait "$holder_pid"
alive=$(sql "SELECT COUNT(*) FROM information_schema.PROCESSLIST WHERE ID=$holder_id")
[[ $alive == 0 && ! -f $output/INVALID ]] || exit 1
touch "$output/lock-released"
stage=validate
gzip -t "$output/database.sql.gz.part"
mv "$output/database.sql.gz.part" "$output/database.sql.gz"
(cd "$output" && sha256sum database.sql.gz > archive.sha256)
printf '%s\n' "database=$database" "holder_connection_id=$holder_id" "guard=$guard" "completed_at=$(date -u +%FT%TZ)" > "$output/identity.txt"
sync -f "$output"
touch "$output/COMPLETE"
sync -f "$output"
