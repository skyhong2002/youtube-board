# Release home-pool f4b6d39（2026-10-24 台北 00:21，只換 web）：首頁與 /keywords 不再因排行池失敗整頁 503

範圍只限 youtube.observe.tw。board.tw 及其所有子網域是另一個服務，不在範圍內（見 `AGENTS.md`「Service boundary」）。

## 事件與根因

- **起點：** 2026-10-23 15:09:54Z 起，tag.observe.tw 的 `/api/v1/ranking-pools` 讀取失敗。告警時看到的原因是 429（rate-limited），之後是非 200。
- **API 層：** 首頁 API 仍回 200，只把 `keywords`、`keywordToday` 標成 `unavailable`。
- **web 層：** 首頁和 `/keywords` 共用同一個 `home` 讀取，只走 ISR。`requireCompleteHome` 遇到任一區塊不可用就拋出 `503 HOME_SECTION_UNAVAILABLE`，原本是想讓 Next 繼續送舊的快取頁。
- **舊頁消失：** ISR 只放在記憶體（64 MB LRU）。舊快取頁大約在 15:24–15:34Z 之間消失，之後每個請求都重新渲染、都失敗，`/` 和 `/keywords` 整頁 503。
- **診斷誤歸：** 池失敗被記成 stage `vocabulary`。
- **readiness 盲點：** `/runtime/ready` 只檢查 API 的 `/ready` 和 `/about`，首頁壞掉時仍回 200。

### 16:07–16:15Z 的 502

- **現象：** web 服務的映像沒有變（`d2ed326b`），也沒有人部署或下指令重啟。但 task 每 1–2 分鐘就被換掉，狀態是 Complete，結束碼 0，沒有 OOM。
- **原因：** 磁碟 I/O 壓力約 80%，資料庫在 MyISAM 表鎖上等待。web 的 `/ready` 在這種情況下回 unavailable（資料庫或 sitemap 準備），健康檢查失敗，Swarm 就把 task 換掉。新 task 在約 90 秒內準備不完 sitemap，形成重啟迴圈。
- **其中一個 I/O 來源是本 thread 自己造成的：** 前一輪診斷留在主機上的 `sudo journalctl --since … -u youtube* -u yt-*`（PID 2638364，D 狀態約 21 分鐘）。
  - 本機的 task 已經停了，遠端程序卻還在跑。16:12Z 已經停掉，之後 I/O avg10 降到 3–6%。
  - web 在 16:15:19Z 恢復 healthy，sitemap 準備花了 21.6 秒。
- **沒有動到的：** readiness 和健康檢查的 timeout 都沒改。另外看到一個執行 727 秒的查詢，它不是本 thread 的，下一次查看時已經消失，沒有處理。

## 修正

- main：`f8cf5ddc6b33cab67579ae2626e7af62c7506774`（8 檔）。
- release 分支：`release/home-pool-f8cf5dd` = `f4b6d39bd0af6df12c7497f2328012313a8bda5a`，也就是 `b2e372b` 加上 cherry-pick `f8cf5dd`。
- 沒有包含其他 session 未提交的 web 原型（`Filters*.tsx`、`next-env.d.ts`）。

### 改了什麼
- **web `requireCompleteHome`：** 只有 keyword 區塊不可用、而且原因是 `rankingPool.status==='unavailable'`（上游池失敗）時，才不再拋錯。頁面會顯示既有的「新聞詞池目前無法完整驗證，排行暫不顯示」，排行列是空的，不會產生假排行。categories 不可用或其他 keyword 失敗時照舊拋錯，Next 保留舊頁。
- **池 client（`tag-ranked-pool.ts`）的退避：**
  - 429 照 Retry-After 冷卻，沒有這個標頭時冷卻 60 秒，和原本一樣。
  - 其他失敗（5xx、網路、deadline、contract）從 30 秒開始，每次加倍，最多 5 分鐘。所有時間窗共用同一個冷卻，冷卻期間不送上游請求。
  - 仍在有效期內的快取池照常回傳。
  - 之後的 5xx 不會改掉一個更長的 429 冷卻的原因標籤。
- **池 client 的診斷事件：** 新增去敏的 `TAG_RANKING_POOL_UPSTREAM` 事件，類型有 failure 和 recovered。
  - 欄位只有 status、Retry-After 標籤、`cooldownUntil`（無限期時寫 `unbounded`）和 UTC，不含 URL 和 body。
  - 事件組裝放在 try 裡面，不會影響讀取結果。
- **首頁診斷：** 新增 stage `ranking-pool`。合併到別人那次 keyword 載入的呼叫者，也會拿到相同的 `rankingPool` 失敗資訊。
- **沒有改的：** 新鮮度規則、限流、上游額度、readiness、gateway TTL 都維持原樣。部分頁面和正常頁面走同一套快取層：資料快取 60 秒、ISR 60 秒、edge `s-maxage≤60` 加 `swr≤60`。

## 測試

在乾淨的 release worktree（`f4b6d39`，不含他人未提交檔案）上執行：

| 項目 | 結果 |
| --- | --- |
| api `tsc --noEmit` | 0 錯誤 |
| api vitest | 檔案 113 passed、31 skipped；測試 887 passed、364 skipped、0 failed |
| web `tsc --noEmit` | 0 錯誤 |
| web `node --test` | 382 項：380 pass、2 skipped、0 fail |

新增的回歸測試：
- 5xx 與網路錯誤的退避（30 秒到 60 秒）、冷卻期間不送請求也不送事件、恢復後送 recovered。
- 429 冷卻窗與 Retry-After 標籤（秒數、HTTP 日期、invalid、超長）。
- 冷卻期間另一個時間窗的有效快取照常回傳。
- 5xx 不會改寫 429 的冷卻原因；時鐘或事件接收端出錯時不影響結果。
- `ranking-pool` stage 與合併呼叫者。這個測試在拿掉修正時會失敗，已實際驗證過。
- `requireCompleteHome` 哪些情況放行、哪些情況拋錯。

獨立 reviewer（另一個 agent）結論：沒有阻擋性問題。它提出的合併呼叫者、冷卻原因標籤、時鐘例外、註解不正確等項目都已修正，並補上測試。

## 建置（與部署分開）

- **映像：** `youtube-board-ts:release-home-pool-f4b6d39` = `sha256:100a11fd0f78991b01f9786c0bc643774bbaac67b10996d062d0926d60aea6fe`
  - revision label 是 `f4b6d39bd0af6df12c7497f2328012313a8bda5a`，BUILD_ID 是 `eyBSbHNXOyH1-gsoBFH4T`。
  - 建置時間 16:16:27–16:18:34Z，在 VPS 上；build 階段用 `nice`/`ionice -c3`。SM 是 x86_64，正式機是 aarch64，standalone 會帶原生模組，所以不能在 SM 離線建置。
- **做法：** 建置目錄 `/home/ubuntu/yt-release-home-pool-f4b6d39/`，source 來自 `git archive f4b6d39 platform`。`Dockerfile.web-overlay` 的 sha256 是 `702300d9…`。
  - build 與 runtime 兩個 stage 都以正式映像 `release-live-ui-b2e372b`（`d2ed326b`）為基底。
  - build 階段只重跑 `next build`。
  - runtime 階段放入新的 `.next` standalone、static、public、BUILD_ID，再覆蓋 4 個 API 檔：`app.ts`、`tag-ranked-pool.ts`、`home-exploration.ts`、`home-diagnostics.ts`。
- **映像內核對：** 這 4 檔的 sha256 和 git 一致；`legacy-redirects.ts`（3094c538…）和 `ui-proxy.ts`（5db7baf8…）沒有變，`7ea09a5` 的行為保留。
  - 覆蓋前也確認過，正式映像裡這 4 檔和 `b2e372b` 完全相同。

## 隔離 smoke（16:19:59–16:21:40Z）

- **設定：** 唯讀的 loopback 候選（127.0.0.1:18176），不帶 Redis，所有寫入都關閉。`--add-host tag.observe.tw:127.0.0.1`，所以不會消耗上游額度，也正好重現上游失效。
- **結果：**
  - ready 花了約 55 秒（sitemap 32 秒）。
  - `/` 連 3 次都是 200，`/keywords` 200，`/channels/3113` 200，`/ch/3113/videos/&hours=24` 和 `/ch/3113/` 都是 308。
  - 首頁有分類區塊和明確的詞池不可用訊息，沒有錯誤頁。
  - 首頁 API：categories 可用（8 列），keywords 不可用、0 列，channels 12、live 20。
  - log 只有一次上游失敗：`status:null`，冷卻 30 秒。
- 驗完已移除候選容器。

## 換版

- **指令：** `.local/dokploy/release-service-image.py --service=web --old=sha256:d2ed326b… --new=sha256:100a11fd…`。
  - 先 dry-run，確認只有 web 會換。
  - 執行前確認：專案內沒有其他 thread 正在跑；load 2.6、I/O avg10 1.2%。
- **時間：** 16:21:54Z 送出；新 task `bdde693a9307` 在 16:21:55Z 啟動；16:22:38Z `UpdateStatus=completed`。
  - 新 task healthy、沒有重啟、沒有 OOM，`/runtime/ready` 的 api/ui/security 都 ready，sitemap 共 461,703 列。
  - 私有備份：`release-service-image-before-20261023T162154Z.private.json`。
- **其他 10 個服務沒有變：**
  - worker-ai-daily：`feb3fdf3…`
  - worker-ai-hourly、worker-youtube-source：`44dcc1d5…`
  - 其餘：`65038431…`，redis 維持原映像
- **回復：**
  ```
  release-service-image.py --service=web --old=sha256:100a11fd0f78991b01f9786c0bc643774bbaac67b10996d062d0926d60aea6fe --new=sha256:d2ed326bc25cef943f0cb9901ac33b64ac45a9af5d22851d0e4bc549f0744f06 --execute
  ```
  回復到 `b2e372b`，就會回到「池失敗時整頁 503」的狀態。

## 正式驗證

- **經 Cloudflare（16:23:04–16:25:36Z）：**
  - `/` 連續 8 次 200（cf HIT），`/keywords` 連續 7 次 200，`/channels/3113` 200，`/ch/3113/videos/&hours=24` 308。
  - Cache-Control 是 `public, max-age=0, s-maxage=60, stale-while-revalidate=60, no-transform`。
  - 首頁沒有錯誤頁，有 9 處詞池不可用訊息。
  - 首頁 API：categories 可用（8 列）；keywords 和 keywordToday 不可用，`rankingPool` 是 unavailable/unavailable，0 列；channels 12、live 20。
- **ISR 確實會重建，不會一直卡在舊的部分頁（16:26:45–16:27:03Z，在 origin 量測）：**

  | 時間 | x-nextjs-cache | 首頁「更新」時間 |
  | --- | --- | --- |
  | 16:26:45Z | STALE | 00:24 |
  | 16:26:54Z | HIT | 00:26 |

  - Codex 在 00:25 用 Brave 重新整理，masthead 從 00:22 前進到 00:24，頻道、議題、直播、分類都完整。
- **錯誤：** 新容器啟動後 `PublicDataError` 是 0。
- **上游與退避：** 上游每次都回 **503，沒有 Retry-After**。退避依 30 秒、60 秒、120 秒加倍：

  | 時間（UTC） | 冷卻到 | 冷卻長度 |
  | --- | --- | --- |
  | 16:23:03.786Z | 16:23:33.786Z | 30 秒 |
  | 16:24:39.984Z | 16:25:39.984Z | 60 秒 |
  | 16:26:50.470Z | 16:28:50.470Z | 120 秒 |

  - 兩次嘗試之間只有首頁或 `/keywords` 的重新驗證會觸發上游請求，沒有渲染重試風暴。

## 限制與未完成

1. **關鍵字排行仍未恢復。** tag.observe.tw 的 ranking-pools 持續回 503，兩個關鍵字區塊會顯示「暫時無法驗證」，直到上游恢復。
   - Tag 側的只讀診斷（Codex 轉述）：
     - 運算額度是全域、每個 process 每分鐘 2 次，busy 與 budget 的單位是 42930 秒與 42960 秒；
     - 單次 10 秒的有界 manifest 請求逾時，DB 和佇列壓力高；
     - 精確的失敗原因還不知道。
   - 上游恢復後，下一次冷卻結束時的嘗試成功，就會送出 recovered 事件，排行自動回來，最多再經過幾分鐘的快取層。
2. **Retry-After 極大時冷卻沒有上限。** 這是既有行為；事件會標成 `unbounded`，但不重啟就不會再嘗試。是否加上限需要另外決定。
3. **sitemap 準備會影響 readiness。** I/O 壓力高時，新 task 可能在健康檢查時限內準備不完，形成重啟迴圈（見 16:07–16:15Z）。這次沒有改 readiness 或 timeout。
4. **`/ai/days/{date}/{非 ASCII 條件}` 回 503**，仍待修正。
5. **之後任何換 web 的 release 都必須包含 `f8cf5dd` 和 `7ea09a5`。**
