CREATE TABLE IF NOT EXISTS `tag_group` (
  `pk` int(11) NOT NULL AUTO_INCREMENT,
  `ctime` datetime NOT NULL,
  `mtime` datetime DEFAULT NULL,
  `latest_time` datetime NOT NULL,
  `tag` varchar(64) NOT NULL,
  `group_name` varchar(64) NOT NULL,
  `del_flag` varchar(1) DEFAULT NULL,
  PRIMARY KEY (`pk`),
  KEY `tag` (`tag`),
  KEY `group_name` (`group_name`)
) ENGINE=MyISAM DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `tags` (
  `pk` int(11) NOT NULL AUTO_INCREMENT,
  `tag` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL,
  `ctime` datetime NOT NULL,
  `mtime` datetime NOT NULL,
  `max_count` int(11) NOT NULL,
  `hours_count` int(11) NOT NULL,
  `max_hours` datetime NOT NULL,
  `no_tag` tinyint(4) DEFAULT NULL,
  PRIMARY KEY (`pk`),
  KEY `tag` (`tag`)
) ENGINE=MyISAM DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS `urt_ai_date` (
  `pk` int(11) NOT NULL AUTO_INCREMENT,
  `ctime` datetime NOT NULL,
  `mtime` datetime DEFAULT NULL,
  `date_from` datetime NOT NULL,
  `date_to` datetime NOT NULL,
  `ai_type` varchar(32) CHARACTER SET utf8mb4 NOT NULL,
  `data_type` varchar(16) CHARACTER SET utf8mb4 NOT NULL,
  `condition_type` varchar(32) CHARACTER SET utf8mb4 DEFAULT NULL,
  `user_token` varchar(32) CHARACTER SET utf8mb4 NOT NULL,
  `del_flag` int(11) DEFAULT NULL,
  `channel_id` text CHARACTER SET utf8mb4 NOT NULL,
  `result_json` text CHARACTER SET utf8mb4 NOT NULL,
  `data_json` text COLLATE utf8mb4_unicode_ci,
  `video_json` longtext CHARACTER SET utf8mb4,
  PRIMARY KEY (`pk`),
  KEY `date_from` (`date_from`),
  KEY `data_type` (`data_type`),
  KEY `condition_type` (`condition_type`),
  KEY `date_to` (`date_to`)
) ENGINE=MyISAM DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `urt_ai_event` (
  `pk` int(11) NOT NULL AUTO_INCREMENT,
  `ctime` datetime NOT NULL,
  `mtime` datetime DEFAULT NULL,
  `date_from` datetime NOT NULL,
  `date_to` datetime NOT NULL,
  `aipk` int(11) NOT NULL,
  `event_name` varchar(128) COLLATE utf8mb4_unicode_ci NOT NULL,
  `ai_type` varchar(32) CHARACTER SET utf8mb4 NOT NULL,
  `data_type` varchar(16) CHARACTER SET utf8mb4 NOT NULL,
  `condition_type` varchar(32) CHARACTER SET utf8mb4 DEFAULT NULL,
  `prompt_type` varchar(32) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `user_token` varchar(32) CHARACTER SET utf8mb4 NOT NULL,
  `del_flag` int(11) DEFAULT NULL,
  `channel_id` text CHARACTER SET utf8mb4,
  `result_json` text CHARACTER SET utf8mb4 NOT NULL,
  `data_json` text COLLATE utf8mb4_unicode_ci,
  PRIMARY KEY (`pk`),
  KEY `data_type` (`data_type`),
  KEY `condition_type` (`condition_type`)
) ENGINE=MyISAM DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `urt_ai_hour` (
  `pk` int(11) NOT NULL AUTO_INCREMENT,
  `ctime` datetime NOT NULL,
  `mtime` datetime DEFAULT NULL,
  `date_from` datetime DEFAULT NULL,
  `date_to` datetime DEFAULT NULL,
  `condition_type` varchar(32) NOT NULL,
  `ai_type` varchar(16) NOT NULL,
  `data_type` varchar(16) NOT NULL,
  `user_token` varchar(32) NOT NULL,
  `del_flag` int(11) DEFAULT NULL,
  `result_json` text NOT NULL,
  PRIMARY KEY (`pk`)
) ENGINE=MyISAM DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `urt_ai_period` (
  `pk` int(11) NOT NULL AUTO_INCREMENT,
  `ctime` datetime NOT NULL,
  `mtime` datetime DEFAULT NULL,
  `date_from` date NOT NULL,
  `date_to` date NOT NULL,
  `ai_type` varchar(16) NOT NULL,
  `data_type` varchar(16) NOT NULL,
  `condition_type` varchar(32) DEFAULT NULL,
  `user_token` varchar(32) NOT NULL,
  `del_flag` int(11) DEFAULT NULL,
  `days` int(11) DEFAULT NULL,
  `data_json` text NOT NULL,
  `result_json` text NOT NULL,
  PRIMARY KEY (`pk`),
  KEY `data_type` (`data_type`)
) ENGINE=MyISAM DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `urt_channel` (
  `u_id` int(11) NOT NULL AUTO_INCREMENT,
  `ctime` datetime NOT NULL,
  `mtime` datetime DEFAULT NULL,
  `stime` datetime DEFAULT NULL,
  `vtime` datetime DEFAULT NULL,
  `flag_del` int(11) DEFAULT NULL,
  `youtube_id` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  `title` varchar(256) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `etag` varchar(32) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `customUrl` varchar(32) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `publishedAt` datetime DEFAULT NULL,
  `thumbnails` varchar(256) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `uploads` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL,
  `viewCount` bigint(20) DEFAULT NULL,
  `commentCount` int(11) DEFAULT NULL,
  `subscriberCount` int(11) DEFAULT NULL,
  `videoCount` int(11) DEFAULT NULL,
  `description` text COLLATE utf8mb4_unicode_ci,
  PRIMARY KEY (`u_id`),
  UNIQUE KEY `youtube_id` (`youtube_id`),
  KEY `viewCount` (`viewCount`),
  KEY `subscriberCount` (`subscriberCount`),
  KEY `videoCount` (`videoCount`),
  KEY `stime` (`stime`),
  KEY `vtime` (`vtime`)
) ENGINE=MyISAM DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `urt_channel_ai` (
  `pk` int(11) NOT NULL AUTO_INCREMENT,
  `u_id` int(11) NOT NULL,
  `ctime` datetime NOT NULL,
  `mtime` datetime DEFAULT NULL,
  `date_from` datetime DEFAULT NULL,
  `date_to` datetime DEFAULT NULL,
  `ai_type` varchar(16) NOT NULL,
  `data_type` varchar(16) NOT NULL,
  `user_token` varchar(32) NOT NULL,
  `del_flag` int(11) DEFAULT NULL,
  `result_json` text NOT NULL,
  PRIMARY KEY (`pk`),
  KEY `u_id` (`u_id`)
) ENGINE=MyISAM DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `urt_channel_history` (
  `pk` int(11) NOT NULL AUTO_INCREMENT,
  `u_id` int(11) NOT NULL,
  `ctime` datetime NOT NULL,
  `youtube_id` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  `title` varchar(256) NOT NULL,
  `thumbnails` varchar(256) NOT NULL,
  `description` text NOT NULL,
  PRIMARY KEY (`pk`),
  KEY `u_id` (`u_id`)
) ENGINE=MyISAM DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `urt_comment` (
  `pk` int(11) NOT NULL AUTO_INCREMENT,
  `videoId` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  `ctime` datetime NOT NULL,
  `mtime` datetime DEFAULT NULL,
  `stime` datetime DEFAULT NULL,
  `comments_count` int(11) DEFAULT NULL,
  `latest_time` datetime DEFAULT NULL,
  `likes_count` int(11) DEFAULT NULL,
  `threads_count` int(11) DEFAULT NULL,
  `replies_count` int(11) DEFAULT NULL,
  `authors_count` int(11) DEFAULT NULL,
  `pageToken` varchar(256) DEFAULT NULL,
  `channelId` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL,
  `u_id` int(11) DEFAULT NULL,
  `authors_json` longtext,
  `comments_json` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  PRIMARY KEY (`pk`),
  UNIQUE KEY `videoId` (`videoId`)
) ENGINE=MyISAM DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `urt_comment_author` (
  `author_id` int(11) NOT NULL AUTO_INCREMENT,
  `ctime` datetime NOT NULL,
  `mtime` datetime DEFAULT NULL,
  `ChannelId` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  `ChannelUrl` varchar(256) NOT NULL,
  `ImageUrl` varchar(512) NOT NULL,
  `DisplayName` varchar(32) NOT NULL,
  PRIMARY KEY (`author_id`),
  KEY `ChannelId` (`ChannelId`)
) ENGINE=MyISAM DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `urt_comment_queue` (
  `pk` int(11) NOT NULL AUTO_INCREMENT,
  `ctime` datetime NOT NULL,
  `stime` datetime DEFAULT NULL,
  `ftime` datetime DEFAULT NULL,
  `videoId` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  PRIMARY KEY (`pk`)
) ENGINE=MyISAM DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `urt_comment_queue_done` (
  `pk` int(11) NOT NULL,
  `ctime` datetime NOT NULL,
  `stime` datetime DEFAULT NULL,
  `ftime` datetime DEFAULT NULL,
  `videoId` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  PRIMARY KEY (`pk`)
) ENGINE=MyISAM DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `urt_comment_rev` (
  `author_id` int(11) NOT NULL,
  `ctime` datetime NOT NULL,
  `mtime` datetime DEFAULT NULL,
  `comments` int(11) DEFAULT NULL,
  `videos` int(11) DEFAULT NULL,
  `index_json` longtext,
  PRIMARY KEY (`author_id`)
) ENGINE=MyISAM DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `urt_count` (
  `u_id` int(11) NOT NULL,
  `ctime` datetime NOT NULL,
  `mtime` datetime DEFAULT NULL,
  `stime` datetime DEFAULT NULL,
  `viewCount` bigint(20) DEFAULT NULL,
  `subscriberCount` int(11) DEFAULT NULL,
  `videoCount` int(11) DEFAULT NULL,
  `view_week` int(11) DEFAULT NULL,
  `sub_week` int(11) DEFAULT NULL,
  `video_week` int(11) DEFAULT NULL,
  `view_month` int(11) DEFAULT NULL,
  `sub_month` int(11) DEFAULT NULL,
  `video_month` int(11) DEFAULT NULL,
  `tags` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `views_pred_week` int(11) DEFAULT NULL,
  `views_pred_month` int(11) DEFAULT NULL,
  PRIMARY KEY (`u_id`),
  KEY `view_week` (`view_week`),
  KEY `tags` (`tags`)
) ENGINE=MyISAM DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `urt_log` (
  `pk` int(11) NOT NULL AUTO_INCREMENT,
  `u_id` int(11) NOT NULL,
  `ctime` datetime NOT NULL,
  `mtime` datetime DEFAULT NULL,
  `themonth` date NOT NULL,
  `thedata` text COLLATE utf8mb4_unicode_ci,
  PRIMARY KEY (`pk`),
  UNIQUE KEY `fpid` (`u_id`,`themonth`)
) ENGINE=MyISAM DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `urt_log_api` (
  `pk` int(11) NOT NULL AUTO_INCREMENT,
  `ctime` datetime NOT NULL,
  `created_time` datetime NOT NULL,
  `api_type` varchar(32) NOT NULL,
  `api_key` varchar(32) NOT NULL,
  `token` varchar(64) NOT NULL,
  PRIMARY KEY (`pk`)
) ENGINE=MyISAM DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `urt_log_tag` (
  `pk` int(11) NOT NULL AUTO_INCREMENT,
  `ctime` datetime NOT NULL,
  `mtime` datetime NOT NULL,
  `tag` varchar(64) NOT NULL,
  `group_condition` varchar(64) NOT NULL,
  `hits` int(11) NOT NULL,
  PRIMARY KEY (`pk`),
  KEY `ctime` (`ctime`,`mtime`,`tag`,`group_condition`)
) ENGINE=MyISAM DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `urt_show_cloud` (
  `pk` int(11) NOT NULL AUTO_INCREMENT,
  `u_id` int(11) NOT NULL,
  `ctime` datetime NOT NULL,
  `mtime` datetime NOT NULL,
  `days` int(11) NOT NULL,
  `keywords_json` longtext COLLATE utf8mb4_unicode_ci NOT NULL,
  PRIMARY KEY (`pk`),
  KEY `fpid` (`u_id`),
  KEY `days` (`days`)
) ENGINE=MyISAM DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `urt_show_data` (
  `pk` int(11) NOT NULL AUTO_INCREMENT,
  `ctime` datetime NOT NULL,
  `mtime` datetime DEFAULT NULL,
  `stime` datetime DEFAULT NULL,
  `data_name` varchar(16) NOT NULL,
  `api` varchar(64) DEFAULT NULL,
  `para` varchar(64) DEFAULT NULL,
  `the_result` longtext,
  PRIMARY KEY (`pk`),
  KEY `data_name` (`data_name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `urt_show_live_date` (
  `pk` int(11) NOT NULL AUTO_INCREMENT,
  `ctime` datetime NOT NULL,
  `mtime` datetime DEFAULT NULL,
  `the_date` date NOT NULL,
  `return_json` longtext,
  PRIMARY KEY (`pk`)
) ENGINE=MyISAM DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `urt_show_live_tag_date` (
  `pk` int(11) NOT NULL AUTO_INCREMENT,
  `ctime` datetime NOT NULL,
  `mtime` datetime DEFAULT NULL,
  `stime` datetime DEFAULT NULL,
  `tagid` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `tag_or` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `tag_not` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `count_channels` int(11) DEFAULT NULL,
  `count_videos` int(11) DEFAULT NULL,
  `count_tags` int(11) DEFAULT NULL,
  `the_date` date NOT NULL,
  `tags_count` int(11) DEFAULT NULL,
  `total_views` int(11) DEFAULT NULL,
  `hour_result` text COLLATE utf8mb4_unicode_ci,
  `videos_result` text COLLATE utf8mb4_unicode_ci,
  `all_result` longtext COLLATE utf8mb4_unicode_ci,
  `tags_video` longtext COLLATE utf8mb4_unicode_ci,
  `tags_views` longtext COLLATE utf8mb4_unicode_ci,
  PRIMARY KEY (`pk`),
  KEY `tagid` (`tagid`,`tag_or`,`tag_not`),
  KEY `tags_count` (`tags_count`),
  KEY `the_date` (`the_date`)
) ENGINE=MyISAM DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `urt_show_photo` (
  `pk` int(11) NOT NULL AUTO_INCREMENT,
  `ctime` datetime NOT NULL,
  `mtime` datetime DEFAULT NULL,
  `tag` varchar(32) NOT NULL,
  `image_url` varchar(256) NOT NULL,
  `image_source` varchar(32) DEFAULT NULL,
  PRIMARY KEY (`pk`),
  KEY `tag` (`tag`)
) ENGINE=MyISAM DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `urt_show_tag_cloud` (
  `pk` int(11) NOT NULL AUTO_INCREMENT,
  `ctime` datetime NOT NULL,
  `mtime` datetime DEFAULT NULL,
  `tagid` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `tag_or` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `tag_not` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `count_channels` int(11) DEFAULT NULL,
  `count_videos` int(11) DEFAULT NULL,
  `count_tags` int(11) DEFAULT NULL,
  `days` int(11) NOT NULL,
  `tags_count` int(11) DEFAULT NULL,
  `tags_result` longtext COLLATE utf8mb4_unicode_ci,
  PRIMARY KEY (`pk`),
  KEY `tagid` (`tagid`,`tag_or`,`tag_not`),
  KEY `tags_count` (`tags_count`),
  KEY `days` (`days`)
) ENGINE=MyISAM DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `urt_show_tag_cloud_tag` (
  `pk` int(11) NOT NULL AUTO_INCREMENT,
  `ctime` datetime NOT NULL,
  `mtime` datetime DEFAULT NULL,
  `tag` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL,
  `tagid` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `tag_or` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `tag_not` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `count_channels` int(11) DEFAULT NULL,
  `count_videos` int(11) DEFAULT NULL,
  `count_tags` int(11) DEFAULT NULL,
  `days` int(11) NOT NULL,
  `tags_count` int(11) DEFAULT NULL,
  `tags_result` longtext COLLATE utf8mb4_unicode_ci,
  `videos_json` longtext COLLATE utf8mb4_unicode_ci,
  PRIMARY KEY (`pk`),
  KEY `tagid` (`tagid`,`tag_or`,`tag_not`),
  KEY `tags_count` (`tags_count`),
  KEY `days` (`days`),
  KEY `tag` (`tag`)
) ENGINE=MyISAM DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `urt_show_tag_date` (
  `pk` int(11) NOT NULL AUTO_INCREMENT,
  `ctime` datetime NOT NULL,
  `mtime` datetime DEFAULT NULL,
  `stime` datetime DEFAULT NULL,
  `tagid` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `tag_or` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `tag_not` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `count_channels` int(11) DEFAULT NULL,
  `count_videos` int(11) DEFAULT NULL,
  `count_tags` int(11) DEFAULT NULL,
  `the_date` date NOT NULL,
  `tags_count` int(11) DEFAULT NULL,
  `total_views` int(11) DEFAULT NULL,
  `tags_result` longtext COLLATE utf8mb4_unicode_ci,
  `tags_video` longtext COLLATE utf8mb4_unicode_ci,
  `tags_views` longtext COLLATE utf8mb4_unicode_ci,
  PRIMARY KEY (`pk`),
  KEY `tagid` (`tagid`,`tag_or`,`tag_not`),
  KEY `tags_count` (`tags_count`),
  KEY `the_date` (`the_date`)
) ENGINE=MyISAM DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `urt_show_tag_month` (
  `pk` int(11) NOT NULL AUTO_INCREMENT,
  `ctime` datetime NOT NULL,
  `mtime` datetime DEFAULT NULL,
  `tag` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL,
  `tagid` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `tag_or` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `tag_not` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `the_month` date NOT NULL,
  `count_videos` int(11) DEFAULT NULL,
  `total_views` int(11) DEFAULT NULL,
  `tags_result` longtext COLLATE utf8mb4_unicode_ci,
  PRIMARY KEY (`pk`),
  KEY `tagid` (`tagid`,`tag_or`,`tag_not`),
  KEY `tag` (`tag`),
  KEY `the_month` (`the_month`)
) ENGINE=MyISAM DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `urt_show_topic` (
  `pk` int(11) NOT NULL AUTO_INCREMENT,
  `ctime` datetime NOT NULL,
  `mtime` datetime DEFAULT NULL,
  `stime` datetime DEFAULT NULL,
  `count_channels` int(11) DEFAULT NULL,
  `count_videos` int(11) DEFAULT NULL,
  `count_tags` int(11) DEFAULT NULL,
  `the_date` date NOT NULL,
  `topic` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL,
  `tags_count` int(11) DEFAULT NULL,
  `total_views` int(11) DEFAULT NULL,
  `tags_result` longtext COLLATE utf8mb4_unicode_ci,
  `tags_video` longtext COLLATE utf8mb4_unicode_ci,
  `tags_views` longtext COLLATE utf8mb4_unicode_ci,
  PRIMARY KEY (`pk`),
  KEY `the_date` (`the_date`),
  KEY `topic` (`topic`)
) ENGINE=MyISAM DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `urt_show_video_live` (
  `pk_live` int(11) NOT NULL,
  `v_pk` int(11) NOT NULL,
  `ctime` datetime NOT NULL,
  `mtime` datetime DEFAULT NULL,
  `videoId` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  `u_id` int(11) NOT NULL,
  `publishedAt` datetime NOT NULL,
  `channelId` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  `channelTitle` varchar(256) NOT NULL,
  `title` varchar(512) NOT NULL,
  `thumbnails` varchar(256) NOT NULL,
  `description` text NOT NULL,
  PRIMARY KEY (`pk_live`),
  KEY `videoId` (`videoId`),
  KEY `u_id` (`u_id`),
  KEY `publishedAt` (`publishedAt`)
) ENGINE=MyISAM DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `urt_show_video_tag` (
  `pk_video` int(11) NOT NULL,
  `ctime` datetime NOT NULL,
  `mtime` datetime DEFAULT NULL,
  `publishedAt` datetime DEFAULT NULL,
  `u_id` int(11) NOT NULL,
  `videoId` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  `tags_num` int(11) DEFAULT NULL,
  `tags_count` int(11) DEFAULT NULL,
  `tags_json` text,
  PRIMARY KEY (`pk_video`),
  KEY `publishedAt` (`publishedAt`),
  KEY `videoId` (`videoId`)
) ENGINE=MyISAM DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `urt_show_video_tag_date` (
  `pk` int(11) NOT NULL AUTO_INCREMENT,
  `ctime` datetime NOT NULL,
  `mtime` datetime DEFAULT NULL,
  `the_date` date NOT NULL,
  `tag` varchar(64) NOT NULL,
  `count_videos` int(11) DEFAULT NULL,
  `count_tags` int(11) DEFAULT NULL,
  `count_channels` int(11) DEFAULT NULL,
  `videos_json` text,
  `tags_json` text,
  PRIMARY KEY (`pk`),
  KEY `the_date` (`the_date`),
  KEY `tag` (`tag`)
) ENGINE=MyISAM DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `urt_show_video_tag_title` (
  `pk_video` int(11) NOT NULL,
  `ctime` datetime NOT NULL,
  `mtime` datetime DEFAULT NULL,
  `publishedAt` datetime DEFAULT NULL,
  `u_id` int(11) NOT NULL,
  `videoId` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  `tags_num` int(11) DEFAULT NULL,
  `tags_count` int(11) DEFAULT NULL,
  `tags_json` text,
  PRIMARY KEY (`pk_video`),
  KEY `publishedAt` (`publishedAt`),
  KEY `videoId` (`videoId`)
) ENGINE=MyISAM DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `urt_show_video_time` (
  `pk_video` int(11) NOT NULL,
  `ctime` datetime NOT NULL,
  `mtime` datetime DEFAULT NULL,
  `publishedAt` datetime DEFAULT NULL,
  `u_id` int(11) NOT NULL,
  `videoId` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  PRIMARY KEY (`pk_video`),
  KEY `publishedAt` (`publishedAt`),
  KEY `videoId` (`videoId`)
) ENGINE=MyISAM DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `urt_tag` (
  `tag_id` int(11) NOT NULL AUTO_INCREMENT,
  `ctime` datetime NOT NULL,
  `mtime` datetime DEFAULT NULL,
  `tag_name` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL,
  `del_flag` tinyint(4) DEFAULT NULL,
  PRIMARY KEY (`tag_id`),
  KEY `topic_name` (`tag_name`)
) ENGINE=MyISAM DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `urt_tag_log` (
  `pk` int(11) NOT NULL AUTO_INCREMENT,
  `ctime` datetime NOT NULL,
  `u_id` int(11) NOT NULL,
  `tag_id` int(11) NOT NULL,
  `log_type` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL,
  PRIMARY KEY (`pk`)
) ENGINE=MyISAM DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `urt_user` (
  `pk` int(11) NOT NULL AUTO_INCREMENT,
  `id` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL,
  `ctime` datetime NOT NULL,
  `mtime` datetime DEFAULT NULL,
  `given_name` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL,
  `family_name` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL,
  `picture` varchar(256) COLLATE utf8mb4_unicode_ci NOT NULL,
  `alias` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `locale` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL,
  `access_token` varchar(256) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `expires_in` datetime DEFAULT NULL,
  `refresh_token` varchar(256) COLLATE utf8mb4_unicode_ci NOT NULL,
  `code_return` text COLLATE utf8mb4_unicode_ci,
  PRIMARY KEY (`pk`)
) ENGINE=MyISAM DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `urt_user_channel` (
  `pk` int(11) NOT NULL AUTO_INCREMENT,
  `ctime` datetime NOT NULL,
  `mtime` datetime DEFAULT NULL,
  `picture` varchar(256) DEFAULT NULL,
  `channel` varchar(24) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  `channel_name` varchar(256) NOT NULL,
  PRIMARY KEY (`pk`),
  UNIQUE KEY `channel` (`channel`)
) ENGINE=MyISAM DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `urt_user_log` (
  `urt_pk` int(11) NOT NULL,
  `ctime` datetime NOT NULL,
  `mtime` datetime DEFAULT NULL,
  `views_count` int(11) DEFAULT NULL,
  `channels_count` int(11) DEFAULT NULL,
  `videos_count` int(11) DEFAULT NULL,
  `data_json` longtext,
  PRIMARY KEY (`urt_pk`)
) ENGINE=MyISAM DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `urt_user_video` (
  `pk` int(11) NOT NULL AUTO_INCREMENT,
  `videoId` varchar(15) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  `ctime` datetime NOT NULL,
  `mtime` datetime DEFAULT NULL,
  `title` varchar(256) NOT NULL,
  `channel` varchar(24) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  `channel_name` varchar(256) NOT NULL,
  PRIMARY KEY (`pk`),
  UNIQUE KEY `videoId` (`videoId`),
  KEY `channel` (`channel`)
) ENGINE=MyISAM DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `urt_video` (
  `pk` int(11) NOT NULL AUTO_INCREMENT,
  `ctime` datetime NOT NULL,
  `mtime` datetime DEFAULT NULL,
  `stime` datetime DEFAULT NULL,
  `u_id` int(11) NOT NULL,
  `id` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  `publishedAt` datetime NOT NULL,
  `channelId` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  `title` varchar(512) COLLATE utf8mb4_unicode_ci NOT NULL,
  `thumbnails` varchar(256) COLLATE utf8mb4_unicode_ci NOT NULL,
  `channelTitle` varchar(256) COLLATE utf8mb4_unicode_ci NOT NULL,
  `playlistId` varchar(40) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  `position` int(11) NOT NULL,
  `videoId` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  `viewCount` bigint(20) DEFAULT NULL,
  `likeCount` int(11) DEFAULT NULL,
  `dislikeCount` int(11) DEFAULT NULL,
  `favoriteCount` int(11) DEFAULT NULL,
  `commentCount` int(11) DEFAULT NULL,
  `description` text COLLATE utf8mb4_unicode_ci NOT NULL,
  PRIMARY KEY (`pk`),
  UNIQUE KEY `videoId` (`videoId`),
  KEY `stime` (`stime`),
  KEY `publishedAt` (`publishedAt`),
  KEY `viewCount` (`viewCount`),
  KEY `likeCount` (`likeCount`),
  KEY `dislikeCount` (`dislikeCount`),
  KEY `commentCount` (`commentCount`),
  KEY `u_id` (`u_id`),
  KEY `mtime` (`mtime`)
) ENGINE=MyISAM DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `urt_video_details` (
  `pk_video` int(11) NOT NULL,
  `ctime` datetime NOT NULL,
  `mtime` datetime DEFAULT NULL,
  `publishedAt` datetime DEFAULT NULL,
  `u_id` int(11) NOT NULL,
  `videoId` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  `duration` varchar(32) DEFAULT NULL,
  `categoryId` int(11) DEFAULT NULL,
  `liveBroadcastContent` varchar(16) DEFAULT NULL,
  `localized` text,
  `tags` text,
  PRIMARY KEY (`pk_video`),
  KEY `publishedAt` (`publishedAt`),
  KEY `videoId` (`videoId`)
) ENGINE=MyISAM DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `urt_video_duration` (
  `pk_video` int(11) NOT NULL AUTO_INCREMENT,
  `ctime` datetime NOT NULL,
  `mtime` datetime DEFAULT NULL,
  `stime` datetime DEFAULT NULL,
  `publishedAt` datetime DEFAULT NULL,
  `u_id` int(11) DEFAULT NULL,
  `videoId` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  `duration` int(11) DEFAULT NULL,
  `caption` varchar(10) DEFAULT NULL,
  PRIMARY KEY (`pk_video`),
  KEY `publishedAt` (`publishedAt`),
  KEY `videoId` (`videoId`)
) ENGINE=MyISAM DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `urt_video_live` (
  `pk` int(11) NOT NULL AUTO_INCREMENT,
  `ctime` datetime NOT NULL,
  `mtime` datetime DEFAULT NULL,
  `publishedAt` datetime NOT NULL,
  `videoId` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  `u_id` int(11) NOT NULL,
  `actualStartTime` datetime DEFAULT NULL,
  `scheduledStartTime` datetime DEFAULT NULL,
  `concurrentViewers` int(11) DEFAULT NULL,
  `actualEndTime` datetime DEFAULT NULL,
  `activeLiveChatId` varchar(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL,
  `max_current` int(11) DEFAULT NULL,
  `del_flag` tinyint(4) DEFAULT NULL,
  PRIMARY KEY (`pk`),
  UNIQUE KEY `videoId` (`videoId`),
  KEY `u_id` (`u_id`),
  KEY `mtime` (`mtime`)
) ENGINE=MyISAM DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `urt_video_live_log` (
  `pk` int(11) NOT NULL AUTO_INCREMENT,
  `videoId` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  `u_id` int(11) DEFAULT NULL,
  `the_date` date NOT NULL,
  `ctime` datetime NOT NULL,
  `mtime` datetime DEFAULT NULL,
  `max_current` int(11) DEFAULT NULL,
  `log_json` text,
  PRIMARY KEY (`pk`),
  KEY `videoId` (`videoId`),
  KEY `the_date` (`the_date`)
) ENGINE=MyISAM DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `urt_video_live_log_tvbs` (
  `pk` int(11) NOT NULL AUTO_INCREMENT,
  `videoId` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  `u_id` int(11) DEFAULT NULL,
  `the_date` date NOT NULL,
  `ctime` datetime NOT NULL,
  `mtime` datetime DEFAULT NULL,
  `max_current` int(11) DEFAULT NULL,
  `log_json` text,
  PRIMARY KEY (`pk`),
  KEY `videoId` (`videoId`),
  KEY `the_date` (`the_date`)
) ENGINE=MyISAM DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `urt_video_live_tvbs` (
  `pk` int(11) NOT NULL AUTO_INCREMENT,
  `ctime` datetime NOT NULL,
  `mtime` datetime DEFAULT NULL,
  `publishedAt` datetime NOT NULL,
  `videoId` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  `u_id` int(11) NOT NULL,
  `actualStartTime` datetime DEFAULT NULL,
  `scheduledStartTime` datetime DEFAULT NULL,
  `concurrentViewers` int(11) DEFAULT NULL,
  `actualEndTime` datetime DEFAULT NULL,
  `activeLiveChatId` varchar(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL,
  `max_current` int(11) DEFAULT NULL,
  `del_flag` tinyint(4) DEFAULT NULL,
  PRIMARY KEY (`pk`),
  UNIQUE KEY `videoId` (`videoId`),
  KEY `u_id` (`u_id`),
  KEY `mtime` (`mtime`)
) ENGINE=MyISAM DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `urt_video_log` (
  `pk` int(11) NOT NULL AUTO_INCREMENT,
  `ctime` datetime NOT NULL,
  `mtime` datetime DEFAULT NULL,
  `videoId` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  `themonth` date NOT NULL,
  `thedata` text COLLATE utf8mb4_unicode_ci,
  PRIMARY KEY (`pk`),
  UNIQUE KEY `videoId` (`videoId`,`themonth`)
) ENGINE=MyISAM DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `urt_video_log_history` (
  `pk` int(11) NOT NULL AUTO_INCREMENT,
  `ctime` datetime NOT NULL,
  `videoId` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  `viewCount` int(11) NOT NULL,
  `likeCount` int(11) NOT NULL,
  `dislikeCount` int(11) NOT NULL,
  `favoriteCount` int(11) NOT NULL,
  `commentCount` int(11) NOT NULL,
  PRIMARY KEY (`pk`),
  KEY `videoId` (`videoId`)
) ENGINE=MyISAM DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `urt_video_schedule` (
  `pk` int(11) NOT NULL AUTO_INCREMENT,
  `ctime` datetime NOT NULL,
  `mtime` datetime DEFAULT NULL,
  `stime` datetime DEFAULT NULL,
  `videoId` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  `publishedAt` datetime NOT NULL,
  `viewCount` int(11) DEFAULT NULL,
  `likeCount` int(11) DEFAULT NULL,
  `commentCount` int(11) DEFAULT NULL,
  PRIMARY KEY (`pk`),
  UNIQUE KEY `videoId` (`videoId`),
  KEY `stime` (`stime`),
  KEY `publishedAt` (`publishedAt`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `urt_video_schedule_myisam` (
  `pk` int(11) NOT NULL AUTO_INCREMENT,
  `ctime` datetime NOT NULL,
  `mtime` datetime DEFAULT NULL,
  `stime` datetime DEFAULT NULL,
  `videoId` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  `publishedAt` datetime NOT NULL,
  `viewCount` int(11) DEFAULT NULL,
  `likeCount` int(11) DEFAULT NULL,
  `commentCount` int(11) DEFAULT NULL,
  PRIMARY KEY (`pk`),
  UNIQUE KEY `videoId` (`videoId`),
  KEY `stime` (`stime`),
  KEY `publishedAt` (`publishedAt`)
) ENGINE=MyISAM DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
