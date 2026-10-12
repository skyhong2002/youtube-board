-- Local additions corresponding to Laravel migrations after the baseline.
-- Never apply this bootstrap to production or use it to downgrade a schema.
CREATE TABLE IF NOT EXISTS urt_mayor_person_ai (
  pk BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, ctime DATETIME NOT NULL,
  mtime DATETIME NULL, city_key VARCHAR(64) NOT NULL, city_label VARCHAR(64) NOT NULL,
  person VARCHAR(128) NOT NULL, the_date DATE NOT NULL, ai_type VARCHAR(128) NULL,
  provider VARCHAR(32) NULL, user_token VARCHAR(64) NOT NULL DEFAULT 'CLI',
  prompt_json LONGTEXT NULL, source_json LONGTEXT NULL, result_json LONGTEXT NOT NULL,
  del_flag TINYINT UNSIGNED NULL,
  KEY mayor_person_ai_lookup_idx (city_key, person, the_date),
  KEY mayor_person_ai_date_city_idx (the_date, city_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE IF NOT EXISTS urt_show_group (
  pk BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, ctime DATETIME NOT NULL,
  stime DATETIME NULL, mtime DATETIME NULL, the_group VARCHAR(128) NOT NULL,
  the_view VARCHAR(64) NOT NULL, the_result LONGTEXT NULL,
  KEY show_group_lookup_idx (the_group, the_view)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE IF NOT EXISTS ingestion_youtube_quota_daily (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, provider VARCHAR(64) NOT NULL,
  quota_date DATE NOT NULL, consumed_units BIGINT UNSIGNED NOT NULL DEFAULT 0,
  reserved_units BIGINT UNSIGNED NOT NULL DEFAULT 0,
  google_exhausted_at DATETIME NULL, google_exhausted_units INT UNSIGNED NULL,
  created_at TIMESTAMP NULL, updated_at TIMESTAMP NULL,
  UNIQUE KEY ingestion_youtube_quota_daily_unique (provider, quota_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE IF NOT EXISTS ingestion_runs (
  id VARCHAR(52) PRIMARY KEY, recorded_at DATETIME NOT NULL,
  request_source VARCHAR(32) NULL, request_mode VARCHAR(16) NULL, result_mode VARCHAR(16) NULL,
  payload_json LONGTEXT NOT NULL, created_at TIMESTAMP NULL, updated_at TIMESTAMP NULL,
  KEY ingestion_runs_recorded_at_index (recorded_at),
  KEY ingestion_runs_scheduler_index (request_source, request_mode, result_mode, recorded_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE IF NOT EXISTS ingestion_run_jobs (
  run_id VARCHAR(52) NOT NULL, job_key VARCHAR(120) NOT NULL, recorded_at DATETIME NOT NULL,
  attempted BOOLEAN NOT NULL DEFAULT TRUE, succeeded BOOLEAN NOT NULL DEFAULT FALSE,
  failed BOOLEAN NOT NULL DEFAULT FALSE, action VARCHAR(120) NULL, exit_code INT NULL,
  started_at VARCHAR(64) NULL, finished_at VARCHAR(64) NULL,
  created_at TIMESTAMP NULL, updated_at TIMESTAMP NULL,
  PRIMARY KEY (run_id, job_key),
  KEY ingestion_run_jobs_attempt_index (job_key, attempted, recorded_at),
  KEY ingestion_run_jobs_success_index (job_key, succeeded, recorded_at),
  CONSTRAINT ingestion_run_jobs_run_foreign FOREIGN KEY (run_id) REFERENCES ingestion_runs(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE IF NOT EXISTS telegram_digest_stories (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, story_key VARCHAR(64) NOT NULL UNIQUE,
  canonical_title VARCHAR(500) NOT NULL, fingerprint_json LONGTEXT NOT NULL,
  video_ids_json LONGTEXT NOT NULL, video_channels_json LONGTEXT NOT NULL,
  observations_json LONGTEXT NOT NULL, first_seen_at DATETIME NOT NULL,
  last_seen_at DATETIME NOT NULL, last_posted_at DATETIME NULL,
  last_posted_video_ids_json LONGTEXT NULL, last_posted_channel_ids_json LONGTEXT NULL,
  post_count INT UNSIGNED NOT NULL DEFAULT 0, created_at TIMESTAMP NULL, updated_at TIMESTAMP NULL,
  KEY (last_seen_at), KEY (last_posted_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE IF NOT EXISTS telegram_digest_dispatches (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, dispatch_key VARCHAR(64) NOT NULL,
  period VARCHAR(16) NOT NULL, context_key VARCHAR(191) NOT NULL,
  story_id BIGINT UNSIGNED NULL, status VARCHAR(16) NOT NULL, message_hash VARCHAR(64) NULL,
  attempted_at DATETIME NOT NULL, sent_at DATETIME NULL,
  created_at TIMESTAMP NULL, updated_at TIMESTAMP NULL,
  UNIQUE KEY tg_dispatches_key_unique (dispatch_key),
  KEY tg_dispatches_period_context_index (period, context_key), KEY tg_dispatches_story_index (story_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
