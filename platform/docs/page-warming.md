# 公開頁面預熱

## 為什麼

網頁讀 API 的逾時是 12 秒（`web/src/lib/api.ts`）。沒人看過的頁面、或換版後剛起來的 web，第一次要即時計算，常常超過 12 秒，讀者就會拿到 503「資料暫時無法讀取」。
這一頁算好之後會進 ISR／API 快取，之後的讀者就很快。

## 怎麼做

`tools/warm-public-pages.sh` 依序讀一次下列頁面：

- 導覽列與 sitemap 的主要入口頁。
- `/keywords` 排名前 20 名關鍵字（不含顯示排除的詞）的影片、文字雲、逐日頁，也就是報表快取排程涵蓋的關鍵字。

做法上的限制：

- 每次只送一個請求，間隔 2 秒。
- 直接打主機上的 Traefik（`--resolve youtube.observe.tw:443:127.0.0.1`），不經 Cloudflare。
- 主機 load 大於 4 時整輪跳過，避免在換版時雪上加霜。

出錯的頁面仍會顯示 `app/error.tsx`。這一頁會在 8 秒後自動重新讀取，每個網址每個瀏覽 session 最多 2 次。

## 安裝（正式主機）

- `/usr/local/lib/youtube-board-ts-worker/warm-public-pages.sh`
- `youtube-board-ts-warm.service`（oneshot、`Nice=10`）
- `youtube-board-ts-warm.timer`：每 10 分鐘在 `*:04/10` 執行，避開比對器的 `*:x2`、`*:x7`；換版完成後也可以手動跑一次。
- 看紀錄：`journalctl -u youtube-board-ts-warm.service -o cat`
