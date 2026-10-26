-- Administrator channel edits: add a channel, change its category tags, create a category (UTC created_at/applied_at).
-- The public web's own-state principal INSERTs a pending request; the youtube-source worker (youtube.channels.admin)
-- applies it to the source tables and records the outcome. Rows are never deleted: the table is the audit trail.
-- Production provisioning: tools/channel-admin-upgrade.mjs.
CREATE TABLE IF NOT EXISTS ts_channel_admin_requests (
 id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
 request_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 kind VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 actor VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 payload VARCHAR(2000) NOT NULL,
 status VARCHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'pending',
 error_code VARCHAR(24) CHARACTER SET ascii COLLATE ascii_bin NULL,
 result VARCHAR(2000) NULL,
 created_at DATETIME NOT NULL,
 applied_at DATETIME NULL,
 UNIQUE INDEX channel_admin_request_id (request_id),
 INDEX channel_admin_status (status,id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
