# youtube_board 舊表 MyISAM → InnoDB（2026-10-25）

對應 issue #8。`youtube_board` 的 48 張舊表（約 2.0 GiB，其中 `urt_video` 約 760k 列、1.2 GiB）是 MyISAM，
`youtube_board_ts*` 的 view 都讀這些表。MyISAM 只有表鎖，worker 寫 `urt_video` 時，web 的讀取會排在後面，
撞上 `max_statement_time=5`。

## 事前檢查（唯讀）

- MyISAM 表上沒有 FULLTEXT／SPATIAL 索引，也沒有 trigger；所有 AUTO_INCREMENT 都是 PRIMARY KEY 的第一欄
  （沒有 MyISAM 專屬的複合自增）。
- 程式不依賴 MyISAM：沒有 `LOCK TABLES`／`DELAYED`；`beginTransaction` 內只寫 `ts_*`（本來就是 InnoDB），
  舊表只在交易外讀。唯一的引擎斷言在 `tools/worker-schema-db.test.mjs`。
- `f2-backup-tools-v40` 的 `ts-only-snapshot.py` 只檢查 `youtube_board_ts` 的引擎，不受影響。
- 磁碟剩 82 GB。MariaDB 11.4、`innodb_file_per_table=ON`、`innodb_flush_method=O_DIRECT`、`log_bin=OFF`。

## 程式（main `800407d`，不需要 release）

- `migrations/000-legacy-dashboard-baseline.sql` 的 48 個 `ENGINE=MyISAM` 改為 InnoDB，與正式環境一致。
- worker facade 測試改為斷言 `urt_video` 是 InnoDB；ingestion 測試的 MyISAM 字樣與暫存表引擎一併更新。
- 本機 `youtube_board_test_rewrite` 的 50 張 MyISAM 表也已 `ALTER … ENGINE=InnoDB`（bootstrap 是
  `CREATE TABLE IF NOT EXISTS`，不會自己改）。整合測試：tools 112/112、api 等 147 檔全過；jobs 有 2 個失敗
  （`media-cli-db`、`video-evidence` 的 cursor 斷言），改回 MyISAM 也一樣失敗，是本機測試庫的既有殘留資料，與此次無關。
- 未篩選的 `SELECT COUNT(*) FROM urt_video` 在 InnoDB 走 `u_id` 索引，安靜時 0.12–0.15 s，負載下平均 0.78 s，
  都低於 5 s 上限，所以轉換不需要先 release；快取總數列在待辦。

## 維護（skyhong-blog，UTC 2026-10-24）

腳本 `/home/ubuntu/yt-innodb-maint.sh`（phase：status／pause／backup／convert-small／convert-big／resume），
紀錄 `/home/ubuntu/yt-innodb-20261025/maint.log`。

| 時間（UTC） | 步驟 |
|---|---|
| 15:28:34 | 開 slow log 作基準：`long_query_time=0.5`、`log_slow_verbosity=query_plan,explain`，檔案 `baseline-20261024-slow.log` |
| 16:15:30 | 停 3 個 systemd timer（recent／avatars／warm），`scheduler` 與 7 個 `worker-*` scale 到 0（SIGTERM，graceful 5 m）；10 秒內全部退出 |
| 16:15:54–16:19:34 | 停寫後 `mariadb-dump --single-transaction --routines --triggers --events youtube_board`，658 MB gzip，`gzip -t` 與 SHA256SUMS：`/home/ubuntu/backups/services/20261024T161554Z-pre-innodb/` |
| 16:19:40–16:21:21 | 47 張小表 `ALTER TABLE … ENGINE=InnoDB`，最久 `urt_video_log` 17 s；load 一度 15 |
| 16:23:10–16:26:03 | 等 load < 4 後轉 `urt_video`，173 s；`ANALYZE TABLE urt_video` |
| 16:26:32 | slow log 換到 `after-innodb-20261025-slow.log`；worker／scheduler scale 回 1，timer 重新啟動；16:27:01 全部 1/1 healthy |

- worker 停了約 11 分鐘。轉換後 `youtube_board` 66 張表全是 InnoDB（3.0 GiB），`urt_video` 766,785 列與轉換前相同。
- 恢復後：worker 連線的 grant／facade 檢查通過；`youtube.live.poll` 16:32 completed；recent matcher `up-to-date`；
  scheduler 只有停機中 16:25 那次 live poll 報了一次 `schedule-attention`，之後都 healthy。
- 轉換期間 web 在 16:25:30–16:26:01（`urt_video` 換表）有幾次 5 s 逾時與 pool 排隊，之後恢復。

## 轉換後量測

恢復後每 5 分鐘取樣（`Innodb_buffer_pool_reads`、暫存表、表鎖、web `"context":"request"` 失敗）：

| 結束時間（UTC） | buffer pool 磁碟讀 | 暫存表落盤 | q/s | `Table_locks_waited` | web request 失敗 | load |
|---|---|---|---|---|---|---|
| 16:41 | 17/s | 18% | 36 | +0 | 0 | 1.05 |
| 16:46 | 222/s | 25% | 41 | +0 | 0 | 3.84 |
| 16:51 | 183/s | 20% | 41 | +0 | 0 | 3.07 |
| 16:56 | 45/s | 19% | 40 | +0 | 0 | 2.12 |
| 17:01 | 357/s | 22% | 45 | +0 | 0 | 5.63 |

- `Table_locks_waited` 停在 85,251（基準期 47 分鐘 +402）；`Innodb_row_lock_waits` 仍是 1。
- 暫存表落盤 18–25%，轉換前累計是 49%。
- web request 失敗：轉換前 15:00–16:15 共 9 次；恢復後 16:27–17:02 共 2 次，都在 16:31 worker 補進度時。
- buffer pool 磁碟讀從長期平均約 4/s 變成 17–357/s。InnoDB 是 O_DIRECT，原本快取 MyISAM 檔案的 page cache
  用不上；`urt_video` 現在和 `ts_*` 共用 3G pool。iowait 約 1%，目前磁碟應付得來。

slow log（0.5 s）比較，基準 `baseline-slow.log` 44.8 分鐘、轉換後 `after-slow.log` 35 分鐘
（兩份都在 `/home/ubuntu/yt-innodb-20261025/`）。web reader 的長連線在基準期仍用舊的 `long_query_time=10`，
所以基準期的 web 筆數偏少，只能看同一種查詢的耗時：

| web 查詢 | 基準 | 轉換後 |
|---|---|---|
| `urt_video` 全表 bytes 掃描（keyword source size） | 45 次，平均 2.38 s | 140 次，平均 1.38 s |
| 未篩選 `COUNT(*) FROM urt_video v WHERE 1=1`（`/videos` 總數） | 不出現（MyISAM 讀表資訊） | 39 次，平均 0.78 s，最久 2.60 s |
| `ts_video_tag_evidence` 的 DISTINCT 計數／boundary | 平均 0.88–1.13 s | 平均 2.04–2.09 s，最久 5.00 s |
| 首頁摘要（含 `COUNT(*) FROM urt_video`） | 不出現 | 7 次，平均 0.70 s |

表鎖等待已經消失；代價是 buffer pool 壓力，讓本來就是 InnoDB 的 keyword evidence 查詢變慢。

### issue 第 3 點：最慢的 worker 查詢

兩份 slow log 裡最慢的都是 `ingestion/src/video-durations.ts` 選待補時長影片的查詢
（`urt_video LEFT JOIN urt_video_duration LEFT JOIN ts_youtube_item_backoff … ORDER BY … LIMIT 25`）：
基準 56.6 s，轉換後 57.6／92.7 s，每次 `Rows_examined` 約 8,500 萬，並產生落盤暫存表。轉換前就這樣，不是退步。

原因：`ts_youtube_item_backoff.video_id` 是 `ascii_bin`，`urt_video.videoId` 是 `utf8mb4_bin`。
`b.video_id = v.videoId` 要轉換字元集，所以 PRIMARY 只用到 `workflow` 前綴（plan：`ref const`，每部影片 111 列），
76.7 萬部 × 111 ≈ 8,500 萬列。`recent-video-evidence.ts` 已經用 `CONVERT(v.videoId USING ascii)` 避開同樣的問題；
duration 查詢照做即可。這需要 worker release。

## 回滾

- 單表：`ALTER TABLE youtube_board.<t> ENGINE=MyISAM`（同樣要先停 worker）。
- 全部：停 worker 後從 `/home/ubuntu/backups/services/20261024T161554Z-pre-innodb/youtube_board.sql.gz` 還原。

## 收尾與待辦

- UTC 17:02 slow log 已恢復原始設定：`slow_query_log=OFF`、`long_query_time=10`、`log_slow_verbosity=''`、
  `log_slow_query_file=797fb41e793f-slow.log`。
- nas-backup 的 `--single-transaction` 從此對 `youtube_board` 也是一致快照。
- 未篩選的 `urt_video` 總數可以在 gateway 短暫快取（例如 5 分鐘），省掉每次約 0.8 s 的索引掃描；需要 release。
- `innodb_buffer_pool_size` 仍是 3G（service args 持久化）。主機 swap 已滿，這台不調大；搬到大主機時再依
  InnoDB 總量（約 9 GiB）調整，keyword evidence 查詢應該會回到轉換前的速度。
