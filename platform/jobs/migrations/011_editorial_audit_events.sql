ALTER TABLE ts_editorial_events ADD INDEX IF NOT EXISTS editorial_merged_into (merged_into,id);
CREATE TABLE IF NOT EXISTS ts_editorial_audit_events (
 sequence BIGINT UNSIGNED NOT NULL,
 event_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 PRIMARY KEY(event_id,sequence),
 INDEX editorial_audit_sequence(sequence,event_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
INSERT IGNORE INTO ts_editorial_audit_events(sequence,event_id)
 SELECT a.sequence,j.event_id FROM ts_editorial_audit a,
 JSON_TABLE(a.before_json,'$.events[*]' COLUMNS(event_id CHAR(36) PATH '$.id')) j
 WHERE j.event_id IS NOT NULL;
INSERT IGNORE INTO ts_editorial_audit_events(sequence,event_id)
 SELECT a.sequence,j.event_id FROM ts_editorial_audit a,
 JSON_TABLE(a.after_json,'$.events[*]' COLUMNS(event_id CHAR(36) PATH '$.id')) j
 WHERE j.event_id IS NOT NULL;
CREATE TRIGGER IF NOT EXISTS ts_editorial_audit_events_no_update BEFORE UPDATE ON ts_editorial_audit_events FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Editorial audit event index is append only';
CREATE TRIGGER IF NOT EXISTS ts_editorial_audit_events_no_delete BEFORE DELETE ON ts_editorial_audit_events FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Editorial audit event index is append only';
