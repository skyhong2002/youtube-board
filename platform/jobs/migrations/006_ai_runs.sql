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
