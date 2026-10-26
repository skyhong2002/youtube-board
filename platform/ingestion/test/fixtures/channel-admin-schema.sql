-- Real table definitions of urt_channel, urt_count, urt_tag, urt_tag_log (production, InnoDB) plus the request table, for ingestion/test/channel-admin-db.test.ts.
CREATE TABLE urt_channel (
  u_id int(11) NOT NULL AUTO_INCREMENT, ctime datetime NOT NULL, mtime datetime DEFAULT NULL, stime datetime DEFAULT NULL, vtime datetime DEFAULT NULL, flag_del int(11) DEFAULT NULL,
  youtube_id varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL, title varchar(256) DEFAULT NULL, etag varchar(32) DEFAULT NULL, customUrl varchar(32) DEFAULT NULL, publishedAt datetime DEFAULT NULL,
  thumbnails varchar(256) DEFAULT NULL, uploads varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL, viewCount bigint(20) DEFAULT NULL, commentCount int(11) DEFAULT NULL, subscriberCount int(11) DEFAULT NULL,
  videoCount int(11) DEFAULT NULL, description text DEFAULT NULL, PRIMARY KEY (u_id), UNIQUE KEY youtube_id (youtube_id)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE urt_count (
  u_id int(11) NOT NULL, ctime datetime NOT NULL, mtime datetime DEFAULT NULL, stime datetime DEFAULT NULL, viewCount bigint(20) DEFAULT NULL, subscriberCount int(11) DEFAULT NULL, videoCount int(11) DEFAULT NULL,
  view_week int(11) DEFAULT NULL, sub_week int(11) DEFAULT NULL, video_week int(11) DEFAULT NULL, view_month int(11) DEFAULT NULL, sub_month int(11) DEFAULT NULL, video_month int(11) DEFAULT NULL,
  tags varchar(100) DEFAULT NULL, views_pred_week int(11) DEFAULT NULL, views_pred_month int(11) DEFAULT NULL, PRIMARY KEY (u_id)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE urt_tag (tag_id int(11) NOT NULL AUTO_INCREMENT, ctime datetime NOT NULL, mtime datetime DEFAULT NULL, tag_name varchar(32) NOT NULL, del_flag tinyint(4) DEFAULT NULL, PRIMARY KEY (tag_id), KEY topic_name (tag_name)) ENGINE=InnoDB AUTO_INCREMENT=115 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE urt_tag_log (pk int(11) NOT NULL AUTO_INCREMENT, ctime datetime NOT NULL, u_id int(11) NOT NULL, tag_id int(11) NOT NULL, log_type varchar(16) NOT NULL, PRIMARY KEY (pk)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
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
