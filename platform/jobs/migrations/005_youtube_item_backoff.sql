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
