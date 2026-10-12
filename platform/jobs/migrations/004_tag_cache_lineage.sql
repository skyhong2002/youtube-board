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
