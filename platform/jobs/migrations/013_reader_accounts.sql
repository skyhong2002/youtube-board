CREATE TABLE IF NOT EXISTS ts_reader_follows (
 user_id BIGINT UNSIGNED NOT NULL,
 kind VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 target VARCHAR(240) COLLATE utf8mb4_bin NOT NULL,
 created_at DATETIME(3) NOT NULL,
 PRIMARY KEY(user_id,kind,target),
 FOREIGN KEY(user_id) REFERENCES ts_auth_users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
CREATE TABLE IF NOT EXISTS ts_reader_saves (
 user_id BIGINT UNSIGNED NOT NULL,
 kind VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 target VARCHAR(240) COLLATE utf8mb4_bin NOT NULL,
 note VARCHAR(500) NOT NULL DEFAULT '',
 created_at DATETIME(3) NOT NULL,
 updated_at DATETIME(3) NOT NULL,
 PRIMARY KEY(user_id,kind,target),
 INDEX(user_id,updated_at),
 FOREIGN KEY(user_id) REFERENCES ts_auth_users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
CREATE TABLE IF NOT EXISTS ts_reader_feed_tokens (
 user_id BIGINT UNSIGNED PRIMARY KEY,
 token_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL UNIQUE,
 created_at DATETIME(3) NOT NULL,
 FOREIGN KEY(user_id) REFERENCES ts_auth_users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
