#!/usr/bin/env bash
# Host adapter. No network/deploy operation runs in preview mode.
# Run only after review, an approved pause window and a manual-writer freeze.
set -Eeuo pipefail
umask 077
mode=${1:---preview}
if [[ $mode == --preview ]]; then
 printf '%s\n' '{"mode":"preview","schemas":["youtube_board","youtube_board_ts"],"schedulerPauseSeconds":300,"databaseLockSeconds":180,"serviceUpdates":0}'
 exit 0
fi
bounded(){ timeout --kill-after=2s 10s "$@"; }
unit_inactive(){
 local state
 state=$(bounded systemctl show "$1" --property=LoadState --property=ActiveState) || return 1
 # Unstarted transient services commonly have LoadState=not-found. Distinguish
 # that explicit state from an unavailable bus, malformed output or timeout.
 awk -F= '
  $1=="LoadState" && NF==2 {loads++; load=$2; next}
  $1=="ActiveState" && NF==2 {actives++; active=$2; next}
  {bad=1}
  END {if (bad || loads!=1 || actives!=1 || (load!="loaded" && load!="not-found") || (active!="inactive" && active!="failed")) exit 1}
 ' <<< "$state"
}
resume_operation(){
 local operation=$1 scheduler init current state lease
 [[ $operation == /* && -d $operation && ! -L $operation ]] || return 1
 read -r scheduler < "$operation/scheduler.id"
 read -r init < "$operation/scheduler.pid"
 [[ $scheduler =~ ^[a-f0-9]{12,64}$ && $init =~ ^[0-9]+$ && $init != 0 ]] || return 1
 current=$(bounded docker inspect --format '{{.State.Pid}}' "$scheduler") || return 1
 [[ $current == "$init" ]] || return 1
 bounded docker kill --signal=CONT "$scheduler" >/dev/null || return 1
 state=$(ps -o stat= -p "$init") || return 1
 [[ -n $state && $state != *T* && $state != *t* ]] || return 1
 date -u +%FT%TZ > "$operation/scheduler-resumed"
}
lease_matches(){
 local lease=$(dirname "$1")/.prewriter-active
 [[ -f $lease/operation && $(cat "$lease/operation") == "$1" ]]
}
release_lease(){
 local lease=$(dirname "$1")/.prewriter-active
 lease_matches "$1" || return 1
 rm "$lease/operation" && rmdir "$lease"
}
resume_locked() (
 exec 8> "$(dirname "$1")/.transition.lock" || return 1
 flock -x 8 || return 1
 lease_matches "$1" || return 1
 resume_operation "$1"
)
release_locked() (
 exec 8> "$(dirname "$1")/.transition.lock" || return 1
 flock -x 8 || return 1
 release_lease "$1"
)
if [[ $mode == --watchdog-resume ]]; then
 [[ $# == 2 && $2 == /* && -d $2 && ! -L $2 ]] || exit 2
 exec 8> "$(dirname "$2")/.transition.lock"
 flock -x 8
 # An old timer must never signal the same container after a new lease starts.
 lease_matches "$2" || exit 0
 touch "$2/HOST_INVALID" "$2/WATCHDOG_FIRED"
 resume_operation "$2"
 release_lease "$2"
 exit
fi
[[ $mode == --execute && $# == 1 ]] || exit 2
# These acknowledgements are intentionally separate from the database tool gate.
[[ ${BACKUP_PAUSE_APPROVED:-} == true && ${BACKUP_MANUAL_WRITERS_FROZEN:-} == true && ${BACKUP_ACCOUNTS_MAINTENANCE_CONFIRMED:-} == true && ${BACKUP_TS_WRITERS_STOPPED:-} == true ]] || exit 2
host_root=${BACKUP_HOST_ROOT:-/home/ubuntu/backups/youtube-board-prewriter}
backup_tool=${BACKUP_TOOL_PATH:-}
operation_record=${BACKUP_OPERATION_RECORD:-}
if [[ -n $operation_record ]]; then
 [[ $operation_record == /* && ! -e $operation_record && ! -L $operation_record && -d $(dirname "$operation_record") ]] || exit 2
 [[ $(stat -c '%a' "$(dirname "$operation_record")") == 700 && $(stat -c '%u' "$(dirname "$operation_record")") == "$EUID" ]] || exit 2
fi
[[ $host_root == /* && $host_root != / && ! -L $host_root && -d $host_root ]] || exit 2
[[ $backup_tool == /* && -f $backup_tool && ! -L $backup_tool ]] || exit 2
# Existing private directory avoids accidental world-readable ancestors.
[[ $(stat -c '%a' "$host_root") == 700 && $(stat -c '%u' "$host_root") == "$EUID" ]] || exit 2
for tool in docker systemd-run systemctl timeout flock sha256sum ps awk; do command -v "$tool" >/dev/null || exit 2; done
exec 9> "$host_root/.operation.lock"
flock -n 9 || exit 1
# Unlike flock, the durable lease survives controller SIGKILL and blocks a second
# pause until either this controller or the independent watchdog confirms CONT.
lease=$host_root/.prewriter-active
mkdir -m 700 "$lease" || { printf 'prewriter-operation-active\n' >&2; exit 1; }
stamp=$(date -u +%Y%m%dT%H%M%SZ)-$$
operation=$host_root/$stamp
mkdir -m 700 "$operation"
printf '%s\n' "$operation" > "$lease/operation"
exec 2> "$operation/private-host-errors.log"
cp "$(realpath "$0")" "$operation/host-adapter.sh"
chmod 700 "$operation/host-adapter.sh"
paused=0; armed=0; timer=; backup_pid=; lease_released=0
finish_operation(){
 local stop_rc=0
 [[ $lease_released != 1 ]] || return 0
 if [[ $paused == 1 ]]; then resume_locked "$operation" || return 1; fi
 if [[ $armed == 1 ]]; then
  # Keep the lease throughout cancellation; no successor can STOP this init.
  bounded systemctl stop "$timer.timer" "$timer.service" >/dev/null 2>&1 || stop_rc=$?
  # systemctl stop can return1 or5 when a transient service is not loaded.
  # Never infer cancellation from that exit code; prove each state separately.
  [[ $stop_rc == 0 || $stop_rc == 1 || $stop_rc == 5 ]] || return 1
  unit_inactive "$timer.timer" || return 1
  unit_inactive "$timer.service" || return 1
  armed=0
 fi
 release_locked "$operation" || return 1
 lease_released=1; paused=0
}
cleanup(){
 local rc=$? resumed=1
 trap - EXIT INT TERM HUP
 exec 8>&-
 if [[ -n $backup_pid ]] && kill -0 "$backup_pid" 2>/dev/null; then kill -TERM "$backup_pid" 2>/dev/null || true; fi
 finish_operation || resumed=0
 if [[ $resumed != 1 || -f $operation/WATCHDOG_FIRED ]]; then rc=1; fi
 if [[ $rc != 0 ]]; then touch "$operation/HOST_INVALID"; rm -f "$operation/HOST_COMPLETE"; fi
 printf 'host-backup status=%s scheduler-resume-confirmed=%s private-directory=%s\n' "$rc" "$resumed" "$operation"
 exit "$rc"
}
trap cleanup EXIT
trap 'exit 1' INT TERM HUP
if [[ -n $operation_record ]]; then (set -o noclobber; printf '%s\n' "$operation" > "$operation_record"); fi
scheduler_service=youtube-board-scheduler
db_service=youtube-board-db-qcja1i
scheduler=$(bounded docker ps -q --filter "label=com.docker.swarm.service.name=$scheduler_service" --filter status=running)
database=$(bounded docker ps -q --filter "label=com.docker.swarm.service.name=$db_service" --filter status=running)
[[ $scheduler =~ ^[a-f0-9]{12}$ && $database =~ ^[a-f0-9]{12}$ ]]
init=$(bounded docker inspect --format '{{.State.Pid}}' "$scheduler")
[[ $init =~ ^[0-9]+$ && $init != 0 ]]
[[ $(ps -o comm= -p "$init") =~ ^(sh|bash|dash)$ ]] || exit 1
[[ $(ps -o stat= -p "$init") != *T* ]] || exit 1
printf '%s\n' "$scheduler" > "$operation/scheduler.id"
printf '%s\n' "$init" > "$operation/scheduler.pid"
# Hash only: image, argv and environment never enter logs/artifacts in plaintext.
fingerprint(){
 bounded docker service inspect --format '{{json .Spec}}' "$scheduler_service" | sha256sum
 bounded docker inspect --format '{{json .Config}} {{.Image}}' "$scheduler" | sha256sum
}
fingerprint > "$operation/scheduler-fingerprint.before"
container_tool=/tmp/yt-prewriter-tool-$stamp.sh
container_output=/tmp/yt-prewriter-backup-$stamp
bounded docker cp "$backup_tool" "$database:$container_tool"
# Conservative combined headroom for logical expansion, compressed archive and
# host copy even when Docker /tmp and host destination share one filesystem.
# Metadata is an estimate; reserve six times data+index bytes plus 2 GiB.
physical_bytes=$(bounded docker exec "$database" bash -c '
 export MYSQL_PWD="${MARIADB_ROOT_PASSWORD:-${MYSQL_ROOT_PASSWORD:-}}"
 [[ -n $MYSQL_PWD ]] || exit 1
 exec mariadb --user=root --batch --skip-column-names -e "SELECT COALESCE(SUM(DATA_LENGTH+INDEX_LENGTH),0) FROM information_schema.TABLES WHERE TABLE_SCHEMA IN (0x796f75747562655f626f617264,0x796f75747562655f626f6172645f7473) AND TABLE_TYPE=0x42415345205441424c45"
')
[[ $physical_bytes =~ ^[0-9]+$ && ${#physical_bytes} -le 15 && $physical_bytes != 0 ]] || exit 1
required_bytes=$((physical_bytes*6+2147483648))
database_free=$(bounded docker exec "$database" df -PB1 /tmp | awk 'NR==2 {print $4}')
host_free=$(df -PB1 "$host_root" | awk 'NR==2 {print $4}')
[[ $database_free =~ ^[0-9]+$ && $host_free =~ ^[0-9]+$ ]] || exit 1
printf 'physical_bytes=%s\nrequired_bytes=%s\ndatabase_tmp_free=%s\nhost_destination_free=%s\n' "$physical_bytes" "$required_bytes" "$database_free" "$host_free" > "$operation/capacity.txt"
(( database_free >= required_bytes && host_free >= required_bytes )) || exit 1
timer=yt-prewriter-resume-${stamp,,}
registered=$SECONDS
# The independent host service survives SSH/controller death. It uses the exact
# original container and PID, never resumes a replacement or changes service spec.
armed=1
bounded systemd-run --quiet --collect --unit="$timer" --on-active=300s /usr/bin/bash "$operation/host-adapter.sh" --watchdog-resume "$operation"
bounded systemctl is-active --quiet "$timer.timer"
paused=1
(
 exec 8> "$host_root/.transition.lock"
 flock -x 8
 lease_matches "$operation"
 [[ ! -f $operation/WATCHDOG_FIRED ]]
 (( SECONDS - registered < 20 ))
 bounded systemctl is-active --quiet "$timer.timer"
 [[ $(bounded docker inspect --format '{{.State.Pid}}' "$scheduler") == "$init" ]]
 bounded docker kill --signal=STOP "$scheduler" >/dev/null
 stopped_state=$(ps -o stat= -p "$init")
 [[ $stopped_state == *T* || $stopped_state == *t* ]]
)
# Only PID 1 is stopped; existing PHP/provider children continue to completion.
# A shell child counts as active too; completed Z children cannot be reaped by
# stopped init, so ignore those plus the loop's harmless sleep.
drain_deadline=$((SECONDS+45))
while true; do
 (( SECONDS < drain_deadline )) || exit 1
 processes=$(timeout --kill-after=1s 5s docker top "$scheduler" -eo pid,stat,comm)
 active=$(awk -v init="$init" '
  NR==1 {if (NF!=3 || $1!="PID" || $2!="STAT" || $3!="COMMAND") bad=1; next}
  {if ((NF!=3 && !(NF==4 && $2~/^Z/ && $4=="<defunct>")) || $1!~/^[1-9][0-9]*$/ || $2!~/^[RSDTtWXIZ][<NLsl+]*$/ || seen[$1]++) bad=1}
  $1==init {owners++; if ($3!~/^(sh|bash|dash)$/ || $2!~/^[Tt]/) bad=1}
  $1!=init && $2!~/^Z/ && $3!="sleep" {n++}
  END {if (bad || owners!=1) exit 1; print n+0}
 ' <<< "$processes")
 [[ $active != 0 ]] || break
 sleep 1
done
# A suspended controller may wake after its watchdog resumed the scheduler.
# Revoke capture in that case. Launch under the same short transition lock;
# the transport closes FD8 so it cannot retain the lock during dump/compression.
exec 8> "$host_root/.transition.lock"
flock -x 8
lease_matches "$operation"
[[ ! -f $operation/WATCHDOG_FIRED ]]
(( SECONDS - registered < 90 ))
[[ $(bounded docker inspect --format '{{.State.Pid}}' "$scheduler") == "$init" ]]
stopped_state=$(ps -o stat= -p "$init")
[[ $stopped_state == *T* || $stopped_state == *t* ]]
printf 'scheduler-drained; bounded-source-state-backup-starting\n'
# Root password stays inside the DB container environment, never host argv/logs.
# One FTWRL and one dump cover both physical schemas. No provider is stopped.
timeout --kill-after=2s 210s docker exec "$database" bash -c '
 export MYSQL_PWD="${MARIADB_ROOT_PASSWORD:-${MYSQL_ROOT_PASSWORD:-}}"
 [[ -n $MYSQL_PWD ]] || exit 1
 export BACKUP_CHECKSUM_TABLES=youtube_board.urt_tag,youtube_board.urt_channel,youtube_board.urt_count
 exec bash "$1" --execute --database=youtube_board --database=youtube_board_ts --output="$2" --max-seconds=180 --lock-wait-seconds=5
' backup "$container_tool" "$container_output" 8>&- &
backup_pid=$!
flock -u 8
exec 8>&-
# Prove holder release, then resume while compression continues. The snapshot's
# independent watchdog still governs a dead/lost controller or transport.
while kill -0 "$backup_pid" 2>/dev/null; do
 if [[ $paused == 1 ]] && bounded docker exec "$database" bash -c '[[ -f $1/lock-released && ! -f $1/INVALID ]]' probe "$container_output"; then
  finish_operation
  touch "$operation/CAPTURE_RESUMED"
 fi
 sleep 1
done
wait "$backup_pid"
backup_pid=
if [[ $paused == 1 ]]; then
 finish_operation
 touch "$operation/CAPTURE_RESUMED"
fi
[[ ! -f $operation/WATCHDOG_FIRED ]]
fingerprint > "$operation/scheduler-fingerprint.after"
cmp -s "$operation/scheduler-fingerprint.before" "$operation/scheduler-fingerprint.after"
# Copy and off-host validation happen after writers resume; artifacts stay private.
timeout --kill-after=2s 120s docker cp "$database:$container_output/." "$operation/snapshot"
[[ -f $operation/snapshot/COMPLETE && ! -f $operation/snapshot/INVALID ]]
(cd "$operation/snapshot" && sha256sum -c archive.sha256 && sha256sum -c manifests.sha256)
touch "$operation/HOST_COMPLETE"
printf 'source-state-archive-verified; offhost-copy-and-isolated-restore-still-required\n'
