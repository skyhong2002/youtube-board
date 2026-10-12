#!/usr/bin/env bash
# Disposable protocol/fault rehearsal. No host ports, no production connections.
set -Eeuo pipefail
umask 077
root=$(cd "$(dirname "$0")" && pwd)
result=${1:?Pass a fresh absolute output directory}
[[ $result == /* && ! -e $result ]] || exit 2
mkdir -m 700 "$result"
name=ytbackup-rehearsal-$(date +%s)-$$
source_name=$name-source
restore_name=$name-restore
image=${BACKUP_REHEARSAL_IMAGE:-mariadb:11.4}
cleanup(){
 local status=$?
 if [[ $status != 0 ]]; then docker cp "$source_name:/tmp" "$result/failed-source-tmp" >/dev/null 2>&1 || true; fi
 docker rm -fv "$source_name" "$restore_name" >/dev/null 2>&1 || true
}
trap cleanup EXIT
for container in "$source_name" "$restore_name"; do
 docker run -d --name "$container" --network none -e MARIADB_ALLOW_EMPTY_ROOT_PASSWORD=1 "$image" --event-scheduler=OFF > /dev/null
 for attempt in {1..90}; do
  if docker logs "$container" 2>&1 | grep -q "MariaDB init process done" && docker exec "$container" mariadb-admin ping --silent >/dev/null 2>&1; then break; fi
  sleep 1
 done
 docker exec "$container" mariadb-admin ping --silent >/dev/null
 docker cp "$root/consistent-logical.sh" "$container:/tmp/consistent-logical.sh" >/dev/null
 done
# Both engines, exact strings, blobs, generated AUTO_INCREMENT, nontrivial SQL objects.
docker exec -i "$source_name" mariadb <<'SQL'
CREATE DATABASE rehearsal CHARACTER SET utf8mb4 COLLATE utf8mb4_bin;
USE rehearsal;
CREATE TABLE legacy (id INT AUTO_INCREMENT PRIMARY KEY, text_value TEXT, binary_value BLOB) ENGINE=MyISAM;
CREATE TABLE modern (id INT AUTO_INCREMENT PRIMARY KEY, amount DECIMAL(12,3), label VARCHAR(80)) ENGINE=InnoDB;
INSERT INTO legacy(text_value,binary_value) VALUES ('有影儀表板',UNHEX('0001ff')),('CaseExact',UNHEX('4142'));
INSERT INTO modern(amount,label) VALUES (2.750,'initial');
CREATE VIEW totals AS SELECT COUNT(*) AS n FROM legacy;
CREATE TRIGGER modern_touch BEFORE INSERT ON modern FOR EACH ROW SET NEW.label=CONCAT('seen:',NEW.label);
CREATE PROCEDURE count_legacy() SELECT COUNT(*) FROM legacy;
CREATE FUNCTION bump(x INT) RETURNS INT DETERMINISTIC RETURN x+1;
CREATE EVENT dormant ON SCHEDULE EVERY 1 DAY STARTS '2030-01-01 00:00:00' DISABLE DO INSERT INTO modern(amount,label) VALUES (1,'event');
INSERT INTO modern(amount,label) VALUES (3.125,'trigger');
CREATE TABLE source_epoch (id INT PRIMARY KEY, epoch INT NOT NULL) ENGINE=MyISAM;
INSERT INTO source_epoch VALUES(1,0);
CREATE DATABASE rehearsal_ts CHARACTER SET utf8mb4 COLLATE utf8mb4_bin;
CREATE TABLE rehearsal_ts.state_epoch (id INT PRIMARY KEY, epoch INT NOT NULL) ENGINE=InnoDB;
INSERT INTO rehearsal_ts.state_epoch VALUES(1,0);
CREATE TABLE rehearsal_ts.audit (id INT PRIMARY KEY, payload VARCHAR(100)) ENGINE=MyISAM;
INSERT INTO rehearsal_ts.audit VALUES(1,'state fixture');
CREATE DATABASE rehearsal_facade CHARACTER SET utf8mb4 COLLATE utf8mb4_bin;
CREATE USER 'backup_fixture'@'localhost';
GRANT SELECT ON rehearsal.* TO 'backup_fixture'@'localhost';
GRANT SELECT ON rehearsal_ts.* TO 'backup_fixture'@'localhost';
CREATE DEFINER='backup_fixture'@'localhost' VIEW rehearsal_facade.source_state AS SELECT s.epoch AS source_epoch,t.epoch AS state_epoch FROM rehearsal.source_epoch s JOIN rehearsal_ts.state_epoch t USING(id);
SQL
checksums=rehearsal.legacy,rehearsal.modern,rehearsal.source_epoch,rehearsal_ts.state_epoch,rehearsal_ts.audit
schema_args=(--database=rehearsal --database=rehearsal_ts --database=rehearsal_facade)
# A single concurrent autocommit statement updates both engines/schemas.
# This exercises lock waiting, not a claim that arbitrary multi-statement
# MyISAM business workflows become atomic: those still must drain before backup.
docker exec -i "$source_name" bash > "$result/writer.log" 2>&1 <<'WRITER' &
for i in {1..100}; do
 mariadb -e 'UPDATE rehearsal.source_epoch s JOIN rehearsal_ts.state_epoch t USING(id) SET s.epoch=s.epoch+1,t.epoch=t.epoch+1'
 sleep .03
done
WRITER
writer_transport=$!
for attempt in {1..50}; do
 current_epoch=$(docker exec "$source_name" mariadb --batch --skip-column-names -e 'SELECT epoch FROM rehearsal.source_epoch')
 [[ $current_epoch == 0 ]] || break
 sleep .02
done
[[ $current_epoch -gt 0 && $current_epoch -lt 100 ]]

invoke(){ docker exec -e BACKUP_CHECKSUM_TABLES="$checksums" "$source_name" bash /tmp/consistent-logical.sh --execute "${schema_args[@]}" "--output=/tmp/$1" "--max-seconds=${2:-30}" --lock-wait-seconds=2; }
assert_unlocked(){
 local n
 n=$(docker exec "$source_name" mariadb --batch --skip-column-names -e "SELECT COUNT(*) FROM information_schema.PROCESSLIST WHERE INFO LIKE 'FLUSH TABLES WITH READ LOCK%'")
 [[ $n == 0 ]]
 docker exec "$source_name" timeout 3 mariadb -e 'INSERT INTO rehearsal.modern(amount,label) VALUES (5,"lock-release-proof")'
}
invoke success > "$result/success.log"
wait "$writer_transport"
# Contents, hash inventory and cross-schema epoch agree after isolated restore.
docker cp "$source_name:/tmp/success" "$result/source" >/dev/null
(cd "$result/source" && sha256sum --check archive.sha256) > "$result/archive-check.log"
gzip -t "$result/source/database.sql.gz"
(cd "$result/source" && sha256sum --check manifests.sha256) > "$result/manifest-hash-check.log"
# Principals/grants are protected recovery prerequisites, not dumped passwords.
docker exec "$restore_name" mariadb -e "CREATE USER 'backup_fixture'@'localhost'; GRANT SELECT ON rehearsal.* TO 'backup_fixture'@'localhost'; GRANT SELECT ON rehearsal_ts.* TO 'backup_fixture'@'localhost';"
gzip -dc "$result/source/database.sql.gz" | docker exec -i "$restore_name" mariadb
docker exec -e BACKUP_CHECKSUM_TABLES="$checksums" "$restore_name" bash /tmp/consistent-logical.sh --manifest "${schema_args[@]}" --output=/tmp/restored > "$result/restore.log"
docker cp "$restore_name:/tmp/restored" "$result/restored" >/dev/null
python3 "$root/compare-manifests.py" "$result/source" "$result/restored" > "$result/compare.log"
epoch=$(docker exec "$restore_name" mariadb --batch --skip-column-names -e 'SELECT source_epoch=state_epoch AND source_epoch>0 AND source_epoch<100 FROM rehearsal_facade.source_state')
[[ $epoch == 1 ]]
printf 'cross-schema-epoch-match\n' > "$result/coherence.log"
# Matching logical manifests alone do not establish working DEFINER identities.
docker exec "$restore_name" mariadb -e "DROP USER 'backup_fixture'@'localhost'"
if docker exec "$restore_name" mariadb -e 'SELECT * FROM rehearsal_facade.source_state' > "$result/missing-definer.log" 2>&1; then exit 1; fi
rg_pattern='ERROR 1449'
grep -q "$rg_pattern" "$result/missing-definer.log"
python3 "$root/compare-manifests.py" "$result/source" "$result/restored" > "$result/missing-definer-manifests.log"
printf 'manifest-equality-does-not-replace-view-read\n' > "$result/definer-proof.log"
assert_unlocked
# Backward-compatible single-schema format still restores all eleven manifests.
docker exec -e BACKUP_CHECKSUM_TABLES=source_epoch "$source_name" bash /tmp/consistent-logical.sh --execute --database=rehearsal --output=/tmp/single-schema --max-seconds=30 --lock-wait-seconds=2 > "$result/single-schema.log"
docker exec "$source_name" test -f /tmp/single-schema/rows.tsv
# A failure in a later schema manifest must invalidate at the root and release.
if docker exec "$source_name" bash /tmp/consistent-logical.sh --execute --database=rehearsal --database=missing_schema --output=/tmp/manifest-failed --max-seconds=30 --lock-wait-seconds=2 > "$result/manifest-failed.log" 2>&1; then exit 1; fi
docker exec "$source_name" test -f /tmp/manifest-failed/INVALID
! docker exec "$source_name" test -f /tmp/manifest-failed/COMPLETE
assert_unlocked
# CHECKSUM TABLE can return NULL rather than a failed client exit for a typo.
if docker exec -e BACKUP_CHECKSUM_TABLES=rehearsal.missing_table "$source_name" bash /tmp/consistent-logical.sh --execute "${schema_args[@]}" --output=/tmp/checksum-failed --max-seconds=30 --lock-wait-seconds=2 > "$result/checksum-failed.log" 2>&1; then exit 1; fi
docker exec "$source_name" test -f /tmp/checksum-failed/INVALID
assert_unlocked
# Fake dump delays after the real dump. It still uses the actual DB/client/holder.
docker exec -i "$source_name" bash -c 'mkdir /tmp/delayed; cat > /tmp/delayed/mariadb-dump; chmod 700 /tmp/delayed/mariadb-dump' <<'DUMP'
#!/usr/bin/env bash
/usr/bin/mariadb-dump "$@" || exit $?
sleep 120
DUMP
wait_dump(){
 for attempt in {1..100}; do
  if docker exec "$source_name" test -s "/tmp/$1/work.pid"; then return; fi
  sleep .1
 done
 return 1
}
for fault in timeout controller-killed transport-disconnect; do
 docker exec -e PATH=/tmp/delayed:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin "$source_name" bash /tmp/consistent-logical.sh --execute "${schema_args[@]}" "--output=/tmp/$fault" --max-seconds=8 --lock-wait-seconds=2 > "$result/$fault.log" 2>&1 &
 transport=$!
 wait_dump "$fault"
 # Shared host flock rejects another capture before making its artifact path.
 if docker exec "$source_name" bash /tmp/consistent-logical.sh --execute "${schema_args[@]}" "--output=/tmp/overlap-$fault" --max-seconds=8 --lock-wait-seconds=2 > "$result/overlap-$fault.log" 2>&1; then exit 1; fi
 ! docker exec "$source_name" test -e "/tmp/overlap-$fault"
 if [[ $fault == controller-killed ]]; then
  docker exec "$source_name" bash -c 'read -r pid born < "$1/controller.pid"; kill -KILL "$pid"' _ "/tmp/$fault"
  # Watchdog must retain flock after controller death, before its deadline.
  ! docker exec "$source_name" test -f "/tmp/$fault/INVALID"
  if docker exec "$source_name" bash /tmp/consistent-logical.sh --execute "${schema_args[@]}" --output=/tmp/post-kill-overlap --max-seconds=8 --lock-wait-seconds=2 > "$result/post-kill-overlap.log" 2>&1; then exit 1; fi
  ! docker exec "$source_name" test -e /tmp/post-kill-overlap
 elif [[ $fault == transport-disconnect ]]; then
  kill -KILL "$transport"
 fi
 wait "$transport" 2>/dev/null || true
 sleep 12
 docker exec "$source_name" test -f "/tmp/$fault/INVALID"
 ! docker exec "$source_name" test -f "/tmp/$fault/COMPLETE"
 remaining=$(docker exec "$source_name" cat "/tmp/$fault/watchdog.remaining")
 [[ $remaining == 0 ]]
 assert_unlocked
 docker cp "$source_name:/tmp/$fault" "$result/$fault" >/dev/null
 printf '%s:invalid-and-unlocked\n' "$fault" >> "$result/faults.log"
 done
# Delay exactly the controller's first successful processlist proof after UNLOCK,
# leaving lock-released absent. The independent watchdog's later proof is not
# delayed: the wrapper claims a private marker once. No controller test hook.
docker exec -i "$source_name" bash -c 'mkdir /tmp/release-race; cat > /tmp/release-race/mariadb; chmod 700 /tmp/release-race/mariadb' <<'CLIENT'
#!/usr/bin/env bash
query=
for arg in "$@"; do [[ $arg != 'SELECT COUNT(*) FROM information_schema.PROCESSLIST WHERE ID='* ]] || query=$arg; done
if [[ -n $query ]]; then
 result=$(/usr/bin/mariadb "$@") || exit $?
 if [[ $result == 0 ]] && mkdir /tmp/release-race/proof-delayed 2>/dev/null; then sleep 20; fi
 printf '%s\n' "$result"
else exec /usr/bin/mariadb "$@"; fi
CLIENT
if docker exec -e PATH=/tmp/release-race:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin "$source_name" bash /tmp/consistent-logical.sh --execute "${schema_args[@]}" --output=/tmp/post-unlock-watchdog --max-seconds=8 --lock-wait-seconds=2 > "$result/post-unlock-watchdog.log" 2>&1; then exit 1; fi
sleep 3
docker exec "$source_name" test -d /tmp/release-race/proof-delayed
docker exec "$source_name" test -f /tmp/post-unlock-watchdog/INVALID
! docker exec "$source_name" test -f /tmp/post-unlock-watchdog/COMPLETE
remaining=$(docker exec "$source_name" cat /tmp/post-unlock-watchdog/watchdog.remaining)
[[ $remaining == 0 ]]
assert_unlocked
docker cp "$source_name:/tmp/post-unlock-watchdog" "$result/post-unlock-watchdog" >/dev/null
printf 'post-unlock-watchdog:invalid-and-unlocked\n' >> "$result/faults.log"
printf 'rehearsal-passed source=%s restored=%s schemas=3 physical-schemas=2 faults=4\n' "$source_name" "$restore_name"
