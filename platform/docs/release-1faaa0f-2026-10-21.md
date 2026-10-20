# Release 1faaa0f（2026-10-21 台北清晨）：留言頁面先下架

## 內容

release 分支 `release/comments-offline-955360b` = 796b5fa（當時正式版）+ `955360b`（cherry-pick 後為 `1faaa0f`）。main 上其他尚未上線的 commit（例如 07c04d4、edd8eb6）沒有包含在這次 release。

留言抓取（issue #2）從來沒在正式環境開啟，留言頁面與區塊都只會顯示空白或「未收錄」。在 `COMMENTS_PUBLISHED`（`web/src/lib/comments-launch.ts`，#2 完成前為 `false`）開關下：

- `/comments/authors/*`、`/channels/:id/comments`、`/tags/comments`、`/tags/:id/comments` 回 404，頻道與分類的分頁籤不再出現「留言」。
- 影片頁拿掉「本站留言收錄」；觀測分析頁拿掉留言統計、逐時／逐日留言、最多留言帳號、最多喜歡留言，以及資料涵蓋範圍中的留言項目。
- 影片列表只顯示 YouTube 留言數，不再顯示收錄狀態、收錄作者、收錄回覆、留言獲讚。
- 方法說明的留言段落與關於頁的「留言」段落暫時隱藏。
- API 不變。#2 上線時把開關改成 `true` 即可恢復。

## Image 與換版

- `youtube-board-ts:release-1faaa0f`（`sha256:dd0e61e22e1e9dd9c7677998d55635ded420a827847a4c686a0e72e67d169250`，17 層），base `base-flat-250fdfc`，Dockerfile.native-f2 SHA256 `c59195a5…`。
- 候選容器（127.0.0.1:18172，`/tmp/yt-candidate-1faaa0f.sh`）：四類留言頁 404；頻道影片、影片頁、觀測分析頁與正式版對照，留言分頁、「本站留言收錄」、「收錄作者」、「顯示 YouTube」都消失。`/` 回 503 `HOME_SECTION_UNAVAILABLE`，原因是候選容器沒有 Redis（已知限制）。
- 21:25:10 UTC 以 `release-all.py` 只換 image（備份 `release-all-before-20261020T212510Z.private.json`）。scheduler 被 Swarm 退回，其餘 9 個服務完成；load 降到 2 以下後，用同一份 compose 再 deploy 一次，21:35:56 scheduler 完成。
- 換版後正式站：四類留言頁 404，`/`、頻道、分類、影片、觀測分析、關於、關鍵字頁都回 200，且沒有留言區塊。
