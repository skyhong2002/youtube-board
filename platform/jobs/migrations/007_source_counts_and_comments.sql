-- Widen only: retain signedness/nullability and exact source values and never clamp counts.
ALTER TABLE urt_video_schedule MODIFY viewCount BIGINT NULL, MODIFY likeCount BIGINT NULL, MODIFY commentCount BIGINT NULL;
ALTER TABLE urt_video_log_history MODIFY viewCount BIGINT NOT NULL, MODIFY likeCount BIGINT NOT NULL, MODIFY dislikeCount BIGINT NOT NULL, MODIFY favoriteCount BIGINT NOT NULL, MODIFY commentCount BIGINT NOT NULL;
ALTER TABLE urt_video MODIFY likeCount BIGINT NULL, MODIFY dislikeCount BIGINT NULL, MODIFY favoriteCount BIGINT NULL, MODIFY commentCount BIGINT NULL;
ALTER TABLE urt_channel MODIFY commentCount BIGINT NULL, MODIFY subscriberCount BIGINT NULL, MODIFY videoCount BIGINT NULL;
ALTER TABLE urt_count MODIFY subscriberCount BIGINT NULL, MODIFY videoCount BIGINT NULL, MODIFY view_week BIGINT NULL, MODIFY sub_week BIGINT NULL, MODIFY video_week BIGINT NULL, MODIFY view_month BIGINT NULL, MODIFY sub_month BIGINT NULL, MODIFY video_month BIGINT NULL, MODIFY views_pred_week BIGINT NULL, MODIFY views_pred_month BIGINT NULL;
ALTER TABLE urt_video_duration MODIFY duration BIGINT NULL;
ALTER TABLE urt_video_live MODIFY concurrentViewers BIGINT NULL, MODIFY max_current BIGINT NULL;
ALTER TABLE urt_video_live_log MODIFY max_current BIGINT NULL;
ALTER TABLE urt_comment MODIFY comments_count BIGINT NULL, MODIFY likes_count BIGINT NULL, MODIFY threads_count BIGINT NULL, MODIFY replies_count BIGINT NULL, MODIFY authors_count BIGINT NULL;
ALTER TABLE urt_comment_author MODIFY DisplayName VARCHAR(512) NOT NULL;
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
