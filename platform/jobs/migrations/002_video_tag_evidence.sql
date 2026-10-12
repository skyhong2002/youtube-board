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
