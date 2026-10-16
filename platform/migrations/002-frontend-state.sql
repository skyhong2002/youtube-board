-- Dedicated NEW-schema bootstrap. Never run the full source migration chain here.

-- TS-owned definitions from 001_vocabulary.sql; source DDL and data backfills excluded.
CREATE TABLE IF NOT EXISTS ts_vocabulary_runs (
 id VARCHAR(100) COLLATE utf8mb4_bin PRIMARY KEY,
 window_since VARCHAR(30) NOT NULL,
 window_until VARCHAR(30) NOT NULL,
 checkpoint_cursor VARCHAR(80) NULL,
 pages INT UNSIGNED NOT NULL DEFAULT 0,
 status VARCHAR(16) NOT NULL DEFAULT 'scanning',
 snapshot LONGTEXT NULL,
 created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 published_at TIMESTAMP(3) NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
CREATE TABLE IF NOT EXISTS ts_vocabulary_stage (
 run_id VARCHAR(100) COLLATE utf8mb4_bin NOT NULL,
 article_id VARCHAR(24) COLLATE utf8mb4_bin NOT NULL,
 payload LONGTEXT NOT NULL,
 PRIMARY KEY(run_id, article_id),
 FOREIGN KEY(run_id) REFERENCES ts_vocabulary_runs(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
CREATE TABLE IF NOT EXISTS ts_vocabulary_current (
 source VARCHAR(100) COLLATE utf8mb4_bin PRIMARY KEY,
 run_id VARCHAR(100) COLLATE utf8mb4_bin NOT NULL,
 FOREIGN KEY(run_id) REFERENCES ts_vocabulary_runs(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
CREATE TABLE IF NOT EXISTS ts_job_runs (
 job_key VARCHAR(100) COLLATE utf8mb4_bin NOT NULL,
 execution_key VARCHAR(100) COLLATE utf8mb4_bin NOT NULL,
 status VARCHAR(20) NOT NULL,
 result LONGTEXT NULL,
 updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
 PRIMARY KEY(job_key, execution_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

-- TS-owned definitions from 002_video_tag_evidence.sql; source DDL and data backfills excluded.
CREATE TABLE IF NOT EXISTS ts_video_tag_matches (
 video_id VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 vocabulary_version VARCHAR(100) COLLATE utf8mb4_bin NOT NULL,
 source_pk BIGINT UNSIGNED NOT NULL,
 source_text_sha256 CHAR(64) CHARACTER SET ascii NOT NULL,
 source_observed_at DATETIME(3) NULL,
 matched_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 rule_version VARCHAR(40) NOT NULL,
 evidence_count INT UNSIGNED NOT NULL,
 PRIMARY KEY(video_id, vocabulary_version),
 FOREIGN KEY(vocabulary_version) REFERENCES ts_vocabulary_runs(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
CREATE TABLE IF NOT EXISTS ts_video_tag_evidence (
 video_id VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 vocabulary_version VARCHAR(100) COLLATE utf8mb4_bin NOT NULL,
 term_key CHAR(64) CHARACTER SET ascii NOT NULL,
 term VARCHAR(240) NOT NULL,
 source VARCHAR(100) NOT NULL,
 field_name VARCHAR(20) NOT NULL,
 start_offset INT UNSIGNED NOT NULL,
 end_offset INT UNSIGNED NOT NULL,
 matched_text VARCHAR(240) NOT NULL,
 snippet TEXT NOT NULL,
 snippet_start INT UNSIGNED NOT NULL,
 rule_version VARCHAR(40) NOT NULL,
 PRIMARY KEY(video_id, vocabulary_version, term_key, field_name, start_offset),
 KEY version_term (vocabulary_version, term_key),
 FOREIGN KEY(video_id, vocabulary_version) REFERENCES ts_video_tag_matches(video_id, vocabulary_version) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

-- TS-owned definitions from 003_full_vocabulary.sql; source DDL and data backfills excluded.
CREATE TABLE IF NOT EXISTS ts_vocabulary_terms (
 run_id VARCHAR(100) COLLATE utf8mb4_bin NOT NULL,
 term_key CHAR(64) COLLATE utf8mb4_bin NOT NULL,
 term VARCHAR(240) COLLATE utf8mb4_bin NOT NULL,
 article_count BIGINT UNSIGNED NOT NULL,
 payload TEXT NOT NULL,
 PRIMARY KEY(run_id, term_key),
 KEY vocabulary_term_order (run_id, article_count),
 FOREIGN KEY(run_id) REFERENCES ts_vocabulary_runs(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

-- TS-owned definitions from 004_tag_cache_lineage.sql; source DDL and data backfills excluded.
CREATE TABLE IF NOT EXISTS ts_tag_cache_lineage (
 selection_key VARCHAR(700) COLLATE utf8mb4_bin NOT NULL,
 the_date DATE NOT NULL,
 vocabulary_version VARCHAR(100) COLLATE utf8mb4_bin NOT NULL,
 coverage VARCHAR(80) NOT NULL,
 rule_version VARCHAR(80) NOT NULL,
 status VARCHAR(20) NOT NULL,
 generated_at DATETIME NOT NULL,
 unknown_view_videos INT UNSIGNED NOT NULL DEFAULT 0,
 PRIMARY KEY(selection_key, the_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
ALTER TABLE ts_tag_cache_lineage ADD COLUMN IF NOT EXISTS unknown_view_videos INT UNSIGNED NOT NULL DEFAULT 0;

-- TS-owned definitions from 005_youtube_item_backoff.sql; source DDL and data backfills excluded.
CREATE TABLE IF NOT EXISTS ts_youtube_item_backoff (
 workflow VARCHAR(80) COLLATE utf8mb4_bin NOT NULL,
 video_id VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 failures INT UNSIGNED NOT NULL,
 retry_after DATETIME NOT NULL,
 reason VARCHAR(80) NOT NULL,
 updated_at DATETIME NOT NULL,
 PRIMARY KEY(workflow, video_id),
 KEY retry_after (retry_after)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

-- TS-owned definitions from 006_ai_runs.sql; source DDL and data backfills excluded.
CREATE TABLE IF NOT EXISTS ts_ai_runs (
 run_id CHAR(64) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
 workflow VARCHAR(40) NOT NULL,
 business_key_sha256 CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 input_sha256 CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 input_json LONGTEXT NOT NULL,
 status VARCHAR(20) NOT NULL,
 result_json LONGTEXT NULL,
 provider_json TEXT NULL,
 target_pk BIGINT UNSIGNED NULL,
 failure_code VARCHAR(64) NULL,
 created_at DATETIME NOT NULL,
 updated_at DATETIME NOT NULL,
 INDEX workflow_status (workflow,status),
 INDEX business_key (business_key_sha256),
 INDEX target_projection (workflow,target_pk,updated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

-- TS-owned definitions from 007_source_counts_and_comments.sql; source DDL and data backfills excluded.
CREATE TABLE IF NOT EXISTS ts_comment_stages (
 video_id VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
 queue_pk INT NOT NULL,
 state_json LONGTEXT NOT NULL,
 status VARCHAR(20) NOT NULL,
 updated_at DATETIME NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
CREATE TABLE IF NOT EXISTS ts_comment_stage_archive (
 id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
 video_id VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 queue_pk INT NOT NULL,
 state_json LONGTEXT NOT NULL,
 status VARCHAR(20) NOT NULL,
 archived_at DATETIME NOT NULL,
 KEY archived_at (archived_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

-- TS-owned definitions from 008_report_cache_lineage.sql; source DDL and data backfills excluded.
CREATE TABLE IF NOT EXISTS ts_live_tag_cache_lineage LIKE ts_tag_cache_lineage;
CREATE TABLE IF NOT EXISTS ts_report_cache_lineage (
 cache_table VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 cache_key CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 vocabulary_version VARCHAR(100) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 coverage VARCHAR(64) NOT NULL,
 rule_version VARCHAR(100) NOT NULL,
 status ENUM('pending','published') NOT NULL,
 generated_at DATETIME NOT NULL,
 unknown_view_videos INT NOT NULL DEFAULT 0,
 PRIMARY KEY(cache_table,cache_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE IF NOT EXISTS ts_report_cache_archive (
 cache_table VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 source_pk BIGINT NOT NULL,
 archived_at DATETIME NOT NULL,
 reason VARCHAR(64) NOT NULL,
 payload LONGTEXT NOT NULL,
 PRIMARY KEY(cache_table,source_pk)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
ALTER TABLE ts_report_cache_lineage ADD COLUMN IF NOT EXISTS window_from DATE DEFAULT NULL, ADD COLUMN IF NOT EXISTS window_to DATE DEFAULT NULL, ADD COLUMN IF NOT EXISTS window_closed BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE ts_tag_cache_lineage ADD COLUMN IF NOT EXISTS window_from DATE DEFAULT NULL, ADD COLUMN IF NOT EXISTS window_to DATE DEFAULT NULL, ADD COLUMN IF NOT EXISTS window_closed BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE ts_live_tag_cache_lineage ADD COLUMN IF NOT EXISTS window_from DATE DEFAULT NULL, ADD COLUMN IF NOT EXISTS window_to DATE DEFAULT NULL, ADD COLUMN IF NOT EXISTS window_closed BOOLEAN NOT NULL DEFAULT FALSE;
CREATE TABLE IF NOT EXISTS ts_cache_item_state (
 workflow VARCHAR(100) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 item_key VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 source_stamp DATETIME NOT NULL,
 processed_at DATETIME NOT NULL,
 PRIMARY KEY(workflow,item_key)
) ENGINE=InnoDB;
ALTER TABLE ts_cache_item_state ADD COLUMN IF NOT EXISTS outcome VARCHAR(32) DEFAULT NULL, ADD COLUMN IF NOT EXISTS retry_after DATETIME DEFAULT NULL, ADD COLUMN IF NOT EXISTS attempts INT NOT NULL DEFAULT 0;

-- TS-owned definitions from 009_notifications.sql; source DDL and data backfills excluded.
CREATE TABLE IF NOT EXISTS ts_notification_runs (
 run_id VARCHAR(36) PRIMARY KEY,workflow VARCHAR(64) NOT NULL,status VARCHAR(32) NOT NULL,
 context_key VARCHAR(191) NULL,source_table VARCHAR(32) NULL,source_pk BIGINT UNSIGNED NULL,source_sha256 CHAR(64) NULL,
 source_json LONGTEXT NULL,posts_json LONGTEXT NULL,result_json LONGTEXT NULL,created_at DATETIME NOT NULL,updated_at DATETIME NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
CREATE TABLE IF NOT EXISTS ts_notification_attempts (
 attempt_id VARCHAR(36) PRIMARY KEY,run_id VARCHAR(36) NOT NULL,dispatch_key CHAR(64) NOT NULL,story_id BIGINT UNSIGNED NOT NULL,
 status VARCHAR(32) NOT NULL,message_hash CHAR(64) NOT NULL,telegram_message_id VARCHAR(64) NULL,error_code VARCHAR(64) NULL,
 created_at DATETIME NOT NULL,updated_at DATETIME NOT NULL,KEY(run_id),KEY(dispatch_key),KEY(story_id,status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
CREATE TABLE IF NOT EXISTS ts_notification_slots (
 slot_key VARCHAR(100) PRIMARY KEY,run_id VARCHAR(36) NOT NULL,claimed_at DATETIME NOT NULL,expires_at DATETIME NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
CREATE TABLE IF NOT EXISTS ts_notification_resolutions (
 resolution_id VARCHAR(36) PRIMARY KEY,dispatch_key CHAR(64) NOT NULL,outcome VARCHAR(16) NOT NULL,
 operator_name VARCHAR(100) NOT NULL,evidence TEXT NOT NULL,previous_json LONGTEXT NOT NULL,
 resolved_at DATETIME NOT NULL,KEY(dispatch_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
CREATE TABLE IF NOT EXISTS ts_notification_resolution_attempts (
 resolution_id VARCHAR(36) NOT NULL,attempt_id VARCHAR(36) NOT NULL,
 PRIMARY KEY(resolution_id,attempt_id),UNIQUE KEY(attempt_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

-- TS-owned definitions from 010_editorial.sql; source DDL and data backfills excluded.
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

-- TS-owned definitions from 011_editorial_audit_events.sql; source DDL and data backfills excluded.
ALTER TABLE ts_editorial_events ADD INDEX IF NOT EXISTS editorial_merged_into (merged_into,id);
CREATE TABLE IF NOT EXISTS ts_editorial_audit_events (
 sequence BIGINT UNSIGNED NOT NULL,
 event_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 PRIMARY KEY(event_id,sequence),
 INDEX editorial_audit_sequence(sequence,event_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
CREATE TRIGGER IF NOT EXISTS ts_editorial_audit_events_no_update BEFORE UPDATE ON ts_editorial_audit_events FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Editorial audit event index is append only';
CREATE TRIGGER IF NOT EXISTS ts_editorial_audit_events_no_delete BEFORE DELETE ON ts_editorial_audit_events FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Editorial audit event index is append only';

-- TS-owned definitions from 012_accounts.sql; source DDL and data backfills excluded.
CREATE TABLE IF NOT EXISTS ts_auth_users (
 id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
 google_sub VARCHAR(255) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 email VARCHAR(255) NOT NULL,
 name VARCHAR(255) NULL,
 picture VARCHAR(512) NULL,
 admin_granted_by BIGINT UNSIGNED NULL,
 admin_granted_at DATETIME(3) NULL,
 disabled_at DATETIME(3) NULL,
 created_at DATETIME(3) NOT NULL,
 last_login_at DATETIME(3) NOT NULL,
 UNIQUE KEY auth_google_sub (google_sub),
 INDEX auth_email (email),
 INDEX auth_last_login (last_login_at,id),
 CONSTRAINT auth_granted_by FOREIGN KEY (admin_granted_by) REFERENCES ts_auth_users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
CREATE TABLE IF NOT EXISTS ts_auth_admin_bindings (
 email VARCHAR(255) NOT NULL PRIMARY KEY,
 user_id BIGINT UNSIGNED NOT NULL,
 google_sub VARCHAR(255) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 created_at DATETIME(3) NOT NULL,
 CONSTRAINT auth_bound_user FOREIGN KEY (user_id) REFERENCES ts_auth_users(id),
 INDEX auth_binding_user (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
CREATE TABLE IF NOT EXISTS ts_auth_sessions (
 token_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
 user_id BIGINT UNSIGNED NOT NULL,
 created_at DATETIME(3) NOT NULL,
 expires_at DATETIME(3) NOT NULL,
 INDEX auth_session_user (user_id),
 INDEX auth_session_expiry (expires_at),
 CONSTRAINT auth_session_owner FOREIGN KEY (user_id) REFERENCES ts_auth_users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
CREATE TABLE IF NOT EXISTS ts_auth_flows (
 binding_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
 state_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 nonce CHAR(43) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 verifier CHAR(43) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 next_path VARCHAR(512) NOT NULL,
 created_at DATETIME(3) NOT NULL,
 expires_at DATETIME(3) NOT NULL,
 INDEX auth_flow_expiry (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
CREATE TABLE IF NOT EXISTS ts_auth_role_audit (
 id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
 user_id BIGINT UNSIGNED NOT NULL,
 actor_id BIGINT UNSIGNED NULL,
 action VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 email VARCHAR(255) NOT NULL,
 created_at DATETIME(3) NOT NULL,
 INDEX auth_audit_user (user_id,id),
 CONSTRAINT auth_audit_target FOREIGN KEY (user_id) REFERENCES ts_auth_users(id),
 CONSTRAINT auth_audit_actor FOREIGN KEY (actor_id) REFERENCES ts_auth_users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
CREATE TRIGGER IF NOT EXISTS ts_auth_role_audit_no_update BEFORE UPDATE ON ts_auth_role_audit FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Auth role audit is append only';
CREATE TRIGGER IF NOT EXISTS ts_auth_role_audit_no_delete BEFORE DELETE ON ts_auth_role_audit FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Auth role audit is append only';

-- TS-owned definitions from 013_reader_accounts.sql; source DDL and data backfills excluded.
CREATE TABLE IF NOT EXISTS ts_reader_follows (
 user_id BIGINT UNSIGNED NOT NULL,
 kind VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 target VARCHAR(240) COLLATE utf8mb4_bin NOT NULL,
 created_at DATETIME(3) NOT NULL,
 PRIMARY KEY(user_id,kind,target),
 FOREIGN KEY(user_id) REFERENCES ts_auth_users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
CREATE TABLE IF NOT EXISTS ts_reader_saves (
 user_id BIGINT UNSIGNED NOT NULL,
 kind VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 target VARCHAR(240) COLLATE utf8mb4_bin NOT NULL,
 note VARCHAR(500) NOT NULL DEFAULT '',
 created_at DATETIME(3) NOT NULL,
 updated_at DATETIME(3) NOT NULL,
 PRIMARY KEY(user_id,kind,target),
 INDEX(user_id,updated_at),
 FOREIGN KEY(user_id) REFERENCES ts_auth_users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
CREATE TABLE IF NOT EXISTS ts_reader_feed_tokens (
 user_id BIGINT UNSIGNED PRIMARY KEY,
 token_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL UNIQUE,
 created_at DATETIME(3) NOT NULL,
 FOREIGN KEY(user_id) REFERENCES ts_auth_users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

-- TS-owned definitions from 014_ops_history_indexes.sql; source DDL and data backfills excluded.
CREATE INDEX IF NOT EXISTS ops_job_history ON ts_job_runs(job_key,updated_at,execution_key);
CREATE INDEX IF NOT EXISTS ops_ai_history ON ts_ai_runs(workflow,updated_at,run_id);
CREATE INDEX IF NOT EXISTS ops_notification_history ON ts_notification_runs(workflow,updated_at,run_id);
CREATE INDEX IF NOT EXISTS ops_vocabulary_history ON ts_vocabulary_runs(created_at,id);

-- TS-owned definitions from 015_keyword_reviews.sql. Review routes never run this DDL.
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

-- TS-owned definitions from 016_reader_api_keys.sql.
-- Additive TS-own-state migration only. Never grant this table to report readers.
CREATE TABLE IF NOT EXISTS ts_reader_api_keys (
 id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
 user_id BIGINT UNSIGNED NOT NULL,
 key_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 prefix CHAR(12) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 label VARCHAR(64) NOT NULL,
 created_at DATETIME(3) NOT NULL,
 last_used_at DATETIME(3) NULL,
 revoked_at DATETIME(3) NULL,
 UNIQUE KEY reader_api_key_hash (key_hash),
 INDEX reader_api_key_owner (user_id,revoked_at,id),
 CONSTRAINT reader_api_key_user FOREIGN KEY (user_id) REFERENCES ts_auth_users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
