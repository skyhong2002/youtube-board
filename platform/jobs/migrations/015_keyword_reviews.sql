-- Own TS schema only; reviewed migration required. Never run automatically from review routes.
-- Phase 1 records decisions only: it cannot activate ranking/matching overrides.
CREATE TABLE IF NOT EXISTS ts_keyword_reviews (
 id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
 revision INT UNSIGNED NOT NULL,
 status VARCHAR(16) NOT NULL,
 vocabulary_version VARCHAR(100) COLLATE utf8mb4_bin NOT NULL,
 term_key CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 rule_version VARCHAR(40) NOT NULL,
 context VARCHAR(40) NOT NULL,
 state_json LONGTEXT NOT NULL,
 created_at DATETIME(3) NOT NULL,
 updated_at DATETIME(3) NOT NULL,
 INDEX keyword_review_lookup(vocabulary_version,term_key,context,status,id),
 CONSTRAINT keyword_review_version FOREIGN KEY(vocabulary_version) REFERENCES ts_vocabulary_runs(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
CREATE TABLE IF NOT EXISTS ts_keyword_review_audit (
 sequence BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
 request_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL UNIQUE,
 review_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 actor VARCHAR(100) NOT NULL,
 action VARCHAR(16) NOT NULL,
 reason VARCHAR(2000) NOT NULL,
 before_json LONGTEXT NOT NULL,
 after_json LONGTEXT NOT NULL,
 created_at DATETIME(3) NOT NULL,
 INDEX keyword_review_history(review_id,sequence),
 CONSTRAINT keyword_review_audit_target FOREIGN KEY(review_id) REFERENCES ts_keyword_reviews(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
CREATE TABLE IF NOT EXISTS ts_keyword_review_requests (
 request_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
 actor VARCHAR(100) NOT NULL,
 input_sha256 CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 result_json LONGTEXT NOT NULL,
 created_at DATETIME(3) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
CREATE TRIGGER IF NOT EXISTS ts_keyword_review_audit_no_update BEFORE UPDATE ON ts_keyword_review_audit FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Keyword review audit is append only';
CREATE TRIGGER IF NOT EXISTS ts_keyword_review_audit_no_delete BEFORE DELETE ON ts_keyword_review_audit FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Keyword review audit is append only';
CREATE TRIGGER IF NOT EXISTS ts_keyword_review_requests_no_update BEFORE UPDATE ON ts_keyword_review_requests FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Keyword review requests are immutable';
CREATE TRIGGER IF NOT EXISTS ts_keyword_review_requests_no_delete BEFORE DELETE ON ts_keyword_review_requests FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Keyword review requests are immutable';
