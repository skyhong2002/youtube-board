-- Last successful homepage keyword windows (public ranking data), one row, written by the web own-state principal
-- so a restarted web process starts warm. Production provisioning: tools/home-keyword-snapshot-upgrade.mjs.
CREATE TABLE IF NOT EXISTS ts_home_keyword_snapshot (
 id TINYINT UNSIGNED NOT NULL PRIMARY KEY,
 computed_at_ms BIGINT UNSIGNED NOT NULL,
 payload LONGTEXT NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
