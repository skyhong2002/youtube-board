-- Durable notification history survives application rollback. Never drop to retry uncertain delivery.
CREATE TABLE IF NOT EXISTS telegram_digest_stories (
 id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
 story_key VARCHAR(64) NOT NULL UNIQUE, canonical_title VARCHAR(500) NOT NULL,
 fingerprint_json LONGTEXT NOT NULL,video_ids_json LONGTEXT NOT NULL,video_channels_json LONGTEXT NOT NULL,observations_json LONGTEXT NOT NULL,
 first_seen_at DATETIME NOT NULL,last_seen_at DATETIME NOT NULL,last_posted_at DATETIME NULL,
 last_posted_video_ids_json LONGTEXT NULL,last_posted_channel_ids_json LONGTEXT NULL,
 post_count INT UNSIGNED NOT NULL DEFAULT 0,created_at TIMESTAMP NULL,updated_at TIMESTAMP NULL,
 INDEX(last_seen_at),INDEX(last_posted_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
CREATE TABLE IF NOT EXISTS telegram_digest_dispatches (
 id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,dispatch_key VARCHAR(64) NOT NULL,
 period VARCHAR(16) NOT NULL,context_key VARCHAR(191) NOT NULL,story_id BIGINT UNSIGNED NULL,
 status VARCHAR(16) NOT NULL,message_hash VARCHAR(64) NULL,attempted_at DATETIME NOT NULL,sent_at DATETIME NULL,
 created_at TIMESTAMP NULL,updated_at TIMESTAMP NULL,
 UNIQUE KEY tg_dispatches_key_unique(dispatch_key),KEY tg_dispatches_period_context_index(period,context_key),KEY tg_dispatches_story_index(story_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
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
