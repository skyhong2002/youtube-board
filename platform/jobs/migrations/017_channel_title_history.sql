-- Observed channel names: one row per name the daily statistics sweep sees change (UTC observed_at).
-- The stats worker appends; the report principal reads. Production provisioning: tools/channel-title-history-upgrade.mjs.
CREATE TABLE IF NOT EXISTS ts_channel_title_history (
 id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
 u_id INT NOT NULL,
 title VARCHAR(256) NOT NULL,
 observed_at DATETIME NOT NULL,
 origin VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 INDEX channel_title_history_lookup (u_id,observed_at,id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
