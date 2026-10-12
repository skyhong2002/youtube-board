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
SQL
invoke(){ docker exec -e BACKUP_CHECKSUM_TABLES=legacy,modern "$source_name" bash /tmp/consistent-logical.sh --execute --database=rehearsal "--output=/tmp/$1" "--max-seconds=${2:-30}" --lock-wait-seconds=2; }
assert_unlocked(){
 local n
 n=$(docker exec "$source_name" mariadb --batch --skip-column-names -e "SELECT COUNT(*) FROM information_schema.PROCESSLIST WHERE INFO LIKE 'FLUSH TABLES WITH READ LOCK%'")
 [[ $n == 0 ]]
 docker exec "$source_name" timeout 3 mariadb -e 'INSERT INTO rehearsal.modern(amount,label) VALUES (5,"lock-release-proof")'
}
invoke success > "$result/success.log"
docker cp "$source_name:/tmp/success" "$result/source" >/dev/null
(cd "$result/source" && sha256sum --check archive.sha256) > "$result/archive-check.log"
gzip -t "$result/source/database.sql.gz"
gzip -dc "$result/source/database.sql.gz" | docker exec -i "$restore_name" mariadb
docker exec -e BACKUP_CHECKSUM_TABLES=legacy,modern "$restore_name" bash /tmp/consistent-logical.sh --manifest --database=rehearsal --output=/tmp/restored > "$result/restore.log"
docker cp "$restore_name:/tmp/restored" "$result/restored" >/dev/null
python3 "$root/compare-manifests.py" "$result/source" "$result/restored" > "$result/compare.log"
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
 docker exec -e PATH=/tmp/delayed:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin "$source_name" bash /tmp/consistent-logical.sh --execute --database=rehearsal "--output=/tmp/$fault" --max-seconds=8 --lock-wait-seconds=2 > "$result/$fault.log" 2>&1 &
 transport=$!
 wait_dump "$fault"
 if [[ $fault == controller-killed ]]; then
  docker exec "$source_name" bash -c 'read -r pid born < "$1/controller.pid"; kill -KILL "$pid"' _ "/tmp/$fault"
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
printf 'rehearsal-passed source=%s restored=%s faults=3\n' "$source_name" "$restore_name"
