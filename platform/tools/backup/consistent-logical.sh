#!/usr/bin/env bash
# Runs beside the source server; root owns deployment/execution approval.
# Credentials: MYSQL_PWD or BACKUP_DEFAULTS_FILE. Never password command arguments.
set -Eeuo pipefail
umask 077
stage=arguments
mode=${1:---preview}; shift || true
database= output= max_seconds=60 wait_seconds=5
databases=() validated=()
for argument in "$@"; do
 case "$argument" in
  --database=*) databases+=("${argument#*=}");;
  --output=*) output=${argument#*=};;
  --max-seconds=*) max_seconds=${argument#*=};;
  --lock-wait-seconds=*) wait_seconds=${argument#*=};;
  *) printf 'Invalid backup option\n' >&2; exit 2;;
 esac
done
if [[ $mode == --preview ]]; then printf '{"mode":"preview","method":"bounded-ftwrl-logical","writes":0,"locks":0}\n'; exit 0; fi
[[ $mode == --execute || $mode == --manifest || $mode == --watchdog ]] || exit 2
(( ${#databases[@]} >= 1 && ${#databases[@]} <= 8 )) || exit 2
for database in "${databases[@]}"; do
 [[ $database =~ ^[A-Za-z0-9_]+$ && ${#database} -le 64 ]] || exit 2
 case "${database,,}" in mysql|information_schema|performance_schema|sys) exit 2;; esac
 for previous in "${validated[@]:-}"; do [[ ${previous,,} != "${database,,}" ]] || exit 2; done
 validated+=("$database")
done
database=${databases[0]}
[[ $output == /* && $output != / && $max_seconds =~ ^[0-9]+$ && $wait_seconds =~ ^[0-9]+$ ]] || exit 2
(( max_seconds >= 3 && max_seconds <= 300 && wait_seconds >= 1 && wait_seconds <= 10 && wait_seconds < max_seconds )) || exit 2
[[ -z ${BACKUP_DEFAULTS_FILE:-} || ( ${BACKUP_DEFAULTS_FILE} == /* && -f ${BACKUP_DEFAULTS_FILE} && ! -L ${BACKUP_DEFAULTS_FILE} ) ]] || exit 2
# Reject misspelled checksum schemas before acquiring any global lock.
IFS=',' read -r -a requested_checksums <<< "${BACKUP_CHECKSUM_TABLES:-}"
for item in "${requested_checksums[@]}"; do
 [[ -z $item ]] && continue
 if [[ $item == *.* ]]; then
  checksum_schema=${item%%.*}; checksum_table=${item#*.}; found=false
  [[ $checksum_table =~ ^[A-Za-z0-9_]+$ ]] || exit 2
  for selected in "${databases[@]}"; do [[ $selected != "$checksum_schema" ]] || found=true; done
  [[ $found == true ]] || exit 2
 else
  [[ ${#databases[@]} == 1 && $item =~ ^[A-Za-z0-9_]+$ ]] || exit 2
 fi
done
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
 sleep "$max_seconds" 9>&-
 if [[ -f $output/lock-released ]]; then
  if [[ ! -f $output/COMPLETE && $(starttime "$controller" || true) != "$born" ]]; then touch "$output/INVALID"; fi
  exit 0
 fi
 touch "$output/INVALID"
 rm -f "$output/COMPLETE"
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
 local table type routine kind extra checksum_database checksum_table checksum_line checksum_value checksum_name
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
  checksum_database=$database; checksum_table=$table
  if [[ $table == *.* ]]; then
   checksum_database=${table%%.*}; checksum_table=${table#*.}
   [[ $checksum_database == "$database" ]] || continue
  elif (( ${#databases[@]} > 1 )); then
   # Multi-schema checksums must be explicit: schema.table, never every schema.
   return 1
  fi
  [[ $checksum_table =~ ^[A-Za-z0-9_]+$ ]] || return 1
  checksum_line=$(sql "CHECKSUM TABLE \`$database\`.\`$checksum_table\` EXTENDED")
  IFS=$'\t' read -r checksum_name checksum_value extra <<< "$checksum_line"
  [[ $checksum_name == "$database.$checksum_table" && $checksum_value =~ ^[0-9]+$ && -z $extra ]] || return 1
  printf '%s\n' "$checksum_line" >> "$output/checksums.tsv"
 done
}
manifests(){
 local base=$output selected
 printf '%s\n' "${databases[@]}" > "$base/schemas.tsv"
 if (( ${#databases[@]} == 1 )); then manifest; return; fi
 mkdir -m 700 "$base/manifests"
 for selected in "${databases[@]}"; do
  # A subshell keeps the controller artifact path stable even when SQL fails.
  # Do not call manifest in an || condition: that disables Bash errexit inside it.
  (
   database=$selected; output="$base/manifests/$selected"
   mkdir -m 700 "$output"
   manifest
  )
 done
}
if [[ $mode == --manifest ]]; then
 mkdir -m 700 "$output"
 manifests 2> "$output/private-errors.log"
 printf 'manifest-complete\n'
 exit 0
fi
# All artifact/error paths are private; output path must be fresh and non-reused.
for tool in mariadb mariadb-dump gzip timeout setsid sha256sum awk sync flock find sort xargs; do command -v "$tool" >/dev/null || exit 2; done
# A shared host lock prevents overlap, including after controller death while
# the detached watchdog still owns the deadline. Maintenance must use this path.
lock_file=${BACKUP_LOCK_FILE:-/run/lock/youtube-board-consistent-backup.lock}
[[ $lock_file == /* && ! -L $lock_file && ( ! -e $lock_file || -f $lock_file ) ]] || exit 2
exec 9>> "$lock_file"
flock -n 9 || { printf 'backup-already-running\n' >&2; exit 1; }
mkdir -m 700 "$output"
exec 2> "$output/private-errors.log"
self=$(realpath "$0")
guard=ytbackup_$(tr -d '-' < /proc/sys/kernel/random/uuid)
holder_id= work_pid= holder_pid= watchdog_pid=
printf '%s %s\n' "$$" "$(starttime $$)" > "$output/controller.pid"
cleanup(){
 local status=$? alive=unknown owner=
 trap - EXIT INT TERM HUP
 if [[ $status != 0 || ! -f $output/COMPLETE || -f $output/INVALID ]]; then
  touch "$output/INVALID"; rm -f "$output/COMPLETE"
 fi
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
coproc HOLDER { "${client[@]}" --unbuffered 9>&- 2>> "$output/private-errors.log"; }
holder_pid=$HOLDER_PID
exec {holder_input}>&"${HOLDER[1]}"
exec {holder_output}<&"${HOLDER[0]}"
printf "SET SESSION lock_wait_timeout=%s; SET SESSION wait_timeout=%s; SELECT CONCAT(CONNECTION_ID(), ' ', GET_LOCK('%s',0));\n" "$wait_seconds" "$((max_seconds+60))" "$guard" >&"$holder_input"
read -r -t 10 holder_id acquired <&"$holder_output"
[[ $holder_id =~ ^[0-9]+$ && $acquired == 1 ]] || exit 1
printf '%s %s\n' "$holder_id" "$guard" > "$output/holder.identity"
# A detached watchdog survives HUP, parent death and docker/SSH client loss.
watchdog_schemas=(); for selected in "${databases[@]}"; do watchdog_schemas+=("--database=$selected"); done
setsid bash "$self" --watchdog "${watchdog_schemas[@]}" "--output=$output" "--max-seconds=$max_seconds" "--lock-wait-seconds=$wait_seconds" < /dev/null > "$output/watchdog.log" 2>&1 &
watchdog_pid=$!
for _ in {1..100}; do [[ ! -f $output/watchdog.ready ]] || break; sleep .02; done
[[ -f $output/watchdog.ready ]] || exit 1
stage=lock
printf "FLUSH TABLES WITH READ LOCK; SELECT CONCAT('LOCKED:',CONNECTION_ID(),':%s');\n" "$guard" >&"$holder_input"
read -r -t "$((wait_seconds+2))" sentinel <&"$holder_output"
[[ $sentinel == "LOCKED:$holder_id:$guard" ]] || exit 1
date -u +%FT%TZ > "$output/lock-acquired"
stage=manifest
manifests
stage=dump
# One dump covers all schemas under the external holder's single FTWRL.
# Do not ask mariadb-dump to acquire/release its own lock or transaction snapshot.
# Compression runs only after lock release, avoiding gzip backpressure on writers.
setsid "${dump[@]}" --databases "${databases[@]}" --skip-lock-tables --skip-add-locks --quick --hex-blob --routines --events --triggers --skip-comments --no-tablespaces > "$output/database.sql.part" 9>&- 2>> "$output/private-errors.log" &
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
date -u +%FT%TZ > "$output/lock-released"
stage=compress
gzip -1 -c "$output/database.sql.part" > "$output/database.sql.gz.part"
stage=validate
gzip -t "$output/database.sql.gz.part"
mv "$output/database.sql.gz.part" "$output/database.sql.gz"
(cd "$output" && sha256sum database.sql.gz > archive.sha256)
rm "$output/database.sql.part"
# Bind the manifests and ordered schema inventory to this artifact's seal.
(cd "$output" && find . -type f -name '*.tsv' -print0 | sort -z | xargs -0 sha256sum > manifests.sha256)
printf '%s\n' "databases=$(IFS=,; printf '%s' "${databases[*]}")" "holder_connection_id=$holder_id" "guard=$guard" "completed_at=$(date -u +%FT%TZ)" > "$output/identity.txt"
sync -f "$output"
touch "$output/COMPLETE"
sync -f "$output"
