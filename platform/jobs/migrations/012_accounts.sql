-- Isolated Google reader/admin identities. All timestamps are UTC.
CREATE TABLE IF NOT EXISTS ts_auth_users (
 id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
 google_sub VARCHAR(255) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 email VARCHAR(255) NOT NULL,
 name VARCHAR(255) NULL,
 picture VARCHAR(512) NULL,
 admin_granted_by BIGINT UNSIGNED NULL,
 admin_granted_at DATETIME(3) NULL,
 disabled_at DATETIME(3) NULL,
 created_at DATETIME(3) NOT NULL,
 last_login_at DATETIME(3) NOT NULL,
 UNIQUE KEY auth_google_sub (google_sub),
 INDEX auth_email (email),
 INDEX auth_last_login (last_login_at,id),
 CONSTRAINT auth_granted_by FOREIGN KEY (admin_granted_by) REFERENCES ts_auth_users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
CREATE TABLE IF NOT EXISTS ts_auth_admin_bindings (
 email VARCHAR(255) NOT NULL PRIMARY KEY,
 user_id BIGINT UNSIGNED NOT NULL,
 google_sub VARCHAR(255) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 created_at DATETIME(3) NOT NULL,
 CONSTRAINT auth_bound_user FOREIGN KEY (user_id) REFERENCES ts_auth_users(id),
 INDEX auth_binding_user (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
CREATE TABLE IF NOT EXISTS ts_auth_sessions (
 token_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
 user_id BIGINT UNSIGNED NOT NULL,
 created_at DATETIME(3) NOT NULL,
 expires_at DATETIME(3) NOT NULL,
 INDEX auth_session_user (user_id),
 INDEX auth_session_expiry (expires_at),
 CONSTRAINT auth_session_owner FOREIGN KEY (user_id) REFERENCES ts_auth_users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
CREATE TABLE IF NOT EXISTS ts_auth_flows (
 binding_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
 state_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 nonce CHAR(43) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 verifier CHAR(43) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 next_path VARCHAR(512) NOT NULL,
 created_at DATETIME(3) NOT NULL,
 expires_at DATETIME(3) NOT NULL,
 INDEX auth_flow_expiry (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
CREATE TABLE IF NOT EXISTS ts_auth_role_audit (
 id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
 user_id BIGINT UNSIGNED NOT NULL,
 actor_id BIGINT UNSIGNED NULL,
 action VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 email VARCHAR(255) NOT NULL,
 created_at DATETIME(3) NOT NULL,
 INDEX auth_audit_user (user_id,id),
 CONSTRAINT auth_audit_target FOREIGN KEY (user_id) REFERENCES ts_auth_users(id),
 CONSTRAINT auth_audit_actor FOREIGN KEY (actor_id) REFERENCES ts_auth_users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
CREATE TRIGGER IF NOT EXISTS ts_auth_role_audit_no_update BEFORE UPDATE ON ts_auth_role_audit FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Auth role audit is append only';
CREATE TRIGGER IF NOT EXISTS ts_auth_role_audit_no_delete BEFORE DELETE ON ts_auth_role_audit FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Auth role audit is append only';
