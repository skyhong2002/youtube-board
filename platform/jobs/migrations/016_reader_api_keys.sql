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
