-- Isolated Compose-only synthetic test database; never production.
CREATE DATABASE IF NOT EXISTS youtube_board_test_rewrite CHARACTER SET utf8mb4 COLLATE utf8mb4_bin;
GRANT ALL PRIVILEGES ON youtube_board_test_rewrite.* TO 'youtube_rewrite'@'%';
