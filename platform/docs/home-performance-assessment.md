# 首頁效能與公開資料快取評估

2026-10-12 10:01–10:02 UTC，來源基準 `eea58eddcc111179e426a90b9a8906f0f0865d18` 附近的工作目錄。本次僅讀程式碼、六次公開 GET、六次現有 web container loopback GET；沒有更動 web、backend、Cloudflare、正式配置，也沒有做備份或部署。

結論：**首頁沒有登入／收藏的個人 SSR 依賴，可以共用短效的公開資料快取；現行 nonce CSP 仍要求每個 HTML response 動態產生，兩者不衝突。最小優化是 API 端 `/home` 資料結果的 15 秒快取與同時請求合併，保持 HTML `private, no-store`。** 不應為了 ISR 移除 nonce、加入 script `unsafe-inline` 或要求 Cloudflare 共用 HTML。

## 已測量的現況

先前回報 TTFB 約 0.66–0.83 秒。本次少量採樣沒有重現該區間；不能據此宣稱原問題已修好，也不能把某次測量當作 p95。每次公開請求都是新的 curl connection、正常 TLS、匿名、無 cookie、未加 cache-busting、順序執行，不是負載測試。

| 路徑／位置 | 三次 TTFB／header-ready（ms） | 三次完整下載（ms） | 說明 |
| --- | --- | --- | --- |
| 公開 `/`，經 Cloudflare | 335.1 / 326.2 / 421.3 | 336.9 / 329.4 / 423.8 | 中位 TTFB 335.1ms；均 HTTP200 |
| 公開 `/api/v1/home` | 326.0 / 309.8 / 328.1 | 358.4 / 335.1 / 355.2 | 中位 TTFB326.0ms；均 HTTP200 |
| container內 `127.0.0.1:8000/api/v1/home` | 196.9 / 159.5 / 119.7 | 201.5 / 161.4 / 120.8 | 包含API組合、DB與媒體enrichment；不經CF／Traefik |
| container內 `127.0.0.1:3100/` | 153.6 / 135.6 / 123.7 | 162.8 / 143.4 / 128.2 | 包含Next SSR及其loopback API；不是純React渲染成本 |

公開請求 TLS完成耗時約75.5–138.7ms；TLS完成後到第一個byte，首頁239.8–282.6ms、API228.8–243.0ms。這個差值仍含網路往返、edge/origin proxy與排程，**不能當SQL時間**。loopback用Node fetch，後續請求可能重用連線；前後採樣時間也不同，因此不能直接用兩欄相减推算Next overhead。沒有逐query tracing、正式EXPLAIN或併發profiling，不能指定某條SQL已被證明是瓶頸。

回應觀察：

- 首頁：`Cache-Control: private, no-store`、`CF-Cache-Status: DYNAMIC`；無Age／Set-Cookie。三次CSP nonce皆不同，且各自存在對應HTML中。
- 公開API：`Cache-Control: public, max-age=15`，但三次仍為CF `DYNAMIC`，沒有Age；`meta.requestedAt`每次改變。這個header不表示已有backend cache，也不表示CF實際cache JSON。
- 首頁解壓後131,000bytes，實際zstd傳輸約20.8KB。API解壓後150,340bytes，傳輸約37.3–37.5KB。這不是初始JS／圖片／字型總量；本次沒有測LCP／INP／手機效能。
- 公開量測的 `meta.updatedAt` 是來源時間，不是本次請求時間；快取後也應維持此語意。`dataset:unknown`是當前API既有metadata，不因效能工作重新宣稱為完整live dataset。

匿名HTTP測量證據存放於 gitignore 的 `.local/reviews/home-performance-http.json`，只含計時、白名單headers、metadata及nonce雜湊，不含登入憑證或完整HTML。上述loopback採樣只輸出數值與cache header，未讀取container env／secrets。

## 首頁是否需要個人 SSR

| 邊界 | 目前程式碼 | 判斷 |
| --- | --- | --- |
| `web/src/app/page.tsx` | `dynamic='force-dynamic'`；只 `await api<HomeData>('home')` | 不讀cookies、session、收藏或追蹤資料；首頁「自己的觀測清單」是通用連結／文案 |
| `web/src/lib/api.ts` | `fetch`僅Accept JSON，`cache:'no-store'`、12秒timeout | 不轉送使用者Cookie／Authorization；每次SSR會重取公開API |
| `SiteHeader`／`AccountMenu`／`lib/session.ts` | client components；server snapshot是session:null；effect才呼叫`/auth/me` | 帳號頭像、角色連結在hydration後取得；session API維持private,no-store |
| `api/src/ui-proxy.ts` | 向Next移除Cookie／Authorization／Proxy-Authorization | 公開HTML管線本來就沒有個人憑證；auth／private reader路由由gateway另處理 |
| `/api/v1/home` | `buildApp`公開report handler；不呼叫currentUser／reader-account store | 公開DTO能共用；auth、收藏、追蹤、個人RSS不能納入同一cache |

沒有使用真人session做HTTP比較，因為本次不需要讀取／複製任何登入cookie。以上是程式路徑證據；未來若把個人推薦、收藏或追蹤直接放進HomeData，此cache安全假設必須重審。

## 為何現在仍需動態 HTML

`web/src/proxy.ts`每次用crypto.randomUUID生成nonce，覆寫傳入的`x-nonce`及CSP；`layout.tsx`透過`headers()`讀nonce，供theme script與Next腳本使用。回應採 `script-src 'self' 'nonce-…' 'strict-dynamic'`，HTML為private,no-store。現有style policy的`unsafe-inline`不是這項評估新增的設定；不得把它擴成script例外。

即使首頁資料完全公開，把這份HTML／RSC成果直接ISR／CDN共用也會重用nonce，或產生header nonce與body nonce不一致。只改`dynamic`、`revalidate`、Cache Everything，無法解決此安全／渲染問題。Next `headers()`的request依賴與SSR API的no-store也是實際動態原因，並非因為「首頁有登入鈕」就必須動態。

## `/home` 的資料與工作量

`api/src/reports/service.ts`的home以Promise.all執行六個公開分支；API Reader每個process有6條連線、等待上限24、acquire3秒及server statement5秒限制。Promise.all不代表各分支都能無排隊並行；多位訪客會反覆跑同一批工作。

| 分支 | 主要來源與處理 | 可以優化但必須保留的語意 |
| --- | --- | --- |
| 頻道動態 | `urt_channel` + `urt_count`，12筆排行、COUNT與`urt_tag`名稱 | active條件、缺值、排名與資料更新時間 |
| 相容tags欄位 | `urt_count`全分類彙整 + `urt_tag`，top20 | 現行首頁主要讀exploration.categories，但API/tests仍保留tags契約，不直接刪欄位 |
| 即時直播 | `urt_video_live`、`urt_show_video_live`、`urt_video`、channel/count；20筆、COUNT、當日日誌 | 一小時有效觀測、byte-exact ID、每日峰值與partial-log coverage |
| 每日議題 | `urt_ai_date`、`urt_channel_ai`、`ts_ai_runs` lineage、影片參照 | 既有JSON解析、受控regroup、不可把過期／缺失引用假裝完整；不呼叫AI provider |
| exploration | `urt_count`分類；`ts_vocabulary_current/runs`與`ts_video_tag_matches/evidence`、`urt_video` | 今日／七日獨立top40、text SHA freshness、stale/unprocessed coverage與上游provenance |
| 總數 | channel/video COUNT、count增量、有效live COUNT/SUM | 來源時間與累計／增量區別；未知不補成已量測0 |

後續`enrichPublicMedia`會對公開DTO做原地修改、batch查目前`urt_channel` identity、讀本機avatar manifest。manifest已有stat-key invalidation／5秒JSON快取，不會在這條request裡到YouTube抓頭像。影片圖片由獨立請求載入，不是SSR呼叫遠端圖片API。

同一home build會重複讀`urt_tag`，分類也讀兩次相近`urt_count`集合；這些是可由程式碼確認的重複工作。其實際佔比尚未量測，不先做schema/index改動，也不犧牲parity去合併不同統計定義。

## 建議的最小實作：公開 home DTO 短效快取

**第一批只改API，交Codex實作／review；所有web變更仍由Opus前端lane處理。**

1. 每個`buildApp`／report-service實例持有一個首頁public-data cache，初始TTL15秒。固定首頁鍵，不能用任意query／Cookie／Authorization產生無界key。快取不得是跨資料庫／fixture／clock的全域singleton；不引入Redis、migration或新writer。
2. 優先cache `service.home()`的成功DTO，並合併同時miss為同一個in-flight promise；只在完整計算成功後發布。快取命中仍由report handler重新建立request metadata、執行必要media enrichment與序列化，不cacheHTML、CSP、nonce、headers或個人資料。
3. `enrichPublicMedia`會修改物件，因此每個consumer必須取得獨立深複本（例如structuredClone），包括共用同一in-flight promise的consumer；不得讓兩個requests修改同一快取object。保留media對目前channel identity的檢查及manifest revision替換，不以過期頭像映射換取速度。
4. TTL使用monotonic elapsed time，並以台北午夜為失效邊界，避免跨日還顯示昨天的「今日」。snapshot中的窗口to、coverage、updatedAt要保留原計算值，不能只把時間改成now而內容仍舊。`meta.requestedAt`仍是本次回應時間；另以清楚命名的cache diagnostics記錄snapshot age，不能把cache命中當資料更新。
5. 設定合理DTO byte上限（例如2MiB，實作前以fixture／大source coverage驗證）；超限只不留cache，不刪資料、不改報表語意。例外／500／503不得當成功cache。200但optional-section unavailable也不要長時間固定：初版可不存這類結果；持續失敗時仍靠existing DB deadline與in-flight合併，而不是把失敗轉成永久空清單。
6. 初版採hard expiry、沒有stale-if-error，不把停播狀態／不完整資料無限延長。若要stale-while-revalidate，另定最長age、標示stale及失敗語意後才加入。
7. public API現有max-age15須考慮疊加：server持有15秒後再讓browser/CDN持有15秒，最老可接近30秒。若要求總staleness不超15秒，API回應max-age須按snapshot剩餘TTL遞減，或有正確Age／freshness策略；不能在每次hit都重新宣告完整15秒。HTML仍private,no-store，不隨API header改變。
8. 快取可關閉、重啟自動清空；固定單一條目與一個in-flight，失敗finally必須釋放。先做本機／隔離資料驗證，之後仍按既有部署批准流程；本次評估沒有替此變更做上線授權。

預期效果是**同process的15秒內訪客共用一次昂貴資料組合**，減少DB／JSON regroup工作與尖峰排隊。仍有每次media identity讀取、clone、HTML SSR、TLS／CF網路成本；從這些小樣本不能承諾TTFB降低多少，也不能保證第一次cold miss改善。不要把整站pool調大當替代，否則可能把壓力推到共用MariaDB。

第二批若量測仍需要，才考慮：每次home build共用tag-name promise、在保留相容tags與categories定義下共用原始分類讀取、對AI daily與live採不同TTL；或另外提供首頁專用較精簡公開DTO。最後一項涉及前端契約，由Opus接手，不直接刪現在首頁只slice前幾筆以外的API欄位。

## 驗收與觀測

實作後至少證明：

- fake clock／隔離fixture：cold／warm、TTL到期、台北午夜、同時miss只跑一次、失敗後可重試、超限不cache、各app實例互不汙染；coverage／source timestamps不能變成「現在」。
- 多consumer物件不共用：其中一次media enrichment／mutation不污染後續response。相同公開資料不因Cookie／Authorization改變；`/auth/me`／reader／manage／個人RSS完全不使用此cache。
- nonce/CSP既有測試與API typecheck；首頁每次nonce不同、header/body匹配、HTML仍private,no-store；無script unsafe-inline、無CF共用HTML。
- 同一runner、相近時段重新做有上限的cold／warm公開與loopback計時，記錄cache hit/miss/build耗時／DTObytes。必要時加無參數、無SQL文字／個資的server timing；若要併發與每條SQL量測，先在隔離restore跑，不能把這次6個requests當load-test證據。

此輪為文件評估，沒有實作變更，因此未重跑完整測試套件；文件diff check即可。正式併發瓶頸、cache實際命中率、冷啟動與手機LCP仍須後續量測。

## 若未來堅持靜態／ISR首頁

必須是一個獨立安全設計與前端工作，不是把現有nonce回應送進cache：

- 保留當前nonce方案是本次決策。若未來批准「無nonce的靜態首頁」，需有可驗證的hash-based嚴格CSP／external bootstrap策略，涵蓋Next生成的inline bootstrap、RSC payload scripts與theme script，並驗證固定框架版本的production build、client navigation、prefetch、dark mode與hydration。
- 不能只externalize themeScript就聲稱已無inline script；Next可能仍輸出其他需要授權的腳本。SRI實驗功能也不自動替代全部inline CSP hashes。ISR regeneration的HTML／script內容與CSP hash集必須原子一致，各variant的cache key与nonce-free policy完整驗證。
- `/my`、管理、私人RSS及OAuth/session繼續分離、private/no-store；靜態公版nav先輸出通用狀態，個人帳號再client fetch。所有request headers()依賴都需移出該static route segment。
- 不使用script unsafe-inline、不重用nonce、不在edge只換header nonce卻留下舊body，也不以正則逐request改寫Next stream當捷徑。若無法證明完整腳本授權與HTML/CSP一致，就保留SSR並只cache資料。

這條路改動與驗證成本明顯大於15秒backend資料cache，目前證據不支持優先做它。
