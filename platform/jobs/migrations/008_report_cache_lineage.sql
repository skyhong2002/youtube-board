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
ALTER TABLE urt_show_live_tag_date MODIFY total_views BIGINT DEFAULT NULL, MODIFY hour_result LONGTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL, MODIFY videos_result LONGTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL;
ALTER TABLE urt_show_tag_month MODIFY total_views BIGINT DEFAULT NULL;
SET @ts_report_cache_ddl = CONCAT('ALTER TABLE urt_show_video_tag_date MODIFY videos_json LONGTEXT CHARACTER SET utf8mb4 COLLATE ', (SELECT COLLATION_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='urt_show_video_tag_date' AND COLUMN_NAME='videos_json'), ' DEFAULT NULL, MODIFY tags_json LONGTEXT CHARACTER SET utf8mb4 COLLATE ', (SELECT COLLATION_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='urt_show_video_tag_date' AND COLUMN_NAME='tags_json'), ' DEFAULT NULL');
PREPARE ts_report_cache_alter FROM @ts_report_cache_ddl;
EXECUTE ts_report_cache_alter;
DEALLOCATE PREPARE ts_report_cache_alter;
SET @ts_report_cache_ddl = NULL;
ALTER TABLE urt_video_live_tvbs MODIFY concurrentViewers BIGINT DEFAULT NULL, MODIFY max_current BIGINT DEFAULT NULL;
ALTER TABLE urt_video_live_log_tvbs MODIFY max_current BIGINT DEFAULT NULL;
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
