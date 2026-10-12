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
