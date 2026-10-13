# GSC sitemap：既有來源端紀錄摘要（2026-10-13）

## root 台北 16:30 核對補充

使用者轉達 root 唯讀核對：**230 筆 log；經驗證 Googlebot 0 筆；
UA 宣稱 Googlebot 且抓 sitemap 也為 0 筆。** 目前沒有可信 Googlebot 抓取
index 或任一子 sitemap 的真實證據，不推測已抓取。
這是 root 回報的盤點總數，沒有隨訊息提供逐筆 receipt 或篩選範圍；
不能將它與下方較早、僅 robots／sitemap 的 141 筆計數當作同一母體或推算新增量。
以下原始 snapshot／SHA256／時間與未驗證流量表均保留，不改寫既有收據。

## 本次離線原始碼檢查

- gateway 的 index 與 child loc 固定正式 origin `https://youtube.observe.tw`，
  分別 `/sitemap.xml`、`/sitemaps/{static|channels|videos|tags}/{page}.xml`；
  index 只引用已完成且非空的 child，帶 lastmod。公開 loc 不帶 query 或登入資訊。
- robots metadata 使用同一正式 origin 宣告 `Sitemap: https://youtube.observe.tw/sitemap.xml`；
  私人／API 前綴的 Disallow 沒有封鎖 `/sitemap.xml` 或 `/sitemaps/`。
- gateway 先註冊 sitemap 路由、後註冊 UI wildcard；成功 XML 的 source handler
  設 `application/xml; charset=utf-8`，匿名200回 `public, max-age=0, s-maxage=3600`；
  Fastify 提供 HEAD。冷 snapshot 未準備可回503與 Retry-After60、no-store；
  這是程式允許的失敗狀態，沒有紀錄證明 Google 遇到它，不能定為根因。
- 有成功200的保留紀錄，但目前 log 不記 response Content-Type 或 Cloudflare cache status；
  source header 契約和較早的驗收紀錄不能代替 Google 當時實際收到的 headers。
  Cloudflare HIT 可能不進 origin；沒有 edge 端證據，不能推論 Google 的請求被快取或擋下。

上述 sitemap、robots、logger、DNS verifier、trusted-ingress 五份 source，
本次在本機 Git 比對皆與最後已知正式 commit `7eb48f4` 相同；
這是 committed source 相同性證據，不是新的 running-image 或網路驗收。
沒有發送 Googlebot UA 或其他新 HTTP 請求，也沒有更改 Cloudflare／WAF。

## UTC 08:13 保留 snapshot（歷史，不是 root 230 筆盤點）

唯讀整理時間 UTC `2026-10-13T08:13:30.924841+00:00`。私有去識別原始摘要 `/home/deck/.cache/youtube-ui-review/ui_ledger-2026-10-13/review-logs/crawler-gsc-deidentified-20261013T081330Z.json`；
SHA256 `d2af1b12677a6d285dfdd308965d7feae60420e412bc5562350c7d60a8c60a1c`。沒有新增 HTTP probe、capture、建置或部署。

保留區間 `2026-10-12T17:49:03.541Z` 至最新 discovery request `2026-10-13T08:06:34.496Z`；
共 141 筆 robots／sitemap 紀錄。**可信 Googlebot 抓取 index：0 筆；子 sitemap：0 筆。**
所以沒有可提供的已驗證 Googlebot 時間／狀態／大小清單，不能用下列 200 當作 GSC 抓取成功。

正式 verifier 使用 trusted ingress IP 做反向 DNS，hostname 必須以網域邊界屬於
`googlebot.com` 或 `google.com`，再正向 DNS 確认同一 IPv4／IPv6。
UA、`cf-verified-bot` header、機房與國別都不獨立構成可信證據。
IP／DNS hostname 只在 bounded 記憶體使用，不寫入摘要或 log；
歷史 missing／false 的 verified 不升級，也不從其他檔案補抓訪客 IP。

以下是**未驗證／验收／瀏覽器流量**的完整 sitemap inventory，僅供來源端服務紀錄對照。
每路徑 4 筆、全部 200；GET body size 為來源端编码後 body bytes，HEAD body 為 0。
此表不宣稱 Google 抓取；詳細每筆 method／UTC／status／bytes／colo／agent 在私有 JSON。

| 路徑 | 首次 UTC | 最後 UTC | GET body bytes（不同值） | 已驗證 Googlebot |
| --- | --- | --- | --- | --- |
| `/sitemap.xml` | 2026-10-12T17:49:05.066Z | 2026-10-12T18:33:35.485Z | 2182 | 0 |
| `/sitemaps/channels/1.xml` | 2026-10-12T17:49:07.095Z | 2026-10-12T18:33:08.090Z | 363867 | 0 |
| `/sitemaps/static/1.xml` | 2026-10-12T17:49:05.742Z | 2026-10-12T18:33:06.571Z | 2213 | 0 |
| `/sitemaps/tags/1.xml` | 2026-10-12T17:49:33.005Z | 2026-10-12T18:33:34.814Z | 11772 | 0 |
| `/sitemaps/videos/1.xml` | 2026-10-12T17:49:08.869Z | 2026-10-12T18:33:09.976Z | 5500108 | 0 |
| `/sitemaps/videos/10.xml` | 2026-10-12T17:49:24.253Z | 2026-10-12T18:33:25.974Z | 5500108 | 0 |
| `/sitemaps/videos/11.xml` | 2026-10-12T17:49:26.003Z | 2026-10-12T18:33:27.911Z | 5500108 | 0 |
| `/sitemaps/videos/12.xml` | 2026-10-12T17:49:27.731Z | 2026-10-12T18:33:29.852Z | 5500108 | 0 |
| `/sitemaps/videos/13.xml` | 2026-10-12T17:49:29.633Z | 2026-10-12T18:33:31.702Z | 5500108 | 0 |
| `/sitemaps/videos/14.xml` | 2026-10-12T17:49:31.402Z | 2026-10-12T18:33:33.436Z | 2634058, 2637798 | 0 |
| `/sitemaps/videos/2.xml` | 2026-10-12T17:49:10.515Z | 2026-10-12T18:33:11.738Z | 5500108 | 0 |
| `/sitemaps/videos/3.xml` | 2026-10-12T17:49:12.215Z | 2026-10-12T18:33:13.498Z | 5500108 | 0 |
| `/sitemaps/videos/4.xml` | 2026-10-12T17:49:13.914Z | 2026-10-12T18:33:15.201Z | 5500108 | 0 |
| `/sitemaps/videos/5.xml` | 2026-10-12T17:49:15.634Z | 2026-10-12T18:33:16.995Z | 5500108 | 0 |
| `/sitemaps/videos/6.xml` | 2026-10-12T17:49:17.330Z | 2026-10-12T18:33:18.970Z | 5500108 | 0 |
| `/sitemaps/videos/7.xml` | 2026-10-12T17:49:19.065Z | 2026-10-12T18:33:20.781Z | 5500108 | 0 |
| `/sitemaps/videos/8.xml` | 2026-10-12T17:49:20.771Z | 2026-10-12T18:33:22.502Z | 5500108 | 0 |
| `/sitemaps/videos/9.xml` | 2026-10-12T17:49:22.513Z | 2026-10-12T18:33:24.252Z | 5500108 | 0 |

Google-InspectionTool 類別 38 筆均未驗證，包含較早驗收使用的 UA；
驗收程式 38 筆、一般瀏覽器 63 筆、無法辨識 2 筆，沒有任何 Googlebot 類別紀錄。
UTC2026-10-12T17:36:50 的舊請求早於持久化開始，保留檔裡沒有該筆，不能重建。

限制：Cloudflare HIT 不會進入 gateway，輪替／限流抑制／transport failure 也會造成缺漏。
因此「未看到可信 Googlebot」不能推論「Google 從未抓取」，更不能解释或宣稱修好 GSC Unknown／Couldn't fetch。
沒有讀取、保存或輸出任何訪客 IP、完整 UA、cookie 或 token。
