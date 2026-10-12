CREATE TABLE IF NOT EXISTS ts_editorial_events (
 id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
 title VARCHAR(300) NOT NULL,
 version INT UNSIGNED NOT NULL,
 merged_into CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
 created_at DATETIME(3) NOT NULL,
 updated_at DATETIME(3) NOT NULL,
 INDEX(updated_at,id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
CREATE TABLE IF NOT EXISTS ts_editorial_sources (
 id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
 identity_sha256 CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 kind VARCHAR(20) NOT NULL,
 source_id VARCHAR(500) NOT NULL,
 headline VARCHAR(1000) NOT NULL,
 url VARCHAR(2000) NULL,
 published_at DATETIME(3) NULL,
 observed_at DATETIME(3) NOT NULL,
 source_sha256 CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 provenance_json LONGTEXT NOT NULL,
 snapshot_json LONGTEXT NOT NULL,
 UNIQUE(identity_sha256,source_sha256)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
CREATE TABLE IF NOT EXISTS ts_editorial_links (
 event_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 source_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 active BOOLEAN NOT NULL DEFAULT TRUE,
 PRIMARY KEY(event_id,source_id),
 INDEX(source_id,active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
CREATE TABLE IF NOT EXISTS ts_editorial_candidates (
 id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
 channel_id CHAR(24) CHARACTER SET ascii COLLATE ascii_bin NOT NULL UNIQUE,
 proposed_name VARCHAR(300) NOT NULL,
 reason VARCHAR(2000) NOT NULL,
 status VARCHAR(20) NOT NULL,
 version INT UNSIGNED NOT NULL,
 adopted_u_id INT NULL,
 submitted_by VARCHAR(100) NOT NULL,
 created_at DATETIME(3) NOT NULL,
 updated_at DATETIME(3) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
CREATE TABLE IF NOT EXISTS ts_editorial_requests (
 request_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
 input_sha256 CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 actor VARCHAR(100) NOT NULL,
 result_json LONGTEXT NOT NULL,
 created_at DATETIME(3) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
CREATE TABLE IF NOT EXISTS ts_editorial_audit (
 sequence BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
 request_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL UNIQUE,
 action VARCHAR(50) NOT NULL,
 actor VARCHAR(100) NOT NULL,
 reason VARCHAR(2000) NOT NULL,
 before_json LONGTEXT NOT NULL,
 after_json LONGTEXT NOT NULL,
 created_at DATETIME(3) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
CREATE TRIGGER IF NOT EXISTS ts_editorial_audit_no_update BEFORE UPDATE ON ts_editorial_audit FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Editorial audit is append only';
CREATE TRIGGER IF NOT EXISTS ts_editorial_audit_no_delete BEFORE DELETE ON ts_editorial_audit FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Editorial audit is append only';
CREATE TRIGGER IF NOT EXISTS ts_editorial_requests_no_update BEFORE UPDATE ON ts_editorial_requests FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Editorial requests are immutable';
CREATE TRIGGER IF NOT EXISTS ts_editorial_requests_no_delete BEFORE DELETE ON ts_editorial_requests FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Editorial requests are immutable';
CREATE TRIGGER IF NOT EXISTS ts_editorial_sources_no_update BEFORE UPDATE ON ts_editorial_sources FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Editorial source snapshots are immutable';
CREATE TRIGGER IF NOT EXISTS ts_editorial_sources_no_delete BEFORE DELETE ON ts_editorial_sources FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Editorial source snapshots are immutable';
