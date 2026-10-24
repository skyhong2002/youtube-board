# 影片總數快取與 buffer pool 調整（2026-10-25，只換 web）

接續 `innodb-conversion-2026-10-25.md`。轉換後的三項後續，使用者要求都做。

## 1. 未篩選的影片總數共用 5 分鐘（`22f4fca`）

- InnoDB 沒有存列數，`SELECT COUNT(*) FROM urt_video v WHERE 1=1` 要掃 `u_id` 索引：安靜時 0.12–0.15 s，
  負載下 35 分鐘 39 次、平均 0.78 s、最久 2.60 s。
- `/videos` 沒有任何篩選（無 keyword、分類、頻道、日期、時數、門檻、cursor）時，總數改走
  `keywordVideoCache<number>`：同一時間的請求共用一次查詢，失敗不快取，5 分鐘後重算。有篩選的總數照舊即時計算。
- 測試：`api/test/video-search.test.ts` 新增一則（失敗不快取、併發共用、8 種篩選各自查詢）；api vitest 892 pass，
  3 個平行時逾時的檔案（media-assets、sitemaps、ui-unavailable）單獨重跑 21/21；`tsc` 0 錯誤。
- release 分支：`release/archive-total-22f4fca` = `35385dd`（d007cfb + 22f4fca）。和 d007cfb 比只差 `service.ts`
  與測試；d007cfb 與 main 的 `service.ts` 在這個 commit 之前相同。

### 正式環境（UTC 2026-10-24）

- **映像：** `youtube-board-ts:release-total-35385dd` = `sha256:132791ba2525da3532e3fd5185a202b04fedce3e748016bc5723e7e1c60c55bc`。
  以正式 web `release-snap-d007cfb`（`e9eb081e…`）為底，只覆蓋 `api/src/reports/service.ts`（sha256 `9b118130…`，與 commit 相同）。
  建置目錄 skyhong-blog `/home/ubuntu/yt-release-total-35385dd`。
- **候選容器：** 127.0.0.1:18181，唯讀、writers 關閉、無 Redis（`/tmp/yt-candidate-total.sh`）。
  `/api/v1/videos` 第一次 0.39 s，之後 0.026–0.028 s；總數 767,392 與正式版相同；`channelId`、`hours` 篩選即時計算。
  `/`、`/videos`、`/channels`、`/keywords` 200，沒有 `data-source-failure`。
- **17:15:40 換 web：** `e9eb081e…` → `132791ba…`，17:16:18 `completed`、healthy、revision `35385dd`。
  換版後 `/api/v1/videos` 0.06–0.48 s（換版前 0.75 s），總數 767,425；頁面全部 200，request 失敗 0。
- **回復：**
  ```
  release-service-image.py --service=web --old=sha256:132791ba2525da3532e3fd5185a202b04fedce3e748016bc5723e7e1c60c55bc --new=sha256:e9eb081ead23d762c80737bbff3994767b74e8ad8fd9f13da1c7e7e3a2fd1003 --title=Rollback --execute
  ```

## 2. buffer pool 3G → 3.5G（執行期）

- 轉換後 mariadbd RSS 4.48 GB + swap 879 MB；主機 available 約 3.0 GB，swap 剩約 840 MB。
- 已經沒有 MyISAM 使用者表（系統表是 Aria），`key_buffer_size` 128M 用不到。
- 17:18:37 `SET GLOBAL key_buffer_size=8M`、`SET GLOBAL innodb_buffer_pool_size=3584M`，立即生效。

每 5 分鐘取樣（3G 時的數字見 `innodb-conversion-2026-10-25.md`：buffer pool 磁碟讀 17–357/s）：

| 結束時間（UTC） | buffer pool 磁碟讀 | 暫存表落盤 | q/s | web request 失敗 | load | available | swap 剩 | si/so |
|---|---|---|---|---|---|---|---|---|
| 17:24 | 51/s | 25% | 40 | 0 | 2.07 | 2,701M | 888M | 0/0 |
| 17:29 | 48/s | 23% | 45 | 0 | 3.46 | 2,393M | 925M | 0/0 |
| 17:34 | 13/s | 28% | 57 | 0 | 1.91 | 2,331M | 928M | 24/0 |
| 17:39 | 13/s | 22% | 45 | 0 | 1.75 | 2,304M | 951M | 0/0 |
| 17:44 | 11/s | 19% | 40 | 0 | 2.14 | 2,114M | 965M | 96/0 |

pool 填滿後磁碟讀穩定在 11–13/s，swap 沒有往外寫，所以保留並持久化：

- Dokploy mariadb `p7QSu23m3iZwCfbwqB3XF` 的 args 改為
  `mariadbd --innodb-buffer-pool-size=3584M --key-buffer-size=8M --tmp-table-size=64M --max-heap-table-size=64M`
  （`mariadb.update`，沒有 deploy；stopGracePeriodSwarm 仍是 120 s）。
- 17:45:34 暫停 worker，`FLUSH TABLES`，17:45:36 `docker service update --stop-grace-period 120s --args "…"`（同上）。
  17:45:50 `ready for connections`，沒有 crash／recovery；`ib_buffer_pool` 17:45:51 載入完成。資料庫中斷約 14 s。
- 17:46:00 恢復 worker，17:46:21 全部 1/1。重啟期間 web 有 2 次 request 失敗；之後 live poll、cache、source、telegram
  都 completed，recent matcher `up-to-date`，頁面 200。
- 重啟後主機 available 5.6 GB、swap 剩 1.7 GB（重啟釋放了 mariadbd 的碎片）。
- 回復：同一指令把 `3584M` 改回 `3G`、拿掉 `--key-buffer-size=8M`，Dokploy 紀錄也一起改回。

## 3. 本機測試資料庫

- jobs 的 `media-cli-db`、`video-evidence` 失敗，原因是一次中斷的 `keyword-alias-database` 執行沒跑 `afterAll`，
  留下頻道 597509320（`alias fixture`）、2 部 2038 年的影片、1 個 `alias-*` 詞彙 run。
- 刪除後兩個測試都通過（連同 editorial-db 3 檔 27/27）。只動本機 `youtube_board_test_rewrite`。
