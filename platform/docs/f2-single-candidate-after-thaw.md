# 解凍後單一候選操作計畫

本文件是準備，不是執行紀錄。使用者最新兩小時衝刺授權到台北15:10（UTC07:10），**YT可立即在skyhong-blog建置，不再等待blog**；本機tag/blog最多2個建置，遠端YT不占本機名額。不得操作tag-backup或刪除既有release、回滾版本、備份、worktree。

## 解凍後新閘門（取代本文件較早的容量門檻）

- 建置／image開始前實際 `df -h /home` 至少40GiB；執行期間低於30GiB，或load1超過12，或首頁整頁totalSeconds超過各站基準2倍（tag2秒、blog6秒、YT2秒），或任一站5xx／逾時或未知，立即暫停自己的建置及capture。不能只看TTFB，也不能只量blog。
- 先估每批新增量。tag還原仍可能以約28GB/小時消耗磁碟，不能把本次df當成後續階段保證；每阶段重讀、持續監控，任何停線都回報。預估8GiB峰值仍是準備估算，實際每階段核對；此版本不再沿用112.5GiB舊停止線。Capture準備版保守採40GiB加批次估計，這個額外capture餘裕是實作選擇，不冒稱使用者另訂的門檻。
- 本機最多2個建置（遠端YT另計）、全站2個capture瀏覽器；nice19/ionicec3，Next workers≤2。`tools/guarded-next-build.py`只適用同主機、自己建立session/process group的Next建置：flock加process檢查、持續量三站整頁時間、容量與load；故障或SIGINT/TERM先STOP自己群組並保留lock；不自動恢復。SIGUSR1是operator明確恢復請求，仍須重新通過全部閘門。它**不能暫停Docker/BuildKit daemon或遠端image工作**；那些階段必須另有host-side guard與安全停止方式，未備好就不啟動。
- 閘門為取樣監控：三個串行探測最多4／8／4秒加5秒迴圈間隔，最壞約21秒另加OS排程延遲才偵測到違規；偵測後立即送SIGSTOP。若訊號失敗，記為`STOP-unconfirmed`、保留lock並要求operator處理，不能聲稱已物理暫停。SIGKILL／主機失效不在此程序可保證的範圍；實際部署仍須operator監看receipt。
- YT遠端即刻建置授權獨立保存在私有receipt，包含owner=YT、remoteBuildAuthorized=true與使用者本次實際通知，不需blogBuildFinished。候選SHA要包含本輪守門及worker cap修正，重新固定最後已審查commit。
- Next編譯保留核准的公開measurement ID `G-X2G1PLNP7K`（會被inline，不能只靠部署後runtime env補回）。candidate hostname/DNT guard與capture啟動前網路封鎖照舊；設定ID不等於測試送GA事件。
- 部署後只清理本輪新產生、確認無須保留的暫存；先列精確路徑與來源、確認不屬release/回退/證據/備份再清理。既有檔案一律保留。

## 唯一候選來源

以 `codex/f2-keyword-quality` 最後完成獨立 source review 的**明確 commit**作為 release SHA，從 Git committed tree 建立乾淨輸入；不直接封裝目前 dirty worktree。建置前將完整 SHA 寫入 release receipt，後續不追隨 branch tip。

| 已在同一祖先鏈的提交 | 本批內容 |
| --- | --- |
| `b6881ce`（含 `7d4d945`） | 市長分享頁、導覽順序；不使用另一 thread 的映像 |
| `654cdf5` 及其先前 F2 commits | 排行、證據、表格／圖片與市長缺值呈現 |
| `b688739` | 首頁 partial cache／錯誤、期間與支持影片狀態修正 |
| `59a7d1b` | Y2 adapter/API、record-only 覆核後端 |
| `b0d2762` | F2 loading／empty／error／dark 原始碼 |
| `5d92387` | 既有權限下的覆核介面與來源選詞 |
| `ba6069d` | 可選 Y2 relations 介面 |
| `893b2ab`、`d1acf63` | source review、來源樹 noEmit 證據與 ledger |
| 本文件後的 P0 小修 | 只納入已提交、有獨立 review 與 focused tests 的修正；在 release receipt 列出確切 SHA |

上述四批成果**不需要 cherry-pick 或重新 merge**。執行前以 `git merge-base --is-ancestor` 核對，保存 `git diff --stat 7eb48f4..<release-SHA>` 與完整 diff。這個比較基線是最後已知正式版本，解除凍結後仍要確認實際正式版本；若正式版本已變動，先重做差異與回退基線，不能直接覆蓋。

**排除範圍：**目前未提交的 quality jobs、database/writer lock、description templates、recent evidence、worker-permissions 與 quality-report-reader 等檔案保留原位，不納入映像。不得藉本次發布執行 migration 015、grant、新增帳號、開啟 Y2/review/write gates 或替換 background worker。Y2 上游與覆核 schema 未啟用狀態必須可理解；「已記錄」不等於「已套用排名」。

## 容量與時間預算（估算，不是量測結果）

既有 `platform/.local/f2/frontend-654cdf5-build-proof.json` 記錄單 CPU、nice 19、ionice idle 的 webpack build：20:50:07.816–20:51:29.942 UTC，**82.1 秒**。它只量前端建置，不含封裝、搬運、warmup 或 review。既有 rollback archive 為 **868,119,040 bytes（827.9 MiB）**；這是 tar 封存大小，不是 Docker inspect Size，也不是新候選的壓縮傳輸大小。

| 項目 | 預算與假設 |
| --- | --- |
| 新 runtime image | 約 0.9–1.3 GiB 未壓縮；以既有 archive 作粗略尺度，實際 image Size／傳輸 bytes 待解凍後記錄 |
| 前端單次 build | 約 2–5 分鐘；已有依賴、單 CPU、同版 Next/React；cache miss 或負載可更長 |
| 封裝／完整雜湊／傳輸 | 約 5–15 分鐘；僅估算，網路與儲存速度未於凍結期間探測 |
| build 至 canary 可用 | 預留 15–30 分鐘，不含逐頁 review；ready/sitemap warmup 獨立記錄 |
| 本輪新增磁碟峰值 | 預留 **8 GiB**（乾淨 source、必要依賴／Next 輸出、封裝／傳輸副本、receipt）；不複製舊 release、不另存大型 DB export |
| 容量閘門 | 最新開始至少40GiB／執行低於30GiB暫停；預估新增量不能跨越停止線；另計正在進行的備份消耗，每階段重讀 |

本機可同時有兩個 Next/Docker 建置，遠端YT獨立；YT自身仍只開一個建置，以host-side lock與實際process確認不重複。以 `nice -n 19 ionice -c3`、單 CPU／有上限 heap 建置。任何超預算或 gate 不明就停止新階段；不清除使用者保留的檔案來勉強完成。8 GiB 是規劃 reserve，實際空間每階段重新量測。

## 單次建置與一致性收據

1. 一份固定 SHA source、一份 lockfile、一輪 Next webpack build；接著一次完整 runtime 封裝，不將新 source 疊上旧 server/chunks。若失敗先分析，不連開多個 build。
2. 記錄 SHA、BUILD_ID、image ID/digest、layer 數、大小及 UTC；逐檔 SHA-256 對照 standalone server、static/server chunks、manifests、app entries、SRI references，並驗證 runtime 解析的 Next/React 檔案來自該份輸出。版本相同或 HTML metadata 相同本身不足以證明一致。
3. 不沿用 654 的 review 或 artifact proof 當作新 SHA 通過證據。若需修正原始碼，重新固定 SHA 並重做必要 build/review；「單次」是準備目標，不是略過失敗的理由。
4. 固定 digest；保留 read-only、cap_drop ALL、PID1 no-new-privileges、pids/resources、tmpfs、GA hostname/DNT guards、hash CSP/strict-dynamic、crawler volume target。candidate 用隔離 log 目錄、無 GA ID、無 OAuth 與背景寫入；正式 GA 與原 env 不變。不新增金鑰。

## Canary 與 review 次序

核心串行讀取：`/`（今日／近七日）、`/keywords`（今日／近七日）、`/keywords/沈伯洋/videos`、`/keywords/支持/videos`、`/channels`、`/videos`、`/live/current`、`/mayor`。`/live` 的既有 404 不能當成 `/live/current` 通過。

先檢查 readiness 與 sitemap warmup，分別記錄首次冷頁、首次冷 API、暖快取延遲；654 的冷首頁曾 **11.197 秒**，不能用暖數字宣稱已解決。保存首頁／關鍵字有限負載 p95（目標 <2 秒），總併發最多 2 且遵守全站負載閘門，不以長時間壓測搶正式查詢。

再檢查本輪 P0 修正的頁面、Y2 disabled/unavailable/loading/empty/有資料狀態、admin anonymous/reader denied 及既有權限可覆核狀態。認證和写入僅用既有隔離資料／mock，不為驗收新增權限或在正式 DB 試寫。

公開匿名 API、Cookie、Authorization、X-Api-Key、X-Service-Token、RSC 六組 cache 契約；4xx/429/5xx no-store、`/my` private、ISR STALE 可共享且 CSP hash/Vary 保留。OpenAPI **116 個 candidate 操作**須重新對照實際契約（115 是舊正式數字）；`/api/`、`/api/status`、17 個既有 sitemap 子檔全部 200、非空與 lastmod，若子檔數随資料改變，核對 index 實際清單而非硬湊 17。

每個新 UI 的 screenshots 與 tag 參考交作者之外的 Opus5.5/GPT-6.1 Sol；待重拍矩陣見 `docs/ui-retake-matrix.json`。真實 SHA／BUILD_ID、DNT、阻擋規則、去識別網路收據缺任一項不得宣稱 zero-GA 或視覺 pass。舊 0550/0620 finding 保持 open 到新獨立複驗；原始圖不覆寫。所有未驗頁面仍 pending，核心頁通過不等於全站完成。

## Dokploy 發布與回退

唯一 deploy owner 在 source、canary、獨立 UI review 通過後，以既有 Dokploy 權限精確更新兩個既有 TS compose services 的 pinned image。保存 prepared／compose-updated／deploy-requested 的去秘密 receipt，完整比較 Swarm Spec 除 image 與其衍生 label/ForceUpdate 外相同。保留 retained Laravel scheduler、presentation controller image、source writer、DB grants、Traefik、CF/WAF，不使用 `docker service update`。無可用 Dokploy 權限就交使用者既有登入 UI 執行，不尋找新 key。

最后已知回退 digest：`sha256:5b7d9171d9633c132766c65abd934c791787693a72b7f016bcd1408097dedadd`（`7eb48f4`）。既有 archive SHA-256：`78714eb474d3c78e8dbb613af0a21da9faf8b4bb1a1461789a86bc29f01f9967`。解凍後先驗證基線仍可用與回退 dry-run，再發布。發生 healthcheck/CSP/核心頁/私人快取錯誤即經 Dokploy 回到 release 前保存的 digest；保留 env/volumes，確認健康與核心頁、sitemap/API。此批無 migration 或來源寫入，正常程式回退不需覆蓋資料庫。

上線後回報 commit、digest、UTC、實際網址與新圖；等 babysit 正式瀏覽器驗收才標正式可見。此文件不構成解凍、部署或驗收批准。
