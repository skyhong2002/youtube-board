-- YouTube WebSub: append-only notices and subscription verifications (UTC received_at).
-- The public web's own-state principal INSERTs; the youtube-source worker (youtube.websub.sync) reads and prunes.
-- Production provisioning: tools/websub-upgrade.mjs.
CREATE TABLE IF NOT EXISTS ts_websub_events (
 id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
 kind VARCHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 channel_id VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 video_id VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NULL,
 lease_seconds INT UNSIGNED NULL,
 received_at DATETIME NOT NULL,
 INDEX websub_events_kind (kind,id),
 INDEX websub_events_age (kind,received_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
